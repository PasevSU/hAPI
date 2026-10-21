'use strict';
// HACS структура: какво трябва да е налично, за да може интеграцията да се инсталира
// през HACS (custom repository) без ръчна намеса.
//
// Проверява се:
//  - `hacs.json` в корена на хранилището с валидни ключове и стойности;
//  - `custom_components/<domain>/` с `manifest.json`, който HACS изисква
//    (domain, name, version, documentation, issue_tracker, codeowners);
//  - brand изображения (icon.png/logo.png) и в `brand/`, както ги очаква Home Assistant;
//  - няма кешове (`__pycache__`, `*.pyc`), които HACS би изтеглил.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const integration = path.join(root, 'custom_components', 'hapi_enterprise');

// 1. hacs.json
const hacsPath = path.join(root, 'hacs.json');
assert.ok(fs.existsSync(hacsPath), 'липсва hacs.json в корена на хранилището');
const hacs = JSON.parse(fs.readFileSync(hacsPath, 'utf8'));
const allowed = new Set([
  'name',
  'content_in_root',
  'zip_release',
  'filename',
  'country',
  'homeassistant',
  'hacs',
  'hide_default_branch',
  'persistent_directory',
  'domains',
  'render_readme',
  'release_filter',
]);
for (const key of Object.keys(hacs)) assert.ok(allowed.has(key), 'hacs.json: непознат ключ ' + key);
assert.equal(typeof hacs.name, 'string', 'hacs.json: name е задължително');
assert.equal(hacs.content_in_root, false, 'интеграцията е в custom_components/, не в корена');
assert.match(String(hacs.homeassistant), /^\d{4}\.\d{1,2}(\.\d+)?$/, 'hacs.json: homeassistant трябва да е версия (напр. 2024.6.0)');
assert.ok(Array.isArray(hacs.domains) && hacs.domains.includes('hapi_enterprise'), 'hacs.json: domains трябва да съдържа hapi_enterprise');

// 2. Интеграцията и манифестът
const folder = path.basename(integration);
const manifestPath = path.join(integration, 'manifest.json');
assert.ok(fs.existsSync(manifestPath), 'липсва manifest.json на интеграцията');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.domain, folder, 'domain трябва да съвпада с името на папката');
for (const key of ['domain', 'name', 'version', 'documentation', 'issue_tracker', 'codeowners', 'iot_class']) {
  assert.ok(manifest[key] !== undefined, 'manifest.json: липсва ' + key);
}
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'manifest.json: version трябва да е SemVer (HACS го изисква)');
assert.ok(Array.isArray(manifest.codeowners) && manifest.codeowners.length > 0, 'manifest.json: codeowners не бива да е празен');
for (const owner of manifest.codeowners) assert.match(owner, /^@[A-Za-z0-9-]+$/, 'codeowners: невалиден GitHub потребител ' + owner);
assert.match(manifest.documentation, /^https:\/\//, 'documentation трябва да е https URL');
assert.match(manifest.issue_tracker, /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues$/, 'issue_tracker трябва да сочи GitHub Issues');
assert.ok(Array.isArray(manifest.requirements) && manifest.requirements.length === 0, 'интеграцията не тегли Python пакети');

// 3. Brand изображения (новото място: brand/, старото: до manifest.json)
const isPng = (file) => {
  const head = fs.readFileSync(file).subarray(0, 8);
  return head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
};
for (const rel of ['brand/icon.png', 'brand/logo.png', 'icon.png', 'logo.png']) {
  const file = path.join(integration, rel);
  assert.ok(fs.existsSync(file), 'липсва ' + rel);
  assert.ok(isPng(file), rel + ' не е PNG');
  assert.ok(fs.statSync(file).size > 512, rel + ' е подозрително малък');
}

// 4. Никакви кешове/артефакти в дървото, което HACS изтегля.
const offenders = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) offenders.push(path.join(dir, entry.name));
    else if (entry.isDirectory()) walk(path.join(dir, entry.name));
  }
};
walk(integration);
assert.deepEqual(offenders, [], 'в интеграцията има кешове: ' + offenders.join(', '));

// 5. Файловете, които HACS очаква, са налични (и UI настройката, ако е включена).
for (const rel of ['__init__.py', 'manifest.json', 'portal.html', 'portal.js']) {
  assert.ok(fs.existsSync(path.join(integration, rel)), 'липсва ' + rel);
}
if (manifest.config_flow === true) {
  for (const rel of ['config_flow.py', 'strings.json', path.posix.join('translations', 'en.json')]) {
    assert.ok(fs.existsSync(path.join(integration, rel)), 'config_flow е включен, но липсва ' + rel);
  }
}

console.log(`hacs-structure OK: hacs.json + brand/ + manifest ${manifest.version} (${manifest.name})`);
