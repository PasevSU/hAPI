'use strict';
// Политиките на сървъра — лимити, данни, задържане, преглед — от панела, не само от API.
//
// Правилото, което този тест пази:
//   • всяко поле, което панелът пише, СТИГА до ефективната стойност (`runtime.effective()`) —
//     иначе полето е украшение;
//   • невалидна стойност → 400 и нищо не се променя (нито в паметта, нито на диска);
//   • ЧАСТИЧЕН запис на вложен обект не връща съседните полета към подразбирането
//     (`{limits:{publicBaseUrl}}` не бива да трие лимита на файла) — това беше дефект;
//   • изрично `null` изчиства поле, защото е стойност, а не липса;
//   • политиката се консумира от другите модули: задържането я показва, прегледът я спазва;
//   • настройките оцеляват рестарт.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const rc = require('../hapi_enterprise/runtime-config.js');

let current = 'S00';
const stage = async (name, fn) => {
  current = name;
  await fn();
  console.log('  ✔ ' + name);
};

(async () => {
  // ── A. Валидация (без сървър) ────────────────────────────────────────────────
  await stage('A01 валидация · всяка група приема точното и отказва останалото', () => {
    const ok = rc.validate({
      limits: { maxUploadMb: 64, maxDownloadStreams: 4, maxJobs: 2, storageCheckMinutes: 15, corsOrigin: 'https://example.test', requirePortalToken: true, storeRawIp: false },
      data: { conflictPolicy: 'skip', strictTaxonomy: true, defaultCategory: 'Договори', defaultGroup: '2026', maxTags: 7 },
      retention: { enabled: true, fileDays: 30, auditDays: 400, fileAction: 'delete' },
      preview: { enabled: false, thumbnails: false },
    });
    assert.equal(ok.limits.maxUploadMb, 64);
    assert.equal(ok.limits.requirePortalToken, true);
    assert.equal(ok.data.conflictPolicy, 'skip');
    assert.equal(ok.retention.fileAction, 'delete');
    assert.equal(ok.preview.thumbnails, false, 'миниатюрите могат да се изключат');

    const bad = [
      [{ limits: { maxUploadMb: 0 } }, /maxUploadMb/],
      [{ limits: { maxUploadMb: 2049 } }, /maxUploadMb/],
      [{ limits: { maxJobs: 5 } }, /maxJobs/],
      [{ limits: { storageCheckMinutes: -1 } }, /storageCheckMinutes/],
      [{ limits: { corsOrigin: 'example.test' } }, /corsOrigin/],
      [{ limits: { requirePortalToken: 'yes' } }, /requirePortalToken/],
      [{ limits: { nope: 1 } }, /Unknown limit/],
      [{ data: { conflictPolicy: 'overwrite' } }, /conflictPolicy/],
      [{ data: { strictTaxonomy: 'true' } }, /strictTaxonomy/],
      [{ data: { maxTags: 0 } }, /maxTags/],
      [{ data: { maxTags: 101 } }, /maxTags/],
      [{ data: { defaultCategory: 'x'.repeat(121) } }, /defaultCategory/],
      [{ retention: { fileDays: 0 } }, /retention days/],
      [{ retention: { auditDays: 36501 } }, /retention days/],
      [{ retention: { fileAction: 'wipe' } }, /fileAction/],
      [{ preview: { enabled: 'no' } }, /preview.enabled/],
      [{ preview: { thumbnails: 1 } }, /preview.thumbnails/],
    ];
    for (const [value, re] of bad) assert.throws(() => rc.validate(value), re, 'трябва да се откаже: ' + JSON.stringify(value));
  });

  // ── A02. Частичният запис не изтрива съседните полета ────────────────────────
  await stage('A02 частичен запис · вложените обекти се сливат, `null` изчиства', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-policies-unit-'));
    const inst = rc.create(root);
    await inst.save({ limits: { maxUploadMb: 64, maxJobs: 2 } });
    await inst.save({ limits: { publicBaseUrl: 'https://example.test' } });
    assert.equal(inst.settings.limits.maxUploadMb, 64, 'базовият адрес не бива да трие лимита на файла');
    assert.equal(inst.settings.limits.maxJobs, 2, 'базовият адрес не бива да трие лимита на задачите');
    assert.equal(inst.settings.limits.publicBaseUrl, 'https://example.test');
    await inst.save({ data: { conflictPolicy: 'skip', maxTags: 7 } });
    await inst.save({ data: { strictTaxonomy: true } });
    assert.equal(inst.settings.data.conflictPolicy, 'skip', 'строгата таксономия не бива да трие политиката при конфликт');
    assert.equal(inst.settings.data.maxTags, 7);
    await inst.save({ retention: { enabled: true, fileDays: 30 } });
    await inst.save({ retention: { auditDays: 400 } });
    assert.equal(inst.settings.retention.fileDays, 30, 'срокът за одита не бива да трие срока за файловете');
    assert.equal(inst.settings.retention.enabled, true);
    await inst.save({ preview: { thumbnails: false } });
    await inst.save({ preview: { enabled: false } });
    assert.equal(inst.settings.preview.thumbnails, false, 'изключването на прегледа не връща миниатюрите');
    await inst.save({ backupSchedule: { enabled: true } });
    assert.equal(inst.settings.backupSchedule.intervalMinutes, 1440, 'графикът се слива, а не се заменя');
    await inst.save({ limits: { maxUploadMb: null } });
    assert.equal(inst.settings.limits.maxUploadMb, null, 'изрично null изчиства полето');
    assert.equal(inst.settings.limits.maxJobs, 2, 'изчистването на едно поле не пипа друго');
  });

  // ── B. През истинския сървър ─────────────────────────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-policies-srv-'));
  const port = 0;
  let server = await startServer({ dataDir: dir, port, keepData: true });
  try {
    const settings = async () => (await server.api('/admin/api/settings')).data;
    const patch = (body) => server.api('/admin/api/settings', 'PATCH', body);

    await stage('B01 подразбиране · лимитите са от средата, политиките са изрични', async () => {
      const s = await settings();
      assert.deepEqual(s.settings.limits, { maxUploadMb: null, maxDownloadStreams: null, maxJobs: null, storageCheckMinutes: null, publicBaseUrl: '', corsOrigin: '', requirePortalToken: null, storeRawIp: null });
      assert.deepEqual(s.settings.data, { conflictPolicy: 'queue', strictTaxonomy: false, defaultCategory: '', defaultGroup: '', maxTags: 30 });
      assert.deepEqual(s.settings.retention, { enabled: false, fileDays: null, auditDays: null, fileAction: 'disable' });
      assert.deepEqual(s.settings.preview, { enabled: true, thumbnails: true });
      assert.equal(s.effective.maxUploadBytes, 52428800, 'без записан лимит важи 50 MB от средата');
      assert.equal(s.effective.maxJobs, 1);
      assert.equal(s.effective.requirePortalToken, false);
    });

    await stage('B02 отказ без промяна · 400 и нищо не се записва', async () => {
      const before = await settings();
      for (const bad of [
        { limits: { maxUploadMb: 0 } },
        { limits: { maxJobs: 9 } },
        { limits: { corsOrigin: 'ftp://example.test' } },
        { data: { conflictPolicy: 'overwrite' } },
        { retention: { fileDays: 0 } },
        { retention: { fileAction: 'wipe' } },
        { preview: { thumbnails: 'no' } },
      ]) {
        const r = await patch(bad);
        assert.equal(r.status, 400, 'трябва 400 за ' + JSON.stringify(bad));
      }
      assert.deepEqual((await settings()).settings, before.settings, 'нищо не се е променило');
    });

    await stage('B03 запис · политиките стигат до ефективните стойности', async () => {
      const r = await patch({
        limits: { maxUploadMb: 64, maxDownloadStreams: 8, maxJobs: 2, storageCheckMinutes: 15, corsOrigin: 'https://example.test', requirePortalToken: true, storeRawIp: true },
        data: { conflictPolicy: 'skip', strictTaxonomy: true, defaultCategory: 'Договори', defaultGroup: '2026', maxTags: 7 },
        retention: { enabled: true, fileDays: 30, auditDays: 400, fileAction: 'disable' },
        preview: { enabled: true, thumbnails: false },
      });
      assert.equal(r.status, 200);
      const now = (await settings());
      assert.equal(now.settings.limits.maxUploadMb, 64);
      assert.equal(now.settings.data.maxTags, 7);
      assert.equal(now.settings.retention.fileDays, 30);
      // Точно тук се вижда дали полето е украшение: ефективните стойности идват от записа.
      assert.equal(now.effective.maxUploadBytes, 64 * 1048576, 'ефективният лимит е 64 MB');
      assert.equal(now.effective.maxDownloadStreams, 8);
      assert.equal(now.effective.maxJobs, 2);
      assert.equal(now.effective.storageCheckIntervalMs, 15 * 60000);
      assert.equal(now.effective.corsOrigin, 'https://example.test');
      assert.equal(now.effective.requirePortalToken, true);
      assert.equal(now.effective.storeRawIp, true);
    });

    await stage('B04 частичен запис през HTTP · съседните лимити оцеляват', async () => {
      // Този път се ползва от секция „Основни“ (публичен базов адрес) — преди поправката
      // той връщаше всички останали лимити към подразбирането.
      assert.equal((await patch({ limits: { publicBaseUrl: 'https://hapi.example.test' } })).status, 200);
      const s = await settings();
      assert.equal(s.settings.limits.publicBaseUrl, 'https://hapi.example.test');
      assert.equal(s.settings.limits.maxUploadMb, 64, 'лимитът на файла е още 64 MB');
      assert.equal(s.settings.limits.maxJobs, 2, 'броят задачи е още 2');
      assert.equal(s.effective.maxUploadBytes, 64 * 1048576, 'и ефективният лимит не е мръднал');
      assert.equal(s.effective.publicBaseUrl, 'https://hapi.example.test');
      // Същото за данните: таванът на етикетите не бива да трие политиката при конфликт.
      assert.equal((await patch({ data: { maxTags: 9 } })).status, 200);
      assert.equal((await settings()).settings.data.conflictPolicy, 'skip');
      // …и за задържането: срокът за одита не бива да трие срока за файловете.
      assert.equal((await patch({ retention: { auditDays: 365 } })).status, 200);
      assert.equal((await settings()).settings.retention.fileDays, 30);
    });

    await stage('B05 рестарт · смяна на стартова настройка се обявява', async () => {
      const r = await patch({ limits: { maxJobs: 3 } });
      assert.equal(r.status, 200);
      assert.equal(r.data.restartRequired, true, 'промяната на задачите иска рестарт за пълно прилагане');
      assert.equal(r.data.effective.maxJobs, 3, 'но ефективната стойност вече е новата');
    });

    await stage('B06 консумация · задържането чете същата политика', async () => {
      // Не „има ли поле“, а „стига ли до модула, който решава“: `retention.preview` връща
      // точно записаните срокове и действието.
      const r = await server.api('/admin/api/retention');
      assert.equal(r.status, 200);
      assert.equal(r.data.enabled, true, 'задържането е включено');
      assert.equal(r.data.fileDays, 30, 'срокът за файловете идва от политиката');
      assert.equal(r.data.auditDays, 365, 'срокът за одита идва от политиката');
      assert.equal(r.data.fileAction, 'disable', 'действието идва от политиката');
    });

    await stage('B07 одит · събитието пази кои ключове са пипани', async () => {
      const events = (await server.api('/admin/api/audit?limit=50')).data.events || [];
      const changed = events.find((e) => e.type === 'settings_changed' || e.event === 'settings_changed');
      assert.ok(changed, 'има събитие settings_changed');
      assert.ok(Array.isArray(changed.keys), 'одитът пази имената на групите');
    });

    // ── C. Рестарт на сървъра ──────────────────────────────────────────────────
    await server.stop();
    server = await startServer({ dataDir: dir, port, keepData: true });
    await stage('C01 рестарт · политиките оцеляват', async () => {
      const s = await settings();
      assert.equal(s.settings.limits.maxUploadMb, 64);
      assert.equal(s.settings.limits.maxJobs, 3);
      assert.equal(s.settings.data.conflictPolicy, 'skip');
      assert.equal(s.settings.retention.fileDays, 30);
      assert.equal(s.settings.retention.auditDays, 365);
      assert.equal(s.settings.preview.thumbnails, false);
      assert.equal(s.effective.maxUploadBytes, 64 * 1048576);
    });
  } finally {
    await server.stop();
  }

  console.log('PASS settings-policies: 4 групи политики · частичен запис слива · ефективни стойности · 400 без промяна · оцеляване след рестарт');
})().catch((e) => {
  console.error('FAIL settings-policies [' + current + ']:', e && e.message ? e.message : e);
  process.exit(1);
});
