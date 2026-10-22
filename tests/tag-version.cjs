'use strict';
// Гейт „таг = версия“ — проверява самия проверяващ скрипт, за да не е сляпо петно.
// Инцидентът, който затваря: таг v0.63.0 сочеше комит с 0.62.1 в config.yaml.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-tag-version.cjs');
const { check, normalizeTag, readAddonVersion, readManifestVersion } = require(SCRIPT);

// 1. Нормализация на тага: приема и суров ref, и кратък вид.
assert.equal(normalizeTag('refs/tags/v1.2.3'), '1.2.3');
assert.equal(normalizeTag('v1.2.3'), '1.2.3');
assert.equal(normalizeTag('1.2.3'), '1.2.3');
assert.equal(normalizeTag('  v1.2.3  '), '1.2.3');
assert.equal(normalizeTag(''), '');
assert.equal(normalizeTag(null), '');

// 2. Версията в config.yaml и manifest.json не бива да се разминават.
const addon = readAddonVersion();
const manifest = readManifestVersion();
assert.match(addon, /^\d+\.\d+\.\d+/, 'config.yaml има семантична версия');
assert.equal(addon, manifest, 'config.yaml и manifest.json носят една и съща версия');

// 3. Съвпадение → ok, включително с пълния ref формат.
const okShort = check('v' + addon);
assert.equal(okShort.ok, true);
assert.equal(okShort.tag, addon);
assert.equal(check('refs/tags/v' + addon).ok, true);
assert.equal(check(addon).ok, true);

// 4. Разминаване → отказ с ясно обяснение (не мълчаливо „мина“).
const bad = check('v0.0.1');
assert.equal(bad.ok, false);
assert.equal(bad.skipped, undefined);
assert.match(bad.reason, /тагът е 0\.0\.1/);
assert.match(bad.reason, new RegExp('config\\.yaml е ' + addon.replace(/\./g, '\\.')));

// 5. Липсва таг → „пропуснато“, а не „счупено“ (локална разработка).
const skipped = check('');
assert.equal(skipped.skipped, true);
assert.equal(skipped.ok, false);

// 6. CLI: кодът на изхода е това, което CI чете.
function run(args, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

const pass = run(['v' + addon]);
assert.equal(pass.code, 0, 'съвпадащ таг → код 0');
assert.match(pass.stdout, /съвпада/);

const fail = run(['v9.9.9']);
assert.equal(fail.code, 1, 'разминаващ таг → код 1');
assert.match(fail.stderr, /Тагът не се мести/, 'съобщението казва какво да се прави');

const fromEnv = run([], { GITHUB_REF_NAME: 'v' + addon });
assert.equal(fromEnv.code, 0, 'чете GITHUB_REF_NAME, както е в CI');

const noTag = run([], { GITHUB_REF_NAME: '' });
assert.equal(noTag.code, 0, 'без таг не чупи локалната работа');
assert.match(noTag.stdout, /пропусната/);

console.log(`PASS tag-version: таг ↔ config.yaml ↔ manifest.json (${addon}) проверени, включително отказа`);
