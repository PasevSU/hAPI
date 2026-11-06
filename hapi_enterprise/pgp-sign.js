'use strict';
// ПОДПИСВАНЕ НА ПАПКА И НА МНОЖЕСТВО ФАЙЛОВЕ (PGP) — с ключа, който ВЕЧЕ е зададен.
//
// Защо отделен модул: дотук се подписваше само цял експортен пакет (`packager.js`). Човекът
// обаче има нужда от двете неща, които липсваха:
//   1. ПАПКА — подпис върху КАНОНИЧЕН манифест (път, размер и SHA-256 на всеки файл), за да
//      се доказва „този набор от файлове, точно тези байтове“;
//   2. МНОЖЕСТВО ФАЙЛОВЕ ПООТДЕЛНО — detached подпис за всеки файл, за да може всеки да се
//      проверява сам, без да зависи от останалите.
//
// Ключът и паролата НЕ се искат от човека: `tools.signer()` ползва прикачения в конзолата
// ключ, а ако няма — ключа от опциите (`pgp_path_public`/`pgp_path_secret`, с паролата от
// `pgp_key_pass`/`pgp_path_pass`). Затова тук няма поле за парола — тя или е в конфигурацията,
// или ключът е незащитен.
//
// Пътищата са ограничени до хранилищата (`/share`, `/media`): символни връзки не се следват,
// „..“ не се приема, а резултатът е ZIP само с подписи и манифест (без копие на файловете).
//
// КОДОВЕТЕ, с които това подписване отказва (панелът ги показва като „КОД: съобщение“):
//   'NO_SIGNING_KEY: няма ключ за подписване — задай pgp_path_secret или прикачи ключ'
//   'INVALID_PATH: пътят липсва, съдържа нулев байт или не е абсолютен и не е под /share или /media'
//   'PATH_OUTSIDE_STORAGE: пътят сочи извън /share и /media (вкл. през „..“ или симв. връзка)'
//   'NOT_FOUND: пътят не съществува'
//   'NOT_A_FOLDER: подай папка, а не файл'
//   'NOT_A_FILE: в списъка с файлове има папка'
//   'NOTHING_TO_SIGN: няма нито папка, нито файлове'
//   'TOO_MANY_FILES: над 500 файла — подпиши подпапка'
//   'TOO_LARGE: над 128 MB наведнъж — подпиши подпапка'
//   'CHANGED_WHILE_SIGNING: файл се е променил между четенето и подписа (409)'
//   'INVALID_ID: невалиден идентификатор на архив'
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const ooxml = require('./ooxml');

const MAX_FILES = 500;
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_AGE_DAYS = 30;

