'use strict';
// Готовото HACS издание в `release/haoss` не бива да изостава от източника.
//
// `tests/haoss-release.cjs` проверява СТРУКТУРАТА на издание, което сам сглобява в temp —
// затова един забравен `build-haoss.cjs` минава незабелязано (случи се на 0.63.0:
// `release/haoss` остана на 0.62.1 и никой гейт не го хвана). Тук се сравнява
// съдържанието на вече комитнатото издание с `custom_components/hapi_enterprise`.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const haoss = path.join(root, 'release', 'haoss');
if (!fs.existsSync(haoss)) {
  console.log('haoss-in-sync SKIP: release/haoss не съществува в това копие');
  process.exit(0);
}

const sourceDir = path.join(root, 'custom_components', 'hapi_enterprise');
const shippedDir = path.join(haoss, 'custom_components', 'hapi_enterprise');
assert.ok(fs.existsSync(shippedDir), 'release/haoss трябва да съдържа custom_components/hapi_enterprise');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__pycache__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

const sourceFiles = walk(sourceDir);
// `release/haoss` се презаписва при всеки строеж; затова до него стои снимка
// `release/haoss_v<version>`, която показва какво точно е излязло за версията. Тя
// се проверява по същия начин, за да не може да замръзне на стар код.
function checkTree(label, shippedDir) {
  const shippedFiles = walk(shippedDir);
  assert.deepEqual(
    shippedFiles,
    sourceFiles,
    `списъкът файлове в ${label} не съвпада с custom_components — пусни \`node scripts/build-haoss.cjs\``,
  );
  for (const relative of sourceFiles) {
    const shippedFile = path.join(shippedDir, relative);
    const sourceFile = path.join(sourceDir, relative);
    if (sha256(shippedFile) === sha256(sourceFile)) continue;
    // JSON файловете се сравняват по съдържание: форматирането е разлика, не изоставане.
    if (relative.endsWith('.json')) {
      assert.deepEqual(
        JSON.parse(fs.readFileSync(shippedFile, 'utf8')),
        JSON.parse(fs.readFileSync(sourceFile, 'utf8')),
        `${label} изостава по съдържание: ${relative} (пусни \`node scripts/build-haoss.cjs\`)`,
      );
      continue;
    }
    assert.fail(`${label} изостава: ${relative} (пусни \`node scripts/build-haoss.cjs\`)`);
  }
}

checkTree('release/haoss', shippedDir);

// Версията в изданието трябва да е същата като в add-on-а (един източник на истина).
const cfgVersion = /^version:\s*["']?([^"'\n]+)["']?\s*$/m.exec(
  fs.readFileSync(path.join(root, 'hapi_enterprise', 'config.yaml'), 'utf8'),
);
assert.ok(cfgVersion, 'config.yaml трябва да съдържа version');
const shippedVersion = JSON.parse(fs.readFileSync(path.join(shippedDir, 'manifest.json'), 'utf8')).version;
assert.equal(shippedVersion, cfgVersion[1].trim(), 'release/haoss носи друга версия от add-on-а');

// Версионната снимка не е задължителна (може да е изключена с --no-versioned),
// но ако я има трябва да отговаря на същия код и на същата версия.
const versioned = path.join(root, 'release', `haoss_v.${shippedVersion}`);
let snapshotNote = 'версионна снимка: няма';
if (fs.existsSync(versioned)) {
  const versionedDir = path.join(versioned, 'custom_components', 'hapi_enterprise');
  assert.ok(fs.existsSync(versionedDir), `release/haoss_v.${shippedVersion} няма custom_components/hapi_enterprise`);
  checkTree(`release/haoss_v.${shippedVersion}`, versionedDir);
  const snapshotVersion = JSON.parse(fs.readFileSync(path.join(versionedDir, 'manifest.json'), 'utf8')).version;
  assert.equal(snapshotVersion, shippedVersion, 'версионната снимка носи друга версия');
  snapshotNote = `версионна снимка ${shippedVersion}: ${sourceFiles.length} файла`;
}

console.log(`haoss-in-sync OK: ${sourceFiles.length} файла съвпадат с източника, версия ${shippedVersion} · ${snapshotNote}`);
