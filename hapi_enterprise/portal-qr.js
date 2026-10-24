'use strict';
// QR ревизии, манифести и ФИЗИЧЕСКИ архиви за един портал.
//
// Защо отделен модул: правилата от архитектурния план са едни и същи за всеки вход —
// админ API, публичната страница и сензорите. Затова дълбочината на дървото, идентичността
// на QR и манифестът се смятат ТУК, а не се разпръскват по маршрутите.
//
// Правила (нормативни, виж `documentation/02_TO_BE_ARCHITECTURE/`):
//   • PORTAL_IDENTITY      — един портал = една коренна папка = един постоянен адрес;
//   • NO_NESTED_PORTALS    — портал не живее в папката на друг портал;
//   • MAX_BRANCH_DEPTH_3   — най-много ТРИ вложени подпапки под корена (ширината е свободна);
//   • QR_REVISION_CHAIN    — един портал може да има много последователни QR кодове;
//   • QR_ARCHIVE_PHYSICAL  — нов QR вследствие на архивиране има РЕАЛЕН файл на диска
//                            със собствен SHA-256, размер и манифест;
//   • NO_SILENT_SUBSTITUTION — стар QR не се подменя; той получава наследник.
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const ooxml = require('./ooxml');
const contentId = require('./content-id');

/** Максимална дълбочина: коренът е ниво 0, разрешени са нива 1, 2 и 3. */
const MAX_DEPTH = 3;
/** Кодът, с който сървърът отказва четвърти клон (ползва се и от GUI, и от тестовете). */
const DEPTH_CODE = 'MAX_BRANCH_DEPTH_3';

/** Брой сегменти в относителен път (`a/b/c` → 3). */
function depthOf(rel) {
  return String(rel == null ? '' : rel).split('/').filter(Boolean).length;
}

/** Надвишен ли е лимитът от три вложени подпапки? */
function tooDeep(rel) {
  return depthOf(rel) > MAX_DEPTH;
}

/** `QR-001`, `QR-002`, … — идентичността, която носи конкретен печат. */
function qrIdOf(seq) {
  return 'QR-' + String(seq).padStart(3, '0');
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * Регистърът на портала в метаданните (`db.portalQr[portalId]`). Създава се при първо
 * ползване, за да не иска миграция на съществуващи бази.
 */
function registry(db, portalId) {
  if (!db.portalQr || typeof db.portalQr !== 'object') db.portalQr = {};
  const current = db.portalQr[portalId];
  if (!current || typeof current !== 'object') db.portalQr[portalId] = { revisions: [], archives: [] };
  const reg = db.portalQr[portalId];
  if (!Array.isArray(reg.revisions)) reg.revisions = [];
  if (!Array.isArray(reg.archives)) reg.archives = [];
  return reg;
}

/** Активната ревизия: САМО последната, ако не е прекратена (към стара не се връщаме). */
function activeRevision(reg) {
  const revisions = reg.revisions || [];
  const last = revisions[revisions.length - 1];
  return last && !last.blockedAt ? last : null;
}

/**
 * Гарантира, че порталът има поне една ревизия (`QR-001`) — „нов портал получава основен
 * QR“ без да се чака първо архивиране. Идемпотентно.
 */
function ensureFirst(db, portal) {
  const reg = registry(db, portal.id);
  if (reg.revisions.length) return reg;
  const created = portal.createdAt || new Date().toISOString();
  reg.revisions.push({
    id: qrIdOf(1),
    seq: 1,
    portalId: portal.id,
    contract: 'order',
    previousQrId: null,
    previousManifestHash: null,
    createdAt: created,
    archivedAt: null,
    archiveId: null,
    manifestHash: null,
    blockedAt: null,
    blockReason: null,
  });
  return reg;
}

/** Дълбочината на дървото е политика на портала, не на клиента — виж `MAX_BRANCH_DEPTH_3`. */
function policy() {
  return { maxDepth: MAX_DEPTH, code: DEPTH_CODE, unlimitedSiblings: true, nestedPortals: false };
}

/** Всички файлове под `rootAbs` с относителен път, размер и SHA-256 (без символни връзки). */
async function walk(rootAbs, rel = '') {
  let entries;
  try {
    entries = await fsp.readdir(path.join(rootAbs, ...rel.split('/').filter(Boolean)), { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const childRel = rel ? rel + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await walk(rootAbs, childRel)));
    } else if (entry.isFile()) {
      const full = path.join(rootAbs, ...childRel.split('/'));
      try {
        const buf = await fsp.readFile(full);
        out.push({ path: childRel, size: buf.length, sha256: sha256(buf), bytes: buf });
      } catch {
        /* файл, който изчезва по време на обхождането, не бива да чупи архива */
      }
    }
  }
  return out;
}

