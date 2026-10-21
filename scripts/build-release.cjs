'use strict';
// Строи изданието за Home Assistant в `dist/`:
//
//   hapi_enterprise-<version>.tar.gz            add-on (за add-on repository или ръчен ъплоуд)
//   hapi_enterprise-integration-<version>.zip   custom_components/hapi_enterprise
//   repository.yaml                             описание на add-on repository
//   RELEASE.json                                манифест на изданието (файлове + хешове)
//   SHA256SUMS.txt                              контролни суми на артефактите
//
// Няма външни зависимости — архивите се сглобяват от scripts/release-lib.cjs.
// Употреба:
//   node scripts/build-release.cjs                 # сглобява текущата версия
//   node scripts/build-release.cjs --version 0.52.0  # сменя версията и сглобява
//   node scripts/build-release.cjs --with-tests    # първо пуска целия тестов набор

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const lib = require('./release-lib.cjs');

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const option = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : null;
};

const started = Date.now();
const root = lib.ROOT;
const distDir = path.join(root, lib.DIST_DIR);

function step(title, fn) {
  process.stdout.write(`\n▸ ${title}\n`);
  const result = fn();
  if (typeof result === 'string') console.log(result);
  return result;
}

function fail(message) {
  console.error('\n✗ ' + message);
  process.exit(1);
}

// ── 1. Версия ────────────────────────────────────────────────────────────────
const wantedVersion = option('version');
if (wantedVersion) {
  if (!lib.SEMVER.test(wantedVersion)) fail('Невалидна версия: ' + wantedVersion);
  lib.writeVersion(wantedVersion, root);
  console.log(`Версията е зададена на ${wantedVersion} (config.yaml + manifest.json)`);
}
const version = lib.readAddonVersion(root);
const integrationVersion = lib.readIntegrationVersion(root);
step('Проверка на версията', () => {
  if (!lib.SEMVER.test(version)) fail('config.yaml: невалидна версия „' + version + '“');
  if (integrationVersion !== version) {
    fail(`Версиите се разминават: add-on ${version} ≠ интеграция ${integrationVersion} (пусни с --version ${version})`);
  }
  return `add-on и интеграция: ${version}`;
});

// ── 2. Тестове (по избор) ────────────────────────────────────────────────────
if (flag('with-tests')) {
  step('Пълен тестов набор', () => {
    const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-tests.cjs')], { cwd: root, stdio: 'inherit' });
    if (res.status !== 0) fail('Тестовете не минават — изданието не се строи.');
    return null;
  });
}

// ── 3. Събиране на файловете ─────────────────────────────────────────────────
const addonEntries = step('Файлове на add-on-а', () => {
  const entries = lib.assertSafeEntryPaths(lib.walk(path.join(root, lib.ADDON_DIR), lib.ADDON_DIR), 'add-on');
  for (const required of ['config.yaml', 'Dockerfile', 'start.js', 'server.js', 'portal.html', 'portal.js', 'portal.css', 'icon.png', 'logo.png']) {
    if (!entries.some((e) => e.path === lib.ADDON_DIR + '/' + required)) fail('add-on: липсва ' + required);
  }
  return entries;
});

const integrationEntries = step('Файлове на интеграцията', () => {
  const entries = lib.assertSafeEntryPaths(lib.walk(path.join(root, lib.INTEGRATION_DIR), path.posix.join('custom_components', 'hapi_enterprise')), 'интеграция');
  for (const required of ['manifest.json', '__init__.py', 'portal.html', 'portal.js', 'portal.css', 'icon.png', 'logo.png']) {
    if (!entries.some((e) => path.posix.basename(e.path) === required)) fail('интеграция: липсва ' + required);
  }
  return entries;
});

const repositoryYaml = path.join(root, 'repository.yaml');
if (!fs.existsSync(repositoryYaml)) fail('липсва repository.yaml');

// ── 4. Архивни имена ─────────────────────────────────────────────────────────
const addonName = `hapi_enterprise-${version}.tar.gz`;
const integrationName = `hapi_enterprise-integration-${version}.zip`;

// ── 5. Сглобяване ────────────────────────────────────────────────────────────
fs.mkdirSync(distDir, { recursive: true });
for (const stale of [addonName, integrationName]) {
  fs.rmSync(path.join(distDir, stale), { force: true });
}

const addonBuf = step('Сглобяване на ' + addonName, () => lib.buildTarGz(addonEntries));
fs.writeFileSync(path.join(distDir, addonName), addonBuf);

const integrationBuf = step('Сглобяване на ' + integrationName, () => lib.buildZip(integrationEntries));
fs.writeFileSync(path.join(distDir, integrationName), integrationBuf);

step('Копиране на repository.yaml', () => {
  fs.copyFileSync(repositoryYaml, path.join(distDir, 'repository.yaml'));
  return null;
});

// ── 6. Манифест и контролни суми ─────────────────────────────────────────────
const fingerprint = (entries) =>
  lib.sha256(
    entries
      .map((e) => `${e.path}:${lib.sha256(fs.readFileSync(e.abs))}`)
      .sort()
      .join('\n'),
  );

const release = {
  schema: 2,
  product: lib.PRODUCT,
  version,
  builtAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  addon: {
    slug: 'hapi_enterprise',
    archive: addonName,
    sha256: lib.sha256(addonBuf),
    bytes: addonBuf.length,
    fileCount: addonEntries.length,
    fingerprint: fingerprint(addonEntries),
    files: addonEntries.map((e) => ({ path: e.path, bytes: e.size, sha256: lib.sha256(fs.readFileSync(e.abs)) })),
  },
  integration: {
    domain: 'hapi_enterprise',
    archive: integrationName,
    sha256: lib.sha256(integrationBuf),
    bytes: integrationBuf.length,
    fileCount: integrationEntries.length,
    fingerprint: fingerprint(integrationEntries),
    files: integrationEntries.map((e) => ({ path: e.path, bytes: e.size, sha256: lib.sha256(fs.readFileSync(e.abs)) })),
  },
  repository: { file: 'repository.yaml', sha256: lib.sha256File(repositoryYaml) },
  install: {
    addon: `Разархивирай ${addonName} в папка и я добави като локален add-on repository (или я копирай в /addons).`,
    integration: `Разархивирай ${integrationName} в /config (получава се /config/custom_components/hapi_enterprise) и рестартирай Home Assistant.`,
  },
};

step('RELEASE.json', () => {
  fs.writeFileSync(path.join(distDir, 'RELEASE.json'), JSON.stringify(release, null, 2) + '\n');
  return null;
});

step('SHA256SUMS.txt', () => {
  const artifacts = [addonName, integrationName, 'repository.yaml', 'RELEASE.json'];
  const lines = artifacts.map((name) => `${lib.sha256File(path.join(distDir, name))}  ${name}`);
  fs.writeFileSync(path.join(distDir, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
  return lines.length + ' артефакта';
});

// ── 7. Обобщение ─────────────────────────────────────────────────────────────
console.log('\n════════ Издание ' + lib.PRODUCT + ' ' + version + ' ════════');
console.log(`  ${addonName.padEnd(44)} ${lib.fmtBytes(addonBuf.length).padStart(9)}  ${addonEntries.length} файла`);
console.log(`  ${integrationName.padEnd(44)} ${lib.fmtBytes(integrationBuf.length).padStart(9)}  ${integrationEntries.length} файла`);
console.log(`  ${'repository.yaml + RELEASE.json + SHA256SUMS.txt'.padEnd(44)}`);
console.log(`  папка: ${lib.DIST_DIR}/  ·  ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('  Проверка: node scripts/verify-release.cjs');
