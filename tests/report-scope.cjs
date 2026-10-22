'use strict';
// Обхвати на отчетите (`ui/report-scope.js`) — чистата част, без DOM и без сървър.
//
// Проверява се договорът, а не оформлението: всеки обхват дава ВАЛИДЕН манифест по
// `report-manifest.js`, границите START/STOP са заключени и на мястото си, подробните
// редове са ограничени и съкращението е КАЗАНО, а „отчетът за този файл“ наистина
// съдържа този файл.
const assert = require('node:assert/strict');
const path = require('node:path');

// Модулите са UMD и очакват браузърни глобални; тук им даваме минималните.
const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const navigations = [];
globalThis.window = { HapiUI: { go: (id) => navigations.push(String(id)) } };

const S = require('../hapi_enterprise/ui/report-scope.js');
const M = require('../hapi_enterprise/report-manifest.js');

const fileOf = (name, size, extra) => ({
  id: 'f-' + name,
  name,
  size,
  version: 1,
  accessMode: 'FREE',
  sha256: 'a'.repeat(64),
  uploadedAt: '2026-10-01T10:00:00.000Z',
  topic: 'Тема',
  category: 'Категория',
  ...(extra || {}),
});
const portalOf = (slug, files) => ({ id: 'p-' + slug, slug, title: 'Портал ' + slug, visibility: 'public', files: files || [] });
const treeOf = (folders, fileCount, bytes) => ({
  folderCount: folders.length,
  fileCount,
  bytes,
  folders,
});

const ids = (manifest) => manifest.blocks.map((b) => b.id);
const types = (manifest) => manifest.blocks.map((b) => b.type);

function assertValid(result, what) {
  assert.ok(result && result.manifest, what + ': има манифест');
  const check = M.check(result.manifest);
  assert.equal(check.ok, true, what + ': манифестът е валиден — ' + JSON.stringify(check.errors));
  const blocks = result.manifest.blocks;
  assert.equal(blocks[0].type, 'rfc3161-start', what + ': START е първи');
  assert.equal(blocks[0].locked, true, what + ': START е заключен');
  assert.equal(blocks[blocks.length - 1].type, 'rfc3161-stop', what + ': STOP е последен');
  assert.equal(blocks[blocks.length - 1].locked, true, what + ': STOP е заключен');
  assert.ok(blocks.length <= 200, what + ': блоковете са под тавана на манифеста');
  const list = ids(result.manifest);
  assert.equal(new Set(list).size, list.length, what + ': id-тата на блоковете са уникални');
  for (const id of list) assert.match(id, /^[a-z][a-z0-9_-]{0,63}$/, what + ': id „' + id + '“ е по договора');
  assert.ok(String(result.manifest.profile).length <= 64, what + ': профилът е под 64 знака');
  assert.equal(result.summary.at.length > 0, true, what + ': отчетът казва кога е сглобен');
}

console.log('· file — отчетът за един файл съдържа точно този файл');
{
  const portal = portalOf('demo', [fileOf('договор.pdf', 2048), fileOf('снимка.jpg', 4096)]);
  const r = S.buildFile({ portal, file: portal.files[0] });
  assertValid(r, 'file');
  assert.equal(r.scope, 'file');
  assert.equal(r.summary.files, 1, 'един файл');
  assert.match(r.manifest.blocks[1].value, /договор\.pdf/, 'заглавието назовава файла');
  const items = Object.fromEntries(r.manifest.blocks[2].items.map((i) => [i.key, i.value]));
  assert.equal(items['Файл'], 'договор.pdf');
  assert.equal(items['SHA-256 (регистриран при качване)'], 'a'.repeat(64), 'хешът е този от регистъра');
  assert.equal(items['Портал'], 'Портал demo');
  const qr = r.manifest.blocks.find((b) => b.type === 'qr');
  assert.ok(qr, 'има QR блок с адреса за изтегляне');
  assert.equal(qr.value, '/api/v1/p/demo/files/' + encodeURIComponent(portal.files[0].id) + '/download');
  // Не бива да влиза втори файл — отчетът е за ЕДИН файл.
  assert.equal(JSON.stringify(r.manifest).includes('снимка.jpg'), false, 'другият файл не влиза');
}

