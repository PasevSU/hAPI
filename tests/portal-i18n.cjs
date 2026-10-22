'use strict';
// Речникът на публичната страница (PP-14): пълнота, липсващи ключове и превод на
// статичния HTML. Тестът НЕ проверява стил на превода, а че няма дупка: ключ без
// текст, текст без ключ, кирилица в английския или немския.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const I = require(path.join(ROOT, 'hapi_enterprise', 'portal-i18n.js'));
const html = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'portal.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'portal.js'), 'utf8');

const keysOf = (lang) => Object.keys(I.dictionary(lang));
const CYRILLIC = /[А-Яа-яЁё]/;

console.log('· три езика, един и същ набор от ключове');
{
  assert.deepEqual(I.LANGS, ['bg', 'en', 'de'], 'езиците са BG/EN/DE');
  const bg = keysOf('bg').sort();
  assert.ok(bg.length >= 60, 'речникът е пълен, не примерно: ' + bg.length + ' ключа');
  for (const lang of ['en', 'de']) {
    assert.deepEqual(keysOf(lang).sort(), bg, 'ключовете на „' + lang + '“ съвпадат с българските');
  }
  // Няма празен текст и няма ключ, оставен като превод.
  for (const lang of I.LANGS) {
    const dict = I.dictionary(lang);
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', lang + '/' + key + ' е текст');
      assert.ok(value.trim().length > 0, lang + '/' + key + ' не е празен');
      assert.notEqual(value, key, lang + '/' + key + ' не е оставен като ключ');
    }
  }
}

console.log('· английският и немският нямат кирилица');
{
  for (const lang of ['en', 'de']) {
    const dict = I.dictionary(lang);
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(CYRILLIC.test(value), false, lang + '/' + key + ' съдържа кирилица: ' + value);
    }
  }
  // Българският, обратно, трябва да е кирилски — иначе „преводът“ е копие на английския.
  const bgValues = Object.entries(I.dictionary('bg')).filter(([key]) => !/^(header\.api|header\.manifest)$/.test(key));
  assert.ok(
    bgValues.filter(([, value]) => CYRILLIC.test(value)).length >= bgValues.length - 3,
    'българският речник е наистина български',
  );
}

console.log('· всеки ключ от HTML и от portal.js съществува в речника');
{
  const dict = new Set(keysOf('bg'));
  const used = new Set();
  for (const m of html.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)) used.add(m[1]);
  // Само литерални ключове: `T("flag." + x)` е съставен ключ и се проверява от самите
  // стойности на флаговете (info/important/urgent/archive), не от този списък.
  for (const m of js.matchAll(/T\(\s*"([^"]+)"\s*[,)]/g)) used.add(m[1]);
  assert.ok(used.size >= 30, 'страницата ползва речника, не твърди текстове: ' + used.size + ' ключа');
  const missing = [...used].filter((key) => !dict.has(key));
  assert.deepEqual(missing, [], 'липсващи ключове в речника: ' + missing.join(', '));
  // Обратното: ключ, който никой не ползва, е мъртъв текст. Допускат се само ключове,
  // които кодът сглобява от префикс (`T("flag." + data.flag)`) — и то само ако точно
  // този префикс наистина се сглобява в кода.
  const DYNAMIC = ['flag.'];
  const unused = [...dict].filter((key) => {
    if (used.has(key)) return false;
    if (new RegExp('"' + key.replace(/\./g, '\\.') + '"').test(js)) return false;
    const prefix = DYNAMIC.find((p) => key.startsWith(p));
    if (prefix) return !js.includes('T("' + prefix + '" +');
    return true;
  });
  assert.deepEqual(unused, [], 'ключове без употреба: ' + unused.join(', '));
}

