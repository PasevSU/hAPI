'use strict';
// `dist/` е папката на ИЗДАНИЕТО, не архив на всички издания. На 0.69.87 там стояха 69 версии
// (140 файла), докато `SHA256SUMS.txt` и `RELEASE.json` описваха само текущата — тоест човек,
// който публикува на ръка, можеше да качи стар архив, а никой нямаше да забележи, защото
// проверките гледаха само текущите имена. Строителят вече маха старите; тук се проверява, че
// папката наистина съдържа ТОЧНО едно издание и че двата манифеста го описват изцяло.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('../scripts/release-lib.cjs');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const version = (fs.readFileSync(path.join(root, 'hapi_enterprise', 'config.yaml'), 'utf8').match(/^version:\s*"?([0-9.]+)"?/m) || [])[1];
assert.ok(version, 'config.yaml носи версия');
assert.ok(fs.existsSync(distDir), 'dist/ съществува — пусни `node scripts/build-release.cjs`');

const files = fs.readdirSync(distDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
const addon = `hapi_enterprise-${version}.tar.gz`;
const integration = `hapi_enterprise-integration-${version}.zip`;
const gui = `hapi-enterprise-gui-${version}.zip`;
const expected = [addon, gui, integration, 'RELEASE.json', 'SHA256SUMS.txt', 'repository.yaml'].sort();
assert.deepEqual(files, expected, `dist/ съдържа точно ${version}: трите архива и трите манифеста (иначе стар архив може да бъде публикуван по погрешка)`);

// ── RELEASE.json описва същите архиви и същата версия ──────────────────────
const release = JSON.parse(fs.readFileSync(path.join(distDir, 'RELEASE.json'), 'utf8'));
assert.equal(release.version, version, 'RELEASE.json е за текущата версия');
const described = [
  release.addon && release.addon.archive,
  release.integration && release.integration.archive,
  release.gui && release.gui.archive,
].filter(Boolean);
assert.deepEqual(described.sort(), [addon, gui, integration].sort(), 'RELEASE.json описва точно трите архива');

// ── SHA256SUMS.txt покрива ВСЕКИ файл от папката и сумите съвпадат ──────────
// Строителят подписва трите архива плюс `repository.yaml` и `RELEASE.json` — тоест всичко,
// което човек би качил. Проверката иска точно това множество, нито по-малко, нито повече.
const sums = fs
  .readFileSync(path.join(distDir, 'SHA256SUMS.txt'), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    assert.ok(match, `редът в SHA256SUMS.txt е във формат „хеш  файл“: ${line}`);
    return { hash: match[1], file: match[2].trim() };
  });
const covered = [addon, gui, integration, 'RELEASE.json', 'repository.yaml'].sort();
assert.deepEqual(sums.map((s) => s.file).sort(), covered, 'SHA256SUMS.txt покрива всички файлове на изданието');
for (const { hash, file } of sums) {
  assert.equal(sha256(fs.readFileSync(path.join(distDir, file))), hash, `сумата на ${file} съвпада с файла`);
}

console.log(`dist-folder: ${files.length} файла · ${version} · RELEASE.json и SHA256SUMS.txt описват същите три архива — наред`);
