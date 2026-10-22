'use strict';
// Обща машина за GUI тестовете: жив add-on + истинските панели в `vm` + тестов DOM.
//
// Принцип: тестът НЕ бива да проверява преписан протокол. Той монтира СЪЩИЯ файл, който
// вижда потребителят (`ui/*.js`), подава му `fetch`, който говори с ЖИВ сървър, и натиска
// бутоните през DOM. Така „минава“ означава „потребителят може да го направи“.
//
// Какво НЕ прави: не рисува (няма CSS/layout) и не пуска браузър.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { stopChild, freePort } = require('../helpers.cjs');
const { createDocument, StubEvent } = require('./dom-stub.cjs');

const root = path.join(__dirname, '..', '..');
const uiDir = path.join(root, 'hapi_enterprise', 'ui');

// Споделените ядра, които `bootstrap.js` зарежда в браузъра (същите файлове).
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

async function startServer({ dataDir, token, port, env, keepData } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-gui-'));
  const keepDirectory = Boolean(keepData);
  const listenPort = port || (await freePort());
  const adminToken = token || 'gui-' + require('node:crypto').randomBytes(18).toString('hex');
  const child = spawn(process.execPath, [path.join(root, 'hapi_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(listenPort), PUBLIC_GATEWAY_PORT: '0', ADMIN_TOKEN: adminToken, ...(env || {}) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  // Последните редове от stderr са единственото, което обяснява защо сървърът не е тръгнал.
  let stderr = '';
  if (child.stderr) child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  const base = `http://127.0.0.1:${listenPort}`;
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error('сървърът приключи преждевременно (код ' + child.exitCode + ')' + (stderr ? ': ' + stderr.trim() : ''));
    try {
      if ((await fetch(base + '/health')).ok) {
        ready = true;
        break;
      }
    } catch {
      /* още стартира */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!ready) throw new Error('сървърът не стартира' + (stderr ? ': ' + stderr.trim() : ''));
  const authFetch = (url, init) =>
    fetch(url, { ...init, headers: { ...((init && init.headers) || {}), Authorization: 'Bearer ' + adminToken } });
  const api = async (p, method = 'GET', bodyValue) => {
    const res = await authFetch(base + p, {
      method,
      headers: bodyValue === undefined ? {} : { 'content-type': 'application/json' },
      body: bodyValue === undefined ? undefined : JSON.stringify(bodyValue),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, ok: res.ok, data };
  };
  return {
    dir,
    base,
    token: adminToken,
    child,
    authFetch,
    api,
    async stop({ keep = keepDirectory } = {}) {
      await stopChild(child);
      if (!keep) fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Памет за localStorage/sessionStorage с истински ключове.
function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() { return map.size },
    key: (i) => [...map.keys()][i] || null,
    _map: map,
  };
}

/**
 * Монтира интерфейса в отделен `vm` контекст.
 * `server` идва от `startServer()`; `lang` сменя езика на речника.
 */
function mountUi(server, { lang = 'bg', modules = [] } = {}) {
  const doc = createDocument({ lang });
  const toasts = [];
  const copied = [];
  const confirmations = [];
  const prompts = [];
  const winTarget = {};
  const location = {
    protocol: 'http:',
    origin: server.base,
    host: '127.0.0.1',
    pathname: '/ui/index.html',
    href: server.base + '/ui/index.html',
    hash: '',
    search: '',
    toString: () => server.base + '/ui/index.html',
  };
  // `fetch` минава през Authorization, както го прави панелът (той слага своя токен).
  const fetchShim = (url, init = {}) => {
    const full = typeof url === 'string' && url.startsWith('/') ? server.base + url : url;
    return server.authFetch(full, init);
  };
  const sandbox = {
    window: null,
    document: doc,
    location,
    localStorage: storage({ 'hapi.apiBase': server.base }),
    sessionStorage: storage({ hapiAdminToken: server.token }),
    fetch: fetchShim,
    URL: Object.assign(class extends URL { }, {
      createObjectURL: () => 'blob:hapi-test',
      revokeObjectURL: () => { },
    }),
    Blob: class Blob {
      constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; this.size = (parts || []).reduce((n, p) => n + (p.length || 0), 0) }
    },
    FileReader: class FileReader {
      readAsArrayBuffer() { this.result = new ArrayBuffer(0); if (this.onload) this.onload({ target: this }) }
      readAsDataURL() { this.result = 'data:,'; if (this.onload) this.onload({ target: this }) }
    },
    Event: StubEvent,
    TextEncoder,
    TextDecoder,
    crypto: require('node:crypto').webcrypto,
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    structuredClone,
    navigator: { clipboard: { writeText: async (text) => { copied.push(String(text)) }, readText: async () => copied[copied.length - 1] || '' } },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    alert: () => { },
    confirm: (question) => { confirmations.push(String(question)); return true },
    prompt: (question, value) => { prompts.push({ question: String(question), value: String(value == null ? '' : value) }); return null },
  };
  // В браузър `window` И `globalThis` са един и същ обект. В `vm` те са два, затова
  // `window` е огледало: UMD модулите пишат на `globalThis` (`root.HapiReportSign = …`),
  // панелите — на `window`. Тестът трябва да вижда и двете, иначе обявява липсващ модул.
  const win = new Proxy(winTarget, {
    get: (target, key) => (key in target ? target[key] : sandbox[key]),
    set: (target, key, value) => { target[key] = value; sandbox[key] = value; return true },
    has: (target, key) => key in target || key in sandbox,
    deleteProperty: (target, key) => { delete target[key]; return true },
  });
  sandbox.window = win;
  win.document = doc;
  win.location = location;
  win.localStorage = sandbox.localStorage;
  win.sessionStorage = sandbox.sessionStorage;
  win.fetch = fetchShim;
  win.navigator = sandbox.navigator;
  win.confirm = sandbox.confirm;
  win.prompt = sandbox.prompt;
  win.alert = sandbox.alert;
  win.URL = sandbox.URL;
  win.Blob = sandbox.Blob;
  win.crypto = sandbox.crypto;
  // `HapiUI` е това, което `app.js` дава на панелите; тук само записва известията.
  win.HapiUI = {
    toast: (message, kind) => { toasts.push({ message: String(message), kind: kind || '' }) },
    t: (key) => key,
    getLang: () => lang,
    setLang: () => { },
  };
  vm.createContext(sandbox);
  const run = (file, dir) => {
    const full = path.join(dir, file);
    vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: file });
  };
  for (const file of SHARED) run(file, path.join(root, 'hapi_enterprise'));
  run('i18n.js', uiDir);
  for (const file of modules) run(file, uiDir);
  return {
    sandbox,
    window: win,
    document: doc,
    toasts,
    copied,
    confirmations,
    prompts,
    run: (file) => run(file, uiDir),
    /** Нов контейнер, монтиран в body — както `#view` в app.js. */
    container() {
      const host = doc.createElement('div');
      doc.body.appendChild(host);
      return host;
    },
    lastToast: () => toasts[toasts.length - 1] || null,
    clearToasts: () => { toasts.length = 0 },
  };
}

/** Чака, докато условието стане истина (панелите работят асинхронно). */
async function waitFor(predicate, { timeout = 10000, label = 'условие' } = {}) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeout) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('изтече времето за ' + label + (lastError ? ' · последна грешка: ' + lastError.message : ''));
}

/** Малка помощ: цъка всички елементи по селектор и връща броя. */
function clickAll(host, selector) {
  const nodes = host.querySelectorAll(selector);
  for (const node of nodes) node.click();
  return nodes.length;
}

module.exports = { startServer, mountUi, waitFor, clickAll, storage, root, uiDir, SHARED };
