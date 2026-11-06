'use strict';
// Evidence View портал — РЕНДЕР тест върху истинския assets/app.js.
//
// Защо: договорните проверки (имена на функции, текстове) не хващат runtime грешка. Тук
// файлът се изпълнява върху DOM stub-а на репото, с вендорвания QR енкодер и реален демо
// манифест, и се проверява какво РЕАЛНО се появява на страницата: обобщение, редове, детайли
// и QR код с валиден SVG path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./lib/dom-stub.cjs');

const pkg = path.join(__dirname, '..', 'hapi_enterprise', 'evidence-portal');
const read = (rel) => fs.readFileSync(path.join(pkg, rel), 'utf8');
const manifest = JSON.parse(read('data/demo-evidence.json'));

const doc = createDocument({ lang: 'bg' });
// Страницата има `<main id="app">`; stub-ът се ражда празен, затова коренът се създава тук.
const root = doc.createElement('main');
root.id = 'app';
doc.body.append(root);
// SVG се строи с createElementNS; stub-ът няма такъв, затова се добавя тук (не в продукта).
const createElement = doc.createElement.bind(doc);
doc.createElementNS = (namespace, tag) => {
  const el = createElement(tag);
  el.namespaceURI = namespace;
  return el;
};

const appSource = read('assets/app.js').replace(/^import .*$/m, 'const requireConsent = async () => {};');
const sandbox = {
  document: doc,
  console,
  location: {
    origin: 'https://ha.example',
    pathname: '/local/hapi/data/portal.html',
    search: '?folder=demo-evidence',
    hash: '#file=f1',
  },
  history: { replaceState() { } },
  navigator: { clipboard: { writeText() { } } },
  URLSearchParams,
  URL,
  Intl,
  encodeURIComponent,
  decodeURIComponent,
  setTimeout,
  alert() { },
  fetch: async (url) => {
    if (String(url).includes('/api/evidence/')) return { ok: false, status: 404 };
    return { ok: true, json: async () => manifest };
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('assets/qrcode.js'), sandbox, { filename: 'qrcode.js' });
assert.equal(typeof sandbox.qrcode, 'function', 'QR енкодерът се зарежда преди app.js');
vm.runInContext(appSource, sandbox, { filename: 'app.js' });

(async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 10));

  const app = doc.querySelector('#app');
  assert.ok(app, 'приложението има корен #app');
  const text = app.textContent;
  assert.match(text, /Доказателства \(демонстрация\)/, 'заглавието на пакета се показва');
  assert.match(text, /Файлове:\s*3/, 'обобщението показва броя файлове');
  assert.match(text, /Договор_17\.pdf/, 'файлът от манифеста е в таблицата');

  const cards = app.querySelectorAll('.card');
  assert.ok(cards.length >= 3, 'всяка карта е един файл/папка: ' + cards.length);
  const cardNames = app.querySelectorAll('.card .cardname').map((h) => h.textContent);
  assert.ok(cardNames.includes('Договор_17.pdf'), 'картата на файла е с истинското име: ' + cardNames.join(', '));
  const tags = app.querySelectorAll('.tag');
  assert.ok(tags.length >= 3, 'етикетите се виждат като чипове: ' + tags.length);
  assert.equal(app.querySelectorAll('table').length, 0, 'облачният изглед не е таблица');

  // Дълбоката връзка #file=f1 трябва да отвори детайлите още при зареждане.
  const details = doc.querySelector('.details');
  assert.ok(details, 'детайлният панел е отворен от #file=f1');
  const detailText = details.textContent;
  assert.match(detailText, /Основни/, 'секция „Основни“');
  assert.match(detailText, /Цялост/, 'секция „Цялост“');
  assert.match(detailText, /application\/pdf/, 'показва MIME типа');
  assert.match(detailText, /SHA-512/, 'показва и втория хеш');

  // QR: истински SVG с path, който кодира #file=f1, и връзка без тайни.
  const svg = details.querySelector('.qrbox svg');
  assert.ok(svg, 'QR SVG се рисува в детайлите');
  const pathEl = svg.querySelector('path');
  assert.ok(pathEl, 'SVG-ът има path');
  const d = pathEl.getAttribute('d');
  assert.match(d, /^M\d+ \d+h1v1h-1z/, 'path-ът е от QR модули');
  assert.ok(d.length > 500, 'QR кодът има достатъчно модули: ' + d.length);
  const link = details.querySelector('.qrlink').textContent;
  assert.equal(link, 'https://ha.example/local/hapi/data/portal.html?folder=demo-evidence#file=f1', 'връзката е база + #file=');
  assert.equal(/password|token=/i.test(link), false, 'връзката в QR не съдържа парола или токен');

  console.log('PASS evidence-portal render: обобщение · таблица · детайли · QR SVG за #file=f1');
})();
