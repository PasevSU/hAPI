'use strict';
// Версията в Enterprise Control Center (GUI-ят в `hapi_enterprise/ui/`).
//
// Причината за този тест: `ui/index.html` показваше твърдо `v1.0.0`, а `ui/app.js` —
// `v0.50.0` в баджа и в „Настройки → Версия“. Затова локалният GUI (START_HAPI_GUI.bat)
// и панелът на add-on-а в Home Assistant показваха стара версия, независимо от това
// коя версия реално е инсталирана. Сега версията идва от едно място —
// `window.HAPI_VERSION` в `ui/data.js` — а този тест пази съответствието с
// `hapi_enterprise/config.yaml` и `custom_components/hapi_enterprise/manifest.json`.
//
// Вторият капан: index.html зареждаше споделените ядра от `../hapi_enterprise/...`,
// което през HTTP сървъра работи, но при отваряне от диска (file://) сочи
// `hapi_enterprise/hapi_enterprise/...` и мълчаливо дава 404 → липсват
// HapiReportManifest/HapiApiSpec/... и панелите не работят. Затова има bootstrap.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAddonVersion } = require('../scripts/release-lib.cjs');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const version = readAddonVersion(root);

// 1. Единствен източник за версията в GUI-я.
const data = read('hapi_enterprise/ui/data.js');
const uiVersion = (data.match(/window\.HAPI_VERSION\s*=\s*'([0-9]+\.[0-9]+\.[0-9]+)'/) || [])[1];
assert.ok(uiVersion, 'ui/data.js: липсва window.HAPI_VERSION');
assert.equal(uiVersion, version, `ui/data.js: ${uiVersion}, а config.yaml е ${version}`);

// 2. Интеграцията носи същата версия.
const manifest = JSON.parse(read('custom_components/hapi_enterprise/manifest.json'));
assert.equal(
  manifest.version,
  version,
  `manifest.json: ${manifest.version}, а config.yaml е ${version}`,
);

// 3. Няма твърдо кодирани версии в обвивката на GUI-я.
const html = read('hapi_enterprise/ui/index.html');
assert.ok(!/v\d+\.\d+\.\d+/i.test(html), 'ui/index.html: твърдо кодирана версия — ползвай #app-version');
assert.ok(html.includes('id="app-version"'), 'ui/index.html: липсва #app-version за версията');
assert.ok(html.includes('<script src="bootstrap.js"></script>'), 'ui/bootstrap.js не се зарежда от index.html');
assert.ok(!html.includes('../hapi_enterprise/'), 'ui/index.html: ../hapi_enterprise/ не работи при file://');

const app = read('hapi_enterprise/ui/app.js');
for (const literal of ['0.50.0', '1.0.0']) {
  assert.ok(!app.includes(`'${literal}'`), `ui/app.js: твърдо кодирана версия ${literal}`);
}
assert.ok(app.includes('window.HAPI_VERSION'), 'ui/app.js: версията не идва от HAPI_VERSION');
assert.ok(app.includes('versionLabel()'), 'ui/app.js: липсва versionLabel()');

// 4. Споделените ядра се зареждат през bootstrap.js и съществуват на диска.
const boot = read('hapi_enterprise/ui/bootstrap.js');
const shared = [
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
for (const file of shared) {
  assert.ok(boot.includes(`'${file}'`), 'ui/bootstrap.js: липсва ' + file);
  assert.ok(
    fs.existsSync(path.join(root, 'hapi_enterprise', file)),
    'hapi_enterprise/' + file + ' липсва (bootstrap.js ще даде 404)',
  );
}
assert.ok(
  boot.includes("location.protocol === 'file:'"),
  'ui/bootstrap.js: липсва избор на базов път за file://',
);

// 5. Сървърът сервира bootstrap.js — иначе панелът в Home Assistant остава без ядра.
const server = read('hapi_enterprise/server.js');
assert.ok(/'bootstrap\.js'/.test(server), 'server.js: allowlist-ът на /ui/ не съдържа bootstrap.js');

// 6. Работещият add-on съобщава ПРОДУКТОВАТА си версия (за сензора в HA и за отчета).
//    `apiVersion.VERSION.CURRENT` е версията на API-то („v2“) — не на продукта.
assert.match(server, /function addonVersion\(\)/, 'server.js: липсва четене на версията от config.yaml');
assert.match(server, /version: addonVersion\(\) \|\| apiVersion\.VERSION\.CURRENT/, 'server.js: телеметрията не ползва продуктовата версия');
assert.match(server, /version: addonVersion\(\) \|\| apiVersion\.VERSION\.CURRENT/, 'server.js: отчетът не ползва продуктовата версия');
const docker = read('hapi_enterprise/Dockerfile');
assert.match(docker, /^COPY config\.yaml /m, 'Dockerfile: config.yaml не се копира — add-on-ът не може да каже версията си');
