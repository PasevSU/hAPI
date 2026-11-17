'use strict';
// ДЕБЪГ ПРОТОКОЛ: находка → причина → решение → тест.
//
// Защо този тест съществува: `gui-debug-objects.cjs` пази, че законите ХВАЩАТ нарушения.
// Тук се пази онова, без което инструментът е само шум: всяка находка носи ЗАПИСАНО решение,
// повторението се брои вместо да отваря нов ред, а затварянето е изрично (`resolve`).
//
// Тестът пада, ако:
//   • закон на дебъгинг системата остане без причина/решение (или сочи несъществуващ тест);
//   • решение има, но текстът му липсва на някой от трите езика;
//   • повторено сканиране вдига нов ред вместо брояч;
//   • „решена“ находка, която се появи пак, не се отбелязва като регресия;
//   • протоколът расте без таван или не оцелява презареждане;
//   • законът не хване нарочно поставено нарушение (решение без защита не се брои).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const UI = path.join(root, 'hapi_enterprise', 'ui');
const code = (name) => fs.readFileSync(path.join(UI, name), 'utf8');

// ── 1. Модулът се зарежда и не носи български текст (речникът го дава) ──────
const store = new Map();
const sandbox = {
  window: {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    console: { log: () => {} },
    location: { search: '' },
  },
  Date,
  JSON,
  Array,
  String,
  Number,
  Object,
};
sandbox.window.window = sandbox.window;
sandbox.window.document = { readyState: 'complete', addEventListener: () => {}, body: null };
vm.createContext(sandbox);
// Речникът се зарежда пръв — протоколът взима текстовете през `t()`.
vm.runInContext(code('i18n.js'), sandbox, { filename: 'i18n.js' });
assert.ok(sandbox.window.HapiI18n, 'речникът се зарежда');
vm.runInContext(code('debug-ledger.js'), sandbox, { filename: 'debug-ledger.js' });
const ledger = sandbox.window.HapiDebugLedger;
assert.ok(ledger, 'протоколът се зарежда');

const stripped = code('debug-ledger.js').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
assert.equal(/[\u0400-\u04FF]/.test(stripped), false, 'в модула няма български литерал — текстът идва от i18n.js (DEF-49)');

// ── 2. Всеки закон има решение, а решението сочи реален тест ────────────────
vm.runInContext(code('debug-objects.js'), sandbox, { filename: 'debug-objects.js' });
const laws = sandbox.window.HapiDebugObjects.LAWS;
assert.ok(laws.length >= 6, 'законите са поне 6: ' + laws.length);

// Стойностите идват от друг контекст (`vm`), затова се сравняват в равнинен вид —
// иначе `deepEqual` пада по прототип, а не по съдържание.
const plain = (value) => JSON.parse(JSON.stringify(value));

const solutions = ledger.SOLUTIONS;
const lawIds = Array.from(laws, (law) => law.id);
assert.deepEqual(
  Array.from(Object.keys(solutions)).sort(),
  lawIds.slice().sort(),
  'всеки закон има ред в решенията (и няма ред за несъществуващ закон): ' + lawIds.join(', '),
);
for (const id of lawIds) {
  const s = solutions[id];
  assert.ok(s.cause && s.fix, id + ': решението има и причина, и какво се прави');
  assert.equal(s.guard === null || /^tests\/[a-z0-9-]+\.cjs$/.test(s.guard), true, id + ': guard е тест от tests/ или null, а не „някой ще го оправи“');
  if (s.guard) assert.ok(fs.existsSync(path.join(root, s.guard)), id + ': тестът „' + s.guard + '“ съществува');
  // Текстът се взима през речника: липсващ ключ се вижда като ключ, а тук това е дефект.
  const text = ledger.solutionOf(id);
  assert.equal(/^dbg\./.test(text.cause), false, id + ': причината има превод (не се показва ключ)');
  assert.equal(/^dbg\./.test(text.fix), false, id + ': решението има превод (не се показва ключ)');
  assert.match(text.cause, /[\u0400-\u04FF]/, id + ': причината е на български по подразбиране');
}

// ── 2б. Всеки ключ на решенията съществува на трите езика ────────────────────
const dict = sandbox.window.HapiI18n.DICT;
const keys = Object.keys(dict.bg).filter((k) => k.startsWith('dbg.'));
assert.ok(keys.length >= 9, 'ключовете за протокола са поне 9: ' + keys.length);
for (const lang of ['bg', 'en', 'de']) {
  for (const key of keys) {
    assert.ok(dict[lang][key] && String(dict[lang][key]).trim(), lang + ': липсва текст за ' + key);
  }
}
assert.ok(keys.includes('dbg.fix.named.cause'), 'решението за DEF-38 (законът named) е записано');

