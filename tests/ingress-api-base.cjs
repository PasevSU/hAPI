'use strict';
// ОРАКУЛ: панелът и генераторът говорят с add-on-а ПРЕЗ INGRESS префикса.
//
// Дефектът: всички панели строяха адреса като `location.origin`. Под Home Assistant
// Ingress обаче документът живее на `/api/hassio_ingress/<token>/ui/`, а add-on-ът е
// точно под този префикс. `https://<ha>/admin/api/...` отива в Home Assistant и връща
// 404 — панелът се зарежда (ресурсите му са относителни), но НИЩО в него не работи.
// Същото важеше и за генератора (`/admin/api/generator/templates` абсолютно), т.е.
// новият модул беше недостъпен точно там, където се ползва.
//
// Затова тук се проверява:
//   1. общият помощник `ui/api-base.js` дава верния адрес за всички форми на ingress,
//      за standalone, за file:// и при ръчно зададен `hapi.apiBase`;
//   2. документът наистина сервира този помощник под ingress префикса;
//   3. API-то на генератора отговаря под префикса (идентичност от HA);
//   4. в клиентския код НЯМА останали абсолютни `/admin/api/...` заявки.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { stopChild } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const HELPER = path.join(ROOT, 'hapi_enterprise/ui/api-base.js');

/** Зарежда помощника в изолиран контекст с подаден адрес и (по избор) записан apiBase. */
function loadHelper(url, storedBase) {
  const parsed = new URL(url);
  const ctx = { location: { protocol: parsed.protocol, origin: parsed.origin, pathname: parsed.pathname } };
  const saved = storedBase === undefined ? null : storedBase;
  ctx.localStorage = { getItem: (key) => (key === 'hapi.apiBase' ? saved : null) };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(HELPER, 'utf8'), ctx, { filename: HELPER });
  return ctx;
}

function unitChecks() {
  const baseOf = (url, stored) => {
    const ctx = loadHelper(url, stored);
    assert.equal(typeof ctx.hapiApiBase, 'function', 'api-base.js не публикува hapiApiBase');
    return ctx.hapiApiBase();
  };

  // 1. Истинската форма на Home Assistant Ingress.
  assert.equal(
    baseOf('https://ha.local:8123/api/hassio_ingress/tok_9f2c/ui/'),
    'https://ha.local:8123/api/hassio_ingress/tok_9f2c',
    'адресът под Ingress трябва да включва префикса, иначе заявките отиват в HA'
  );
  // 2. Старите форми остават валидни (reverse proxy, по-стари версии).
  assert.equal(baseOf('https://ha.local:8123/app/c838e403_portal_enterprise/ui/'), 'https://ha.local:8123/app/c838e403_portal_enterprise');
  assert.equal(baseOf('https://ha.example.org/hapi/tok-1/ui/'), 'https://ha.example.org/hapi/tok-1');
  assert.equal(baseOf('https://ha.example.org/hassio/ingress/t0k/ui/'), 'https://ha.example.org/hassio/ingress/t0k');
  // 3. Standalone (порт 8099) — без префикс.
  assert.equal(baseOf('http://homeassistant.local:8099/ui/'), 'http://homeassistant.local:8099');
  // 4. От диска (file://) backend няма: празен адрес, за да остане демо режимът.
  assert.equal(baseOf('file:///D:/hAPI/hapi_enterprise/ui/index.html'), '', 'при file:// не бива да се лъже за връзка');
  // 5. Ръчно зададеният адрес печели и под Ingress (външен адрес/друг порт).
  assert.equal(baseOf('https://ha.local:8123/api/hassio_ingress/tok/ui/', 'http://10.0.0.5:8099/'), 'http://10.0.0.5:8099');

  // 6. Пълният адрес за път: префикс + път, без двойна наклонена черта.
  const ctx = loadHelper('https://ha.local:8123/api/hassio_ingress/tok_1/ui/');
  assert.equal(ctx.hapiApiUrl('/admin/api/connection'), 'https://ha.local:8123/api/hassio_ingress/tok_1/admin/api/connection');
  assert.equal(ctx.hapiApiUrl('admin/api/connection'), 'https://ha.local:8123/api/hassio_ingress/tok_1/admin/api/connection');
  assert.equal(ctx.hapiApiUrl('https://example.com/x'), 'https://example.com/x', 'абсолютен адрес не се преправя');
  assert.equal(ctx.hapiIngressPrefix(), '/api/hassio_ingress/tok_1');

  return '6 случая';
}

