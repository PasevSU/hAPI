'use strict';
// ДВЕ СЕКЦИИ И ГОЛЯМО ЛОГО (0.69.243) — оформлението на публичната страница е договор.
//
// Защо има тест: страницата на портала беше осем блока един под друг (числа, статус на
// достъпа, резюме, информация, файлове, парола). Собственикът поиска обратното: посетителят
// вижда САМО структурата на портала (папки) и файловете, а всичко останало се отваря в
// прозорец. Тук се пази точно това:
//   1. `#main` има ТОЧНО две секции — дървото и файловете;
//   2. всеки друг блок (числа, достъп, резюме, информация, идентификатор, парола) живее
//      В прозорец (`section.sheet` с role="dialog"), а не на страницата;
//   3. заглавната част има голямо лого (вградено SVG) и три действия;
//   4. прозорците се затварят с Escape, а JS ги отваря/затваря през `openSheet`/`closeSheet`;
//   5. същото оформление е и в интеграционното копие — двата портала не се разминават.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORTAL = path.join(ROOT, 'hapi_enterprise', 'portal');
const INT = path.join(ROOT, 'custom_components', 'hapi_enterprise');

const read = (base, name) => fs.readFileSync(path.join(base, name), 'utf8');
const html = read(PORTAL, 'portal.html');
const js = read(PORTAL, 'portal.js');
const css = read(PORTAL, 'portal.css');
const i18nSource = read(PORTAL, 'portal-i18n.js');
const intHtml = read(INT, 'portal.html');
const intJs = read(INT, 'portal.js');
const intCss = read(INT, 'portal.css');

// ── 1. Кой възел в кой прозорец живее ────────────────────────────────────────
// Малък скенер на `<section>`: стек от позиции, за да знаем границите на всеки лист.
function sheetRanges(source) {
  const ranges = [];
  const stack = [];
  const tags = Array.from(source.matchAll(/<(\/?)section\b([^>]*)>/g));
  for (const m of tags) {
    if (m[1] !== '/') {
      stack.push({ start: m.index, open: m[2] });
      continue;
    }
    const top = stack.pop();
    if (!top) continue;
    const isSheet = /class="sheet"/.test(top.open);
    if (isSheet) ranges.push([top.start, m.index]);
  }
  return ranges;
}

const insideSheet = (source, id) => {
  const at = source.indexOf(`id="${id}"`);
  assert.ok(at > 0, `липсва възел #${id}`);
  return sheetRanges(source).some(([from, to]) => at > from && at < to);
};

// Блоковете, които НЕ бива да са на страницата: всеки от тях е в прозорец.
const SHEETED = [
  'stats', 'stat-files', 'access-card', 'access-list',
  'doc-info', 'doc-info-body', 'copy-link', 'api-open', 'manifest-open',
  'description', 'badges', 'contact',
];
// Само в add-on копието: резюмето, идентификаторът и формата за парола не съществуват в
// интеграционната страница (тя не отключва заключен портал и не показва резюме).
const SHEETED_ADDON = ['summary', 'summary-list', 'package-btn', 'portal-id', 'copy-id', 'locked', 'unlock-pw'];
for (const id of SHEETED) {
  assert.ok(insideSheet(html, id), `#${id} живее в прозорец, не на страницата`);
  assert.ok(insideSheet(intHtml, id), `#${id} живее в прозорец и в интеграционното копие`);
}
for (const id of SHEETED_ADDON) assert.ok(insideSheet(html, id), `#${id} живее в прозорец, не на страницата`);
// Двете секции НЕ са в прозорец — те са страницата.
for (const id of ['tree-panel', 'tree-list', 'files', 'files-title', 'q']) {
  assert.equal(insideSheet(html, id), false, `#${id} е на страницата, не в прозорец`);
  assert.equal(insideSheet(intHtml, id), false, `#${id} е на страницата и в интеграцията`);
}

// ── 2. Точно две секции в решетката ──────────────────────────────────────────
const gridOf = (source) => {
  const from = source.indexOf('<div class="portal-grid">');
  assert.ok(from > 0, 'липсва решетката .portal-grid');
  const to = source.indexOf('</div>', source.indexOf('</section>', source.indexOf('</section>', from) + 1));
  return source.slice(from, to);
};
const sectionsIn = (chunk) => (chunk.match(/<section\b/g) || []).length;
assert.equal(sectionsIn(gridOf(html)), 2, 'основната част има ТОЧНО две секции');
assert.equal(sectionsIn(gridOf(intHtml)), 2, 'интеграционната има също две секции');

