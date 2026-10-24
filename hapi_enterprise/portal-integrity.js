'use strict';
// Целостта на ФИЗИЧЕСКИТЕ архиви (правило `ARCHIVE_NOT_TAMPERED`).
//
// Защо отделен модул: архивът е ДОКАЗАТЕЛСТВОТО. Ако някой подмени байтове в ZIP файла,
// смени файл вътре в него или подмени `manifest.json`, това трябва да се види без човешка
// сверка. Затова проверката се прави от един модул, който ползват и админ API, и фоновата
// задача, и сензорите — едни и същи числа навсякъде.
//
// Какво се проверява (по ред, първата грешка спира проверката на ТОЗИ архив):
//   1. файлът съществува на диска                        → `file_missing`
//   2. SHA-256 на целия ZIP съвпада със записания        → `archive_hash_mismatch`
//   3. ZIP-ът се разчита от нашия четец                   → `archive_unreadable`
//   4. има `manifest.json`                                → `manifest_missing`
//   5. манифестът е валиден JSON                          → `manifest_invalid`
//   6. хешът на манифеста съвпада с `revision.manifestHash` → `manifest_hash_mismatch`
//   7. всеки файл от манифеста е в ZIP-а                  → `file_missing_in_archive`
//   8. всеки файл има същия SHA-256 и размер              → `file_hash_mismatch` / `file_size_mismatch`
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const ooxml = require('./ooxml');

/** Правилото, което тази проверка пази (ползва се и от тестовете, и от документацията). */
const CODE = 'ARCHIVE_NOT_TAMPERED';
/** По подразбиране: на всеки 6 часа. `HAPI_INTEGRITY_INTERVAL_MS=0` изключва задачата. */
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Интервалът идва от средата; невалидна стойност пада към 6 часа, а не към „изключено“. */
function intervalMs(env = process.env) {
  const raw = env && env.HAPI_INTEGRITY_INTERVAL_MS;
  if (raw === undefined || raw === '') return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_INTERVAL_MS;
}

/** Последният резултат за всеки портал (`db.portalIntegrity[portalId]`). */
function store(db) {
  if (!db.portalIntegrity || typeof db.portalIntegrity !== 'object') db.portalIntegrity = {};
  return db.portalIntegrity;
}

function read(db, portalId) {
  const saved = db && db.portalIntegrity ? db.portalIntegrity[portalId] : null;
  if (!saved) return { checkedAt: null, ok: null, archives: 0, verified: 0, failed: [] };
  return saved;
}

function record(db, portalId, result) {
  store(db)[portalId] = result;
  return result;
}

/**
 * Проверява ЕДИН архивен файл. Не хвърля: връща `{ ok:false, reason }`, за да може един
 * повреден архив да не спре проверката на останалите.
 */
async function verifyArchive({ archive, dir, revision }) {
  const id = archive && archive.id;
  const qrId = archive && archive.qrId;
  const bad = (reason, extra) => ({ id, qrId, ok: false, reason, ...(extra || {}) });
  const full = path.join(dir, String((archive && archive.file) || ''));
  const buf = await fsp.readFile(full).catch(() => null);
  if (!buf) return bad('file_missing');
  const hash = sha256(buf);
  if (archive.sha256 && hash !== archive.sha256) {
    return bad('archive_hash_mismatch', { expected: archive.sha256, actual: hash });
  }
  let entries;
  try {
    entries = ooxml.unzip(buf);
  } catch {
    return bad('archive_unreadable', { actual: hash });
  }
  const manifestEntry = entries.get('manifest.json');
  if (!manifestEntry) return bad('manifest_missing', { actual: hash });
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry().toString('utf8'));
  } catch {
    return bad('manifest_invalid', { actual: hash });
  }
  if (revision && revision.manifestHash && sha256(Buffer.from(JSON.stringify(manifest))) !== revision.manifestHash) {
    return bad('manifest_hash_mismatch', { expected: revision.manifestHash });
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const file of files) {
    const entry = entries.get('files/' + file.path);
    if (!entry) return bad('file_missing_in_archive', { detail: file.path });
    const inner = entry();
    if (file.sha256 && sha256(inner) !== file.sha256) return bad('file_hash_mismatch', { detail: file.path });
    if (Number.isFinite(file.size_bytes) && inner.length !== file.size_bytes) {
      return bad('file_size_mismatch', { detail: file.path });
    }
  }
  return { id, qrId, ok: true, reason: null, files: files.length, sha256: hash, size: buf.length };
}

/** Проверява всички архиви на ЕДИН портал (и връща обобщение, годно за сензор). */
async function verifyPortal({ portalId, dir, archives, revisions }) {
  const list = Array.isArray(archives) ? archives : [];
  const revs = Array.isArray(revisions) ? revisions : [];
  const results = [];
  for (const archive of list) {
    results.push(await verifyArchive({ archive, dir, revision: revs.find((r) => r.id === archive.qrId) }));
  }
  const failed = results.filter((r) => !r.ok);
  return {
    portalId,
    checkedAt: new Date().toISOString(),
    ok: failed.length === 0,
    archives: list.length,
    verified: results.length - failed.length,
    failed,
  };
}

/**
 * Фонова проверка на ВСИЧКИ портали с архиви. `onResult(portalId, result)` записва и
 * вдига събитие — така компонентът решава как да пази (метаданни + одитен дневник).
 */
async function verifyPortals({ db, qr, archiveRoot, onResult }) {
  const out = [];
  for (const portal of (db && db.portals) || []) {
    const reg = qr.registry(db, portal.id);
    if (!reg.archives.length) continue;
    const result = await verifyPortal({
      portalId: portal.id,
      dir: path.join(archiveRoot, portal.id),
      archives: reg.archives,
      revisions: reg.revisions,
    });
    if (typeof onResult === 'function') await onResult(portal.id, result);
    else record(db, portal.id, result);
    out.push(result);
  }
  return out;
}

/** Броячи за Home Assistant: колко проверки са правени и колко са се провалили. */
function stats(db) {
  const saved = (db && db.portalIntegrity) || {};
  let failures = 0, portalsFailed = 0, checked = 0, lastCheckedAt = null;
  for (const key of Object.keys(saved)) {
    const result = saved[key];
    if (!result || !result.checkedAt) continue;
    checked += 1;
    if (!result.ok) {
      portalsFailed += 1;
      failures += (result.failed || []).length;
    }
    if (!lastCheckedAt || String(result.checkedAt) > String(lastCheckedAt)) lastCheckedAt = result.checkedAt;
  }
  return { failures, portalsFailed, checked, lastCheckedAt, intervalMs: intervalMs(), code: CODE };
}

/** Пуска фоновата проверка; връща таймера (или `null`, ако е изключена). */
function schedule(run, ms) {
  if (!(ms > 0) || typeof run !== 'function') return null;
  const timer = setInterval(() => { void Promise.resolve().then(run).catch(() => { }) }, ms);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = { CODE, DEFAULT_INTERVAL_MS, intervalMs, sha256, store, read, record, verifyArchive, verifyPortal, verifyPortals, stats, schedule };
