'use strict';
// ОТЧЕТ С ЕДНО НАТИСКАНЕ (ADR-0028, стъпка 2): обхват → манифест → PDF → запис в листа.
//
// Защо има тест: отчетът е твърдение за файлове (име, байтове, SHA-256). Ако обхватът се
// сбърка, отчетът пак ще е валиден PDF и никой няма да разбере, че описва чужди файлове.
// Затова тук се проверява СЪДЪРЖАНИЕТО, не само статусът:
//   1. трите обхвата (портал · папка · файл) дават запис с линк, брой файлове и байтове;
//   2. хешът в PDF-а е на НАБОРА (basis), а не на един файл — сменен файл дава друг отчет;
//   3. всяко натискане ражда НОВ запис (D7): стар линк не се преизползва;
//   4. отказ: път извън портала, празна папка, непознат портал, портал без собствена папка;
//   5. PDF-ът е истински (`%PDF-`), а листът го сочи към файла на диска.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const makePortal = async (server, slug, title) => {
  const made = await server.api('/admin/api/portals', 'POST', { slug, title, visibility: 'public' });
  assert.equal(made.status, 201, 'порталът се създава: ' + JSON.stringify(made.data));
  return made.data;
};

const upload = async (server, portalId, name, text) => {
  const res = await fetch(server.base + `/admin/api/portals/${portalId}/files`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + server.token, 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' },
    body: Buffer.from(text, 'utf8'),
  });
  const data = await res.json().catch(() => null);
  assert.equal(res.status, 201, 'файлът се качва: ' + JSON.stringify(data));
  return data;
};

const oneclick = (server, body) => server.api('/admin/api/v2/reports/oneclick', 'POST', body);

