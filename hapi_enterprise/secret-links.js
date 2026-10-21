'use strict';
// Тайни връзки (zero-knowledge): тайната се шифрова В БРАУЗЪРА, а сървърът пази само
// непрозрачен плик с шифротекст. Моделът следва scrt.link v2 (MIT), но кодът е собствен
// и без зависимости.
//
// Линкът е `/secret#<id><ключ>` — ЦЯЛАТА информация е след „#“, тоест във фрагмента,
// който браузърът не изпраща. Затова:
//   • идентификаторът (22 знака) НЕ влиза в пътя → не влиза в логове, проксита, Referer
//     или одита на add-on-а;
//   • сървърът получава само `sha256(id)` (64 hex знака) и по него намира файла;
//   • ключът (32 байта, base64url) също остава само в браузъра.
//
// Съзнателни разлики с scrt.link:
//   • записите са файлове в `secrets/` (не в SQLite), за да е изтриването едно `unlink`;
//   • `hint` е ОТКРИТ текст по избор на подателя — единственото, което сървърът вижда;
//   • `receipt` (8 знака) е чекът за подателя: по него намира записа в панела, без да
//     пази линка и без да знае ключа.
//
// Плик (`envelope`) е непрозрачен за сървъра JSON:
//   { v:2, iv:<b64u 12B>, ct:<b64u>, pwd?:{ alg:'PBKDF2-SHA256', iterations, salt } }
// Ако `pwd` присъства, `ct` е шифрован ДВА пъти: отвън с ключ от паролата (PBKDF2),
// отвътре с ключа от линка. Затова и паролата, и линкът са нужни — сървърът не знае нито
// едното, нито другото.
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ID_LENGTH = 22;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_BYTES = 32;
const KEY_LENGTH = 43; // base64url без подпълване на 32 байта
const FRAGMENT_LENGTH = ID_LENGTH + KEY_LENGTH;
const RECEIPT_LENGTH = 8;
const HASH_LENGTH = 64;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_VIEWS = 1;
const MAX_VIEWS = 100;
const MAX_CIPHERTEXT_BYTES = 64 * 1024;
const MAX_HINT_LENGTH = 200;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const MIN_PBKDF2_ITERATIONS = 100000;
const MAX_PBKDF2_ITERATIONS = 2000000;

const nowMs = (now) => (typeof now === 'function' ? now() : Date.now());