console.log('· file — файл без хеш не си измисля отпечатък');
{
  const portal = portalOf('demo', []);
  const bare = { id: 'x', name: 'без-хеш.txt', size: 10, version: 1 };
  const r = S.buildFile({ portal, file: bare });
  assertValid(r, 'file без хеш');
  const items = Object.fromEntries(r.manifest.blocks[2].items.map((i) => [i.key, i.value]));
  assert.equal(Object.hasOwn(items, 'SHA-256 (регистриран при качване)'), false, 'няма измислен хеш');
}

console.log('· portal — всички регистрирани файлове, подробно до тавана');
{
  const files = Array.from({ length: 3 }, (_, i) => fileOf('файл-' + (i + 1) + '.pdf', 1000));
  const r = S.buildPortal({ portal: portalOf('demo', files) });
  assertValid(r, 'portal');
  assert.equal(r.scope, 'portal');
  assert.equal(r.summary.files, 3);
  assert.equal(r.summary.folders, 0, 'без рекурсия няма папки');
  const metas = r.manifest.blocks.filter((b) => b.type === 'metadata');
  assert.equal(metas.length, 4, 'обобщение + по един блок на файл');
  assert.equal(r.summary.truncated, false);
}

console.log('· portal — при много файлове съкращението е КАЗАНО');
{
  const many = Array.from({ length: S.MAX_DETAIL + 5 }, (_, i) => fileOf('f' + i + '.pdf', 10));
  const r = S.buildPortal({ portal: portalOf('mnogo', many) });
  assertValid(r, 'portal съкратен');
  assert.equal(r.summary.files, S.MAX_DETAIL + 5);
  assert.equal(r.summary.truncated, true, 'отчетът признава, че е съкратен');
  const note = r.manifest.blocks.find((b) => b.id === 'more-files');
  assert.ok(note, 'има блок, който обяснява съкращението');
  assert.match(note.value, new RegExp('първите ' + S.MAX_DETAIL + ' от ' + (S.MAX_DETAIL + 5)), 'броят е верен: ' + note.value);
}

console.log('· portal-recursive — папките влизат рекурсивно, с път и обем');
{
  const tree = treeOf(
    [
      { path: 'А', fileCount: 2, bytes: 2000, folders: [{ path: 'А/Б', fileCount: 1, bytes: 500, folders: [] }] },
      { path: 'В', fileCount: 1, bytes: 100, folders: [] },
    ],
    3,
    2100,
  );
  const r = S.buildPortal({ portal: portalOf('demo', [fileOf('a.pdf', 10)]), tree, recursive: true });
  assertValid(r, 'portal-recursive');
  assert.equal(r.scope, 'portal-recursive');
  assert.equal(r.summary.folders, 2, 'две папки в дървото');
  const paths = r.manifest.blocks.filter((b) => String(b.id).startsWith('folder')).map((b) => b.label);
  assert.deepEqual(paths, ['Папка /А', 'Папка /А/Б', 'Папка /В'], 'папките са рекурсивно: ' + paths.join(' | '));
  const items = Object.fromEntries(r.manifest.blocks[2].items.map((i) => [i.key, i.value]));
  assert.equal(items['Папки (рекурсивно)'], '2');
  assert.equal(items['Файлове в папките'], '3');
}

console.log('· combo — всички портали в един отчет');
{
  const portals = [portalOf('a', [fileOf('1.pdf', 10), fileOf('2.pdf', 20)]), portalOf('b', [fileOf('3.pdf', 30)])];
  const r = S.buildCombo({ portals });
  assertValid(r, 'combo');
  assert.equal(r.scope, 'combo');
  assert.equal(r.summary.portals, 2);
  assert.equal(r.summary.files, 3, 'файловете са сбор от порталите');
  assert.equal(r.summary.folders, 0, 'без рекурсия няма папки');
  assert.match(r.manifest.blocks[1].value, /2 портала/);
  const perPortal = r.manifest.blocks.filter((b) => String(b.id).startsWith('portal'));
  assert.equal(perPortal.length, 2, 'по един блок на портал');
  assert.match(perPortal[0].label, /Портал a/);
}

