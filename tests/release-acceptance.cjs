'use strict';
// Приемен тест на ИЗДАНИЕТО за Home Assistant: новите детайли трябва да са в самите
// артефакти, не само в дървото.
//
// `verify-release` сравнява дърво ↔ архив (S08/S09) и покрива схемата на add-on-а
// (S02/S14), но не казва нищо за съдържанието на новите функции. Тук се проверява
// точно това, което потребителят ще получи от HACS / add-on repository:
//   1. версията е една и съща в tar, zip и RELEASE.json;
//   2. zip-ът носи 4-те отчетни манифеста и индекса, който им съвпада ПО СЪДЪРЖАНИЕ;
//   3. tar-ът носи новите модули (report-stamp, report-render, pdf-writer с qrMatrix);
//   4. отчета с времеви печат е включваем от HA: опциите за TSA са в config.yaml
//      и entrypoint-ът ги превръща в env;
//   5. CHANGELOG за тази версия изброява новите неща — без „тихи“ функции.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../scripts/release-lib.cjs');

const root = lib.ROOT;
const distDir = path.join(root, lib.DIST_DIR);
const version = lib.readAddonVersion(root);
const addonArchive = path.join(distDir, `hapi_enterprise-${version}.tar.gz`);
const integrationArchive = path.join(distDir, `hapi_enterprise-integration-${version}.zip`);
const releaseJson = path.join(distDir, 'RELEASE.json');

for (const file of [addonArchive, integrationArchive, releaseJson]) {
  assert.ok(fs.existsSync(file), `липсва ${path.relative(root, file)} — пусни node scripts/build-release.cjs`);
}

const tarEntries = new Map(
  lib.readArchive(fs.readFileSync(addonArchive), path.basename(addonArchive)).map((e) => [e.path, e.data]),
);
const zipEntries = new Map(
  lib.readArchive(fs.readFileSync(integrationArchive), path.basename(integrationArchive)).map((e) => [e.path, e.data]),
);
const tarText = (relative) => {
  const data = tarEntries.get(`${lib.ADDON_DIR}/${relative}`);
  assert.ok(data, `липсва ${lib.ADDON_DIR}/${relative} в add-on архива`);
  return data.toString('utf8');
};
const zipText = (relative) => {
  const data = zipEntries.get(`custom_components/hapi_enterprise/${relative}`);
  assert.ok(data, `липсва custom_components/hapi_enterprise/${relative} в интеграцията`);
  return data.toString('utf8');
};
const sha256 = (data) => require('node:crypto').createHash('sha256').update(data).digest('hex');
// Индексът пази отпечатък върху ТЕКСТА с CRLF → LF (виж `hash_rule` в него), а в
// изданието файловете са с CRLF, защото са писали на Windows. Сравнява се по същото
// правило, иначе тестът би „хванал“ собствената си грешка, а не дефект.
const sha256TextLF = (data) => sha256(Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));

// ── 1. Една версия навсякъде, включително в имената на артефактите ──────────
const release = JSON.parse(fs.readFileSync(releaseJson, 'utf8'));
assert.equal(release.version, version, 'RELEASE.json носи друга версия');
const configVersion = /^version:\s*["']?([^"'\n]+)["']?\s*$/m.exec(tarText('config.yaml'));
assert.ok(configVersion, 'config.yaml в архива няма version');
assert.equal(configVersion[1].trim(), version, 'config.yaml в tar-а е с друга версия');
const integrationManifest = JSON.parse(zipText('manifest.json'));
assert.equal(integrationManifest.version, version, 'manifest.json в zip-а е с друга версия');

// ── 2. Отчетните манифести пътуват с изданието и индексът им съвпада ────────
const index = JSON.parse(zipText('report_manifests/index.json'));
assert.equal(index.kind, 'hash_report_manifests', 'index.json не е отчетният индекс');
assert.equal(index.manifests.length, 4, 'трябват 4 манифеста (single, combo, combo_all, volume)');
const shipped = new Set(
  [...zipEntries.keys()]
    .filter((p) => p.startsWith('custom_components/hapi_enterprise/report_manifests/'))
    .map((p) => p.split('/').pop()),
);
for (const entry of index.manifests) {
  assert.ok(entry.file, `индексът няма файл за ${entry.id || '?'}`);
  assert.ok(shipped.has(entry.file), `изданието не съдържа ${entry.file}`);
  const data = zipEntries.get(`custom_components/hapi_enterprise/report_manifests/${entry.file}`);
  const expected = String(entry.sha256 || '').toLowerCase();
  assert.match(expected, /^[a-f0-9]{64}$/, `index.json няма валиден sha256 за ${entry.id}`);
  assert.equal(
    sha256TextLF(data),
    expected,
    `${entry.file} в изданието не съвпада с отпечатъка в index.json — опресни индекса`,
  );
}