// ── 3. Голямо лого и три действия в заглавната част ──────────────────────────
const heroOf = (source) => source.slice(source.indexOf('<header class="hero">'), source.indexOf('</header>') + 9);
const hero = heroOf(html);
assert.ok(/class="logo"/.test(hero), 'заглавната част има лого');
assert.ok(/<svg[^>]*viewBox="0 0 64 64"/.test(hero), 'логото е ВГРАДЕНО (inline SVG), без заявка за картинка');
assert.equal(/<img\b/.test(hero), false, 'логото не е <img> — няма счупена картинка');
assert.ok(/id="logo"/.test(hero) === false, 'логото не носи id — не е възел, който се пълни от данни');
for (const id of ['info-open', 'access-open', 'lang']) {
  assert.ok(hero.includes(`id="${id}"`), `заглавната част има #${id}`);
}
assert.equal(hero.includes('id="api-open"'), false, 'API не е в заглавната част — в прозореца е');
assert.ok(/id="info-open"[^>]*aria-controls="info-sheet"/.test(hero), '#info-open сочи прозореца');
assert.ok(/id="access-open"[^>]*aria-controls="access-sheet"/.test(hero), '#access-open сочи прозореца');
assert.ok(/<svg[^>]*viewBox="0 0 64 64"/.test(heroOf(intHtml)), 'логото е и в интеграционната заглавна част');

// ── 4. Прозорците са диалози и се затварят с Escape ─────────────────────────
for (const id of ['info-sheet', 'access-sheet']) {
  const tag = new RegExp(`<section class="sheet" id="${id}"[^>]*>`).exec(html);
  assert.ok(tag, `#${id} е секция с клас sheet`);
  assert.ok(/role="dialog"/.test(tag[0]), `#${id} е с role="dialog"`);
  assert.ok(/aria-modal="true"/.test(tag[0]), `#${id} е с aria-modal="true"`);
  assert.ok(/\shidden/.test(tag[0]), `#${id} е скрит, докато не се поиска`);
  assert.ok(html.includes(`id="${id}-close"`), `#${id} има бутон за затваряне`);
}
for (const [source, label] of [[js, 'add-on'], [intJs, 'интеграцията']]) {
  assert.ok(source.includes('function openSheet('), `${label}: липсва openSheet()`);
  assert.ok(source.includes('function closeSheet('), `${label}: липсва closeSheet()`);
  assert.ok(source.includes('e.key === "Escape"'), `${label}: Escape не затваря прозореца`);
  assert.ok(source.includes('aria-controls="'), `${label}: затварянето връща aria-expanded`);
}

// ── 5. Дървото се рисува от данните, а кликът сменя пътя ────────────────────
for (const [source, label] of [[js, 'add-on'], [intJs, 'интеграцията']]) {
  assert.ok(source.includes('function paintTree('), `${label}: липсва paintTree()`);
  assert.ok(source.includes('async function ensureTree('), `${label}: липсва ensureTree()`);
  assert.ok(source.includes('async function openTreeFolder('), `${label}: липсва openTreeFolder()`);
  assert.ok(/tree-list/.test(source), `${label}: дървото не се пълни в #tree-list`);
}

// ── 6. Оформлението съществува в двете копия ────────────────────────────────
for (const cls of ['.logo', '.portal-grid', '.ptree', '.ptree-btn']) {
  assert.ok(css.includes(cls), `portal.css съдържа ${cls}`);
  assert.ok(intCss.includes(cls), `интеграционният portal.css съдържа ${cls}`);
}

// ── 7. Планът съществува — оформлението не се сменя пак без документ ────────
const plan = path.join(ROOT, 'documentation', '07_RELEASE', 'PLAN_PORTAL_TWO_PANELS.md');
assert.ok(fs.existsSync(plan), 'планът на оформлението е в документацията');

// ── 8. ЖИВОТО: истинският HTML и истинският portal.js върху истински DOM ────
// Статичните проверки горе пазят файловете; тук се минава през всичко приложено наведнъж:
// страницата се монтира, логото е на място, основният екран е двете секции, дървото се
// пълни, кликът върху папка сменя списъка, а прозорците се отварят и затварят. API-то е
// подменено с точни отговори (живият сървър се пази от порталните тестове) — така проверката
// е детерминирана и не зависи от мрежа.
const vm = require('node:vm');
const { createDocument } = require('./lib/dom-stub.cjs');

const page = html
  .replace('{{BASE}}', 'http://127.0.0.1:9')
  .replace('{{API}}', '/api/v1/p/demo')
  .replace('{{FOLDER}}', '')
  .replace('{{FOLDERS}}', '1')
  .replace('{{QR}}', '')
  .replace('{{LOCKED}}', '0');
const bodyHtml = page.slice(page.indexOf('<body>') + '<body>'.length, page.indexOf('</body>'));
const doc = createDocument({ lang: 'bg' });
doc.body.innerHTML = bodyHtml;

const FILES_ROOT = [
  { name: 'a.txt', path: 'a.txt', size: 3, modifiedAt: '2026-01-02T10:00:00.000Z' },
];
const FILES_DOCS = [
  { name: 'b.txt', path: 'Документи/b.txt', size: 7, modifiedAt: '2026-02-03T11:30:00.000Z' },
];
const jsonRes = (payload) => ({
  ok: true,
  status: 200,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});
