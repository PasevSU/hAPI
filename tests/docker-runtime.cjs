'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../hapi_enterprise');
const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const run = fs.readFileSync(path.join(root, 'start.js'), 'utf8');
assert.match(docker, /^FROM node:22\.16\.0-alpine3\.21$/m);
assert.match(docker, /node:sqlite/);
assert.match(run, /node:sqlite/);
assert.doesNotMatch(docker, /apk add.*nodejs/);
// Правилото на проекта: entrypoint-ът е JavaScript. Shell скрипт в add-on-а
// (run.sh и подобни) би върнал втори език за стартиране и чупи това правило.
assert.doesNotMatch(docker, /CMD\s+\["\/app\/run\.sh"\]/, 'Dockerfile не бива да стартира shell entrypoint');
assert.match(docker, /^CMD\s+\["node",\s*"\/app\/start\.js"\]$/m, 'CMD трябва да е node /app/start.js');
const copyLine = (docker.match(/^COPY\s+(.+?)\s+\/app\/\s*$/m) || [])[1] || '';
const copied = new Set(copyLine.split(/\s+/));
for (const mod of ['sqlite-store.js', 'qrcode.js', 'ooxml.js', 'pdf-writer.js', 'cabinet.js', 'directory.js', 'job-manager.js', 'server.js', 'runtime-config.js', 'audit-chain.js', 'rbac.js', 'error-log.js', 'config-profiles.js', 'storage-check.js', 'load-control.js', 'storage-preflight.js', 'storage-migrate.js', 'admin.js', 'admin.html', 'portal.html', 'portal.js', 'portal.css', 'start.js']) {
  assert.ok(copied.has(mod), 'Dockerfile must COPY ' + mod);
}
// Пълен манифест: всички локални модули, които се изискват (транзитивно) от server.js,
// трябва да са в COPY — иначе add-on-ът стартира с MODULE_NOT_FOUND.
const seen = new Set();
const queue = [path.join(root, 'server.js')];
while (queue.length) {
  const file = queue.pop();
  let text;
  try { text = fs.readFileSync(file, 'utf8') } catch { continue }
  for (const m of text.matchAll(/require\('\.\/([a-z0-9-]+)(?:\.js)?'\)/g)) {
    const name = m[1] + '.js';
    if (seen.has(name)) continue;
    seen.add(name);
    assert.ok(copied.has(name), 'Dockerfile COPY липсва ' + name);
    queue.push(path.join(root, name));
  }
}
assert.ok(seen.size >= 25, 'трябва да има поне 25 локални модула');
for (const module of ['pgp.js', 'packager.js']) assert.ok(copied.has(module), 'Dockerfile COPY липсва ' + module);
// Статичните файлове на Enterprise Control Center не се хващат от require-веригата:
// build context-ът на Supervisor е САМО тази папка, затова всеки асет от UI_FILES
// трябва да съществува в hapi_enterprise/ и да е покрит от COPY.
assert.match(docker, /^COPY ui \/app\/ui\/$/m, 'Dockerfile трябва да копира ui/ в /app/ui/');
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
// Форматирането в server.js може да е `const UI_FILES = (() => {` — затова се търси
// по шаблон, а не по точен низ (иначе тестът чупи при безобиден reformat).
const uiStart = serverSrc.search(/const UI_FILES\s*=/);
assert.ok(uiStart > 0, 'server.js: липсва UI_FILES allowlist');
const uiBlock = serverSrc.slice(uiStart, serverSrc.indexOf('})();', uiStart));
const assets = new Set();
for (const m of uiBlock.matchAll(/'((?:ui|hapi_enterprise)\/[A-Za-z0-9._-]+)'/g)) assets.add(m[1]);
for (const line of uiBlock.split('\n')) {
  const prefix = /files\['\/ui\/'\s*\+\s*f\]/.test(line)
    ? 'ui/'
    : /files\['\/hapi_enterprise\/'\s*\+\s*f\]/.test(line)
      ? ''
      : null;
  if (prefix === null) continue;
  const list = line.slice(line.indexOf('['), line.lastIndexOf(']') + 1);
  for (const m of list.matchAll(/'([A-Za-z0-9._-]+\.js)'/g)) assets.add(prefix + m[1]);
}
assert.ok(assets.size >= 20, 'UI_FILES трябва да съдържа поне 20 асета, намерени ' + assets.size);
for (const asset of assets) {
  assert.ok(fs.existsSync(path.join(root, asset)), 'UI асетът липсва в add-on папката: ' + asset);
  if (asset.startsWith('ui/')) continue; // покрит от COPY ui
  assert.ok(copied.has(asset.replace(/^hapi_enterprise\//, '')), 'Dockerfile COPY липсва ' + asset);
}
console.log('PASS pinned SQLite-compatible Node runtime + complete module manifest');