// ── 3. Новите модули са в образа и правят каквото обещават ──────────────────
for (const module of ['report-stamp.js', 'report-render.js', 'pdf-writer.js', 'tsa-client.js']) {
  assert.ok(tarEntries.has(`${lib.ADDON_DIR}/${module}`), `липсва ${module} в add-on архива`);
}
assert.match(tarText('report-stamp.js'), /stampReport/, 'report-stamp.js не изнася stampReport');
assert.match(tarText('report-stamp.js'), /closingDigest/, 'report-stamp.js не изчислява затварящ хеш');
assert.match(tarText('pdf-writer.js'), /qrMatrix/, 'pdf-writer.js не рисува векторен QR');
assert.match(tarText('report-render.js'), /Произход на манифеста/, 'report-render.js не носи произхода на манифеста');
assert.match(tarText('server.js'), /X-PDF-SHA256/, 'сървърът не връща отпечатък на готовия PDF');
const dockerfile = tarText('Dockerfile');
assert.match(dockerfile, /report-stamp\.js/, 'Dockerfile не копира report-stamp.js — контейнерът ще падне');

// ── 4. Обхватът с времеви печат е включваем от Home Assistant ───────────────
// options и schema са с еднакво отстояние, затова се четат като блокове, а не с regex
// по ред: иначе „намери tsa_enabled някъде“ минава и когато липсва в schema.
const configYaml = tarText('config.yaml');
const yamlBlock = (text, name) => {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${name}:\\s*$`).test(line));
  assert.ok(start >= 0, `config.yaml няма блок ${name}`);
  const keys = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i])) break;
    const match = /^\s{2}([A-Za-z0-9_]+):/.exec(lines[i]);
    if (match) keys.push(match[1]);
  }
  return keys;
};
const shippedOptions = yamlBlock(configYaml, 'options');
const shippedSchema = yamlBlock(configYaml, 'schema');
for (const option of ['tsa_enabled', 'tsa_start_url', 'tsa_stop_url']) {
  assert.ok(shippedOptions.includes(option), `липсва опция ${option} в options на config.yaml`);
  assert.ok(shippedSchema.includes(option), `липсва ${option} в schema на config.yaml`);
}
// Всяка опция трябва да има схема и обратно — и в ИЗДАНИЕТО, не само в дървото.
assert.deepEqual(
  shippedOptions.filter((key) => !shippedSchema.includes(key)),
  [],
  'опции без схема в издадения config.yaml',
);
assert.deepEqual(
  shippedSchema.filter((key) => !shippedOptions.includes(key)),
  [],
  'схема без опция в издадения config.yaml',
);
const startJs = tarText('start.js');
for (const env of ['TSA_ENABLED', 'TSA_START_URL', 'TSA_STOP_URL']) {
  assert.match(startJs, new RegExp(`'${env}'`), `start.js не предава ${env} към сървъра`);
}

// ── 5. Няма „тихи“ функции: CHANGELOG ги изброява ───────────────────────────
// Проверката е върху ЦЕЛИЯ CHANGELOG, не само върху секцията на текущата версия:
// пач издание (0.63.1) не описва наново функциите от 0.63.0, а ново минорно (0.64.0)
// ги наследява. Изискването, което наистина има смисъл, е всяка голяма функция да е
// документирана НЯКЪДЕ в историята — иначе излиза „тихо“.
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const sections = changelog.split(/^## /m).filter((part) => /^\d+\.\d+\.\d+/.test(part));
const sectionIndex = sections.findIndex((part) => part.startsWith(version + '\n') || part.startsWith(version + '\r\n'));
assert.ok(sectionIndex >= 0, `CHANGELOG няма секция за ${version}`);
for (const marker of ['report_manifests', 'report-stamp.js', 'qrMatrix', 'X-PDF-SHA256', 'tsa_enabled']) {
  assert.ok(changelog.includes(marker), `CHANGELOG не споменава ${marker} — функцията е „тиха“`);
}

console.log(
  `release-acceptance OK: ${version} · ${tarEntries.size} файла в add-on, ${zipEntries.size} в интеграцията, ` +
  `${Object.keys(index.manifests).length} манифеста с валидни отпечатъци`,
);