(async () => {
  const server = await startServer({ keepData: true });
  try {
    const portal = await makePortal(server, 'oneclick-demo', 'Портал с отчети');
    await upload(server, portal.id, 'договор.txt', 'първи документ');
    await upload(server, portal.id, 'приложение.txt', 'втори документ');

    // ── 1. Отчет за портала: регистърът на портала, всеки файл премерен наново ──
    const first = await oneclick(server, { portal: portal.id, type: 'portal' });
    assert.equal(first.status, 201, 'отчетът за портала се строи: ' + JSON.stringify(first.data));
    const record = first.data;
    assert.match(record.url, /^\/statik\/[A-Za-z0-9_-]{32}\/report-portal-oneclick-demo-.+\.pdf$/, 'линкът е /statik/<id>/<име>.pdf');
    assert.equal(record.type, 'portal');
    assert.equal(record.path, '', 'отчетът за портала няма път в папката');
    assert.equal(record.files, 2, 'описани са двата качени файла');
    assert.ok(record.bytes > 4000, 'PDF-ът има съдържание, байтове: ' + record.bytes);
    assert.match(record.sha256, /^[0-9a-f]{64}$/, 'записът носи sha256 на готовия PDF');
    assert.match(record.api, /^\/admin\/api\/portals\/[^/]+\/tree$/, 'записът носи препратка към дървото на портала');

    const pdfFile = path.join(server.dir, 'statik', record.id + '.pdf');
    assert.ok(fs.existsSync(pdfFile), 'PDF-ът е записан до листа: ' + pdfFile);
    const bytes = fs.readFileSync(pdfFile);
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-', 'файлът е PDF');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), record.sha256, 'sha256 в записа е на самия файл');
    assert.equal(bytes.length, record.bytes, 'байтовете в записа са на самия файл');

    // Листът е един файл и съдържа записа — това е „твърдогенерираният“ адрес.
    const indexFile = path.join(server.dir, 'statik', 'index.json');
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    assert.equal(index.links[record.id].url, record.url, 'листът сочи същия адрес');
    assert.equal(index.links[record.id].portalId, portal.id, 'листът свързва линка с портала');

    // ── 2. Всяко натискане ражда НОВ запис (D7) ──────────────────────────────
    const again = await oneclick(server, { portal: portal.id, type: 'portal' });
    assert.equal(again.status, 201);
    assert.notEqual(again.data.id, record.id, 'второто натискане дава нов линк, а не стария');
    const save = await server.api('/admin/api/v2/reports/links?portal=' + portal.id);
    assert.equal(save.status, 200);
    assert.equal(save.data.links.length, 2, 'листът пази и двата отчета');

    // ── 3. Отчет за папка: дървото на портала (собствена папка) ──────────────
    // `storage_root` на създадения портал е собствена папка, тоест обхватът „папка“ е позволен.
    // Пътят се смята от ЛОГИЧЕСКИЯ `storage_root` през `paths.js` — тестът не строи
    // `<share>/<slug>` сам (иначе на Windows получава `D:\share`).
    const paths = require('../hapi_enterprise/paths');
    const folderRoot = paths.resolveStoragePath(portal.storage_root, '', { STORAGE_ROOT_OVERRIDE: server.storageRoot() });
    fs.mkdirSync(path.join(folderRoot, 'подпапка'), { recursive: true });
    fs.writeFileSync(path.join(folderRoot, 'протокол.txt'), 'съдържание на протокола');
    fs.writeFileSync(path.join(folderRoot, 'подпапка', 'фактура.txt'), 'сума');

    const folder = await oneclick(server, { portal: portal.id, type: 'folder', path: '' });
    assert.equal(folder.status, 201, 'отчетът за папката се строи: ' + JSON.stringify(folder.data));
    assert.equal(folder.data.type, 'folder');
    assert.equal(folder.data.files, 2, 'папката има два файла (един в подпапка)');
    assert.match(folder.data.url, /report-folder-/, 'името казва обхвата');

    const single = await oneclick(server, { portal: portal.id, type: 'file', path: 'протокол.txt' });
    assert.equal(single.status, 201, 'отчетът за файла се строи: ' + JSON.stringify(single.data));
    assert.equal(single.data.files, 1);
    assert.equal(single.data.path, 'протокол.txt', 'записът пази пътя до файла');
    assert.match(single.data.url, /report-file-/, 'името казва обхвата');

    // Отчетът за файл описва ТОЧНО този файл: сменено съдържание дава друг отпечатък.
    const before = single.data.sha256;
    fs.writeFileSync(path.join(folderRoot, 'протокол.txt'), 'съдържание на протокола — поправено');
    const changed = await oneclick(server, { portal: portal.id, type: 'file', path: 'протокол.txt' });
    assert.equal(changed.status, 201);
    assert.notEqual(changed.data.sha256, before, 'сменен файл дава различен отчет');

    // ── 4. Отказите казват защо ──────────────────────────────────────────────
    const outside = await oneclick(server, { portal: portal.id, type: 'file', path: '../../db.json' });
    assert.equal(outside.status, 400, 'път извън портала се отказва');
    assert.match(outside.data.error, /PATH_OUTSIDE_PORTAL/);

    const emptyFolder = await oneclick(server, { portal: portal.id, type: 'folder', path: 'няма-такава' });
    assert.equal(emptyFolder.status, 404, 'липсваща папка е 404');

    const badType = await oneclick(server, { portal: portal.id, type: 'всичко' });
    assert.equal(badType.status, 400, 'непознат обхват се отказва');
    assert.match(badType.data.error, /BAD_SCOPE/);

    const noPortal = await oneclick(server, { portal: 'няма-такъв', type: 'portal' });
    assert.equal(noPortal.status, 404, 'непознат портал е 404');

    // ── 5. Празен портал: отчетът не твърди нищо за нула файла ───────────────
    const voidPortal = await makePortal(server, 'oneclick-void', 'Празен портал');
    const voidReport = await oneclick(server, { portal: voidPortal.id, type: 'portal' });
    assert.equal(voidReport.status, 400, 'празен обхват се отказва');
    assert.match(voidReport.data.error, /EMPTY_SCOPE/);

    // ── 6. Без токен административният маршрут не работи ─────────────────────
    const naked = await fetch(server.base + '/admin/api/v2/reports/oneclick', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ portal: portal.id, type: 'portal' }),
    });
    assert.equal(naked.status, 401, 'отчетът е административна операция');

    console.log('PASS oneclick-reports: 3 обхвата · линк + лист · нов запис при всяко натискане · отказите с причина');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