/** Непрозрачен идентификатор (Crockford base32 без I/L/O/U — 22 знака ≈ 110 бита). */
function newId(bytes = crypto.randomBytes(ID_LENGTH)) {
  let out = '';
  for (let i = 0; i < ID_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const isValidId = (id) => typeof id === 'string' && /^[0-9A-HJKMNP-TV-Z]{22}$/.test(id);
const isValidKey = (key) => typeof key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key);
const isValidHash = (hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
const isValidIv = (iv) => typeof iv === 'string' && /^[A-Za-z0-9_-]{16}$/.test(iv); // 12 байта base64url

/** `sha256(id)` — единственото, което сървърът знае за идентификатора. */
const idHashOf = (id) => crypto.createHash('sha256').update(String(id)).digest('hex');

/** Нов линк: `id` (за намиране) + `key` (за декриптиране), слепени във фрагмента. */
function newFragment() {
  const id = newId();
  const key = crypto.randomBytes(KEY_BYTES).toString('base64url');
  return { id, key, fragment: id + key, idHash: idHashOf(id) };
}

/**
 * Разчита фрагмента. Връща `null` при каквото и да е отклонение — така един повреден или
 * подменен линк не стига до сървъра с безсмислена заявка.
 * @returns {{id:string,key:string,fragment:string,idHash:string}|null}
 */
function parseFragment(value) {
  const text = String(value == null ? '' : value).replace(/^#/, '').replace(/^\?+/, '');
  if (text.length !== FRAGMENT_LENGTH) return null;
  const id = text.slice(0, ID_LENGTH);
  const key = text.slice(ID_LENGTH);
  if (!isValidId(id) || !isValidKey(key)) return null;
  return { id, key, fragment: text, idHash: idHashOf(id) };
}

/** Чек за подателя: 8 знака от същата азбука. */
function newReceipt() {
  const bytes = crypto.randomBytes(RECEIPT_LENGTH);
  let out = '';
  for (let i = 0; i < RECEIPT_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Шифротекстът идва като base64url; размерът е ограничен, за да не е хранилище за файлове. */
function normalizeCiphertext(value) {
  if (typeof value !== 'string' || !value) return { error: 'ciphertext е задължителен (base64url)' };
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return { error: 'ciphertext трябва да е base64url' };
  const bytes = Math.floor((value.length * 3) / 4);
  if (bytes > MAX_CIPHERTEXT_BYTES) return { error: `ciphertext е над ${MAX_CIPHERTEXT_BYTES} байта` };
  return { value };
}

/**
 * Проверява плика. Връща нормализиран обект — сървърът не разбира съдържанието, но
 * проверява формата, за да не пази боклук и да не приема парола, която не е PBKDF2.
 * @returns {{error:string}|{value:object,requiresPassword:boolean}}
 */
function normalizeEnvelope(envelope) {
  let parsed = envelope;
  if (typeof parsed === 'string') {
    if (!parsed.trim()) return { error: 'envelope е задължителен' };
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return { error: 'envelope трябва да е JSON' };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'envelope трябва да е обект' };
  if (Number(parsed.v) !== 2) return { error: 'envelope трябва да е версия 2' };
  const ct = normalizeCiphertext(parsed.ct);
  if (ct.error) return { error: ct.error };
  if (!isValidIv(parsed.iv)) return { error: 'iv трябва да е 12 байта base64url' };
  const out = { v: 2, iv: parsed.iv, ct: ct.value };
  if (parsed.pwd != null) {
    const pwd = parsed.pwd;
    if (!pwd || typeof pwd !== 'object') return { error: 'pwd трябва да е обект' };
    if (pwd.alg !== 'PBKDF2-SHA256') return { error: 'pwd.alg трябва да е PBKDF2-SHA256' };
    const iterations = Number(pwd.iterations);
    if (!Number.isSafeInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS) {
      return { error: `pwd.iterations трябва да е между ${MIN_PBKDF2_ITERATIONS} и ${MAX_PBKDF2_ITERATIONS}` };
    }
    if (typeof pwd.salt !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(pwd.salt)) return { error: 'pwd.salt трябва да е 16 байта base64url' };
    // `check` = sha256 на ключа, извлечен от паролата. Сървърът сравнява САМО него, за да
    // не изразходва преглед при сгрешена парола — и никога не вижда паролата или ключа.
    if (typeof pwd.check !== 'string' || !/^[a-f0-9]{64}$/.test(pwd.check)) return { error: 'pwd.check трябва да е 64 hex знака' };
    out.pwd = { alg: 'PBKDF2-SHA256', iterations, salt: pwd.salt, check: pwd.check };
  }
  return { value: out, requiresPassword: Boolean(out.pwd) };
}

function normalizeTtl(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.trunc(n), MAX_TTL_SECONDS);
}

function normalizeViews(views) {
  const n = Number(views);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_VIEWS;
  return Math.min(Math.trunc(n), MAX_VIEWS);
}

function normalizeHint(hint) {
  const text = String(hint == null ? '' : hint).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return text.slice(0, MAX_HINT_LENGTH);
}

const isExpired = (rec, now) => Boolean(rec && rec.expiresAt && Date.parse(rec.expiresAt) <= nowMs(now));
const isExhausted = (rec) => Boolean(rec && Number(rec.maxViews) > 0 && Number(rec.views || 0) >= Number(rec.maxViews));

/** Единственото място, което решава дали една тайна още съществува. */
function inspectRecord(rec, now) {
  if (!rec) return { ok: false, reason: 'missing' };
  if (rec.disabled) return { ok: false, reason: 'revoked' };
  if (isExpired(rec, now)) return { ok: false, reason: 'expired' };
  if (isExhausted(rec)) return { ok: false, reason: 'used' };
  return { ok: true, reason: 'ok' };
}

/**
 * Нов запис. Нито идентификаторът, нито ключът са тук — само `idHash` и пликът.
 * @returns {{error:string}|{record:object}}
 */
function createRecord({ envelope, idHash, hint = '', expiresIn = DEFAULT_TTL_SECONDS, maxViews = DEFAULT_VIEWS } = {}, now) {
  const env = normalizeEnvelope(envelope);
  if (env.error) return { error: env.error };
  const hash = idHash == null ? crypto.randomBytes(32).toString('hex') : String(idHash);
  if (!isValidHash(hash)) return { error: 'idHash трябва да е 64 hex знака (sha256 на идентификатора)' };
  const at = nowMs(now);
  const ttl = normalizeTtl(expiresIn);
  const record = {
    idHash: hash,
    receipt: newReceipt(),
    createdAt: new Date(at).toISOString(),
    expiresAt: new Date(at + ttl * 1000).toISOString(),
    maxViews: normalizeViews(maxViews),
    views: 0,
    lastViewAt: null,
    disabled: false,
    requiresPassword: env.requiresPassword,
    hint: normalizeHint(hint),
    envelope: env.value,
    // Отпечатък на плика: администраторът вижда, че записът не е подменен, без да му
    // трябва ключът (който не съществува на сървъра).
    sha256: crypto.createHash('sha256').update(JSON.stringify(env.value)).digest('hex'),
  };
  return { record };
}

/** Какво вижда администраторът — никога плика и никога идентификатора. */
function adminView(rec) {
  return {
    idHash: rec.idHash,
    receipt: rec.receipt || '',
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt || null,
    maxViews: Number(rec.maxViews || 0),
    views: Number(rec.views || 0),
    viewsLeft: Math.max(0, Number(rec.maxViews || 0) - Number(rec.views || 0)),
    lastViewAt: rec.lastViewAt || null,
    disabled: Boolean(rec.disabled),
    requiresPassword: Boolean(rec.requiresPassword),
    hint: rec.hint || '',
    bytes: Math.floor((String((rec.envelope || {}).ct || '').length * 3) / 4),
    sha256: rec.sha256 || null,
    path: '/secret',
  };
}

// ── Съхранение: един файл на тайна, за да е изтриването едно `unlink` ──────────
const secretsDir = (root) => path.join(root, 'secrets');
const recordPath = (root, hash) => path.join(secretsDir(root), hash + '.json');

async function ensureDir(root) {
  await fsp.mkdir(secretsDir(root), { recursive: true, mode: 0o700 });
}

async function save(root, record) {
  await ensureDir(root);
  const target = recordPath(root, record.idHash);
  const tmp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(record), { mode: 0o600 });
  await fsp.rename(tmp, target);
  return target;
}

async function read(root, hash) {
  if (!isValidHash(hash)) return null;
  try {
    const raw = await fsp.readFile(recordPath(root, hash), 'utf8');
    const rec = JSON.parse(raw);
    return rec && rec.idHash === hash ? rec : null;
  } catch {
    return null;
  }
}

async function remove(root, hash) {
  if (!isValidHash(hash)) return false;
  try {
    await fsp.unlink(recordPath(root, hash));
    return true;
  } catch (e) {
    return e.code === 'ENOENT';
  }
}

/** Изтрива изтеклите и изчерпаните файлове. Връща броя изтрити. */
async function sweep(root, now) {
  let removed = 0;
  let names = [];
  try {
    names = await fsp.readdir(secretsDir(root));
  } catch (e) {
    if (e.code === 'ENOENT') return 0;
    throw e;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const hash = name.slice(0, -'.json'.length);
    const rec = await read(root, hash);
    if (!rec || !inspectRecord(rec, now).ok) {
      if (await remove(root, hash)) removed++;
    }
  }
  return removed;
}

/** Списък за администратора (без плик), най-новите първи. */
async function list(root, now) {
  let names = [];
  try {
    names = await fsp.readdir(secretsDir(root));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const rec = await read(root, name.slice(0, -'.json'.length));
    if (rec) out.push({ ...adminView(rec), alive: inspectRecord(rec, now).ok });
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

module.exports = {
  ALPHABET,
  ID_LENGTH,
  KEY_BYTES,
  KEY_LENGTH,
  FRAGMENT_LENGTH,
  RECEIPT_LENGTH,
  HASH_LENGTH,
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  DEFAULT_VIEWS,
  MAX_VIEWS,
  MAX_CIPHERTEXT_BYTES,
  MAX_HINT_LENGTH,
  IV_BYTES,
  SALT_BYTES,
  MIN_PBKDF2_ITERATIONS,
  MAX_PBKDF2_ITERATIONS,
  newId,
  newFragment,
  newReceipt,
  parseFragment,
  idHashOf,
  isValidId,
  isValidKey,
  isValidHash,
  isValidIv,
  normalizeEnvelope,
  normalizeHint,
  inspectRecord,
  createRecord,
  adminView,
  secretsDir,
  recordPath,
  save,
  read,
  remove,
  sweep,
  list,
};
