'use strict';
// ИНТЕГРАЦИОННИЯТ ПОРТАЛ ГОВОРИ СЪЩИТЕ ТРИ ЕЗИКА (0.69.210).
//
// Защо има тест: публичната страница съществува в две копия — в add-on-а и в HACS
// интеграцията. Add-on страницата има речник (BG/EN/DE) от 0.69.78, а интеграционната
// беше само на български: чужд потребител, отворил QR кода през Home Assistant, виждаше
// български интерфейс. Тук се пази решението:
//   1. речникът е СЪЩИЯТ файл (`portal-i18n.js`) — едни текстове, без втори речник;
//   2. всеки ключ, сложен в HTML-а, има превод на трите езика, а DE/EN са без кирилица;
//   3. речникът се сервира: иначе `/assets/portal-i18n.js` е 404 (същият капан като
//      `UI_FILES` в add-on-а) и страницата остава едноезична, без никой да разбере;
//   4. страницата наистина сменя езика в DOM — от адреса, от запазения избор и пада към
//      български при непознат език;
//   5. ратчет: българският текст, който ОСТАВА (съобщенията от кода), не расте.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./lib/dom-stub.cjs');

const ROOT = path.join(__dirname, '..');
const INT = path.join(ROOT, 'custom_components', 'hapi_enterprise');
const CYRILLIC = /[А-Яа-яЁё]/;
const read = (file) => fs.readFileSync(path.join(INT, file), 'utf8');
// Същото правило като `tests/ui-i18n-ratchet.cjs`: коментарите са на български нарочно и
// не са интерфейсен текст.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

// ── 1. Един речник за двете страници ────────────────────────────────────────
const addonDictionary = path.join(ROOT, 'hapi_enterprise', 'portal', 'portal-i18n.js');
const integrationDictionary = path.join(INT, 'portal-i18n.js');
assert.ok(fs.existsSync(integrationDictionary), 'интеграцията има свой portal-i18n.js');
assert.deepEqual(
  fs.readFileSync(integrationDictionary),
  fs.readFileSync(addonDictionary),
  'речникът е СЪЩИЯТ файл като в add-on портала — втори речник значи разминаващи се текстове',
);
const dict = require(integrationDictionary);

// ── 2. Всеки ключ в HTML-а има превод на трите езика ────────────────────────
const html = read('portal.html');
const KEY_ATTRS = /data-i18n(?:-placeholder|-title|-aria|-alt)?="([^"]+)"/g;
const keys = [...html.matchAll(KEY_ATTRS)].map((m) => m[1]);
assert.ok(keys.length >= 20, 'страницата носи поне 20 ключа за превод, намерени: ' + keys.length);
for (const lang of dict.LANGS) {
  const table = dict.dictionary(lang);
  for (const key of keys) {
    assert.ok(Object.hasOwn(table, key), `липсва превод на „${lang}“ за ключа „${key}“`);
  }
}
for (const lang of ['en', 'de']) {
  const table = dict.dictionary(lang);
  for (const key of keys) {
    assert.equal(CYRILLIC.test(table[key]), false, `${lang}/${key} съдържа кирилица: ${table[key]}`);
  }
}

// ── 3. Речникът се ЗАРЕЖДА и се СЕРВИРА ─────────────────────────────────────
// Капанът от DEF-38: файл, който не е в allowlist-а на сървъра, е 404 при зелен код.
const idxDictionary = html.indexOf('/assets/portal-i18n.js');
const idxPageScript = html.indexOf('/assets/portal.js');
assert.ok(idxDictionary > 0, 'portal.html зарежда /assets/portal-i18n.js');
assert.ok(idxPageScript > idxDictionary, 'речникът се зарежда ПРЕДИ portal.js (иначе няма кой да го приложи)');
const py = read('__init__.py');
assert.match(
  py,
  /_read_static_files[\s\S]{0,300}portal-i18n\.js/,
  'интеграцията ЧЕТЕ portal-i18n.js при старт — без това asset-ът е 404',
);
assert.match(
  py,
  /asset not in \("portal\.js", "portal-i18n\.js", "portal\.css"\)/,
  'asset изгледът РАЗРЕШАВА portal-i18n.js — иначе 404 при зелен код',
);
const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-haoss.cjs'), 'utf8');
assert.ok(build.includes("'portal-i18n.js'"), 'build-haoss изисква речникът да е в HACS пакета');

// ── 4. Страницата сменя езика в ЖИВ DOM ─────────────────────────────────────
const portalHtml = read('portal.html');
const bodyHtml = portalHtml.slice(portalHtml.indexOf('<body>') + '<body>'.length, portalHtml.indexOf('</body>'));

