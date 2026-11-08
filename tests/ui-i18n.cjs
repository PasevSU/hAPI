'use strict';
// Немските (и английските) низове в панелите (BUG-11).
//
// Проблемът: навигацията беше преведена в `app.js`, а съдържанието на панелите — не.
// Затова тук се проверява не „има ли превод“, а че:
//   1. всеки ключ, който кодът ползва, съществува и в трите езика и е непразен;
//   2. немският и английският НЕ съдържат кирилица (хваща забравен български текст);
//   3. панелът взима заглавията на секциите и заглавките на таблиците през речника,
//      а не като твърд текст;
//   4. при смяна на езика панелът наистина се пре-рисува на немски (проверено в vm).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const uiDir = path.join(__dirname, '..', 'hapi_enterprise', 'ui');
const read = (f) => fs.readFileSync(path.join(uiDir, f), 'utf8');
const i18n = require(path.join(uiDir, 'i18n.js'));

// ── 1. Пълнота и чистота на речника ──────────────────────────────────────────────
const langs = i18n.LANGS;
assert.deepEqual(langs.sort(), ['bg', 'de', 'en'], 'три езика');
const keys = Object.keys(i18n.DICT.bg);
assert.ok(keys.length >= 60, `речникът има поне 60 ключа (сега ${keys.length})`);
for (const lang of langs) {
  for (const key of keys) {
    const value = i18n.DICT[lang][key];
    assert.ok(typeof value === 'string' && value.trim(), `${lang}: липсва стойност за ${key}`);
    // Марката (`portal.brand` = „ПАП БОКС“) е собствено име и не се превежда — както
    // `header.api` на публичната страница. Всичко останало в DE/EN трябва да е без кирилица.
    if (lang !== 'bg' && key !== 'portal.brand') {
      assert.equal(/[\u0400-\u04FF]/.test(value), false, `${lang}: „${key}“ съдържа кирилица: ${value}`);
    }
  }
  const extra = Object.keys(i18n.DICT[lang]).filter((k) => !keys.includes(k));
  assert.deepEqual(extra, [], `${lang}: излишни ключове — ${extra.join(', ')}`);
}

// ── 2. Всеки T('...') в панелите съществува в речника ───────────────────────────
const panel = read('settings-panel.js');
const used = new Set([...panel.matchAll(/\bT\('([a-z]+(?:\.[A-Za-z]+){1,2})'\)/g)].map((m) => m[1]));
assert.ok(used.size >= 40, `панелът ползва поне 40 ключа (сега ${used.size})`);
for (const key of used) assert.ok(i18n.has(key), `кодът ползва липсващ ключ: ${key}`);
// Същото и за КАРТАТА НА ПОРТАЛА: тя беше единствената част от интерфейса без речник, тоест
// немският и английският потребител виждаха български бутони в преведения панел.
// 0.69.199: блокът „Достъп и QR код“ е махнат, а QR кодът стана бутон в главата на картата,
// тоест текстовете му се рисуват от `files-manager.js`. Затова ключовете се търсят там — и
// трябва да са в речника, а не твърд български текст.
const control = read('portal-control.js');
const manager = read('files-manager.js');
const usedCard = new Set([...manager.matchAll(/\bT\('(portal\.[A-Za-z.]+)'\)/g)].map((m) => m[1]));
assert.ok(usedCard.size >= 3, `картата на портала ползва поне 3 ключа (сега ${usedCard.size})`);
for (const key of usedCard) {
  assert.ok(i18n.has(key), `картата ползва липсващ ключ: ${key}`);
  assert.match(key, /^portal\./, `ключовете на картата са групирани в portal.*: ${key}`);
}
// Заглавието и бутоните не са твърд български текст (иначе смяната на езика не работи).
// Блокът „Достъп и QR код“ вече не съществува като markup — споменава се само в коментари,
// които обясняват защо е махнат.
assert.equal(/data-block="link"/.test(control + manager), false, 'махнатият блок не е останал като markup');
for (const literal of ['Отвори портала', 'Обнови достъпа', 'Свали QR', 'Печат на QR', 'Свали api.json']) {
  assert.equal(control.includes(`'${literal}'`), false, `картата още държи твърд текст: ${literal}`);
}
assert.ok(i18n.DICT.de['portal.qr.button'] && i18n.DICT.en['portal.qr.button'], 'QR бутонът има превод');

// ── 2б. Речникът не расте с текстове, които никой не рисува ───────────────
// Защо: до 0.69.201 в речника стояха 33 ключа × 3 езика от махнатия блок „Достъп и QR код“
// (`portal.link.*`, `portal.state.*`, `portal.tip.*`, `portal.act.*`, `portal.brand`,
// `portal.crypto`). Никой тест не ги хващаше, защото се проверява само обратната посока
// („използван ключ съществува“). Сега ключ, който не се среща в нито един модул на `ui/`, е
// грешка. Изключение са само ключовете, които се строят динамично (шаблон или конкатенация),
// и те се изреждат тук с причина — иначе тестът ще лъже.
const DYNAMIC_KEY_PREFIXES = ['state.', 'action.'];
const modules = fs
  .readdirSync(uiDir)
  .filter((f) => f.endsWith('.js') && f !== 'i18n.js')
  .map((f) => read(f))
  .join('\n');
