'use strict';
// ОРАКУЛ: манифестът и виртуалното хранилище дават ТОЧНО очаквания резултат.
//
// Тук се проверяват правилата на домейна, а не „има ли грешка“:
//   • нормализирането връща ТОЧНО този обект (схема, страница, брандинг, печат);
//   • всеки отказ има ТОЧЕН код и ТОЧЕН път (напр. `blocks[1].signature`);
//   • START е винаги първи, STOP — винаги последен, а системните блокове не се
//     променят от потребителя;
//   • виртуалните пътища са уникални, стабилни и НЕ позволяват излизане от корена.
const assert = require('node:assert/strict');
const manifest = require('../hapi_enterprise/report-manifest.js');
const virtualStorage = require('../hapi_enterprise/virtual-storage.js');

const START = { id: 's', type: 'rfc3161-start', label: 'START', locked: true };
const STOP = { id: 'e', type: 'rfc3161-stop', label: 'STOP', locked: true };
const codeOf = (errors) => errors.map((e) => e.code);
const pathOf = (errors, code) => (errors.find((e) => e.code === code) || {}).path || null;

// ── 1. Нормализиране: точно очакваният обект ───────────────────────────────────
{
  const normalized = manifest.normalize({ blocks: [START, STOP] });
  assert.deepEqual(normalized, {
    schemaVersion: 1,
    profile: 'default',
    page: { format: 'A4', orientation: 'portrait', marginsMm: [15, 15, 15, 15] },
    branding: { organization: '', logo: '', qr: false },
    print: { pageNumbers: true, headerFooter: false, footerNote: '' },
    blocks: [START, STOP],
  }, 'нормализирането връща ТОЧНО този обект — без излишни полета и с подразбирания');
  assert.equal(manifest.SCHEMA_VERSION, 1, 'схемата е версия 1');
  // Подразбиранията не бива да „изяждат“ подаденото.
  const custom = manifest.normalize({ blocks: [START, STOP], profile: 'forensic-full', page: { format: 'A4', orientation: 'portrait', marginsMm: [10, 12, 10, 12] }, branding: { organization: 'Община', qr: true } });
  assert.equal(custom.profile, 'forensic-full', 'профилът се пази');
  assert.deepEqual(custom.page.marginsMm, [10, 12, 10, 12], 'полетата се пазят точно');
  assert.equal(custom.branding.organization, 'Община', 'брандингът се пази');
  assert.equal(custom.branding.qr, true, 'флагът за QR се пази');
  assert.equal(custom.branding.logo, '', 'липсващото поле получава празна стойност, не undefined');
}

// ── 2. Откази: ТОЧЕН код + ТОЧЕН път ───────────────────────────────────────────
{
  const empty = manifest.validate({});
  assert.deepEqual(codeOf(empty.errors), ['UNSUPPORTED_SCHEMA_VERSION', 'INVALID_PROFILE', 'INVALID_PAGE', 'INVALID_BLOCKS'], 'празният манифест дава точно тези четири грешки в този ред');
  assert.equal(empty.ok, false, 'празният манифест не е валиден');

  // Един блок изобщо не е отчет: валидаторът спира с INVALID_BLOCKS (поне два).
  const single = manifest.validate({ blocks: [STOP] });
  assert.ok(codeOf(single.errors).includes('INVALID_BLOCKS'), 'един блок → INVALID_BLOCKS (отчетът иска начало и край)');

  const noStart = manifest.validate({ blocks: [{ id: 't', type: 'title', value: 'x' }, STOP] });
  assert.ok(codeOf(noStart.errors).includes('MISSING_START'), 'липсващият START се отчита като MISSING_START');
  assert.equal(pathOf(noStart.errors, 'MISSING_START'), 'blocks', 'пътят сочи блока на масива');
  assert.equal(pathOf(noStart.errors, 'START_NOT_FIRST'), 'blocks[0]', 'първият блок е проверен И за позиция');

  const noStop = manifest.validate({ blocks: [START, { id: 't', type: 'title', value: 'x' }] });
  assert.ok(codeOf(noStop.errors).includes('MISSING_STOP'), 'липсващият STOP се отчита като MISSING_STOP');
  assert.equal(pathOf(noStop.errors, 'STOP_NOT_LAST'), 'blocks[1]', 'последният блок е проверен И за позиция');

  const unknownType = manifest.validate({ blocks: [START, { id: 'x', type: 'nope' }, STOP] });
  assert.equal(pathOf(unknownType.errors, 'UNKNOWN_BLOCK_TYPE'), 'blocks[1].type', 'пътят сочи ТОЧНО невалидния блок и полето');
  assert.match(unknownType.errors.find((e) => e.code === 'UNKNOWN_BLOCK_TYPE').message, /title, text, table, image, qr, separator, signature, metadata, hash-table/, 'съобщението изброява позволените типове');

  const middle = manifest.validate({ blocks: [START, { ...START, id: 's2', label: 'S2' }, STOP] });
  assert.ok(codeOf(middle.errors).includes('SYSTEM_BLOCK_IN_MIDDLE'), 'втори системен блок в средата се отказва');
  assert.equal(pathOf(middle.errors, 'SYSTEM_BLOCK_IN_MIDDLE'), 'blocks[1]', 'пътят е на втория блок');

  const forbidden = manifest.validate({ blocks: [START, { id: 't', type: 'title', value: 'x', signature: 'фалшив' }, STOP] });
  assert.equal(pathOf(forbidden.errors, 'FORBIDDEN_FIELD'), 'blocks[1].signature', 'забраненото поле се хваща с точния път');
  assert.match(forbidden.errors.find((e) => e.code === 'FORBIDDEN_FIELD').message, /издадени TSA\/подпис стойности не са част от оформлението/, 'съобщението обяснява ЗАЩО е забранено');
  for (const key of ['tsaToken', 'tsaTime', 'tsaTimestamp', 'signature', 'signatureValue', 'certificate']) {
    assert.ok(manifest.FORBIDDEN_KEYS.includes(key), 'ключът „' + key + '“ е в списъка на забранените (никой не може да внесе фалшив подпис в оформлението)');
  }
}