/** Монтира интеграционната страница така, както я отваря браузърът (без мрежа). */
function mountPage({ lang = '', saved = '' } = {}) {
  const doc = createDocument({ lang: 'bg' });
  doc.body.innerHTML = bodyHtml;
  const store = new Map();
  if (saved) store.set('hapi.portalLang', saved);
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const query = lang ? '?lang=' + encodeURIComponent(lang) : '';
  const sandbox = {
    document: doc,
    location: {
      protocol: 'http:',
      origin: 'http://ha.local',
      pathname: '/api/hapi_enterprise/portal/demo',
      href: 'http://ha.local/api/hapi_enterprise/portal/demo' + query,
      search: query,
      hash: '',
    },
    localStorage,
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    // Мрежата не е нужна: страницата трябва да е четима и когато API-то не отговаря.
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(integrationDictionary, 'utf8'), sandbox, { filename: 'portal-i18n.js' });
  vm.runInContext(read('portal.js'), sandbox, { filename: 'portal.js' });
  return { doc, store };
}

/** Всеки елемент с `data-i18n*` трябва да носи ТОЧНО превода за избрания език. */
function assertTranslated(doc, lang, label) {
  let checked = 0;
  for (const [attribute, target] of [
    ['data-i18n', 'textContent'],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-title', 'title'],
    ['data-i18n-aria', 'aria-label'],
  ]) {
    for (const el of doc.querySelectorAll('[' + attribute + ']')) {
      const key = el.getAttribute(attribute);
      if (!key) continue;
      const expected = dict.t(lang, key);
      const actual = target === 'textContent' ? String(el.textContent || '') : el.getAttribute(target);
      assert.equal(String(actual || '').trim(), expected, `${label}: ${attribute}="${key}" не е преведен`);
      checked += 1;
    }
  }
  assert.ok(checked >= 20, label + ': проверени възли ' + checked);
  return checked;
}

console.log('· без език в адреса — български (страницата работи и без избор)');
{
  const { doc } = mountPage({});
  assert.equal(String(doc.documentElement.getAttribute('lang')), 'bg', '<html lang="bg"> по подразбиране');
  assertTranslated(doc, 'bg', 'bg');
}

console.log('· ?lang=en — интерфейсът е английски, без кирилица в преведените възли');
{
  const { doc } = mountPage({ lang: 'en' });
  assert.equal(String(doc.documentElement.getAttribute('lang')), 'en', '<html lang="en">');
  assert.equal(String(doc.getElementById('lang').value), 'en', 'изборът показва английски');
  assertTranslated(doc, 'en', 'en');
  for (const id of ['files-title', 'access-title', 'stat-files-label', 'copy-link', 'bar-search', 'fi-verify']) {
    const text = String(doc.getElementById(id).textContent || '').trim();
    assert.equal(CYRILLIC.test(text), false, '#' + id + ' остана на кирилица: ' + text);
  }
}

console.log('· ?lang=de — немски; непознат език пада към български, не към празна страница');
{
  const de = mountPage({ lang: 'de' });
  assert.equal(String(de.doc.documentElement.getAttribute('lang')), 'de');
  assertTranslated(de.doc, 'de', 'de');
  const fr = mountPage({ lang: 'fr' });
  assert.equal(String(fr.doc.documentElement.getAttribute('lang')), 'bg', 'fr не се приема — остава български');
}

console.log('· запазен избор на посетителя се помни и се прилага преди адреса');
{
  const { doc, store } = mountPage({ saved: 'de' });
  assert.equal(String(doc.documentElement.getAttribute('lang')), 'de', 'запазеният избор се прилага');
  const select = doc.getElementById('lang');
  select.value = 'en';
  select.dispatch('change');
  assert.equal(String(doc.documentElement.getAttribute('lang')), 'en', 'смяната от избора се прилага веднага');
  assert.equal(store.get('hapi.portalLang'), 'en', 'изборът се запазва за следващото отваряне');
  assertTranslated(doc, 'en', 'en след смяна');
}

// ── 5. Ратчет: оставащият български текст не расте ─────────────────────────
// Преведени са СТАТИЧНИТЕ текстове (заглавия, бутони, етикети, подсказки). Съобщенията,
// които кодът строи (статуси, грешки, изречения за съдържанието), още са на български —
// те искат ключове × 3 езика и са отделна задача. Числото е измерено днес; може само да пада.
const LIMIT_DEBT = 2916;
const debtOf = (file) => {
  const src = read(file);
  const code = file.endsWith('.js') ? stripComments(src) : src.replace(/<!--[\s\S]*?-->/g, ' ');
  return (code.match(/[\u0400-\u04FF]/g) || []).length;
};
const debtJs = debtOf('portal.js');
const debtHtml = debtOf('portal.html');
assert.ok(
  debtJs + debtHtml <= LIMIT_DEBT,
  `българският текст в интеграционния портал е ${debtJs + debtHtml} знака, таванът е ${LIMIT_DEBT}. ` +
    'Нов текст минава през t() от portal-i18n.js; ако си ПРЕВЕЛ модул, свали тавана в същия комит.',
);

console.log(
  'PASS integration-portal-i18n: един речник с add-on-а · ' +
    keys.length +
    ' ключа × ' +
    dict.LANGS.length +
    ' езика · asset обявен в __init__.py и в build-haoss · ' +
    'страницата сменя езика в DOM (bg/en/de, fr→bg) · остават ' +
    (debtJs + debtHtml) +
    ' български знака (таван ' +
    LIMIT_DEBT +
    ')',
);