function sourceChecks() {
  // Абсолютна заявка към `/admin/...` от страница под ingress стига до Home Assistant.
  // Затова в клиентския код не бива да има `fetch('/admin/...')`.
  const offenders = [];
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'hapi_enterprise/ui')).filter((f) => f.endsWith('.js')).map((f) => ['ui/' + f, path.join(ROOT, 'hapi_enterprise/ui', f)]),
    ['generator/app.js', path.join(ROOT, 'hapi_enterprise/generator/app.js')],
  ];
  for (const [name, file] of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/fetch\(\s*(['"`])\/admin\/[^'"`]*\1/g)) offenders.push(`${name}: ${match[0]}`);
  }
  assert.deepEqual(offenders, [], 'има абсолютни admin заявки — под Ingress те връщат 404: ' + offenders.join(' | '));

  // Генераторът строи адреса от префикса, а не от корена.
  const generator = fs.readFileSync(path.join(ROOT, 'hapi_enterprise/generator/app.js'), 'utf8');
  assert.match(generator, /hassio_ingress/, 'generator/app.js трябва да разпознава ingress префикса');
  assert.doesNotMatch(generator, /const API = '\/admin/, 'generator/app.js не бива да ползва абсолютен адрес');

  // Документът зарежда помощника ПРЕДИ панелите (иначе base() пада на location.origin).
  const html = fs.readFileSync(path.join(ROOT, 'hapi_enterprise/ui/index.html'), 'utf8');
  const helperAt = html.indexOf('src="api-base.js"');
  assert(helperAt > 0, 'ui/index.html не зарежда api-base.js');
  for (const panel of ['dashboard-panel.js', 'files-manager.js', 'report-studio.js', 'settings-panel.js']) {
    const panelAt = html.indexOf('src="' + panel + '"');
    assert(panelAt > helperAt, `api-base.js трябва да се зарежда преди ${panel}`);
  }
  return 'без абсолютни admin заявки';
}

const INGRESS = '/api/hassio_ingress/panel-token_9f2c';
const pub = 18499;
const adm = 18498;

(async () => {
  const unit = unitChecks();
  const source = sourceChecks();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-ingress-api-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise/server.js')], {
    env: { ...process.env, DATA_DIR: dir, ADMIN_TOKEN: 'ingress-api-base-secret-7c1f93', PORT: String(pub), ADMIN_PORT: String(adm), INGRESS_MODE: 'true' },
    stdio: 'pipe',
  });
  const base = `http://127.0.0.1:${adm}`;
  const ha = { 'X-Remote-User-Name': 'pasev', 'X-Remote-User-Id': 'u-1', 'X-Ingress-Path': INGRESS };
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(`http://127.0.0.1:${pub}/health`)).ok) { ready = true; break } } catch { /* още стартира */ }
      await new Promise((r) => setTimeout(r, 80));
    }
    assert(ready, 'сървърът не стартира');

    // 2. Помощникът се сервира под префикса — иначе документът остава без него.
    const helper = await fetch(base + INGRESS + '/ui/api-base.js');
    assert.equal(helper.status, 200, 'api-base.js не се сервира под ingress префикса');
    assert.match(helper.headers.get('content-type') || '', /javascript/);

    // 3. API-то на генератора отговаря под префикса с идентичност от Home Assistant.
    const templates = await fetch(base + INGRESS + '/admin/api/generator/templates', { headers: ha });
    assert.equal(templates.status, 200, 'списъкът с шаблони не се зарежда през ingress');
    const body = await templates.json();
    assert(Array.isArray(body.templates), 'отговорът трябва да съдържа списък с шаблони');

    // 3б. Същото за панела: `/admin/api/connection` през префикса.
    const connection = await fetch(base + INGRESS + '/admin/api/connection', { headers: ha });
    assert.equal(connection.status, 200, 'панелът не може да прочете връзката през ingress');

    // 4. Страницата на генератора се отваря под префикса и сочи относителни ресурси.
    const page = await fetch(base + INGRESS + '/generator/');
    assert.equal(page.status, 200, 'генераторът не се отваря през ingress');
    const html = await page.text();
    assert.match(html, /Document Generator/);
    assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/, 'генераторът не бива да сочи абсолютни ресурси');

    console.log(
      'PASS ingress-api-base: ' + unit + ' · ' + source + ' · помощник и API под префикса · ' +
      'шаблони ' + body.templates.length + ' · генератор 200'
    );
  } finally {
    await stopChild(child).catch(() => { });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows може да държи файла още */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
