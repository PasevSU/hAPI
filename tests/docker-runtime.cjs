'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../hapi_enterprise');
const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const run = fs.readFileSync(path.join(root, 'start.js'), 'utf8');
// Два етапа: официалният `node:*` образ (само за бинарника) → чист Alpine като краен образ.
// Причината е измерена: `node:*` носи npm, а Docker Scout отчита точно в него 2 critical +
// high (npm/tar 7.5.11, npm/brace-expansion, npm/ip-address) — код, който никога не се
// изпълнява в add-on-а. Изтриването на по-късен слой оставя пакета в историята на образа,
// затова npm/npx/corepack остават в ИЗХВЪРЛЕНИЯ етап, а в готовия образ влиза един файл.
const stages = [...docker.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\w+))?$/gm)].map((m) => ({ image: m[1], alias: m[2] }));
assert.ok(stages.length >= 2, 'Dockerfile трябва да е на два етапа (node → alpine): ' + JSON.stringify(stages));
assert.match(stages[0].image, /^node:\$\{NODE_VERSION\}-alpine$/, 'първият етап е официалният node образ (по ARG), намерено ' + stages[0].image);
assert.equal(stages[0].alias, 'node', 'първият етап се казва `node` — към него сочи COPY --from');
const lastStage = stages[stages.length - 1];
assert.match(lastStage.image, /^alpine:\d+\.\d+$/, 'последният етап е чист Alpine, намерено ' + lastStage.image);
assert.match(docker, /^ARG NODE_VERSION=22\.\d+\.\d+$/m, 'версията на Node е закачена');
// От етапа с Node се копира САМО бинарникът — това е целият смисъл на двата етапа.
const fromNodeCopies = [...docker.matchAll(/^COPY --from=node\s+(.+)$/gm)].map((m) => m[1].trim());
assert.deepEqual(fromNodeCopies, ['/usr/local/bin/node /usr/local/bin/node'], 'от етапа с Node се копира само бинарникът `node`: ' + JSON.stringify(fromNodeCopies));
assert.doesNotMatch(docker, /COPY --from=node[^\n]*(node_modules|\bnpm\b|\bnpx\b|corepack)/, 'npm/npx/corepack не се копират в готовия образ');
// Node от официалния Alpine билд е динамично свързан с libstdc++ — без него `node` не стартира.
assert.match(docker, /apk add --no-cache libstdc\+\+/, 'libstdc++ се слага — иначе Node не зарежда libstdc++.so.6');
assert.match(docker, /node:sqlite/);
assert.match(run, /node:sqlite/);
assert.doesNotMatch(docker, /apk add.*nodejs/);
// 0.69.87: слой за сигурност. Alpine пакетите се вдигат, а npm/npx/yarn/corepack се махат —
// add-on-ът няма нито една npm зависимост и не бива да носи чуждите CVEs на npm.
// 0.69.211: `--available` е задължителен — без него `apk upgrade` подминава пакети със
// сменена произходна група, а точно така идват поправките за zlib/musl/openssl, които
// Docker Scout отчита в базовия минирутфс (zlib 1.3.2-r1, musl 1.2.6-r3, openssl 3.5.9-r0).
assert.match(docker, /RUN apk upgrade --no-cache --available/, 'Dockerfile вдига пакетите на Alpine до актуалните поправки (`--available`)');
assert.match(docker, /apk info -v zlib musl openssl/, 'версиите на zlib/musl/openssl се печатат в лога на build-а');
// npm/npx/corepack не се копират в готовия образ (виж `COPY --from=node` по-горе) и не се
// трият след това — изтриването оставя следа в слоя.
assert.doesNotMatch(docker, /rm -rf \/usr\/local\/lib\/node_modules\/npm/, 'npm не се трие след копиране — той не влиза');
assert.doesNotMatch(docker, /\bapk add\b[^\n]*\bnodejs\b/, 'Node не идва от apk пакет');
// Правилото на проекта: entrypoint-ът е JavaScript. Shell скрипт в add-on-а
// (run.sh и подобни) би върнал втори език за стартиране и чупи това правило.
assert.doesNotMatch(docker, /CMD\s+\["\/app\/run\.sh"\]/, 'Dockerfile не бива да стартира shell entrypoint');
assert.match(docker, /^CMD\s+\["node",\s*"\/app\/start\.js"\]$/m, 'CMD трябва да е node /app/start.js');
const copyLine = (docker.match(/^COPY\s+(.+?)\s+\/app\/\s*$/m) || [])[1] || '';
const copied = new Set(copyLine.split(/\s+/));
for (const mod of ['sqlite-store.js', 'qrcode.js', 'ooxml.js', 'pdf-writer.js', 'cabinet.js', 'directory.js', 'job-manager.js', 'server.js', 'runtime-config.js', 'audit-chain.js', 'rbac.js', 'error-log.js', 'config-profiles.js', 'storage-check.js', 'load-control.js', 'storage-preflight.js', 'storage-migrate.js', 'evidence-portal.js', 'start.js']) {
  assert.ok(copied.has(mod), 'Dockerfile must COPY ' + mod);
}
// Старият панел е премахнат: качва се само именното на новия интерфейс (COPY ui /app/ui/).
assert.doesNotMatch(copyLine, /\badmin\.(?:js|html)\b/, 'Dockerfile не бива да копира стария панел');
assert.match(docker, /^COPY\s+ui\s+\/app\/ui\/\s*$/m, 'Dockerfile копира ui/ като /app/ui/');
// Пълен манифест: всички локални модули, които се изискват (транзитивно) от server.js,
// трябва да са в COPY — иначе add-on-ът стартира с MODULE_NOT_FOUND.
const seen = new Set();
const queue = [path.join(root, 'server.js')];
// DEF-71: `server-modules.js` зарежда ЦЯЛАТА папка `server_module/` по време на изпълнение,
// тоест статичният граф от `server.js` не ги вижда. Затова всяка компонента е СЕМЕ на обхождането,
// а `require('../x')` от компонента се проверява като `x.js` — иначе първият компонент, който
// поиска локален модул, ще падне с MODULE_NOT_FOUND само в контейнера.
// Същото важи за глобалните функции: `core.js` чете ЦЯЛАТА папка `core_module/`.
for (const dirName of ['server_module', 'core_module']) {
  const moduleDir = path.join(root, dirName);
  if (!fs.existsSync(moduleDir)) continue;
  for (const name of fs.readdirSync(moduleDir).filter((n) => n.endsWith('.js'))) queue.push(path.join(moduleDir, name));
}
while (queue.length) {
  const file = queue.pop();
  let text;
  try { text = fs.readFileSync(file, 'utf8') } catch { continue }
  for (const m of text.matchAll(/require\('(?:\.\/|\.\.\/)([a-z0-9-]+)(?:\.js)?'\)/g)) {
    const name = m[1] + '.js';
    if (seen.has(name)) continue;
    seen.add(name);
    assert.ok(copied.has(name), 'Dockerfile COPY липсва ' + name);
    queue.push(path.join(root, name));
  }
}
assert.ok(seen.size >= 25, 'трябва да има поне 25 локални модула');
for (const module of ['pgp.js', 'packager.js']) assert.ok(copied.has(module), 'Dockerfile COPY липсва ' + module);

