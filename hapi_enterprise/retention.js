'use strict';
const fsp = require('node:fs/promises'), path = require('node:path');
const contentId = require('./content-id');
const MS = 86400000;
// Retention policies: age-based expiry of uploaded files and the human-readable audit
// log. Files older than fileDays are either disabled (default) or deleted; audit lines
// older than auditDays are pruned. The tamper-evident hash chain (audit-chain.jsonl)
// is intentionally NOT truncated, since truncation would break its integrity guarantee.
//
// §EVIDENCE_NEVER_DELETED (0.69.87). Политиката за изтриване НЕ може да изтрие файл,
// който вече е публикуван — тоест чиито байтове влизат в архивен манифест. Иначе
// „доказателството“ и „почистването“ си противоречат: манифестът твърди какво е било
// публикувано, а байтовете ги няма и никой не може да провери твърдението.
// Забранено е само ТРИЕНЕТО. Изключването (`accessMode='DISABLED'`) остава разрешено:
// то крие файла, но байтовете остават и манифестът продължава да съвпада.
// Ако архивът е от версия, която не е пазила манифеста, не знаем какво пази — затова
// ЦЕЛИЯТ портал се пази от триене (по-добре отказ, отколкото загубено доказателство).
const CODE = 'EVIDENCE_NEVER_DELETED';

function create({ filesRoot, auditPath, getSettings, getQrRegistry }) {
  const cfg = () => { const r = getSettings().retention || { enabled: false, fileDays: null, auditDays: null, fileAction: 'disable' }; return r };
  async function auditLines() { try { return (await fsp.readFile(auditPath, 'utf8')).split('\n').filter(Boolean) } catch (e) { if (e.code === 'ENOENT') return []; throw e } }

  /**
   * Индекс на доказателствата: `content_id` (и резервно `sha256`) на всичко, което е влизало
   * в манифест на архивирана ревизия. Чете се от регистъра на QR (`db.portalQr`), защото
   * ревизията пази манифеста си — не се въвежда ново поле и няма миграция.
   */
  function evidenceIndex() {
    let map;
    try { map = typeof getQrRegistry === 'function' ? getQrRegistry() : null } catch { map = null }
    const ids = new Set(), hashes = new Set(), unindexed = new Set();
    for (const portalId of Object.keys(map && typeof map === 'object' ? map : {})) {
      const reg = map[portalId]; const revisions = (reg && Array.isArray(reg.revisions)) ? reg.revisions : [];
      for (const r of revisions) {
        if (!r || !(r.archiveId || r.archivedAt)) continue;
        const files = r.manifest && Array.isArray(r.manifest.files) ? r.manifest.files : null;
        if (!files) { unindexed.add(portalId); continue }
        for (const f of files) { if (f && f.content_id) ids.add(f.content_id); else if (f && f.sha256) hashes.add(String(f.sha256).toLowerCase()) }
      }
    }
    return { ids, hashes, unindexed };
  }

  /** Защо файлът е доказателство (или `null`, ако не е). Причината се показва, не се гадае. */
  function protectionOf(portal, file, index) {
    const f = file || {};
    if (f.evidence === true || f.sealed === true) return 'sealed-flag';
    if (index.unindexed.has(portal.id)) return 'archive-unindexed';
    const id = contentId.forFile(portal, f);
    if (id && index.ids.has(id)) return 'qr-manifest';
    const sha = typeof f.sha256 === 'string' ? f.sha256.toLowerCase() : '';
    if (sha && index.hashes.has(sha)) return 'qr-manifest-hash';
    return null;
  }

  async function preview(portals, index = evidenceIndex()) {
    const c = cfg(); const fileCut = c.fileDays ? Date.now() - c.fileDays * MS : null, auditCut = c.auditDays ? Date.now() - c.auditDays * MS : null;
    const files = [], protectedFiles = [];
    if (fileCut) {
      for (const p of portals) for (const f of p.files) {
        const t = Date.parse(f.uploadedAt || ''); if (!Number.isFinite(t)) continue; if (t < fileCut && f.accessMode !== 'DISABLED') {
          const item = { portalId: p.id, fileId: f.id, name: f.name, uploadedAt: f.uploadedAt };
          const why = protectionOf(p, f, index);
          if (why) protectedFiles.push({ ...item, reason: why }); else files.push(item);
        }
      }
    }
    let auditLinesExpired = 0; if (auditCut) { for (const line of await auditLines()) { try { if (Date.parse(JSON.parse(line).at) < auditCut) auditLinesExpired++ } catch { /* повреден одитен ред не се брои за изтекъл */ } } }
    return { enabled: c.enabled, fileDays: c.fileDays, auditDays: c.auditDays, fileAction: c.fileAction, files, protectedFiles, protectedCount: protectedFiles.length, auditLinesExpired, code: CODE };
  }
  async function apply(portals) {
    // Индексът се строи ВЕДНЪЖ и се подава и на `preview`, и на цикъла: той е от регистъра на
    // QR, който не се променя по време на прилагането (махаме само записи от `p.files`).
    // Преди това се строеше вътре в цикъла по файлове — O(файлове × ревизии).
    const index = evidenceIndex();
    const c = cfg(); const prev = await preview(portals, index); if (!c.enabled) return { ...prev, applied: false, note: 'retention disabled' };
    let deleted = 0, disabled = 0;
    // `refused` = триения, които политиката е блокирала. В режим `disable` няма отказ: файлът
    // се изключва, байтовете остават и манифестът продължава да сочи към тях. Затова броячът
    // започва от нула и се вдига само когато `delete` е истински отказан.
    let refused = c.fileAction === 'delete' ? prev.protectedCount : 0;
    // Изключването е разрешено и за доказателства (байтовете остават), затова при `disable`
    // списъкът включва и защитените. При `delete` — не.
    const targets = c.fileAction === 'delete' ? prev.files : [...prev.files, ...prev.protectedFiles];
    for (const it of targets) {
      const p = portals.find(x => x.id === it.portalId); if (!p) continue; const f = p.files.find(x => x.id === it.fileId); if (!f) continue;
      // Защитата се пре-проверява тук със същия индекс: списъкът от preview може да е
      // остарял, а триенето е необратимо. По-евтино е да откажем, отколкото да обясняваме
      // липсващ файл.
      if (c.fileAction === 'delete' && protectionOf(p, f, index)) { refused++; continue }
      if (c.fileAction === 'delete') { await fsp.rm(path.join(filesRoot, it.portalId, it.fileId), { force: true }); p.files = p.files.filter(x => x.id !== it.fileId); deleted++ }
      else { f.accessMode = 'DISABLED'; f.expired = true; disabled++ }
    }
    let auditLinesPruned = 0; if (c.auditDays) { const cut = Date.now() - c.auditDays * MS; const lines = await auditLines(); const keep = lines.filter(l => { try { return Date.parse(JSON.parse(l).at) >= cut } catch { return false } }); auditLinesPruned = lines.length - keep.length; if (auditLinesPruned > 0) await fsp.writeFile(auditPath, keep.join('\n') + (keep.length ? '\n' : ''), { mode: 0o600 }) }
    return { ...prev, applied: true, deleted, disabled, auditLinesPruned, refused };
  }
  // `protection` е публичната форма на същото правило за други извикващи: преместване между
  // портали (`routes/file-transfer.js`) пита „това доказателство ли е?“ преди да махне
  // байтовете от портала-източник. Едно правило, един тест — не второ мнение по същия въпрос.
  return { preview, apply, evidenceIndex, protection: (portal, file) => protectionOf(portal, file, evidenceIndex()), CODE };
}
module.exports = { create, CODE };
