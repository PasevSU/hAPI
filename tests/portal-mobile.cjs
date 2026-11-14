'use strict';
// МОБИЛНАТА КОРА НА ПОРТАЛА Е ДОГОВОР, НЕ ОФОРМЛЕНИЕ (PP-15).
//
// Защо има тест: екранът на телефона е ПЪРВИЯТ, който посетителят вижда — QR кодът се
// сканира с телефон. Затова числата на портала, статусът на достъпа, информацията за един
// файл и бързите действия трябва да са на страницата, а не да се стигат през три екрана.
//
// Какво пази:
//   1. всички възли на кората съществуват и СА бутони, където се натискат;
//   2. всяко число се ИЗЧИСЛЯВА от данните (`files.length`), а не е написано в HTML;
//   3. сверката на отпечатъка е истинска — същият `sha256Hex`, който свалянето ползва;
//   4. всеки нов ключ има превод на трите езика (иначе страницата показва ключа);
//   5. страницата НЕ показва QR към себе си (DEF-34 остава затворен);
//   6. бързата лента не е декорация: всеки бутон вика съществуващо действие.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'portal', 'portal.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'portal', 'portal.js'), 'utf8');
const baseCss = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'portal', 'portal.css'), 'utf8');
const modernCss = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'portal', 'portal-modern.css'), 'utf8');
const i18n = require(path.join(ROOT, 'hapi_enterprise', 'portal', 'portal-i18n.js'));
// Вторият портал (интеграцията) има същия договор: двата варианта не бива да се разминават.
const intHtml = fs.readFileSync(path.join(ROOT, 'custom_components', 'hapi_enterprise', 'portal.html'), 'utf8');
const intJs = fs.readFileSync(path.join(ROOT, 'custom_components', 'hapi_enterprise', 'portal.js'), 'utf8');
const intCss = fs.readFileSync(path.join(ROOT, 'custom_components', 'hapi_enterprise', 'portal.css'), 'utf8');

// ── 1. Възлите на кората ──────────────────────────────────────────────────────
const IDS = [
  'stats', 'stat-files', 'stat-folders', 'stat-hash', 'stat-key',
  'access-card', 'access-state', 'access-list',
  'file-info', 'file-info-name', 'file-info-close',
  'fi-general', 'fi-integrity', 'fi-hash', 'fi-verify', 'fi-result',
  'footbar', 'bar-top', 'bar-search', 'bar-info', 'bar-manifest',
];
for (const id of IDS) assert.ok(html.includes(`id="${id}"`), `липсва възел #${id} в portal.html`);
for (const id of IDS) assert.ok(intHtml.includes(`id="${id}"`), `липсва възел #${id} в интеграционния portal.html`);

// Паритет: същият набор възли в двата портала — иначе единият изостава тихо.
const idsOf = (source) =>
  [...IDS].filter((id) => source.includes(`id="${id}"`)).sort().join(',');
assert.equal(idsOf(html), idsOf(intHtml), 'двата портала трябва да имат еднакъв набор възли на кората');

// Действията са бутони: на телефон `<a>` с празен href е капан, а страницата не дава линкове.
for (const id of ['file-info-close', 'fi-verify', 'bar-top', 'bar-search', 'bar-info', 'bar-manifest']) {
  assert.match(html, new RegExp('<button[^>]*id="' + id + '"', 'i'), `#${id} трябва да е БУТОН`);
  assert.match(intHtml, new RegExp('<button[^>]*id="' + id + '"', 'i'), `#${id} трябва да е БУТОН и в интеграцията`);
}

// Листът е диалог: скрит по подразбиране и с aria-modal, за да не се чете зад него.
const sheetTag = /<section class="sheet" id="file-info"[^>]*>/.exec(html);
assert.ok(sheetTag, 'листът #file-info не е секция с клас sheet');
assert.ok(/role="dialog"/.test(sheetTag[0]), 'листът е с role="dialog"');
assert.ok(/aria-modal="true"/.test(sheetTag[0]), 'листът е с aria-modal="true"');
assert.ok(/\shidden/.test(sheetTag[0]), 'листът е скрит, докато не се поиска');

// ── 2. Числата се смятат, не се пишат ─────────────────────────────────────────
assert.ok(js.includes('function paintStats()'), 'липсва paintStats() — числата няма кой да ги сметне');
for (const call of ['set("stat-files", files)', 'set("stat-hash", hash)', 'set("stat-key", key)']) {
  assert.ok(js.includes(call), `paintStats не смята ${call}`);
}
// Числата идват от заредените данни, а не от литерал в скрипта.
assert.ok(js.includes('allFiles.filter((f) => f.sha256).length'), 'броят „с отпечатък“ трябва да е от данните');
assert.ok(js.includes('allFiles.filter((f) => f.accessMode === "KEY_REQUIRED").length'), 'броят „с ключ“ трябва да е от данните');

