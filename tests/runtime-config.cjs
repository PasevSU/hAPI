'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { create, validate } = require('../hapi_enterprise/runtime-config');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-runtime-')); try {
    const rt = create(root); assert.equal(rt.settings.databaseFile, 'db.json');
    await rt.save({ artifactDirectory: 'qr_archive', databaseFile: 'catalog.json' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'config', 'settings.json'))).artifactDirectory, 'qr_archive');
    const a = await rt.createArtifacts({ qrId: 'QR_2026_001' }); assert.equal(a.qrId, 'QR_2026_001');
    for (const name of ['manifest.json', 'log.json', 'report.json']) assert(fs.existsSync(path.join(root, 'qr_archive', 'QR_2026_001', name)));
    await assert.rejects(rt.createArtifacts({ qrId: '../bad' })); await assert.rejects(rt.createArtifacts({ qrId: 'QR_2026_001' }));
    // Невалидният вход е грешка на КЛИЕНТА (400), не „Internal error“ 500: сървърът връща
    // кода на грешката, а 500-ца заключва причината и плаши (дефект, намерен от одита).
    for (const bad of [{}, { qrId: '../bad' }, { qrId: '' }, { qrId: 'x'.repeat(200) }]) {
      const err = await rt.createArtifacts(bad).then(() => null, e => e);
      assert(err, 'липсва отказ за ' + JSON.stringify(bad).slice(0, 40));
      assert.equal(err.status, 400, 'отказът трябва да е 400, а е ' + (err.status || '(без статус → 500)'));
    }
    assert.throws(() => validate({ artifactDirectory: '../outside' })); assert.throws(() => validate({ databaseFile: '../../secret.json' }));
    assert.equal(create(root).settings.databaseFile, 'catalog.json');
    console.log('PASS runtime config, QR records, traversal, duplicate protection, persistence');
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})().catch(e => { console.error(e); process.exitCode = 1 });