/**
 * Манифест на едно публикувано състояние (схема от плана, §9.1) — идентичността, която
 * свързва QR, файлове, хешове и (ако има) физически архив.
 */
function manifestFor({ portal, revision, files, archiveId, note }) {
  const listed = (portal.files || []).filter((f) => f.listed !== false);
  const byPath = new Map(listed.filter((f) => f.storagePath).map((f) => [String(f.storagePath).replace(/^\/+/, ''), f]));
  return {
    schema_version: 1,
    kind: 'qr-manifest',
    // §12: `manifest_id` е звеното между отчета и QR-а. Стабилен е за ревизията (един QR =
    // един манифест), без да зависи от самия хаш на манифеста (иначе би се самопроменил).
    manifest_id: 'MF-' + revision.id,
    portal_id: portal.id,
    portal_slug: portal.slug,
    contract: revision.contract || 'order',
    qr_id: revision.id,
    revision: revision.seq,
    previous_qr_id: revision.previousQrId || null,
    previous_manifest_hash: revision.previousManifestHash || null,
    archive_id: archiveId || null,
    note: note || '',
    depth_policy: { max_depth: MAX_DEPTH, code: DEPTH_CODE },
    created_at: new Date().toISOString(),
    files: files.map((f) => {
      const reg = byPath.get(f.path);
      return {
        path: f.path,
        // §11: идентичността на съдържанието върви с байтовете. Записаната печели (за да не
        // се смени вече публикувана идентичност); при стари записи се смята от самия файл.
        content_id: (reg && reg.contentId) || contentId.of({ portalId: portal.id, sha256: f.sha256, size: f.size }),
        sha256: f.sha256,
        size_bytes: f.size,
        published: true,
        locked: !!reg && (reg.accessMode || 'FREE') !== 'FREE',
        lock_reason: (reg && reg.lockReason) || null,
      };
    }),
  };
}

/**
 * Физическият архив: ZIP с `manifest.json` и самите байтове на файловете.
 *
 * Защо байтовете, а не само хешовете: без тях можем да докажем несъответствие, но не и да
 * покажем какво е имало в документа. Точно това иска планът (§7).
 */
async function buildArchive({ portal, revision, files, note, archiveId }) {
  const manifest = manifestFor({ portal, revision, files, archiveId, note });
  const entries = [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') }];
  for (const file of files) entries.push({ name: 'files/' + file.path, data: file.bytes });
  const buffer = ooxml.zip(entries);
  return { buffer, manifest, hash: sha256(buffer), size: buffer.length };
}

/**
 * Разопакова архив: манифестът и байтовете на файловете (за възстановяване, §10.2/§22).
 * Хвърля `409`, ако липсва манифест или файл — възстановява се само доказуемо съдържание.
 */
function unpack(buffer) {
  const entries = ooxml.unzip(buffer);
  const manifestEntry = entries.get('manifest.json');
  if (!manifestEntry) throw Object.assign(new Error('Архивът няма манифест'), { status: 409 });
  const manifest = JSON.parse(manifestEntry().toString('utf8'));
  const files = (manifest.files || []).map((f) => {
    const entry = entries.get('files/' + f.path);
    if (!entry) throw Object.assign(new Error('В архива липсва файл: ' + f.path), { status: 409 });
    return { path: f.path, sha256: f.sha256, contentId: f.content_id || null, data: entry() };
  });
  return { manifest, files };
}

/** Броячи за сензорите: активни и прекратени QR, архиви и заключени публикувани файлове.
 * Смятат се ТУК, за да виждат панелът и Home Assistant едни и същи числа.
 */
function stats(db) {
  const registryMap = db && db.portalQr && typeof db.portalQr === 'object' ? db.portalQr : {};
  let active = 0, blocked = 0, archives = 0, lockedFiles = 0, portals = 0;
  for (const portal of (db && db.portals) || []) {
    portals += 1;
    const reg = registryMap[portal.id];
    if (reg && Array.isArray(reg.revisions) && reg.revisions.length) {
      active += activeRevision(reg) ? 1 : 0;
      blocked += reg.revisions.filter((r) => r.blockedAt).length;
    }
    if (reg && Array.isArray(reg.archives)) archives += reg.archives.length;
    lockedFiles += (portal.files || []).filter((f) => (f.accessMode || 'FREE') !== 'FREE' && f.listed !== false).length;
  }
  return { active, blocked, archives, lockedFiles, portals, maxDepth: MAX_DEPTH };
}

module.exports = {
  MAX_DEPTH,
  DEPTH_CODE,
  depthOf,
  tooDeep,
  qrIdOf,
  sha256,
  registry,
  activeRevision,
  ensureFirst,
  policy,
  walk,
  manifestFor,
  buildArchive,
  unpack,
  stats,
};