const unusedKeys = keys.filter(
  (key) => !modules.includes(key) && !DYNAMIC_KEY_PREFIXES.some((p) => key.startsWith(p)),
);
assert.deepEqual(unusedKeys, [], 'ключове, които никой модул не ползва: ' + unusedKeys.join(', '));
// Същото и за блоковете, които са махнати от интерфейса — тях ги няма дори като префикс.
for (const dead of ['portal.link.', 'portal.state.', 'portal.tip.', 'portal.act.']) {
  assert.equal(
    keys.some((k) => k.startsWith(dead)),
    false,
    `ключове от махнатия блок „Достъп и QR код“ са останали в речника: ${dead}*`,
  );
}
// Секциите пазят ключ, а не текст: иначе смяната на езика не работи без презареждане.
const sectionBlock = panel.slice(panel.indexOf('const SECTIONS = ['), panel.indexOf('];', panel.indexOf('const SECTIONS = [')));
const sectionLabels = [...sectionBlock.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
assert.equal(sectionLabels.length, 17, 'седемнайсет секции');
for (const label of sectionLabels) {
  assert.match(label, /^section\./, `секцията пази ключ, а не текст: ${label}`);
  assert.ok(i18n.has(label), `липсва ключ за секция: ${label}`);
  assert.equal(/[\u0400-\u04FF]/.test(label), false, 'в ключа няма кирилица');
}
// Заглавките на таблиците не са твърд български текст.
for (const header of ['Показател', 'Стойност', 'Портал', 'Адрес', 'Състояние', 'Напредък']) {
  assert.equal(new RegExp(`table\\(\\[[^\\]]*'${header}'`).test(panel), false, `заглавката „${header}“ още е твърд текст`);
}

// ── 3. Панелът се рисува на немски ──────────────────────────────────────────────
function stubElement() {
  const children = new Map();
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    title: '',
    className: '',
    dataset: {},
    addEventListener() { },
    setAttribute() { },
    getAttribute() {
      return null;
    },
    querySelector(sel) {
      if (!children.has(sel)) children.set(sel, stubElement());
      return children.get(sel);
    },
    querySelectorAll() {
      return [];
    },
    classList: { toggle() { }, add() { }, remove() { }, contains: () => false },
  };
}

function mountWithLang(lang) {
  const window = { HapiUI: { getLang: () => lang, toast() { } } };
  const document = {
    documentElement: { lang },
    body: stubElement(),
    createElement: () => stubElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() { },
  };
  const storage = () => ({ getItem: () => null, setItem() { }, removeItem() { } });
  const sandbox = {
    window,
    document,
    localStorage: storage(),
    sessionStorage: storage(),
    location: { protocol: 'file:', origin: 'null' },
    fetch: async () => {
      throw Error('офлайн');
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  vm.runInNewContext(read('i18n.js'), sandbox, { filename: 'i18n.js' });
  vm.runInNewContext(panel, sandbox, { filename: 'settings-panel.js' });
  const host = stubElement();
  window.SettingsPanel.mount(host);
  return host.innerHTML;
}

const german = mountWithLang('de');
// Табовете са навигацията на панела — там преводът трябва да е пълен.
const germanTabs = german.slice(german.indexOf('<nav class="set-tabs"'), german.indexOf('</nav>'));
assert.ok(germanTabs.length > 100, 'намирам табовете в немския изглед');
assert.equal(/[\u0400-\u04FF]/.test(germanTabs), false, 'немските табове нямат кирилица: ' + germanTabs.replace(/<[^>]+>/g, ' '));
for (const label of ['Allgemein', 'Hierarchie', 'Kartei', 'Aufgaben', 'Benutzer', 'Variablen', 'Diagnose', 'Analysen', 'Sicherheit', 'QR-Archiv', 'Berichtssignatur', 'Speicher', 'Sicherungen', 'Protokoll']) {
  assert.ok(germanTabs.includes(label), `немският таб „${label}“ липсва`);
}
const germanTitle = german.slice(0, german.indexOf('<nav'));
assert.equal(/[\u0400-\u04FF]/.test(germanTitle), false, 'заглавието на панела е преведено');
assert.ok(germanTitle.includes('Einstellungen'), 'заглавието е „Einstellungen“');

const english = mountWithLang('en');
const englishTabs = english.slice(english.indexOf('<nav class="set-tabs"'), english.indexOf('</nav>'));
assert.equal(/[\u0400-\u04FF]/.test(englishTabs), false, 'английските табове нямат кирилица');
for (const label of ['General', 'Hierarchy', 'Jobs', 'Variables', 'Diagnostics', 'Storage', 'Backups', 'Log']) {
  assert.ok(englishTabs.includes(label), `английският таб „${label}“ липсва`);
}
const bulgarian = mountWithLang('bg');
assert.ok(bulgarian.includes('Йерархия') && bulgarian.includes('Основни'), 'българският изглед не се е променил');

// ── 3б. Дългът: дългите обяснения вътре в секциите още са на български. Таванът
// може само да пада — нов български текст на място, което има ключ, чупи теста.
const BG_CAP = 330;
const bgLiterals = [...panel.matchAll(/'([^'\n]*[\u0400-\u04FF][^'\n]*)'/g)].map((m) => m[1]);
assert.ok(bgLiterals.length <= BG_CAP, `български литерали в панела: ${bgLiterals.length} (таван ${BG_CAP}) — ползвай T('ключ')`);

// ── 4. Страницата зарежда речника преди панелите ────────────────────────────────
const index = read('index.html');
const order = ['app.js', 'i18n.js', 'settings-panel.js'].map((f) => index.indexOf(f));
assert.ok(order.every((i) => i > -1), 'index.html зарежда трите скрипта');
assert.ok(order[2] > order[1], 'settings-panel.js се зарежда след i18n.js');
const server = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'server.js'), 'utf8');
assert.ok(server.includes("'i18n.js'"), 'сървърът сервира /ui/i18n.js');

console.log(`PASS ui-i18n: ${keys.length} ключа × ${langs.length} езика · ${used.size} ключа в панела · DE/EN без кирилица · смяна на езика работи`);
