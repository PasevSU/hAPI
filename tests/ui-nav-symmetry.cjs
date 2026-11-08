'use strict';
// ЗАКОН „МЕНЮТО ИМА СИМЕТРИЯ И ЛОГИКА“ (0.69.208).
//
// Поводът: секциите на „Настройки“ бяха ЕДИН ред от 18 чипа — при първата ширина се чупеха
// на произволен брой редове, а съседни по смисъл секции стояха далеч една от друга. Редът в
// един ред е „подредено“ само докато екранът е широк достатъчно.
//
// Законът, който този тест налага (и който живият екран проверява със `balanced-groups`):
//   1. секциите са в ГРУПИ по смисъл, не в един списък;
//   2. групите са с РАВЕН брой секции — симетрия, при която нито един ред не „виси“ сам;
//   3. редът в групата следва работата (структура → достъп и одит → данни и експлоатация);
//   4. всяка група има ИМЕ за екранен четец (`role="group"` + `aria-labelledby`);
//   5. нито една секция не липсва и не се повтаря (18 общо, както преди);
//   6. законът съществува и в дебъгинг системата, с причина/решение на три езика.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const UI = path.join(root, 'hapi_enterprise', 'ui');
const read = (name) => fs.readFileSync(path.join(UI, name), 'utf8');