// ── 3. Отпечатък: чувствителен на всяка смислена промяна ──────────────────────
{
  const base = manifest.normalize({ blocks: [START, STOP] });
  const variants = {
    'нов блок': manifest.normalize({ blocks: [START, { id: 't', type: 'title', value: 'x' }, STOP] }),
    'друг профил': manifest.normalize({ blocks: [START, STOP], profile: 'forensic-full' }),
    'други полета': manifest.normalize({ blocks: [START, STOP], page: { format: 'A4', orientation: 'portrait', marginsMm: [1, 2, 3, 4] } }),
    'друг брандинг': manifest.normalize({ blocks: [START, STOP], branding: { organization: 'X' } }),
  };
  const baseDigest = manifest.digest(base);
  assert.match(baseDigest, /^[0-9a-f]{64}$/, 'отпечатъкът е 64 hex знака');
  for (const [label, variant] of Object.entries(variants)) {
    assert.notEqual(manifest.digest(variant), baseDigest, 'промяна „' + label + '“ дава ДРУГ отпечатък');
  }
  // Една и съща промяна → един и същ отпечатък, независимо от реда на ключовете.
  const a = manifest.normalize({ profile: 'forensic-full', blocks: [START, STOP] });
  const b = manifest.normalize({ blocks: [START, STOP], profile: 'forensic-full' });
  assert.equal(manifest.digest(a), manifest.digest(b), 'редът на ключовете не влияе (канонична форма)');
}

// ── 4. Виртуално хранилище: точни пътища и уникалност ─────────────────────────
{
  const files = [
    { id: 'f1', name: 'Договор.pdf', topic: 'Договори', category: '2026', group: 'Община', sha256: 'a'.repeat(64), size: 10 },
    { id: 'f2', name: 'Анекс.pdf', topic: 'Договори', category: '2026', group: 'Община', sha256: 'b'.repeat(64), size: 20 },
    // Същото име в същата папка: трябва да получи РАЗЛИЧЕН път, без да презаписва.
    { id: 'f3', name: 'Договор.pdf', topic: 'Договори', category: '2026', group: 'Община', sha256: 'c'.repeat(64), size: 30 },
  ];
  const paths = virtualStorage.pathsOf(files);
  assert.equal(paths.f1, '/Договори/2026/Община/Договор.pdf', 'пътят е точно тема/категория/група/име');
  assert.equal(paths.f2, '/Договори/2026/Община/Анекс.pdf', 'вторият файл е до първия');
  assert.equal(paths.f3, '/Договори/2026/Община/Договор (2).pdf', 'еднаквото име получава „ (2)“, а НЕ презаписва първия');
  assert.equal(new Set(Object.values(paths)).size, 3, 'всички пътища са уникални');
  const tree = virtualStorage.buildTree(files);
  assert.equal(tree.fileCount, 3, 'дървото брои ТОЧНО три файла');
  assert.equal(tree.folderCount, 3, 'дървото брои ТОЧНО три папки (тема → категория → група)');

  // Резолвване: точно попадение и точен отказ при излизане от корена.
  const hit = virtualStorage.resolve(tree, paths.f1);
  assert.equal(hit && hit.id, 'f1', 'пътят се резолвва до ТОЧНО този файл');
  assert.equal(virtualStorage.resolve(tree, '/../etc/passwd'), null, 'излизане нагоре се отказва (null, не „някакъв“ файл)');
  assert.equal(virtualStorage.resolve(tree, '/Договори/../../x'), null, 'двойно излизане също се отказва');
  assert.equal(virtualStorage.resolve(tree, '/няма/такъв/файл.pdf'), null, 'липсващ път връща null');
  assert.equal(virtualStorage.resolve(tree, '/'), tree.tree, 'коренът се резолвва до самото дърво');
  assert.equal(virtualStorage.flatten(tree).length, 3, 'плоското изброяване дава ТОЧНО три файла');
  // Санитизиране на име: без управляващи знаци и без наклонени черти.
  assert.equal(virtualStorage.sanitizeSegment('a/b'), 'a_b', 'наклонена черта в име става долно тире');
  assert.equal(virtualStorage.sanitizeSegment('..'), '', '„..“ се изхвърля НАПЪЛНО (празен сегмент), а не се преименува — така не може да стане част от път');
  assert.equal(virtualStorage.sanitizeSegment('...'), '...', 'трите точки НЕ са обхождане и остават');
  assert.equal(virtualStorage.sanitizeSegment('  ime  '), 'ime', 'водещите/следващите интервали се махат');
  assert.equal(virtualStorage.sanitizeSegment('a\u0000b'), 'a_b', 'управляващ знак не влиза в име на файл');
  // Празните сегменти се изхвърлят от пътя — затова файл с тема „..“ не излиза от корена.
  const sneaky = virtualStorage.pathsOf([{ id: 'x', name: 'f.pdf', topic: '..', category: '..', group: '..' }]);
  assert.equal(sneaky.x, '/f.pdf', 'тема/категория/група от „..“ не създават нива в пътя');
}

console.log(
  'PASS oracle-manifest-rules: нормализиране с точни подразбирания · откази с точен код и път (' +
  manifest.FORBIDDEN_KEYS.length + ' забранени ключа) · отпечатък чувствителен · виртуални пътища уникални и без изход от корена',
);