console.log('· combo-recursive — папките на всеки портал се сумират');
{
  const portals = [portalOf('a', [fileOf('1.pdf', 10)]), portalOf('b', [])];
  const trees = { 'p-a': treeOf([{ path: 'X', fileCount: 2, bytes: 20, folders: [] }], 2, 20), 'p-b': treeOf([], 0, 0) };
  const r = S.buildCombo({ portals, trees, recursive: true });
  assertValid(r, 'combo-recursive');
  assert.equal(r.scope, 'combo-recursive');
  assert.equal(r.summary.folders, 1, 'една папка общо');
  const scopeItems = Object.fromEntries(r.manifest.blocks[2].items.map((i) => [i.key, i.value]));
  assert.equal(scopeItems['Папки (рекурсивно)'], '1');
  assert.match(r.manifest.blocks[1].value, /Рекурсивен комбо отчет/);
}

console.log('· combo — много портали: подробните са до тавана и това е записано');
{
  const portals = Array.from({ length: S.MAX_PORTALS + 3 }, (_, i) => portalOf('p' + i, []));
  const r = S.buildCombo({ portals });
  assertValid(r, 'combo голям');
  assert.equal(r.summary.portals, S.MAX_PORTALS + 3);
  assert.equal(r.summary.truncated, true);
  assert.ok(r.manifest.blocks.find((b) => b.id === 'more-portals'), 'има обяснение за съкращението');
  assert.equal(ids(r.manifest).length, 2 + 1 + 1 + S.MAX_PORTALS + 1, 'блоковете са точно колкото трябва');
}

console.log('· празен портал и нула портали — отчетът пак е валиден');
{
  assertValid(S.buildPortal({ portal: portalOf('empty', []) }), 'празен портал');
  assertValid(S.buildCombo({ portals: [] }), 'нула портали');
  assert.equal(S.buildCombo({ portals: [] }).summary.truncated, false);
}

console.log('· без входни данни — ясна грешка, не празен отчет');
{
  assert.throws(() => S.buildFile({ portal: portalOf('x', []) }), /Липсва файл/, 'файл е задължителен');
  assert.throws(() => S.buildPortal({}), /Липсва портал/, 'портал е задължителен');
  assert.throws(() => S.open(null), /Липсва манифест/, 'няма отваряне без манифест');
}

console.log('· open/readPending — обхватът стига до Report Studio и се изчиства');
{
  const r = S.buildPortal({ portal: portalOf('demo', [fileOf('a.pdf', 10)]) });
  const payload = S.open(r);
  assert.deepEqual(navigations, ['report'], 'панелът „Отчети“ се отваря');
  assert.equal(payload.scope, 'portal');
  const pending = S.readPending();
  assert.ok(pending, 'чакащият обхват се чете');
  assert.equal(pending.scope, 'portal');
  assert.equal(pending.label, r.label, 'етикетът стига до панела');
  assert.equal(pending.manifest.blocks.length, r.manifest.blocks.length, 'манифестът е целият');
  S.clearPending();
  assert.equal(S.readPending(), null, 'след поемане няма чакащ обхват');
}

console.log('· fmtSize — обемът е в четима форма');
{
  assert.equal(S.fmtSize(0), '0 B');
  assert.equal(S.fmtSize(2048), '2 KB');
  assert.equal(S.fmtSize(5 * 1048576), '5 MB');
}

console.log('PASS report-scope: 5 обхвата дават валиден манифест · START/STOP заключени · съкращението е казано · рекурсията стига до папките · обхватът стига до Report Studio');
void path;
