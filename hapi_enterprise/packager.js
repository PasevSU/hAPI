'use strict';
// Пакетиране на портал (или избрани файлове) в ZIP с манифест, хешове и
// незадължителен PGP деташиран подпис.
//
// Структура на пакета:
//   PACKAGE_INDEX.json      — списък на файловете с размер и ПЪЛЕН набор хешове
//   manifest/portal.json    — метаданни на портала (без лични данни)
//   hashes/sha256sum.txt    — контролни суми в sha256sum формат (за `sha256sum -c`)
//   hashes/checksums.txt    — четим списък с всички алгоритми за всеки файл
//   originals/<файл>        — оригиналното съдържание
//
// На диска: <DATA_DIR>/packages/<id>.zip (+ <id>.zip.asc) и <id>.json (метаданни).
// Всички записи са атомарни (tmp + rename), с права 0600.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const ooxml = require('./ooxml');
const rules = require('./export-rules');
const pgp = require('./pgp');
const pkgcrypto = require('./package-crypto');

const MAX_FILES = 5000;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const DEFAULT_TTL_HOURS = 72;
const DEFAULT_MAX_KEPT = 50;
const ID_RE = /^[a-f0-9]{16,40}$/;

// Пълният набор хешове: криптографски (SHA-2/SHA-3) + бърз контрол (MD5).
// Включва се само алгоритъм, който тази OpenSSL сборка поддържа.
const HASH_ALGOS = ['sha256', 'sha512', 'sha384', 'sha3-256', 'sha1', 'md5'];
const available = (() => {
  const supported = new Set(crypto.getHashes());
  return HASH_ALGOS.filter((a) => supported.has(a));
})();

const bad = (message, status) => Object.assign(new Error(message), { status: status || 400 });

