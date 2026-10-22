'use strict';
// ОРАКУЛ: един и същи байтове → един и същи отпечатък във ВСЕКИ сегмент.
//
// „Минал тест“ не значи „вярно“. Този тест не пита „има ли sha256“, а „равен ли е на
// отпечатъка, който ИЗЧИСЛЯВАМ САМ“ — и то на всяко място, където кодът го показва:
// качване → списък → публичен манифест → виртуално дърво → отчет → CMS подпис → одитна
// верига. Ако един сегмент сметне хеша по друг начин (друг алгоритъм, друг обхват,
// компресирани вместо сурови байтове), тук пада.
//
// Освен стойностите се проверяват и две свойства, които „зелените“ тестове често пропускат:
//   • ВЪЗПРОИЗВОДИМОСТ — един и същи манифест се рендира до ЕДНАКЪВ PDF (байт по байт);
//   • НЕИЗМЕНЯЕМОСТ — подправен байт променя отпечатъка и се хваща (409), а одитната
//     верига се разпада точно на подправения запис, не „някъде“.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const auditChain = require('../hapi_enterprise/audit-chain.js');
const manifest = require('../hapi_enterprise/report-manifest.js');
const reportRender = require('../hapi_enterprise/report-render.js');
const cms = require('../hapi_enterprise/cms-sign.js');
const x509 = require('../hapi_enterprise/x509.js');
const fileCrypto = require('../hapi_enterprise/file-crypto.js');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// Байтовете са фиксирани, за да е сравнението смислено (не случайни данни).
const BYTES = Buffer.from('Договор №2026-001\nЦена: 12 345,67 лв.\n', 'utf8');
const START_STOP = [
  { id: 's', type: 'rfc3161-start', label: 'START', locked: true },
  { id: 't', type: 'title', value: 'Договор №2026-001' },
  { id: 'e', type: 'rfc3161-stop', label: 'STOP', locked: true },
];

