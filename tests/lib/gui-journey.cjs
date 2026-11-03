'use strict';
// Машина за GUI-ONLY сценарии.
//
// Разликата с `gui-harness.cjs` е важна и е смисълът на този файл:
//
//   • `gui-harness.cjs` монтира ОТДЕЛЕН панел и дава на теста `server.api(...)`.
//     Така подготовката на данните минава покрай интерфейса.
//   • тук се зарежда ИСТИНСКИЯТ `ui/index.html` (самото тяло), ИСТИНСКИЯТ ред на
//     `<script>`-овете от него и ИСТИНСКИЯТ `app.js`. После се натискат само елементи.
//     Тестът НЕ получава `api`/`authFetch`: ако иска данни, единственият път е DOM-ът.
//
// Затова „сценарият минава“ тук значи „човек може да го направи от интерфейса“.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument, StubEvent } = require('./dom-stub.cjs');

const root = path.join(__dirname, '..', '..');
const uiDir = path.join(root, 'hapi_enterprise', 'ui');

// Същите споделени ядра, които `bootstrap.js` добавя в браузъра, в същия ред.
// (`bootstrap.js` не се изпълнява: той чака `onload` на добавените `<script>`-ове,
// а в `vm` няма мрежа. Затова файловете се зареждат директно — редът е същият.)
const SHARED = [
  'report-manifest.js',
  'api-spec.js',
  'virtual-storage.js',
  'storage-tree.js',
  'export-rules.js',
  'export-manager.js',
  'download-access.js',
  'public-gateway.js',
  'qrcode.js',
];

function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] || null,
    _map: map,
  };
}

/**
 * Зарежда интерфейса като браузър: тялото на `index.html`, скриптовете в реда от
 * файла, после `DOMContentLoaded`.
 *
 * `addon` е това, което връща `startServer()`; навън оттук НЕ излиза неговият `api`.
 */
