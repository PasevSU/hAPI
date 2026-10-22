'use strict';
// Report Studio (Фаза 11) — панелът се монтира и работи без браузър.
//
// Причината за теста: панелът четеше ядрото `report-manifest.js` още при дефиниране
// (`const M = globalThis.HapiReportManifest`). bootstrap.js обаче зарежда ядрата
// асинхронно, затова при бавна връзка `M` беше `undefined`, IIFE-то гърмеше с TypeError,
// `window.ReportStudio` липсваше и менюто „Отчети“ показваше „не е зареден“.
//
// Тук пускаме истинските файлове (report-manifest.js, report-objects.js,
// report-studio.js) в отделен контекст с минимален DOM и проверяваме, че:
//   1. панелът се зарежда дори когато ядрото липсва в момента на дефиниране;
//   2. когато ядрото липсва, панелът казва защо, вместо да остави празен екран;
//   3. с налично ядро се монтира напълно — START/STOP са заключени, библиотеката,
//      свойствата и A4 preview се рисуват;
//   4. манифестът, който панелът строи, минава валидатора на backend-а;
//   5. PDF рендерът и TSA-та говорят с реалните маршрути (нищо измислено).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const ui = (f) => fs.readFileSync(path.join(root, 'hapi_enterprise', 'ui', f), 'utf8');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

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
    files: null,
    dataset: {},
    draggable: false,
    addEventListener() { },
    setAttribute() { },
    appendChild() { },
    removeChild() { },
    remove() { },
    getAttribute() {
      return null;
    },
    click() { },
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

// ── 1. Ядрото липсва при дефиниране: панелът пак се зарежда и казва защо ────────────
function load({ withCore }) {
  const window = {};
  const listeners = [];
  const document = {
    head: stubElement(),
    body: stubElement(),
    documentElement: stubElement(),
    createElement: () => stubElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    dispatchEvent: (event) => {
      listeners.filter((l) => l.type === event.type).forEach((l) => l.fn(event));
      return true;
    },
  };
  const sandbox = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    location: { protocol: 'file:', origin: 'null' },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    fetch: async () => {
      throw new Error('офлайн');
    },
    URL: { createObjectURL: () => 'blob:', revokeObjectURL() { } },
    Blob: class {
      constructor(parts) {
        this.parts = parts;
      }
    },
    FileReader: class {
      readAsText() { }
    },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    Promise,
  };
  sandbox.globalThis = sandbox;
  if (withCore) {
    vm.runInNewContext(read('hapi_enterprise/report-manifest.js'), sandbox, { filename: 'report-manifest.js' });
  }
  // report-objects.js е независим от ядрото и се зарежда винаги преди панела.
  vm.runInNewContext(ui('report-objects.js'), sandbox, { filename: 'report-objects.js' });
  vm.runInNewContext(ui('report-studio.js'), sandbox, { filename: 'report-studio.js' });
  return { sandbox, window, listeners };
}

const withoutCore = load({ withCore: false });
assert.ok(
  withoutCore.window.ReportStudio && typeof withoutCore.window.ReportStudio.mount === 'function',
  'без ядро панелът все пак се дефинира (иначе менюто „Отчети“ остава празно)',
);
const emptyHost = stubElement();
withoutCore.window.ReportStudio.mount(emptyHost);
assert.match(emptyHost.innerHTML, /ядрото не е заредено/, 'без ядро панелът казва какво липсва');
assert.match(emptyHost.innerHTML, /report-manifest\.js/, 'съобщението назовава липсващия файл');

// ── 2. С налично ядро: пълен монтаж ────────────────────────────────────────────────
const withCore = load({ withCore: true });
assert.ok(withCore.sandbox.HapiReportManifest, 'ядрото се зарежда в контекста');
const panel = withCore.window.ReportStudio;
const host = stubElement();
panel.mount(host);

const html = host.innerHTML;
assert.match(html, /id="rs-lib"/, 'има библиотека с обекти');
assert.match(html, /id="rs-doc"/, 'има структура на документа');
assert.match(html, /id="rs-props"/, 'има панел със свойства');
assert.match(html, /id="rs-a4"/, 'има A4 preview');
assert.match(html, /id="rs-generate"/, 'има бутон за PDF');
assert.match(html, /id="rs-tsa-start"/, 'има RFC 3161 START');
assert.match(html, /id="rs-tsa-stop"/, 'има RFC 3161 STOP');
assert.match(html, /id="rs-validate"/, 'има валидация на манифеста');

// Манифестът, който панелът държи, минава същия валидатор като backend-а.
const state = panel.state;
assert.ok(state.manifest && Array.isArray(state.manifest.blocks), 'панелът има манифест');
const blocks = state.manifest.blocks;
assert.equal(blocks[0].type, 'rfc3161-start', 'START е първи и заключен');
assert.equal(blocks[blocks.length - 1].type, 'rfc3161-stop', 'STOP е последен и заключен');
assert.equal(blocks[0].locked, true, 'START носи locked:true');
assert.equal(blocks[blocks.length - 1].locked, true, 'STOP носи locked:true');
const result = withCore.sandbox.HapiReportManifest.check(state.manifest);
assert.equal(result.ok, true, 'манифестът е валиден: ' + JSON.stringify(result.errors || []));

// ── 3. Никакви измислени сертификати в preview ────────────────────────────────────
const preview = host.querySelector('#rs-a4').innerHTML;
assert.match(preview, /RFC 3161 START/, 'preview-то показва началото на обхвата');
assert.match(preview, /RFC 3161 STOP/, 'preview-то показва края на обхвата');
assert.match(preview, /обхватът/, 'маркерите обясняват, че става дума за обхват');
assert.equal(/BEGIN CERTIFICATE/.test(preview), false, 'в preview няма фалшив сертификат');
assert.equal(/tsaToken\s*[:=]\s*['"][^'"]+['"]/.test(ui('report-studio.js')), false, 'интерфейсът не си измисля TSA токен');

// ── 4. Маршрутите, които панелът вика, съществуват в сървъра ──────────────────────
const server = read('hapi_enterprise/server.js');
const studio = ui('report-studio.js');
for (const route of ["'/admin/api/v2/reports/render'", "'/admin/api/v2/rfc3161'"]) {
  assert.ok(studio.includes(route), 'панелът вика ' + route);
}
assert.match(server, /parts\[3\] === 'reports' && parts\[4\] === 'render'/, 'сървърът има /admin/api/v2/reports/render');
assert.match(server, /parts\[3\] === 'rfc3161'/, 'сървърът има /admin/api/v2/rfc3161');
assert.match(server, /x-manifest-sha256/i, 'рендерът връща хеша на манифеста');

// ── 5. Bootstrap зарежда ядрата строго по ред ─────────────────────────────────────
const boot = ui('bootstrap.js');
assert.match(boot, /el\.onload = next/, 'bootstrap чака всеки модул, преди да пусне следващия');
assert.match(boot, /el\.async = false/, 'bootstrap изключва async, за да е сигурен редът');
assert.match(boot, /hapi:shared-ready/, 'bootstrap съобщава кога ядрата са готови');
assert.ok(studio.includes('hapi:shared-ready'), 'панелът чака ядрата, ако още ги няма');

console.log('PASS report-studio: монтаж · START/STOP заключени · валиден манифест · реални маршрути · подредено зареждане');
