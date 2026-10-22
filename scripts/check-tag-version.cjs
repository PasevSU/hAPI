'use strict';
// Проверка „таг = версия“ — тагът, който се публикува, трябва да сочи точно тази
// версия, която стои в `hapi_enterprise/config.yaml`.
//
// Причината е реален инцидент: таг `v0.63.0` сочеше комит, в който config.yaml и
// manifest.json пишеха 0.62.1. HACS инсталира от тага, тоест който е сложил „0.63.0“,
// е получил 0.62.1 без нито една дума за това.
//
//   node scripts/check-tag-version.cjs v0.69.0
//   GITHUB_REF_NAME=v0.69.0 node scripts/check-tag-version.cjs
//
// Код 0 = съвпадат, 1 = разминаване, 2 = липсва таг за проверка (не е грешка сам по себе си).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readAddonVersion() {
  const text = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'config.yaml'), 'utf8');
  const match = text.match(/^version:\s*"?([0-9]+\.[0-9]+\.[0-9]+[^"\s]*)"?/m);
  if (!match) throw Error('config.yaml: липсва version');
  return match[1];
}

function readManifestVersion() {
  const file = path.join(ROOT, 'custom_components', 'hapi_enterprise', 'manifest.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

function normalizeTag(raw) {
  return String(raw || '').trim().replace(/^refs\/tags\//, '').replace(/^v/, '');
}

function check(tag) {
  const wanted = normalizeTag(tag);
  if (!wanted) return { ok: false, skipped: true, reason: 'няма таг за проверка' };
  const addon = readAddonVersion();
  const manifest = readManifestVersion();
  if (addon !== manifest) {
    return { ok: false, tag: wanted, addon, manifest, reason: `config.yaml е ${addon}, а manifest.json е ${manifest}` };
  }
  if (addon !== wanted) {
    return { ok: false, tag: wanted, addon, manifest, reason: `тагът е ${wanted}, а config.yaml е ${addon}` };
  }
  return { ok: true, tag: wanted, addon, manifest };
}

module.exports = { check, readAddonVersion, readManifestVersion, normalizeTag };

if (require.main === module) {
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
  const result = check(tag);
  if (result.skipped) {
    console.log('· няма таг — проверката е пропусната (пусни с `node scripts/check-tag-version.cjs vX.Y.Z`)');
    process.exitCode = 0;
  } else if (result.ok) {
    console.log(`✔ таг v${result.tag} съвпада с config.yaml и manifest.json`);
  } else {
    console.error('✘ ' + result.reason);
    console.error('  Тагът не се мести: вдигни версията с `node scripts/build-release.cjs --version X` и публикувай нов таг.');
    process.exitCode = 1;
  }
}