// ── Обратната посока: нищо мъртво в образа ───────────────────────────────────
// Първата посока (всеки required е в COPY) не хваща мъртъв товар: файл, който никой не
// изисква, се копира и пътува до потребителя. Одитът на 0.69.87 намери точно такова —
// четири модула от „Фаза 2“, описани в MODULE_CATALOG като архитектура, но необвързани.
//
// Сканира се ЦЯЛОТО дърво (не само require-веригата от server.js, която не влиза в
// `routes/`), защото модул може да се изисква и от маршрут с `require('../x')`.
const codeFiles = [];
const walkCode = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'archive'].includes(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkCode(abs);
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.cjs')) codeFiles.push(abs);
  }
};
walkCode(root);
const requiredAnywhere = new Set();
for (const file of codeFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/require\(\s*['"](?:\.\.?\/)*([a-z0-9-]+)(?:\.js)?['"]\s*\)/g)) requiredAnywhere.add(m[1] + '.js');
}
// Списъкът е ИЗРИЧЕН и с причина; нов необвързан файл пада тук.
const NOT_REQUIRED_BY_DESIGN = new Map([
  ['server.js', 'стартира се като дете от start.js (spawn(node, [SERVER])), не се require-ва'],
  ['start.js', 'входна точка (CMD → start.js)'],
  ['storage-migrate.js', 'офлайн CLI (#!node), пуска се ръчно'],
  ['secret-view.js', 'браузър скрипт, сервира се статично (files["/secret-view.js"])'],
  // Необвързани модули от Фаза 2 — оставени съзнателно като скелет, но НЕ бива да се
  // броят за работеща архитектура (вж. MODULE_CATALOG.md, бележката при тях):
  ['container.js', 'Фаза 2.1 scaffolding — никой не го require-ва'],
  ['event-bus.js', 'Фаза 2.2 scaffolding — никой не го require-ва'],
  ['plugins.js', 'Фаза 2.4 scaffolding — никой не го require-ва'],
  ['sqlite-repository.js', 'Фаза 2.3 scaffolding — никой не го require-ва'],
  // Дескрипторът на опциите е източник за документацията (`OPTIONS_REFERENCE.md`) и за гейта
  // `option-spec`; сървърът чете стойностите от `process.env`, а не от описанието им. Стои в
  // образа, за да може HA-C04 („всички top-level модули се копират“) да остане без изключения.
  ['option-spec.js', 'описание на опциите: ползва се от scripts/options-reference.cjs и tests/option-spec.cjs'],
]);
const copyJs = [...copied].filter((n) => n.endsWith('.js'));
const unwired = copyJs.filter((name) => !requiredAnywhere.has(name) && !NOT_REQUIRED_BY_DESIGN.has(name));
assert.deepEqual(
  unwired,
  [],
  'тези файлове се копират в образа, но никой не ги require-ва (мъртъв товар): ' + unwired.join(', ') +
  '. Или ги свържи, или ги добави в NOT_REQUIRED_BY_DESIGN с причина.',
);
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
// `links.js` е ЕДИН файл за сървъра и за панела: сервира се на `/ui/links.js`, но живее в
// корена на add-on-а. Затова проверката повтаря същото правило, вместо да иска копие в ui/.
const linksFromRoot = /f === 'links\.js' \? f : 'ui\/' \+ f/.test(uiBlock);
for (const line of uiBlock.split('\n')) {
  const prefix = /files\['\/ui\/'\s*\+\s*f\]/.test(line)
    ? 'ui/'
    : /files\['\/hapi_enterprise\/'\s*\+\s*f\]/.test(line)
      ? ''
      : null;
  if (prefix === null) continue;
  const list = line.slice(line.indexOf('['), line.lastIndexOf(']') + 1);
  for (const m of list.matchAll(/'([A-Za-z0-9._-]+\.js)'/g)) assets.add(linksFromRoot && m[1] === 'links.js' ? m[1] : prefix + m[1]);
}
assert.ok(assets.size >= 20, 'UI_FILES трябва да съдържа поне 20 асета, намерени ' + assets.size);
for (const asset of assets) {
  assert.ok(fs.existsSync(path.join(root, asset)), 'UI асетът липсва в add-on папката: ' + asset);
  if (asset.startsWith('ui/')) continue; // покрит от COPY ui
  assert.ok(copied.has(asset.replace(/^hapi_enterprise\//, '')), 'Dockerfile COPY липсва ' + asset);
}
console.log('PASS pinned SQLite-compatible Node runtime + complete module manifest');