function mountApp(addon, { lang = 'bg', token = addon.token } = {}) {
  const html = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8');
  const bodyMarkup = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('<script'));
  const scriptOrder = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  if (scriptOrder.length < 10) throw new Error('index.html не изброява скриптовете си — машината не може да зареди страницата');

  const doc = createDocument({ lang });
  doc.body.innerHTML = bodyMarkup;

  const copied = [];
  const opened = [];
  const requests = [];
  const navigations = [];
  const location = {
    protocol: 'http:',
    origin: addon.base,
    host: '127.0.0.1',
    pathname: '/ui/index.html',
    href: addon.base + '/ui/index.html',
    hash: '',
    search: '',
  };
  const history = {
    replaceState: (_state, _title, url) => {
      if (typeof url === 'string' && url.startsWith('#')) location.hash = url;
    },
    pushState: (_state, _title, url) => {
      if (typeof url === 'string' && url.startsWith('#')) location.hash = url;
    },
  };
  // Браузърният `fetch` НЕ носи токен сам: панелите слагат `Authorization` от
  // `sessionStorage`. Затова тук е чистият `fetch`, а не `authFetch` от машината —
  // иначе тестът би „помагал“ на кода, който проверява.
  const fetchShim = (url, init = {}) => {
    const full = typeof url === 'string' && url.startsWith('/') ? addon.base + url : url;
    requests.push({ url: String(full), method: String((init && init.method) || 'GET') });
    return fetch(full, init);
  };
  const sandbox = {
    window: null,
    document: doc,
    location,
    history,
    localStorage: storage({ 'hapi.apiBase': addon.base }),
    sessionStorage: storage(token ? { hapiAdminToken: token } : {}),
    fetch: fetchShim,
    URL: Object.assign(class extends URL { }, {
      createObjectURL: () => 'blob:hapi-test',
      revokeObjectURL: () => { },
    }),
    Blob: class Blob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = (opts && opts.type) || '';
        this.size = (parts || []).reduce((n, p) => n + (p.length || 0), 0);
      }
    },
    FileReader: class FileReader {
      readAsArrayBuffer() { this.result = new ArrayBuffer(0); if (this.onload) this.onload({ target: this }); }
      readAsDataURL() { this.result = 'data:,'; if (this.onload) this.onload({ target: this }); }
    },
    Event: StubEvent,
    TextEncoder,
    TextDecoder,
    crypto: require('node:crypto').webcrypto,
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    structuredClone,
    navigator: { clipboard: { writeText: async (text) => { copied.push(String(text)); }, readText: async () => copied[copied.length - 1] || '' } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    alert: () => { },
    confirm: () => true,
    prompt: () => null,
    open: (url) => { opened.push(String(url)); return null; },
  };
  // `window` и `globalThis` са един обект в браузъра; в `vm` са два, затова `window`
  // е огледало — UMD модулите пишат на `globalThis`, панелите на `window`.
  const winTarget = {};
  const win = new Proxy(winTarget, {
    get: (target, key) => (key in target ? target[key] : sandbox[key]),
    set: (target, key, value) => { target[key] = value; sandbox[key] = value; return true; },
    has: (target, key) => key in target || key in sandbox,
    deleteProperty: (target, key) => { delete target[key]; return true; },
  });
  sandbox.window = win;
  win.document = doc;
  win.location = location;
  win.history = history;
  win.localStorage = sandbox.localStorage;
  win.sessionStorage = sandbox.sessionStorage;
  win.fetch = fetchShim;
  win.navigator = sandbox.navigator;
  win.Event = StubEvent;
  win.URL = sandbox.URL;
  win.Blob = sandbox.Blob;
  win.crypto = sandbox.crypto;
  vm.createContext(sandbox);

  const run = (file, dir) => {
    vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), sandbox, { filename: file });
  };
  for (const file of SHARED) run(file, path.join(root, 'hapi_enterprise'));
  for (const file of scriptOrder) {
    if (file === 'bootstrap.js') continue; // заменен от директното зареждане на SHARED
    // `links.js` живее в корена на add-on-а и се сервира на `/ui/links.js`.
    run(file, file === 'links.js' ? path.join(root, 'hapi_enterprise') : uiDir);
  }
  // `app.js` чака `DOMContentLoaded` — както в браузъра.
  doc.dispatchEvent({ type: 'DOMContentLoaded' });

  const $ = (selector, from = doc) => from.querySelector(selector);
  const $$ = (selector, from = doc) => from.querySelectorAll(selector);
  const text = (node) => String((node && node.textContent) || '').replace(/\s+/g, ' ').trim();
  // Известията тук са ИСТИНСКИТЕ на `app.js` (пише `.toast` в `body`), а не записвач —
  // затова се четат от DOM. Така тестът вижда точно това, което вижда човекът.
  const toastNow = () => {
    const node = doc.querySelector('.toast');
    if (!node) return null;
    return {
      message: text(node),
      kind: String(node.getAttribute('class') || '').replace(/\btoast\b/, '').trim(),
    };
  };
  const clearToasts = () => { doc.querySelectorAll('.toast').forEach((node) => node.remove()); };
  const view = () => doc.querySelector('#view');
  const requireEl = (selector, what) => {
    const el = $(selector);
    if (!el) throw new Error('липсва ' + (what || 'елемент') + ': ' + selector);
    return el;
  };

  return {
    document: doc,
    window: win,
    sandbox,
    copied,
    opened,
    requests,
    navigations,
    location,
    base: addon.base,
    text,
    $,
    $$,
    view,
    requireEl,
    /** Натиска елемент по селектор (или подаден елемент). */
    click(selector, what) {
      const el = typeof selector === 'string' ? requireEl(selector, what) : selector;
      if (!el) throw new Error('няма какво да натисна' + (what ? ': ' + what : ''));
      el.click();
      return el;
    },
    /** Отваря панел от НАВИГАЦИЯТА — същият бутон, който вижда човекът. */
    nav(id) {
      const button = requireEl('#nav button[data-panel="' + id + '"]', 'навигационен бутон „' + id + '“');
      button.click();
      return button;
    },
    /** Наличните навигационни точки, както ги е нарисувал `app.js`. */
    navIds: () => $$('#nav button[data-panel]').map((b) => b.getAttribute('data-panel')),
    /** Пише в поле, както би написал човек (input + change). */
    fill(selector, value) {
      const el = typeof selector === 'string' ? requireEl(selector, 'поле') : selector;
      el.value = String(value);
      el.dispatch('input');
      el.dispatch('change');
      return el;
    },
    /** Избира стойност в `<select>` и уведомява слушателите. */
    select(selector, value) {
      const el = this.fill(selector, value);
      return el;
    },
    /** Отбелязва или сваля отметка в поле за избор — както го прави човек с мишката. */
    check(selector, checked = true) {
      const el = typeof selector === 'string' ? requireEl(selector, 'поле за избор') : selector;
      if (!el) throw new Error('няма поле за избор' + (selector ? ': ' + selector : ''));
      el.checked = Boolean(checked);
      el.dispatch('change');
      return el;
    },
    /** Натиска бутон на секция/панел по `data-action`. */
    action(name, { from = doc } = {}) {
      const btn = $$('[data-action]', from).find((b) => b.getAttribute('data-action') === name);
      if (!btn) throw new Error('няма бутон с data-action="' + name + '"');
      btn.click();
      return btn;
    },
    /** Превключва секция на „Настройки“ през самите табове. */
    section(id) {
      const tab = requireEl('[data-section="' + id + '"]', 'таб „' + id + '“');
      tab.click();
      return tab;
    },
    /** Текущото известие на екрана (или `null`) — същото, което вижда човекът. */
    toast: toastNow,
    clearToasts,
    /**
     * Отваря адрес, който интерфейсът е показал — както би го направил браузърът на
     * човека. Това е ЕДИНСТВЕНОТО място, от което сценарий може да поиска нещо по мрежата,
     * и е само за ЧЕТЕНЕ на вече показан линк, не за действие вместо интерфейса.
     */
    async openLink(url) {
      const res = await fetch(url);
      const body = await res.text();
      return { status: res.status, body };
    },
    /** Последните заявки, които интерфейсът е отправил (за твърдения от типа „панелът попита“). */
    lastRequest: () => requests[requests.length - 1] || null,
  };
}

/** Файл, който панелът може да „качи“ без истинска файлова система. */
function pseudoFile(name, text, type = 'text/plain') {
  const buffer = Buffer.from(text, 'utf8');
  return {
    name,
    size: buffer.length,
    type,
    lastModified: Date.now(),
    webkitRelativePath: name,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length),
  };
}

module.exports = { mountApp, pseudoFile, uiDir, SHARED };