// ── 3. Всеки закон ХВАЩА нарочно поставено нарушение ───────────────────────
// Решение без защита не се брои: ако законът спре да хваща, „решението“ става разказ.
const el = (over) => Object.assign(
  {
    tagName: 'DIV',
    style: {},
    getAttribute: () => null,
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    textContent: '',
  },
  over,
);
const byId = Object.fromEntries(laws.map((law) => [law.id, law]));
const cases = [
  ['spacing-grid', { kind: 'field', el: el(), id: '#a', spacing: { 'padding-left': '13px' }, box: null }],
  ['symmetry', { kind: 'card', el: el(), id: '#b', spacing: { 'padding-left': '8px', 'padding-right': '12px' }, box: null }],
  ['named', { kind: 'control', el: el({ tagName: 'BUTTON' }), id: 'button', spacing: {}, box: null }],
  ['touch-target', { kind: 'control', el: el({ tagName: 'BUTTON' }), id: '#c', spacing: {}, box: { width: 20, height: 10 } }],
  ['no-inline-layout', { kind: 'panel', el: el({ style: { padding: '3px' } }), id: '#d', spacing: {}, box: null }],
  // Менюто: групи с различен брой секции (законът за симетрия и логика, 0.69.208).
  ['balanced-groups', {
    kind: 'scope',
    id: 'екран',
    spacing: {},
    box: null,
    el: el({ querySelectorAll: () => [
      { querySelectorAll: () => [1, 2, 3] },
      { querySelectorAll: () => [1, 2] },
    ] }),
  }],
];
for (const [id, object] of cases) {
  const detail = byId[id].check(object);
  assert.ok(detail && String(detail).trim(), 'законът „' + id + '“ хваща поставеното нарушение: ' + detail);
}
// `one-qr` е за целия екран: един код извън блока за достъп е нарушение.
const qrNode = { closest: () => null };
const qrDetail = byId['one-qr'].check({ kind: 'scope', el: el({ querySelectorAll: () => [qrNode] }), id: 'екран', spacing: {}, box: null });
assert.match(String(qrDetail), /QR/, 'законът „one-qr“ хваща втори код: ' + qrDetail);

// ── 4. Запис, повторение, решение, регресия ─────────────────────────────────
const scan = (violations) => ({ at: '2026-11-08T10:00:00.000Z', objects: [], violations, summary: { byKind: {}, byLaw: {} } });
const finding = (law, kind, detail) => ({ law, kind, title: law, object: '#obj', detail });

let out = ledger.open(scan([finding('spacing-grid', 'field', 'padding-left: 13px')]));
assert.deepEqual(plain(out), { added: 1, repeated: 0 }, 'първата находка влиза като нов ред: ' + JSON.stringify(out));
let entries = ledger.list();
assert.equal(entries.length, 1);
assert.equal(entries[0].signature, 'spacing-grid@field', 'подписът е закон@вид: ' + entries[0].signature);
assert.equal(entries[0].status, 'open');
assert.match(entries[0].remedy.fix, /--sp-/, 'записът носи решението, не само оплакване');

// Същата находка пак — брояч, не нов ред.
out = ledger.open(scan([finding('spacing-grid', 'field', 'padding-left: 15px')]));
assert.deepEqual(plain(out), { added: 0, repeated: 1 }, 'повторението вдига брояч: ' + JSON.stringify(out));
entries = ledger.list();
assert.equal(entries.length, 1, 'протоколът не расте от повтарящо се сканиране');
assert.equal(entries[0].count, 2);
assert.equal(entries[0].detail, 'padding-left: 15px', 'последната находка се вижда');

// Различен вид обект по същия закон е ДРУГ проблем.
out = ledger.open(scan([finding('spacing-grid', 'card', 'gap: 3px'), finding('named', 'control', 'без текст')]));
assert.deepEqual(plain(out), { added: 2, repeated: 0 });
assert.equal(ledger.stats().total, 3, 'три отделни записа: ' + ledger.statsText());

// Затваряне с бележка и регресия при повторна поява.
const resolved = ledger.resolve('named@control', 'сложен aria-label');
assert.equal(resolved.status, 'resolved');
assert.equal(ledger.stats().resolved, 1);
ledger.open(scan([finding('named', 'control', 'пак без текст')]));
const back = ledger.list().find((e) => e.signature === 'named@control');
assert.equal(back.status, 'open', 'решена находка, появила се пак, се отваря');
assert.equal(back.reopened, 1, 'регресията се брои: ' + back.reopened);
assert.equal(ledger.stats().regressed, 1);

