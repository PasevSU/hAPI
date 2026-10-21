'use strict';
// Тайни връзки (zero-knowledge): тайната се шифрова В БРАУЗЪРА, а сървърът пази само
// шифротекста. Ключът пътува във фрагмента на адреса (`/secret/<id>#<key>`), а
// фрагментът не се изпраща по мрежата — значи не влиза в логове, проксита и одита.
//
// Моделът е същият като на scrt.link (MIT): криптиране при клиента, ефимерност,
// изтриване след преглед или след срок. Разлики, съзнателни за hAPI:
//   • няма парола — самата ключова фраза Е ключът (втора парола не добавя сигурност,
//     ако ключът вече е в линка; добавя само объркване);
//   • записите са файлове в `secrets/` (не в SQLite), за да е изтриването едно
//     `unlink` и да не расте базата със шифротекст;
//   • `hint` е ОТКРИТ текст по избор на подателя (напр. „парола за ZIP“) — казва се
//     изрично в интерфейса, защото е единственото, което сървърът вижда.
//
// Тук няма криптография: AES-GCM се прави в браузъра (WebCrypto) при създаване и при
// преглед. Модулът само пази шифротекста, брои прегледите и решава кога е изтекъл.
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ID_LENGTH = 22;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_VIEWS = 1;
const MAX_VIEWS = 100;
const MAX_CIPHERTEXT_BYTES = 64 * 1024;
const MAX_HINT_LENGTH = 200;
const IV_BYTES = 12;

const nowMs = (now) => (typeof now === 'function' ? now() : Date.now());

/** Непрозрачен идентификатор (Crockford base32 без I/L/O/U — 22 знака ≈ 110 бита). */
function newId(bytes = crypto.randomBytes(ID_LENGTH)) {
  let out = '';
  for (let i = 0; i < ID_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const isValidId = (id) => typeof id === 'string' && /^[0-9A-HJKMNP-TV-Z]{22}$/.test(id);
const isValidIv = (iv) => typeof iv === 'string' && /^[A-Za-z0-9_-]{16}$/.test(iv); // 12 байта base64url

/** Шифротекстът идва като base64url; размерът е ограничен, за да не е хранилище за файлове. */
function normalizeCiphertext(value) {
  if (typeof value !== 'string' || !value) return { error: 'ciphertext е задължителен (base64url)' };
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return { error: 'ciphertext трябва да е base64url' };
  const bytes = Math.floor((value.length * 3) / 4);
  if (bytes > MAX_CIPHERTEXT_BYTES) return { error: `ciphertext е над ${MAX_CIPHERTEXT_BYTES} байта` };
  return { value };
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
 * Нов запис. Ключът НЕ е тук — нито в записа, нито в аргументите.
 * @returns {{error:string}|{record:object}}
 */
function createRecord({ ciphertext, iv, hint = '', expiresIn = DEFAULT_TTL_SECONDS, maxViews = DEFAULT_VIEWS } = {}, now) {
  const ct = normalizeCiphertext(ciphertext);
  if (ct.error) return { error: ct.error };
  if (!isValidIv(iv)) return { error: 'iv трябва да е 12 байта base64url' };
  const at = nowMs(now);
  const ttl = normalizeTtl(expiresIn);
  const record = {
    id: newId(),
    createdAt: new Date(at).toISOString(),
    expiresAt: new Date(at + ttl * 1000).toISOString(),
    maxViews: normalizeViews(maxViews),
    views: 0,
    lastViewAt: null,
    disabled: false,
    hint: normalizeHint(hint),
    iv,
    ciphertext: ct.value,
    // Отпечатък на шифротекста: администраторът вижда, че записът не е подменен,
    // без да му трябва ключът (който не съществува на сървъра).
    sha256: crypto.createHash('sha256').update(ct.value).digest('hex'),
  };
  return { record };
}

/** Какво вижда администраторът — никога шифротекста. */
function adminView(rec) {
  return {
    id: rec.id,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt || null,
    maxViews: Number(rec.maxViews || 0),
    views: Number(rec.views || 0),
    viewsLeft: Math.max(0, Number(rec.maxViews || 0) - Number(rec.views || 0)),
    lastViewAt: rec.lastViewAt || null,
    disabled: Boolean(rec.disabled),
    hint: rec.hint || '',
    bytes: Math.floor((String(rec.ciphertext || '').length * 3) / 4),
    sha256: rec.sha256 || null,
    path: '/secret/' + rec.id,
  };
}

// ── Съхранение: един файл на тайна, за да е изтриването едно `unlink` ──────────
const secretsDir = (root) => path.join(root, 'secrets');
const recordPath = (root, id) => path.join(secretsDir(root), id + '.json');

async function ensureDir(root) {
  await fsp.mkdir(secretsDir(root), { recursive: true, mode: 0o700 });
}

async function save(root, record) {
  await ensureDir(root);
  const target = recordPath(root, record.id);
  const tmp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(record), { mode: 0o600 });
  await fsp.rename(tmp, target);
  return target;
}

async function read(root, id) {
  if (!isValidId(id)) return null;
  try {
    const raw = await fsp.readFile(recordPath(root, id), 'utf8');
    const rec = JSON.parse(raw);
    return rec && rec.id === id ? rec : null;
  } catch {
    return null;
  }
}

async function remove(root, id) {
  if (!isValidId(id)) return false;
  try {
    await fsp.unlink(recordPath(root, id));
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
    const id = name.slice(0, -'.json'.length);
    const rec = await read(root, id);
    if (!rec || !inspectRecord(rec, now).ok) {
      if (await remove(root, id)) removed++;
    }
  }
  return removed;
}

/** Списък за администратора (без шифротекст), най-новите първи. */
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
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  DEFAULT_VIEWS,
  MAX_VIEWS,
  MAX_CIPHERTEXT_BYTES,
  MAX_HINT_LENGTH,
  IV_BYTES,
  newId,
  isValidId,
  isValidIv,
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