// ── 1. Панелът се зарежда с речника (както в index.html) и рисува табовете ──
// DOM-шим, колкото да мине рендерът (същият подход като `ui-settings-sections.cjs`).
function stubElement() {
  const children = new Map();
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    addEventListener() {},
    setAttribute() {},
    getAttribute() { return null },
    querySelector(sel) { if (!children.has(sel)) children.set(sel, stubElement()); return children.get(sel) },
    querySelectorAll() { return [] },
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  };
}
const storage = () => ({ getItem: () => null, setItem() {}, removeItem() {} });
const sandbox = {
  window: {},
  document: {
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    documentElement: stubElement(),
    body: stubElement(),
    addEventListener() {},
    createElement: () => stubElement(),
  },
  localStorage: storage(),
  sessionStorage: storage(),
  location: { protocol: 'file:', origin: 'null' },
  fetch: async () => { throw Error('офлайн') },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
vm.createContext(sandbox);
vm.runInContext(read('i18n.js'), sandbox, { filename: 'i18n.js' });
vm.runInContext(read('settings-panel.js'), sandbox, { filename: 'settings-panel.js' });
const panel = sandbox.window.SettingsPanel;
assert.ok(panel && typeof panel.mount === 'function', 'панелът се зарежда');

const host = stubElement();
panel.mount(host);
const html = host.innerHTML;

// ── 2. Групите: равен брой, без повторения, общо 18 ─────────────────────────
// Разделя се по началото на групата, за да се вижда и ОТВАРЯЩИЯТ таг (там е `role`).
const groupBlocks = html
  .split('<div class="set-tabs-group"')
  .slice(1)
  .map((chunk) => ({
    id: (/data-nav-group="([a-z]+)"/.exec(chunk) || [])[1],
    open: chunk.slice(0, chunk.indexOf('>')),
    body: chunk.slice(0, chunk.indexOf('</div></div>')),
  }));
assert.equal(groupBlocks.length, 3, 'секциите са в ТРИ групи по смисъл, намерени: ' + groupBlocks.length);
const counts = groupBlocks.map((g) => ({ id: g.id, n: (g.body.match(/data-section="/g) || []).length }));
assert.deepEqual(
  counts.map((g) => g.n),
  [6, 6, 6],
  'групите са с РАВЕН брой секции (симетрия): ' + counts.map((g) => g.id + '=' + g.n).join(' · '),
);
assert.deepEqual(counts.map((g) => g.id), ['structure', 'access', 'runtime'], 'редът на групите следва работата: структура → достъп → данни');

const allSections = [...html.matchAll(/data-section="([a-z]+)"/g)].map((m) => m[1]);
assert.equal(allSections.length, 18, 'осемнайсет секции общо (Основни + 17), намерени: ' + allSections.length);
assert.equal(new Set(allSections).size, 18, 'нито една секция не се повтаря: ' + allSections.join(', '));
for (const id of ['general', 'hierarchy', 'users', 'logs', 'sensors', 'backups']) {
  assert.ok(allSections.includes(id), 'секцията „' + id + '“ е на място');
}
// Всяка секция е в ГРУПАТА ПО СМИСЪЛ, а не където остане място.
const groupOf = Object.fromEntries(allSections.map((id) => {
  const block = groupBlocks.find((g) => g.body.includes('data-section="' + id + '"'));
  return [id, block ? block.id : '?'];
}));
assert.deepEqual(
  { general: groupOf.general, variables: groupOf.variables, users: groupOf.users, logs: groupOf.logs, data: groupOf.data, backups: groupOf.backups },
  { general: 'structure', variables: 'structure', users: 'access', logs: 'access', data: 'runtime', backups: 'runtime' },
  'секциите са в групата по смисъл: ' + JSON.stringify(groupOf),
);

// ── 3. Групите имат име за екранен четец ───────────────────────────────────
for (const group of groupBlocks) {
  assert.match(group.open, /role="group"/, 'групата „' + group.id + '“ е обявена като група');
  const labelled = /aria-labelledby="([^"]+)"/.exec(group.open);
  assert.ok(labelled, 'групата „' + group.id + '“ има aria-labelledby');
  assert.ok(html.includes('id="' + labelled[1] + '"'), 'заглавието на групата „' + group.id + '“ съществува в документа (id=' + labelled[1] + ')');
  assert.match(group.body, /class="set-tabs-group-title"/, 'групата „' + group.id + '“ показва заглавието си, не само име за четец');
}
assert.equal((html.match(/<nav class="set-tabs-groups"/g) || []).length, 1, 'има ЕДИН контейнер на групите, не по един на група');

// ── 4. Законът съществува и в дебъгинг системата, с решение на три езика ───
const laws = read('debug-objects.js');
assert.match(laws, /id: 'balanced-groups'/, 'дебъгинг системата има закона „balanced-groups“');
assert.match(laws, /data-nav-group/, 'законът мери СЪЩИТЕ групи, които панелът рисува (`data-nav-group`)');
const ledger = read('debug-ledger.js');
assert.match(ledger, /'balanced-groups': \{/, 'протоколът има ред за закона — иначе находката остава без решение');
assert.match(ledger, /guard: 'tests\/ui-nav-symmetry\.cjs'/, 'решението сочи ТОЗИ тест като защита');
const dict = sandbox.window.HapiI18n.DICT;
for (const lang of ['bg', 'en', 'de']) {
  for (const key of ['dbg.fix.balanced-groups.cause', 'dbg.fix.balanced-groups.fix', 'group.structure', 'group.access', 'group.runtime']) {
    assert.ok(dict[lang][key] && String(dict[lang][key]).trim(), lang + ': липсва текст за ' + key);
  }
}

// ── 5. CSS-ът не въвежда литерал (иначе расте таванът на отстоянията) ──────
const css = read('components.css');
const block = (css.split('.set-tabs-groups {')[1] || '').split('.set-tab {')[0];
assert.ok(block.includes('var(--sp-'), 'групите дишат през токени от скалата');
// `0` не е стойност от скалата — него го брои само `LIMIT_SPACING` на дизайн системата.
const literals = [...block.matchAll(/(?:padding|margin|gap)\s*:\s*([^;]+);/g)]
  .map((m) => m[1].trim())
  .filter((v) => /^\d/.test(v) && v !== '0');
assert.deepEqual(literals, [], 'в новите правила няма литерални отстояния: ' + literals.join(', '));

console.log('PASS ui-nav-symmetry: 3 групи × 6 секции (18 общо, без повторение) · групите по смисъл и с име · законът balanced-groups в дебъгинга · решение на 3 езика · CSS само с токени');