console.log('· статичният HTML е преводим и без JavaScript');
{
  // Всяка видима част на страницата има ключ — иначе смяната на езика оставя български.
  for (const id of ['title', 'summary-title', 'files-title', 'qr-title', 'visibility', 'copy-id', 'copy-link', 'api-link', 'manifest-link']) {
    const tag = new RegExp('<[^>]*id="' + id + '"[^>]*>', 'i').exec(html);
    assert.ok(tag, 'има елемент #' + id);
    const hasKey = /data-i18n/.test(tag[0]) || id === 'title';
    assert.ok(hasKey, 'елементът #' + id + ' има data-i18n ключ: ' + tag[0].slice(0, 120));
  }
  assert.match(html, /<title[^>]*data-i18n="doc\.title"/, '<title> също се превежда');
  assert.match(html, /id="lang"/, 'има избор на език');
  assert.match(html, /<option value="bg"/, 'изборът предлага български');
  assert.match(html, /<option value="en"/, 'изборът предлага английски');
  assert.match(html, /<option value="de"/, 'изборът предлага немски');
  assert.match(html, /src="\/portal-i18n\.js"/, 'речникът се зарежда преди portal.js');
  assert.ok(html.indexOf('/portal-i18n.js') < html.indexOf('/portal.js'), 'редът на скриптовете е правилен');
}

console.log('· t() замества, count() избира форма, pick() пази подразбирането');
{
  assert.equal(I.t('bg', 'summary.many', { n: 3, what: 'файла', size: '1 MB' }), 'Този портал е цялостен набор от 3 файла с общ обем 1 MB.');
  assert.equal(I.t('en', 'summary.many', { n: 3, what: 'files', size: '1 MB' }), 'This portal is a complete set of 3 files with a total size of 1 MB.');
  assert.equal(I.t('en', 'no.such.key'), 'no.such.key', 'липсващ ключ се вижда, не се скрива');
  assert.equal(I.t('de', 'file.status.http', { status: 403 }), 'Der Download ist fehlgeschlagen (HTTP 403).');
  assert.equal(I.t('bg', 'file.status.http', { status: 403 }), 'Изтеглянето не бе успешно (HTTP 403).');
  // Заместител без стойност остава видим — по-добре от „undefined“ в текста.
  assert.match(I.t('en', 'file.status.started'), /\{name\}/, 'непопълнен заместител остава видим');

  assert.equal(I.count('bg', 1, 'doc'), 'документ');
  assert.equal(I.count('bg', 3, 'doc'), 'документа');
  assert.equal(I.count('en', 1, 'image'), 'image');
  assert.equal(I.count('en', 2, 'image'), 'images');
  assert.equal(I.count('de', 1, 'archive'), 'Archiv');
  assert.equal(I.count('de', 5, 'archive'), 'Archive');
  assert.equal(I.count('bg', 2, 'unknown-kind'), 'файла', 'непознат вид пада към „файл“');

  assert.equal(I.pick('en'), 'en');
  assert.equal(I.pick('DE'), 'de', 'главните букви не чупят избора');
  assert.equal(I.pick('fr'), 'bg', 'непознат език пада към български');
  assert.equal(I.pick(null), 'bg');
  assert.equal(I.isLang('de'), true);
  assert.equal(I.isLang('fr'), false);
}

console.log('· apply() превежда DOM дървото и слага lang на <html>');
{
  // Малък фалшив DOM: достатъчно, за да проверим, че apply() стига до атрибутите.
  const made = [];
  const el = (attrs) => {
    const node = {
      attrs: { ...attrs },
      textContent: '',
      getAttribute: (n) => node.attrs[n],
      setAttribute: (n, v) => { node.attrs[n] = v; },
    };
    made.push(node);
    return node;
  };
  const nodes = [el({ 'data-i18n': 'files.title' }), el({ 'data-i18n-placeholder': 'files.search.placeholder.plain' }), el({ 'data-i18n-title': 'header.copyId.title' })];
  const root = {
    documentElement: { attrs: { lang: 'bg' }, setAttribute(n, v) { this.attrs[n] = v } },
    querySelectorAll: (selector) => nodes.filter((n) => Object.hasOwn(n.attrs, selector.slice(1, -1))),
  };
  const applied = I.apply(root, 'en');
  assert.equal(applied, 3, 'три елемента са преведени');
  assert.equal(nodes[0].textContent, 'Files');
  assert.equal(nodes[1].attrs.placeholder, 'Search by name');
  assert.equal(nodes[2].attrs.title, 'Copy the identifier');
  assert.equal(root.documentElement.attrs.lang, 'en', '<html lang> следва езика');
}

console.log('PASS portal-i18n: BG/EN/DE с еднакъв набор ключове · без кирилица в EN/DE · всеки ключ от HTML/JS съществува · статичният HTML е преводим · t/count/pick/apply работят');