// Нивата на компресия са ИМЕНУВАНИ, за да не зависи договорът от числата на zlib.
// `none` = без компресия (важно за вече компресирани файлове и за отстраняване на
// проблеми), `fast`/`default`/`max` = 1/6/9. Непознато ниво е грешка, не подразбиране.
const COMPRESSION_LEVELS = { none: 0, store: 0, fast: 1, default: 6, normal: 6, max: 9, best: 9 };
function compressionLevel(value) {
  if (value === undefined || value === null || value === '') return 6;
  if (Number.isInteger(value)) {
    if (value < 0 || value > 9) throw bad('Нивото на компресия е от 0 до 9', 400);
    return value;
  }
  const named = COMPRESSION_LEVELS[String(value).toLowerCase()];
  if (named === undefined) throw bad('Невалидно ниво на компресия: ' + value, 400);
  return named;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Криптиране на ЦЕЛИЯ пакет (не на отделен файл). Режимът е именуван; непознат режим е
// 400, а не тихо „без криптиране“. Ако липсва парола, add-on-ът генерира такава и я връща
// ЕДИН път в отговора — на диска паролата не се записва никъде.
const ENCRYPTION_MODES = ['none', 'password'];
function encryptionSpec(value, password) {
  if (value === undefined || value === null || value === '' || value === false) return null;
  const mode = value === true ? 'password' : String(value).toLowerCase();
  if (!ENCRYPTION_MODES.includes(mode)) throw bad('Непознат режим на криптиране: ' + value, 400);
  if (mode === 'none') return null;
  const given = String(password == null ? '' : password);
  if (given && given.length < pkgcrypto.MIN_PASSWORD) throw bad(`Паролата трябва да е поне ${pkgcrypto.MIN_PASSWORD} знака`, 400);
  if (given.length > pkgcrypto.MAX_PASSWORD) throw bad(`Паролата е по-дълга от ${pkgcrypto.MAX_PASSWORD} знака`, 400);
  return { mode, password: given };
}

/** Всички налични хешове на буфер (един проход на алгоритъм, но върху памет). */
function hashAll(buf) {
  const out = {};
  for (const algo of available) out[algo] = crypto.createHash(algo).update(buf).digest('hex');
  return out;
}

function stamp(date) {
  const d = date || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function safeName(name) {
  const cleaned = rules.sanitizeSegment(String(name || '').replace(/\\/g, '/').split('/').pop());
  return cleaned || 'file.bin';
}

function create({ root }) {
  const dir = path.join(root, 'packages');
  const zipPath = (id) => path.join(dir, `${id}.zip`);
  const sigPath = (id) => path.join(dir, `${id}.zip.asc`);
  const metaPath = (id) => path.join(dir, `${id}.json`);

  function assertId(id) {
    const value = String(id || '');
    if (!ID_RE.test(value)) throw bad('Невалиден идентификатор на пакет', 400);
    return value;
  }

  async function writeAtomic(target, data, mode) {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const handle = await fsp.open(tmp, 'wx', mode || 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(tmp, target);
  }

  /**
   * Създава пакет.
   * files:    [{ name, data: Buffer, path? }]
   * sign:     { secretArmored, keyId, label } | null
   * excluded: [{ name, size, reason }] — какво е останало ИЗВЪН пакета и защо (публичният
   *           пакет не слага файлове с ключ/забранени, а манифестът казва кои са те).
   * origin:   'public' — пакетът е поискан от публичната страница, не от администратора.
   */
  async function build({ portal, files, sign, now, ttlHours, excluded, origin, compression, encryption, password }) {
    const list = Array.isArray(files) ? files : [];
    const level = compressionLevel(compression);
    // Криптирането се решава ПРЕДИ писането: невалидна парола трябва да върне 400, а не
    // да остави половин пакет на диска.
    const sealSpec = encryptionSpec(encryption, password);
    if (!list.length) throw bad('Пакетът е празен — няма файлове', 400);
    if (list.length > MAX_FILES) throw bad(`Твърде много файлове (макс. ${MAX_FILES})`, 413);
    const total = list.reduce((sum, f) => sum + (f && f.data ? f.data.length : 0), 0);
    if (total > MAX_TOTAL_BYTES) throw bad('Пакетът надвишава допустимия размер', 413);

    const createdAt = (now instanceof Date ? now : new Date()).toISOString();
    const id = crypto.randomBytes(12).toString('hex');
    const used = new Set();
    const entries = [];
    const indexFiles = [];

    for (const file of list) {
      if (!file || !Buffer.isBuffer(file.data)) throw bad('Невалидни данни за файл', 400);
      const base = safeName(file.name);
      // При път от хранилището (storage/...) се запазва структурата на папките.
      const wanted = file.path ? String(file.path) : `originals/${base}`;
      const checked = rules.safeRelPath(wanted);
      if (!checked.ok) throw bad(`Невалиден път в пакета: ${wanted}`, 400);
      let rel = checked.path;
      let n = 1;
      while (used.has(rel.toLowerCase())) {
        const slash = rel.lastIndexOf('/');
        const dir = slash >= 0 ? rel.slice(0, slash + 1) : '';
        const leaf = slash >= 0 ? rel.slice(slash + 1) : rel;
        const dot = leaf.lastIndexOf('.');
        const stem = dot > 0 ? leaf.slice(0, dot) : leaf;
        const ext = dot > 0 ? leaf.slice(dot) : '';
        rel = `${dir}${stem}-${++n}${ext}`;
      }
      used.add(rel.toLowerCase());
      const hashes = hashAll(file.data);
      entries.push({ name: rel, data: file.data });
      indexFiles.push({
        path: rel,
        name: base,
        size: file.data.length,
        sha256: hashes.sha256 || sha256(file.data),
        hashes,
        source: file.source || 'portal',
      });
    }

    const signature = sign && sign.secretArmored
      ? { status: 'signed', keyId: sign.keyId || '', label: sign.label || '', file: `${id}.zip.asc`, algorithm: 'OpenPGP' }
      : { status: 'unsigned', keyId: '', label: '', file: '', algorithm: '' };

    const index = {
      schema_version: '1.1',
      package_id: id,
      created_at: createdAt,
      // Нивото се записва в индекса: получателят вижда С КАКВО е направен архивът,
      // а не гадае от размера. 0 значи „без компресия“ (ZIP method 0).
      compression: { level, method: level === 0 ? 0 : 8, name: level === 0 ? 'store' : 'deflate' },
      hash_algorithms: available,
      portal: portal
        ? {
          id: portal.id,
          slug: portal.slug,
          title: portal.title,
          category: portal.category || '',
          subject: portal.subject || '',
          flag: portal.flag || 'none',
          storage_root: portal.storage_root || '/share',
        }
        : null,
      signature: { status: signature.status, key_id: signature.keyId, algorithm: signature.algorithm },
      files: indexFiles,
      total_bytes: total,
    };
    // Какво НЕ е влезнало в пакета и защо — за да не изглежда липсващ файл като грешка.
    const skipped = (Array.isArray(excluded) ? excluded : [])
      .filter((x) => x && x.name)
      .map((x) => ({ name: String(x.name), size: Number(x.size) || 0, reason: String(x.reason || 'EXCLUDED') }));
    if (skipped.length) index.excluded = skipped;

    const storageCount = indexFiles.filter((f) => f.source === 'storage').length;
    const manifest = {
      schema_version: '1.1',
      exported_at: createdAt,
      portal: index.portal,
      counts: { files: indexFiles.length, bytes: total, fromStorage: storageCount, excluded: skipped.length },
      hash_algorithms: available,
      notes: storageCount
        ? 'Файловете под storage/ са копирани директно от папката на портала (storage_root).'
        : '',
      verification: `Всеки файл носи пълен набор хешове (${available.join(', ')}) в PACKAGE_INDEX.json; hashes/sha256sum.txt е във формат sha256sum, а hashes/checksums.txt съдържа всички алгоритми.`,
    };
    // Отказът се назовава изрично — иначе получателят брои файловете и мисли, че липсват.
    if (skipped.length) manifest.refused = skipped;

    const sums = indexFiles.map((f) => `${f.sha256}  ${f.path}`).join('\n') + '\n';
    // Четим списък с ВСИЧКИ хешове: един блок на файл (лесно се сравнява на ръка).
    const checksums = indexFiles
      .map((f) => {
        const lines = [`# ${f.path} (${f.size} B)`];
        for (const algo of available) lines.push(`${algo}\t${f.hashes[algo]}`);
        return lines.join('\n');
      })
      .join('\n\n') + '\n';
    const zipEntries = [
      { name: 'PACKAGE_INDEX.json', data: Buffer.from(JSON.stringify(index, null, 2), 'utf8') },
      { name: 'manifest/portal.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
      { name: 'hashes/sha256sum.txt', data: Buffer.from(sums, 'utf8') },
      { name: 'hashes/checksums.txt', data: Buffer.from(checksums, 'utf8') },
      ...entries,
    ];
    const zipBuffer = ooxml.zip(zipEntries, { level });
    const zipSha256 = sha256(zipBuffer);
    // ── Криптиране на целия пакет (AES-256-GCM, scrypt) ──────────────────────
    // Плаща се само ако е поискано. `sha256` в индекса остава хешът на ZIP-а ПРЕДИ
    // криптиране, за да може получателят да свери съдържанието след разшифроване;
    // хешът на самия доставян файл е в `encryption.sha256`.
    let payload = zipBuffer;
    let sealed = null;
    let generatedPassword = '';
    if (sealSpec) {
      generatedPassword = sealSpec.password ? '' : pkgcrypto.generatePassword();
      payload = await pkgcrypto.encrypt(zipBuffer, sealSpec.password || generatedPassword);
      sealed = {
        ...pkgcrypto.describe(),
        mode: sealSpec.mode,
        bytes: payload.length,
        packageBytes: zipBuffer.length,
        sha256: sha256(payload),
        packageSha256: zipSha256,
        passwordGenerated: Boolean(generatedPassword),
      };
    }
    const slug = safeName((portal && portal.slug) || 'package').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60);
    const fileName = `${slug}-${stamp(now instanceof Date ? now : new Date())}.zip${sealed ? '.enc' : ''}`;

    let signed = null;
    let armored = '';
    if (sign && sign.secretArmored) {
      // Подписът покрива ДОСТАВЯНИЯ файл (шифротекста, ако има криптиране) — иначе
      // получателят не може да провери това, което държи в ръка.
      const result = pgp.signDetached(payload, sign.secretArmored);
      armored = result.armored;
      signed = {
        keyId: result.keyId,
        fingerprint: result.fingerprint,
        algorithm: result.algorithm,
        hash: result.hash,
        createdAt: result.createdAt,
      };
      signature.keyId = result.keyId;
    }

    const ttl = Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : DEFAULT_TTL_HOURS;
    const storageFiles = indexFiles.filter((f) => f.source === 'storage').length;
    const meta = {
      id,
      fileName,
      // `size` е размерът на ДОСТАВЯНИЯ файл (контейнерът, ако има криптиране) — това е
      // числото, което трябва да съвпада с това, което получателят изтегля.
      size: payload.length,
      sha256: zipSha256,
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + ttl * 3600_000).toISOString(),
      portalId: portal ? portal.id : '',
      portalSlug: portal ? portal.slug : '',
      portalTitle: portal ? portal.title : '',
      files: indexFiles.length,
      storageFiles,
      storageRoot: portal ? portal.storage_root || '' : '',
      bytes: total,
      entries: zipEntries.length,
      compression: { level, method: level === 0 ? 0 : 8, name: level === 0 ? 'store' : 'deflate' },
      encryption: sealed,
      hasEncryption: Boolean(sealed),
      signature: signed
        ? { ...signature, keyId: signed.keyId, fingerprint: signed.fingerprint, hash: signed.hash, signedAt: signed.createdAt }
        : signature,
      hasSignature: Boolean(signed),
    };
    if (origin) meta.origin = String(origin);
    if (skipped.length) meta.excluded = skipped.length;

    await writeAtomic(zipPath(id), payload);
    if (armored) await writeAtomic(sigPath(id), Buffer.from(armored, 'utf8'));
    await writeAtomic(metaPath(id), Buffer.from(JSON.stringify(meta, null, 2), 'utf8'));
    // Паролата се връща САМО тук и само когато е генерирана — в <id>.json я няма.
    return generatedPassword ? { ...meta, generatedPassword } : meta;
  }

  async function readMeta(id) {
    try {
      const raw = await fsp.readFile(metaPath(assertId(id)), 'utf8');
      const meta = JSON.parse(raw);
      return meta && meta.id === id ? meta : null;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      if (e.status) throw e;
      return null;
    }
  }

  async function list() {
    let names = [];
    try {
      names = await fsp.readdir(dir);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const meta = await readMeta(name.slice(0, -5));
      if (meta) out.push(meta);
    }
    out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return out;
  }

  async function artifact(id, kind) {
    const meta = await readMeta(id);
    if (!meta) return null;
    const file = kind === 'signature' ? sigPath(meta.id) : zipPath(meta.id);
    try {
      const stat = await fsp.stat(file);
      if (!stat.isFile()) return null;
      return { file, stat, meta, name: kind === 'signature' ? `${meta.fileName}.asc` : meta.fileName };
    } catch {
      return null;
    }
  }

  async function remove(id) {
    const meta = await readMeta(id);
    if (!meta) return { removed: false, id };
    await fsp.rm(zipPath(meta.id), { force: true });
    await fsp.rm(sigPath(meta.id), { force: true });
    await fsp.rm(metaPath(meta.id), { force: true });
    return { removed: true, id: meta.id };
  }

  async function prune({ maxAgeHours = DEFAULT_TTL_HOURS, maxCount = DEFAULT_MAX_KEPT, now } = {}) {
    const all = await list();
    const at = (now instanceof Date ? now : new Date()).getTime();
    const ttlHours = Number.isFinite(Number(maxAgeHours)) && Number(maxAgeHours) >= 0 ? Number(maxAgeHours) : DEFAULT_TTL_HOURS;
    const ttlMs = ttlHours * 3600_000;
    const removed = [];
    let kept = 0;
    for (const meta of all) {
      const created = Date.parse(meta.createdAt) || at;
      const expired = at - created > ttlMs;
      if (expired || kept >= Math.max(1, Number(maxCount) || DEFAULT_MAX_KEPT)) {
        await remove(meta.id);
        removed.push(meta.id);
      } else {
        kept++;
      }
    }
    return { removed, kept };
  }

  return { dir, build, list, readMeta, artifact, remove, prune, limits: { MAX_FILES, MAX_TOTAL_BYTES } };
}

module.exports = { create, sha256, safeName, limits: { MAX_FILES, MAX_TOTAL_BYTES } };