const apiRoutes = {
  '/api/v1/p/demo': {
    id: 'demo-id-1234567890',
    title: 'Две секции',
    visibility: 'public',
    readonly: false,
    urls: { folders: '1' },
  },
  '/api/v1/p/demo/files?limit=500': { files: [], total: 0 },
  '/api/v1/p/demo/tree?path=/': { files: FILES_ROOT, folders: [{ name: 'Документи', path: 'Документи' }] },
  '/api/v1/p/demo/tree?path=/Документи': { files: FILES_DOCS, folders: [] },
};
const requested = [];
const sandbox = {
  document: doc,
  location: {
    protocol: 'http:', origin: 'http://127.0.0.1:9', host: '127.0.0.1', pathname: '/p/demo', search: '', hash: '',
    href: 'http://127.0.0.1:9/p/demo', toString: () => 'http://127.0.0.1:9/p/demo',
  },
  isSecureContext: true,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  URL,
  TextEncoder,
  TextDecoder,
  Blob: class Blob { constructor(parts) { this.parts = parts; this.size = 0 } },
  crypto: require('node:crypto').webcrypto,
  navigator: { clipboard: { writeText: async () => {} } },
  fetch: async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    requested.push(path);
    // `withAuth()` кодира пътя на папката (`%2F`, кирилица), затова ключът се разчита.
    let key;
    try {
      key = decodeURIComponent(path);
    } catch {
      key = path;
    }
    const found = apiRoutes[path] || apiRoutes[key];
    if (found) return jsonRes(found);
    return { ok: false, status: 404, json: async () => null, text: async () => '' };
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(i18nSource, sandbox, { filename: 'portal-i18n.js' });
vm.runInContext(js, sandbox, { filename: 'portal.js' });

const waitFor = async (check, label) => {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('изтече времето: ' + label);
};

(async () => {
  const byId = (id) => doc.getElementById(id);

  // (а) двете секции се виждат, прозорците са скрити, логото е на място
  await waitFor(() => byId('files').children.length > 0, 'списъкът на портала');
  assert.ok(doc.querySelector('.logo svg'), 'логото е на страницата');
  assert.equal(byId('info-sheet').hidden, true, 'прозорецът „Информация“ е скрит в началото');
  assert.equal(byId('access-sheet').hidden, true, 'прозорецът „Достъп“ е скрит в началото');
  const grid = doc.querySelector('.portal-grid');
  assert.ok(grid, 'основната част е решетка .portal-grid');
  const gridSections = Array.from(grid.children).filter((el) => String(el.tagName).toLowerCase() === 'section');
  assert.equal(gridSections.length, 2, 'в решетката има ТОЧНО две секции: ' + gridSections.map((el) => el.id).join(', '));
  assert.equal(gridSections.filter((el) => !el.hidden).length, 2, 'и двете секции се виждат');
  assert.equal(gridSections[0].id, 'tree-panel', 'първата секция е структурата на портала');
  assert.ok(byId('files').textContent.includes('a.txt'), 'коренният файл е в списъка');

  // (б) дървото се пълни от данните и кликът сменя пътя на списъка
  await waitFor(() => doc.querySelectorAll('#tree-list button').length > 0, 'редовете на дървото');
  const rows = Array.from(doc.querySelectorAll('#tree-list button'));
  assert.ok(rows.length >= 2, 'дървото показва корена и папката: ' + rows.length);
  const folderRow = rows.find((el) => el.textContent.includes('Документи'));
  assert.ok(folderRow, 'папката е в дървото');
  folderRow.click();
  await waitFor(() => byId('files').textContent.includes('b.txt'), 'съдържанието на папката');

  // (в) прозорецът „Информация“: отваря се, носи числата, затваря се с Escape
  byId('info-open').click();
  assert.equal(byId('info-sheet').hidden, false, '„Информация“ се отваря');
  assert.equal(byId('info-open').getAttribute('aria-expanded'), 'true', 'бутонът обявява отворено състояние');
  assert.ok(byId('portal-id').textContent.includes('demo-id'), 'идентификаторът е в прозореца');
  assert.ok(byId('stats').textContent.includes('1'), 'числата са сметнати от данните');
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(byId('info-sheet').hidden, true, 'Escape затваря прозореца');
  assert.equal(byId('info-open').getAttribute('aria-expanded'), 'false', 'бутонът се връща в спокойно състояние');

  // (г) прозорецът „Достъп“: статусът на достъпа е вътре, не на страницата
  byId('access-open').click();
  assert.equal(byId('access-sheet').hidden, false, '„Достъп“ се отваря');
  assert.ok(byId('access-list').children.length > 0, 'статусът на достъпа е изчислен');
  byId('access-sheet-close').click();
  assert.equal(byId('access-sheet').hidden, true, 'бутонът затваря прозореца');
  assert.equal(byId('access-open').getAttribute('aria-expanded'), 'false', 'бутонът на достъпа се връща в спокойно състояние');

  console.log(
    'PASS portal-two-panels: две секции (дърво и файлове) · ' +
      `${SHEETED.length} блока в прозорци · голямо лого (inline SVG) · три действия · Escape · ` +
      'двете копия · живата страница: дърво → клик → списък · прозорците се отварят и затварят',
  );
})();