// ── 5. Отчетът казва причината, решението и теста ──────────────────────────
const text = ledger.reportText();
assert.match(text, /spacing-grid@field/, 'отчетът изрежда подписа: ' + text.slice(0, 80));
assert.match(text, /причина:/, 'отчетът казва причината');
assert.match(text, /решение:/, 'отчетът казва решението');
assert.match(text, /пази: tests\//, 'отчетът казва кой тест пази решението');
assert.match(ledger.statsText(), /3 · /, 'резюмето брои записите: ' + ledger.statsText());

// ── 6. Таван и оцеляване при презареждане ──────────────────────────────────
for (let i = 0; i < ledger.LIMIT + 25; i += 1) ledger.open(scan([finding('symmetry', 'kind-' + i, 'x')]));
assert.equal(ledger.list().length, ledger.LIMIT, 'протоколът се реже до тавана си: ' + ledger.list().length);
assert.ok(ledger.list().some((e) => e.signature === 'symmetry@kind-' + (ledger.LIMIT + 24)), 'режат се най-старите, не най-новите');

// Презареждане: нов контекст чете същия `localStorage` — протоколът не е в паметта на модула.
const again = { window: { localStorage: sandbox.window.localStorage, console: { log: () => {} }, location: { search: '' } }, Date, JSON, Array, String, Number, Object };
again.window.window = again.window;
again.window.document = { readyState: 'complete', addEventListener: () => {}, body: null };
vm.createContext(again);
vm.runInContext(code('i18n.js'), again, { filename: 'i18n.js' });
vm.runInContext(code('debug-ledger.js'), again, { filename: 'debug-ledger.js' });
assert.equal(again.window.HapiDebugLedger.stats().total, ledger.LIMIT, 'след презареждане протоколът е същият');
assert.ok(again.window.HapiDebugLedger.toJSON().entries.length === ledger.LIMIT, 'toJSON() дава готов за прикачане отчет');

// Нулиране: протоколът се изчиства изцяло (иначе „чисто“ не се различава от „старо“).
again.window.HapiDebugLedger.reset();
assert.equal(again.window.HapiDebugLedger.stats().total, 0);

// ── 7. Инструментът пише в протокола само при включен дебъгинг ──────────────
const quiet = { window: { localStorage: null, console: { log: () => {} }, location: { search: '' } }, Date, JSON, Array, String, Number, Object };
quiet.window.window = quiet.window;
quiet.window.document = { readyState: 'complete', addEventListener: () => {}, body: null };
vm.createContext(quiet);
vm.runInContext(code('i18n.js'), quiet, { filename: 'i18n.js' });
vm.runInContext(code('debug-ledger.js'), quiet, { filename: 'debug-ledger.js' });
vm.runInContext(code('debug-objects.js'), quiet, { filename: 'debug-objects.js' });
const fake = { at: '2026-11-08T00:00:00.000Z', objects: [], violations: [finding('named', 'control', 'без име')], summary: { byKind: {}, byLaw: { named: 1 } } };
quiet.window.HapiDebugObjects.report(fake);
assert.equal(quiet.window.HapiDebugLedger.stats().total, 0, 'без дебъгинг флаг протоколът не се пише');
quiet.window.HAPI_DEBUG = true;
quiet.window.HapiDebugObjects.report(fake);
assert.equal(quiet.window.HapiDebugLedger.stats().total, 1, 'с флаг отчетът влиза в протокола');

// ── 8. Страницата и allowlist-ът го познават ───────────────────────────────
const html = code('index.html');
const order = (name) => html.indexOf('src="' + name + '"');
assert.ok(order('debug-ledger.js') > 0, 'index.html зарежда debug-ledger.js');
assert.ok(order('i18n.js') < order('debug-ledger.js'), 'речникът е преди протокола — иначе текстовете са ключове');
assert.ok(order('debug-ledger.js') < order('debug-objects.js'), 'протоколът е преди инструмента, който пише в него');
// От 0.69.242 allowlist-ът е данни (`ui-files.json`, D12) — `server.js` само го зарежда.
const allow = JSON.parse(fs.readFileSync(path.join(root, 'hapi_enterprise', 'ui-files.json'), 'utf8'));
assert.ok(
  Object.values(allow).some(([rel]) => rel === 'ui/debug-ledger.js'),
  'сървърът сервира /ui/debug-ledger.js (иначе 404 и панелът мълчи)',
);

console.log('PASS debug-ledger: ' + laws.length + ' закона · всеки с причина, решение и тест · протокол с подпис, брояч и регресия · таван ' + ledger.LIMIT + ' · оцелява презареждане');