// ── 3. Статусът на достъпа следва политиката на портала ───────────────────────
assert.ok(js.includes('function paintAccess(data)'), 'липсва paintAccess()');
assert.ok(js.includes('data.visibility === "public"'), 'статусът трябва да идва от видимостта на портала');
assert.ok(js.includes('access.free.count') && js.includes('access.key.count'), 'броячите по режим липсват');

// ── 4. Сверката на отпечатъка е ИСТИНСКА ───────────────────────────────────────
assert.ok(js.includes('async function verifyFile(file)'), 'липсва verifyFile()');
assert.match(js, /sha256Hex\(await res\.arrayBuffer\(\)\)/, 'сверката трябва да смята SHA-256 на живите байтове');
assert.ok(js.includes('fileinfo.match') && js.includes('fileinfo.mismatch'), 'липсват двата изхода от сверката');
// Файл с ключ не се проверява без ключ — бутонът се скрива, вместо да лъже.
assert.ok(
  js.includes('file.accessMode !== "KEY_REQUIRED" && file.accessMode !== "DISABLED"'),
  'сверката трябва да е отказана за файл с ключ и за забранен файл',
);

// ── 5. Бързата лента вика съществуващи действия ──
assert.ok(js.includes('function wireQuickBar()'), 'липсва wireQuickBar()');
for (const call of ['openInfo("api")', 'openInfo("manifest")', 'closeFileInfo', 'window.scrollTo']) {
  assert.ok(js.includes(call), `бързата лента не връзва ${call}`);
}
assert.ok(js.includes('wireQuickBar();'), 'wireQuickBar не се вика при рисуване на портала');

// ── 5б. Същото в интеграционния портал ─────────────────────────────────────
for (const fn of [
  'function paintStats()',
  'function paintAccess(data)',
  'function openFileInfo(file)',
  'async function verifyFile(file)',
  'function wireQuickBar()',
]) {
  assert.ok(intJs.includes(fn), `интеграционният portal.js няма ${fn}`);
}
assert.match(intJs, /sha256Hex\(await res\.arrayBuffer\(\)\)/, 'сверката в интеграцията трябва да е на живите байтове');
assert.ok(intJs.includes('paintStats();'), 'интеграционният portal.js не вика paintStats');
assert.ok(intJs.includes('wireQuickBar();'), 'интеграционният portal.js не вика wireQuickBar');
assert.ok(intJs.includes('!f.accessMode || f.accessMode === "FREE"'), 'интеграцията трябва да брои „без ключ“ от данните');

// ── 6. Всеки ключ има превод на трите езика ──────────────────────────────────
const used = new Set();
for (const m of html.matchAll(/data-i18n(?:-aria|-title)?="([\w.]+)"/g)) used.add(m[1]);
for (const m of js.matchAll(/\bT\("([\w.]+)"/g)) used.add(m[1]);
const mobileKeys = [...used].filter((key) => /^(stats|access|fileinfo|bar)\./.test(key));
assert.ok(mobileKeys.length >= 30, 'ключовете на кората са необичайно малко: ' + mobileKeys.length);
for (const lang of i18n.LANGS) {
  const dict = i18n.dictionary(lang);
  const missing = mobileKeys.filter((key) => !(key in dict));
  assert.deepEqual(missing, [], `липсват преводи на „${lang}“: ` + missing.join(', '));
}

// ── 7. DEF-34 остава затворен: никакъв QR към самата страница ────────────────
for (const gone of ['qr-panel', 'id="qr"', 'id="qr-note"', 'id="qr-hint"', 'id="portal-url"']) {
  assert.equal(html.includes(gone), false, `страницата НЕ бива да съдържа ${gone} (DEF-34)`);
}

// ── 8. Оформлението съществува и в двете кожи ───────────────────────────────
for (const cls of ['.stats', '.sheet', '.fi-block', '.footbar', '.bar-btn']) {
  assert.ok(baseCss.includes(cls), `portal.css (базата) съдържа ${cls}`);
  assert.ok(modernCss.includes(cls), `portal-modern.css (кожата) съдържа ${cls}`);
  assert.ok(intCss.includes(cls), `интеграционният portal.css съдържа ${cls}`);
}
assert.ok(baseCss.includes('@media (min-width: 720px)'), 'базата има точка на пречупване за широк екран');
assert.ok(modernCss.includes('@media (min-width: 720px)'), 'кожата има точка на пречупване за широк екран');

// ── 9. Листът се затваря и с Escape (телефонът няма къде да се цъкне извън него) ──
assert.ok(js.includes('e.key === "Escape"'), 'липсва затваряне с Escape');

console.log(
  `PASS portal-mobile: ${IDS.length} възела · ${mobileKeys.length} ключа × ${i18n.LANGS.length} езика · ` +
    'двата портала с един и същ набор · числа от данните · сверка на живите байтове · без QR към себе си',
);