function create(deps) {
  const { tools, root, roots, audit, log, retention = 50 } = deps;
  if (!tools) throw new Error('pgp-sign: липсва tools (pgp-tools)');
  if (!root) throw new Error('pgp-sign: липсва root (папка за архивите)');
  if (!roots || typeof roots !== 'object') throw new Error('pgp-sign: липсва roots (логически → реален път)');

  // Кодът се добавя от маршрута (`КОД: съобщение`) — тук е само съобщението, за да няма
  // „NOT_FOUND: NOT_FOUND: …“ в отговора.
  const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

  /** Логическите корени (`/share`, `/media`) → реалните им пътища в тази инсталация. */
  function resolveInput(input) {
    const raw = String(input == null ? '' : input).trim();
    if (!raw || raw.includes('\0')) throw fail(400, 'INVALID_PATH', 'Липсва път');
    for (const [logical, real] of Object.entries(roots)) {
      if (!real) continue;
      if (raw === logical) return path.resolve(real);
      if (raw.startsWith(logical + '/')) return path.resolve(real, raw.slice(logical.length + 1));
    }
    if (!path.isAbsolute(raw)) throw fail(400, 'INVALID_PATH', 'Пътят трябва да е абсолютен или да започва с /share или /media');
    return path.resolve(raw);
  }

  /** Влиза ли пътят в разрешен корен (след `realpath`, тоест без символни връзки навън). */
  async function insideRoot(target) {
    let real;
    try {
      real = await fsp.realpath(target);
    } catch {
      throw fail(404, 'NOT_FOUND', 'Пътят не съществува: ' + target);
    }
    const allowed = await Promise.all(Object.values(roots).filter(Boolean).map((r) => fsp.realpath(r).catch(() => path.resolve(r))));
    const prefixOk = allowed.some((r) => real === r || real.startsWith(r + path.sep));
    if (!prefixOk) throw fail(403, 'PATH_OUTSIDE_STORAGE', 'Пътят е извън /share и /media');
    return real;
  }

  const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

  /** Файловете в папка: без символни връзки, без скрити имена, с лимити. */
  async function listFolder(dir, recursive) {
    const out = [];
    let bytes = 0;
    async function walk(current, rel) {
      const entries = await fsp.readdir(current, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const abs = path.join(current, entry.name);
        const relPath = rel ? rel + '/' + entry.name : entry.name;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (recursive) await walk(abs, relPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const stat = await fsp.stat(abs);
        if (!stat.isFile() || stat.size < 0) continue;
        bytes += stat.size;
        if (out.length >= MAX_FILES) throw fail(413, 'TOO_MANY_FILES', `Повече от ${MAX_FILES} файла — подпиши подпапка`);
        if (bytes > MAX_BYTES) throw fail(413, 'TOO_LARGE', `Над ${Math.round(MAX_BYTES / 1024 / 1024)} MB — подпиши подпапка`);
        out.push({ abs, rel: relPath, size: stat.size });
      }
    }
    await walk(dir, '');
    return out;
  }

  /** Каноничен манифест: подреден, без времена на файловете, само път/размер/SHA-256. */
  function manifestFor(folderRel, entries) {
    const files = entries
      .map((e) => ({ path: e.rel, size: e.size, sha256: e.sha256 }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return Buffer.from(JSON.stringify({
      type: 'hapi-folder-manifest',
      version: 1,
      folder: folderRel,
      fileCount: files.length,
      totalBytes: files.reduce((n, f) => n + f.size, 0),
      files,
    }, null, 2), 'utf8');
  }

  const nameFor = (rel, armor) => rel + (armor === false ? '.sig' : '.asc');

  /** Подписва един буфер с избрания ключ (ключът от опциите НЕ иска парола). */
  function signBuffer(signer, data, armor) {
    const result = signer.sign(data);
    return { armored: result.armored, keyId: result.keyId, fingerprint: result.fingerprint, algorithm: result.algorithm, hash: result.hash, createdAt: result.createdAt, armor: armor !== false };
  }

  function artifactPath(id) {
    const safe = String(id || '').trim();
    if (!/^[a-z0-9]{8,32}$/.test(safe)) throw fail(400, 'INVALID_ID', 'Невалиден идентификатор');
    return path.join(root, safe + '.zip');
  }

  async function prune() {
    try {
      const names = await fsp.readdir(root);
      const files = [];
      for (const name of names) {
        if (!name.endsWith('.zip')) continue;
        const stat = await fsp.stat(path.join(root, name)).catch(() => null);
        if (stat && stat.isFile()) files.push({ name, at: stat.mtimeMs });
      }
      files.sort((a, b) => b.at - a.at);
      for (const old of files.slice(retention)) await fsp.rm(path.join(root, old.name), { force: true }).catch(() => { });
      const cut = Date.now() - MAX_AGE_DAYS * 86400000;
      for (const item of files.slice(0, retention)) {
        if (item.at < cut) await fsp.rm(path.join(root, item.name), { force: true }).catch(() => { });
      }
    } catch {
      // почистването не бива да събаря подписването
    }
  }

  /**
   * Подписва папка и/или списък файлове.
   * `folder` — логически или абсолютен път; `paths` — масив от файлове; `perFile` — по
   * подразбиране истина (всеки файл получава свой detached подпис); `armor` — `.asc` срещу `.sig`.
   */
  async function sign({ keyId, folder, paths, recursive = true, perFile = true, armor = true } = {}) {
    const signer = tools.signer(keyId);
    if (!signer) throw fail(400, 'NO_SIGNING_KEY', 'Няма PGP ключ за подписване — задай pgp_path_secret в опциите на add-on-а (или прикачи ключ в „Настройки → PGP ключ и автоподписване“)');

    const entries = [];
    const sigEntries = [];
    const signed = [];
    let folderInfo = null;

    if (folder) {
      const dirAbs = await insideRoot(resolveInput(folder));
      const stat = await fsp.stat(dirAbs);
      if (!stat.isDirectory()) throw fail(400, 'NOT_A_FOLDER', 'Пътят не е папка: ' + folder);
      const files = await listFolder(dirAbs, recursive !== false);
      for (const file of files) file.sha256 = sha256(await fsp.readFile(file.abs));
      const folderRel = folder === dirAbs ? path.basename(dirAbs) : String(folder).trim();
      const manifest = manifestFor(folderRel, files);
      const manifestSig = signBuffer(signer, manifest, armor);
      entries.push({ name: 'FOLDER_MANIFEST.json', data: manifest });
      sigEntries.push({ name: nameFor('FOLDER_MANIFEST.json', armor), data: manifestSig.armored });
      folderInfo = {
        path: folderRel,
        files: files.length,
        bytes: files.reduce((n, f) => n + f.size, 0),
        manifestSha256: sha256(manifest),
        manifestSignature: nameFor('FOLDER_MANIFEST.json', armor),
      };
      for (const file of files) {
        signed.push({ path: file.rel, size: file.size, sha256: file.sha256, signature: perFile === false ? '' : nameFor(file.rel, armor) });
        if (perFile === false) continue;
        const buf = await fsp.readFile(file.abs);
        if (sha256(buf) !== file.sha256) throw fail(409, 'CHANGED_WHILE_SIGNING', 'Файлът се промени по време на подписването: ' + file.rel);
        sigEntries.push({ name: nameFor(file.rel, armor), data: signBuffer(signer, buf, armor).armored });
      }
    }

    for (const raw of Array.isArray(paths) ? paths : []) {
      const target = await insideRoot(resolveInput(raw));
      const stat = await fsp.stat(target);
      if (!stat.isFile()) throw fail(400, 'NOT_A_FILE', 'Пътят не е файл: ' + raw);
      const buf = await fsp.readFile(target);
      const digest = sha256(buf);
      const rel = path.basename(target);
      const name = nameFor(rel, armor);
      const sig = signBuffer(signer, buf, armor);
      sigEntries.push({ name, data: sig.armored });
      signed.push({ path: rel, size: buf.length, sha256: digest, signature: name });
    }

    if (!signed.length) throw fail(400, 'NOTHING_TO_SIGN', 'Няма файлове за подписване — подай folder и/или paths');

    // Един и същ файл не бива да влиза два пъти в ZIP-а (иначе подписът е объркващ).
    const seen = new Set();
    const uniqueSigs = sigEntries.filter((e) => (seen.has(e.name) ? false : (seen.add(e.name), true)));
    const index = Buffer.from(JSON.stringify({
      type: 'hapi-signature-index',
      version: 1,
      createdAt: new Date().toISOString(),
      keyId: signer.keyId,
      source: signer.source,
      armor: armor !== false,
      folder: folderInfo,
      files: signed,
    }, null, 2), 'utf8');

    // Индексът СЪЩО се подписва: иначе списъкът „кое с кое върви“ не е защитен.
    uniqueSigs.push({ name: nameFor('SIGNATURES.json', armor), data: signBuffer(signer, index, armor).armored });
    // `entries` носи САМИТЕ манифести (без копие на файловете), `uniqueSigs` — подписите.
    const zip = ooxml.zip([{ name: 'SIGNATURES.json', data: index }, ...entries, ...uniqueSigs], { level: 6 });
    const id = crypto.randomBytes(8).toString('hex');
    const fileName = 'signatures-' + new Date().toISOString().replace(/[:.]/g, '-') + '.zip';
    await fsp.mkdir(root, { recursive: true });
    await fsp.writeFile(artifactPath(id), zip);
    void prune();
    const out = {
      id,
      fileName,
      size: zip.length,
      sha256: sha256(zip),
      keyId: signer.keyId,
      keySource: signer.source,
      armor: armor !== false,
      folder: folderInfo,
      files: signed,
      download: '/admin/api/pgp/signatures/' + id,
      createdAt: new Date().toISOString(),
    };
    if (audit) void audit('pgp.sign', { id, keyId: signer.keyId, source: signer.source, folder: folderInfo ? folderInfo.path : null, files: signed.length, bytes: zip.length });
    if (log) log.info('pgp.signed', { ns: 'pgp', id, files: signed.length, folder: folderInfo ? folderInfo.path : null });
    return out;
  }

  /** ZIP с подписите (само за този, който има админ достъп — маршрутът го пази). */
  async function artifact(id) {
    const file = artifactPath(id);
    const stat = await fsp.stat(file).catch(() => null);
    return stat && stat.isFile() ? { file, stat } : null;
  }

  return { sign, artifact, resolveInput, listFolder, manifestFor, MAX_FILES, MAX_BYTES };
}

module.exports = { create };
