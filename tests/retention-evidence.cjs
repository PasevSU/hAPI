'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const retention = require('../hapi_enterprise/retention.js');
const contentId = require('../hapi_enterprise/content-id.js');
// §EVIDENCE_NEVER_DELETED: политиката за изтриване не бива да може да изтрие публикувано
// съдържание. Тестът доказва три неща: (1) файл от архивен манифест се отказва, (2) изключването
// остава разрешено, защото пази байтовете, (3) архив без манифест пази целия портал — по-добре
// отказ, отколкото загубено доказателство.
const OLD = new Date(Date.now() - 40 * 86400000).toISOString();
const PORTAL = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SHA = 'a'.repeat(64);

function file(id, extra) {
  return { id, name: id + '.txt', uploadedAt: OLD, accessMode: 'FREE', sha256: SHA, size: 10, ...extra };
}

function manual(id, files, dir) {
  fs.mkdirSync(path.join(dir, 'files', id), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, 'files', id, f.id), f.id);
}

function qrWithManifest(portalId, fileList) {
  return { [portalId]: { revisions: [{ id: 'QR-001', seq: 1, archiveId: 'AR-001', archivedAt: OLD, manifest: { manifest_id: 'MF-QR-001', files: fileList } }, { id: 'QR-002', seq: 2, archiveId: null, archivedAt: null }], archives: [] } };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-evidence-'));
  try {
    const filesRoot = path.join(dir, 'files');
    const auditPath = path.join(dir, 'audit.jsonl');
    fs.writeFileSync(auditPath, '');

    // ── 1. Публикуван файл: изтриването се отказва ─────────────────────────────
    const published = file('pub', { contentId: contentId.of({ portalId: PORTAL, sha256: SHA, size: 10 }) });
    // Различно съдържание, иначе двата файла имат един и същ `content_id` (точно това правило
    // пази `content-id.cjs`) и „непубликуваният“ също би бил защитен.
    const loose = file('loose', { sha256: 'c'.repeat(64), size: 11 });
    const portals = [{ id: PORTAL, files: [published, loose] }];
    manual(PORTAL, [published, loose], dir);
    const qr = qrWithManifest(PORTAL, [{ path: 'pub.txt', content_id: published.contentId, sha256: SHA, size_bytes: 10 }]);

    let r = retention.create({ filesRoot, auditPath, getSettings: () => ({ retention: { enabled: true, fileDays: 30, auditDays: null, fileAction: 'delete' } }), getQrRegistry: () => qr });
    let pv = await r.preview(portals);
    assert.equal(pv.code, retention.CODE, 'кодът на правилото се връща към извикващия');
    assert.deepEqual(pv.files.map(f => f.fileId), ['loose'], 'само непубликуваният е кандидат за триене');
    assert.equal(pv.protectedCount, 1);
    assert.equal(pv.protectedFiles[0].fileId, 'pub');
    assert.equal(pv.protectedFiles[0].reason, 'qr-manifest');

    let ap = await r.apply(portals);
    assert.equal(ap.deleted, 1, 'непубликуваният се трие');
    assert.equal(ap.refused, 1, 'отказаното триене се отчита, не се премълчава');
    assert.ok(fs.existsSync(path.join(filesRoot, PORTAL, 'pub')), 'публикуваният файл остава на диска');
    assert.ok(!fs.existsSync(path.join(filesRoot, PORTAL, 'loose')));
    assert.ok(portals[0].files.some(f => f.id === 'pub'), 'публикуваният остава и в регистъра');

    // ── 2. Изключването остава разрешено (байтовете пазят манифеста) ───────────
    const portals2 = [{ id: PORTAL, files: [file('pub2', { contentId: published.contentId, accessMode: 'FREE' })] }];
    const r2 = retention.create({ filesRoot, auditPath, getSettings: () => ({ retention: { enabled: true, fileDays: 30, auditDays: null, fileAction: 'disable' } }), getQrRegistry: () => qr });
    const ap2 = await r2.apply(portals2);
    assert.equal(ap2.disabled, 1);
    assert.equal(portals2[0].files[0].accessMode, 'DISABLED');

    // ── 3. Архив без манифест (стара версия): целият портал е защитен ──────────
    const legacy = { [PORTAL]: { revisions: [{ id: 'QR-001', seq: 1, archiveId: 'AR-001', archivedAt: OLD, manifest: null }], archives: [] } };
    const portals3 = [{ id: PORTAL, files: [file('any')] }];
    const r3 = retention.create({ filesRoot, auditPath, getSettings: () => ({ retention: { enabled: true, fileDays: 30, auditDays: null, fileAction: 'delete' } }), getQrRegistry: () => legacy });
    const pv3 = await r3.preview(portals3);
    assert.equal(pv3.files.length, 0, 'незнайно съдържание не се трие');
    assert.equal(pv3.protectedFiles[0].reason, 'archive-unindexed');
    const ap3 = await r3.apply(portals3);
    assert.equal(ap3.deleted, 0);
    assert.equal(ap3.refused, 1);

    // ── 4. Явна добавка `sealed: true` пази без архив ─────────────────────────
    const portals4 = [{ id: PORTAL, files: [file('sealed', { sealed: true })] }];
    const r4 = retention.create({ filesRoot, auditPath, getSettings: () => ({ retention: { enabled: true, fileDays: 30, auditDays: null, fileAction: 'delete' } }), getQrRegistry: () => ({}) });
    const pv4 = await r4.preview(portals4);
    assert.equal(pv4.protectedFiles[0].reason, 'sealed-flag');

    // ── 5. Без архиви и без флаг: поведението е като преди (обратна съвместимост) ──
    const portals5 = [{ id: PORTAL, files: [file('plain')] }];
    manual(PORTAL, [file('plain')], dir);
    const r5 = retention.create({ filesRoot, auditPath, getSettings: () => ({ retention: { enabled: true, fileDays: 30, auditDays: null, fileAction: 'delete' } }), getQrRegistry: () => ({}) });
    const ap5 = await r5.apply(portals5);
    assert.equal(ap5.deleted, 1, 'без доказателства политиката работи както досега');
    assert.equal(ap5.refused, 0);

    // ── 6. Стар запис без `contentId`: идентичността се смята от хеша и размера ──
    const computed = file('old-style', { sha256: 'b'.repeat(64), size: 42 });
    const cid = contentId.of({ portalId: PORTAL, sha256: computed.sha256, size: computed.size });
    const portals6 = [{ id: PORTAL, files: [computed] }];
    const r6 = retention.create({ filesRoot, auditPath, getSettings: () => ({ retention: { enabled: true, fileDays: 30, auditDays: null, fileAction: 'delete' } }), getQrRegistry: () => qrWithManifest(PORTAL, [{ path: 'old.txt', content_id: cid, sha256: computed.sha256, size_bytes: computed.size }]) });
    const pv6 = await r6.preview(portals6);
    assert.equal(pv6.protectedCount, 1, 'липсващият contentId не изключва защитата');

    // ── 7. Липсващ регистър (add-on без QR данни) не чупи нищо ────────────────
    const r7 = retention.create({ filesRoot, auditPath, getSettings: () => ({ retention: { enabled: true, fileDays: 30, auditDays: null, fileAction: 'disable' } }) });
    const pv7 = await r7.preview([{ id: PORTAL, files: [file('x')] }]);
    assert.equal(pv7.protectedCount, 0);

    console.log('retention-evidence OK: ' + retention.CODE);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1) });