(async () => {
  const server = await startServer();
  const expectedFileHash = sha256(BYTES);
  try {
    // ── 1. Качване: отпечатъкът е на СУРОВИТЕ байтове ───────────────────────────
    const portal = await server.api('/admin/api/portals', 'POST', { slug: 'oracle', title: 'Оракул', visibility: 'public' });
    assert.equal(portal.status, 201, 'порталът е създаден');
    const uploaded = await server.authFetch(server.base + '/admin/api/portals/' + portal.data.id + '/files', {
      method: 'POST',
      headers: { 'x-file-name': 'akt.txt', 'content-type': 'text/plain' },
      body: BYTES,
    });
    assert.equal(uploaded.status, 201, 'файлът е качен');
    const file = await uploaded.json();
    assert.equal(file.sha256, expectedFileHash, 'качването връща sha256 на суровите байтове');
    assert.equal(file.size, BYTES.length, 'размерът е точният брой байтове');
    assert.equal(file.version, 1, 'първата версия е 1');

    // ── 2. Списъкът, публичният манифест и дървото казват СЪЩОТО ────────────────
    const list = await server.api('/admin/api/portals/' + portal.data.id + '/files');
    assert.equal(list.data.files[0].sha256, expectedFileHash, 'списъкът не преизчислява хеша различно');
    const manifestRes = await fetch(server.base + '/api/v1/p/oracle/manifest');
    assert.equal(manifestRes.status, 200, 'публичният манифест е достъпен');
    const man = await manifestRes.json();
    const manFile = (man.storage && man.storage.paths ? Object.values(man.storage.paths) : []).find((f) => f && f.sha256 === expectedFileHash);
    assert.ok(manFile || JSON.stringify(man).includes(expectedFileHash), 'манифестът носи същия отпечатък');
    const treeRes = await fetch(server.base + '/api/v1/p/oracle/storage');
    assert.equal(treeRes.status, 200, 'виртуалното дърво е достъпно');
    const tree = await treeRes.json();
    const flat = [];
    const walk = (node) => {
      for (const f of node.files || []) flat.push(f);
      for (const d of node.folders || []) walk(d);
    };
    walk(tree);
    assert.equal(flat.length, 1, 'в дървото файлът е ТОЧНО веднъж (без дубликати)');
    assert.equal(flat[0].sha256, expectedFileHash, 'дървото показва същия отпечатък');
    assert.equal(flat[0].path, '/akt.txt', 'виртуалният път е коренов, защото няма тема/категория/група');
    // Същият файл, свален през публичния API, е БАЙТ ПО БАЙТ същият.
    const download = await fetch(server.base + '/api/v1/p/oracle/files/' + file.id + '/download');
    assert.equal(download.status, 200, 'файлът се сваля');
    const back = Buffer.from(await download.arrayBuffer());
    assert.equal(sha256(back), expectedFileHash, 'свалените байтове дават същия отпечатък (без преобразуване по пътя)');

    // ── 3. Отчетът: СЪЩИЯТ манифест + СЪЩАТА дата → СЪЩИЯ PDF, два пъти ────────
    const issued = '2026-10-22T09:00:00Z';
    const first = reportRender.renderPdf({ profile: 'forensic-full', blocks: START_STOP }, { createdAt: issued });
    const second = reportRender.renderPdf({ profile: 'forensic-full', blocks: START_STOP }, { createdAt: issued });
    assert.equal(Buffer.compare(first, second), 0, 'с фиксирана дата двата рендирания са байт по байт еднакви (възпроизводимост)');
    // Датата е част от документа, а НЕ „скрита“ от отпечатъка: друга дата → друг файл.
    const otherDay = reportRender.renderPdf({ profile: 'forensic-full', blocks: START_STOP }, { createdAt: '2026-10-23T09:00:00Z' });
    assert.equal(otherDay.equals(first), false, 'друга дата на издаване дава друг файл — това е очаквано');
    // Милисекундите НЕ влизат в документа: иначе две рендирания в една секунда се разминават.
    const ms1 = reportRender.renderPdf({ profile: 'forensic-full', blocks: START_STOP }, { createdAt: '2026-10-22T09:00:00.100Z' });
    const ms2 = reportRender.renderPdf({ profile: 'forensic-full', blocks: START_STOP }, { createdAt: '2026-10-22T09:00:00.900Z' });
    assert.equal(ms1.equals(ms2), true, 'различни милисекунди в СЪЩАТА секунда дават един и същ файл');
    assert.equal(reportRender.renderPdf({ profile: 'forensic-full', blocks: START_STOP.map((b) => (b.id === 't' ? { ...b, value: 'Друг договор' } : b)) }, { createdAt: issued }).equals(first), false, 'промяна в съдържанието дава РАЗЛИЧЕН PDF');
    const renderRes = await server.authFetch(server.base + '/admin/api/v2/reports/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest: { profile: 'forensic-full', blocks: START_STOP }, tsa: false, createdAt: issued }),
    });
    assert.equal(renderRes.status, 201, 'сървърът рендира отчета');
    const serverPdf = Buffer.from(await renderRes.arrayBuffer());
    assert.equal(renderRes.headers.get('x-pdf-sha256'), sha256(serverPdf), 'заглавката X-PDF-SHA256 е отпечатък на ВЪРНАТИТЕ байтове');
    assert.equal(sha256(serverPdf), sha256(first), 'сървърът и модулът дават един и същ PDF при същата дата');
    assert.equal(renderRes.headers.get('x-pdf-issued-at'), issued, 'сървърът казва с коя дата е издаден отчетът (за възпроизвеждане)');
    // Второ извикване през HTTP със същата дата → същият отпечатък.
    const renderAgain = await server.authFetch(server.base + '/admin/api/v2/reports/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest: { profile: 'forensic-full', blocks: START_STOP }, tsa: false, createdAt: issued }),
    });
    assert.equal(renderAgain.headers.get('x-pdf-sha256'), renderRes.headers.get('x-pdf-sha256'), 'две HTTP рендирания с една и съща дата дават един и същ отпечатък (възпроизводим отчет)');

    // ── 4. Манифестът: отпечатъкът е стабилен и чувствителен ────────────────────
    const m1 = manifest.normalize({ profile: 'forensic-full', blocks: START_STOP });
    const m2 = manifest.normalize({ blocks: START_STOP, profile: 'forensic-full' });
    assert.equal(manifest.digest(m1), manifest.digest(m2), 'редът на ключовете не мени отпечатъка (канонична форма)');
    const changed = manifest.normalize({ profile: 'forensic-full', blocks: START_STOP.map((b) => (b.id === 't' ? { ...b, value: 'Друг договор' } : b)) });
    assert.notEqual(manifest.digest(changed), manifest.digest(m1), 'промяна в един блок мени отпечатъка');
    assert.equal(manifest.digest(m1), sha256(Buffer.from(manifest.canonical(m1), 'utf8')), 'digest = sha256 от каноничния низ, както е документирано');

    // ── 5. CMS подпис: digest-ът е на ПОДПИСАНИТЕ байтове, не на нещо друго ────
    const identity = x509.selfSigned({ commonName: 'Oracle Signer', days: 30 });
    const signed = cms.signDetached({ data: first, certDer: identity.certDer, keyPem: identity.keyPem });
    assert.equal(signed.digest, sha256(first), 'подписаният отпечатък е sha256 на PDF-а');
    const verified = cms.verifyDetached({ data: first, cms: signed.cms });
    assert.equal(verified.ok, true, 'подписът се проверява');
    assert.equal(verified.digest, signed.digest, 'проверката връща същия отпечатък');
    const tampered = Buffer.from(first);
    tampered[Math.floor(tampered.length / 2)] ^= 0x01;
    const broken = cms.verifyDetached({ data: tampered, cms: signed.cms });
    assert.equal(broken.ok, false, 'подправен байт чупи подписа');
    assert.equal(broken.reason, 'messageDigest не съвпада с данните', 'причината е точната: разминава се отпечатъкът');

    // ── 6. Одитната верига: преизчислявам я САМ, ред по ред ─────────────────────
    const chainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-audit-'));
    try {
      const chain = auditChain.createAuditChain(chainDir);
      await chain.append('oracle.event', { digest: expectedFileHash });
      await chain.append('oracle.second', { n: 2 });
      const verdict = await chain.verify();
      assert.equal(verdict.valid, true, 'веригата е валидна');
      assert.equal(verdict.count, 2, 'точно два записа');
      const rows = fs.readFileSync(path.join(chainDir, 'audit-chain.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      let prev = '0'.repeat(64);
      rows.forEach((row, index) => {
        assert.equal(row.seq, index + 1, 'поредният номер е последователен');
        assert.equal(row.prevHash, prev, 'всеки запис сочи ТОЧНО предишния отпечатък');
        const canonical = JSON.stringify({ seq: row.seq, at: row.at, event: row.event, details: row.details, prevHash: row.prevHash });
        assert.equal(row.hash, sha256(Buffer.from(canonical, 'utf8')), 'отпечатъкът е sha256 от каноничния запис (независимо преизчисление)');
        prev = row.hash;
      });
      // Подправям ВТОРИЯ запис и очаквам отказ, който сочи точно него.
      const lines = fs.readFileSync(path.join(chainDir, 'audit-chain.jsonl'), 'utf8').split('\n').filter(Boolean);
      const second2 = JSON.parse(lines[1]);
      second2.details = { n: 999 };
      lines[1] = JSON.stringify(second2);
      fs.writeFileSync(path.join(chainDir, 'audit-chain.jsonl'), lines.join('\n') + '\n');
      const tamperVerdict = await chain.verify();
      assert.equal(tamperVerdict.valid, false, 'подправен запис се хваща');
      assert.equal(tamperVerdict.count, 1, 'веригата се разпада точно СЛЕД първия запис, не по-рано');
      assert.equal(tamperVerdict.reason, 'CHAIN_MISMATCH', 'причината е точната');
    } finally {
      fs.rmSync(chainDir, { recursive: true, force: true });
    }

    // ── 7. Криптиране на файл: обратимо, с точно оформление и чувствително ─────
    // Договорът: [magic 'hapiE1' 6][iv 12][tag 16][шифротекст]. Логическият sha256 и
    // размерът остават на ОТКРИТИЯ текст — затова отпечатъкът не зависи от шифроването.
    const secret = 'парола-за-теста';
    const envelope = fileCrypto.encrypt(BYTES, secret);
    assert.equal(Buffer.isBuffer(envelope), true, 'encrypt връща буфер');
    assert.equal(envelope.length, 6 + 12 + 16 + BYTES.length, 'оформлението е точно: magic + iv + tag + шифротекст');
    assert.equal(envelope.subarray(0, 6).toString('ascii'), 'hapiE1', 'файлът започва с разпознаваем маркер');
    assert.equal(fileCrypto.isEncrypted(envelope), true, 'пликът е разпознат като шифрован');
    assert.equal(fileCrypto.isEncrypted(BYTES), false, 'обикновените байтове НЕ се броят за шифровани');
    assert.equal(sha256(BYTES), expectedFileHash, 'отпечатъкът остава на открития текст (шифроването не го мени)');
    const plain = fileCrypto.decrypt(envelope, secret);
    assert.equal(Buffer.compare(plain, BYTES), 0, 'decrypt връща ТОЧНО същите байтове');
    assert.throws(() => fileCrypto.decrypt(envelope, 'друга-парола'), /unable to authenticate|bad decrypt/i, 'грешна парола дава криптографски отказ, а не „боклук“');
    const tampered2 = Buffer.from(envelope);
    tampered2[6 + 12 + 16] ^= 0x01; // първи байт от шифротекста
    assert.throws(() => fileCrypto.decrypt(tampered2, secret), /unable to authenticate|bad decrypt/i, 'подправен шифротекст се отказва (GCM таг)');
    assert.throws(() => fileCrypto.decrypt(Buffer.from('hapiE1'), secret), /Not an encrypted file/, 'скъсен файл се отказва с точната причина');

    console.log(
      'PASS oracle-digest-chain: sha256 ' + expectedFileHash.slice(0, 12) + '… един и същ в качване/списък/манифест/дърво/сваляне · ' +
      'PDF възпроизводим байт по байт · манифест стабилен · CMS digest = sha256(PDF) · одитна верига преизчислена независимо',
    );
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
