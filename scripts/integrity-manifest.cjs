'use strict';
// ГЕНЕРАТОР НА МАНИФЕСТА ЗА ЦЯЛОСТ (`hapi_enterprise/integrity-manifest.json`).
//
//   node scripts/integrity-manifest.cjs          → записва манифеста
//   node scripts/integrity-manifest.cjs --check  → само сверява (изход 1 при разминаване)
//
// Защо скрипт, а не ръчно писани хешове: хеш, който човек копира, остарява при първата
// поправка. Затова манифестът се строи от самото дърво и `--check` пада, когато някой е
// променил критичен файл, без да го отрази — тоест в изданието не влиза стар хеш.
const fs = require('node:fs');
const path = require('node:path');
const integrity = require('../hapi_enterprise/integrity');

const ROOT = path.join(__dirname, '..');
const ADDON = path.join(ROOT, 'hapi_enterprise');
const MANIFEST = path.join(ADDON, integrity.MANIFEST_NAME);
const readVersion = () => {
  const yaml = fs.readFileSync(path.join(ADDON, 'config.yaml'), 'utf8');
  const m = /^version:\s*"?([0-9.]+)"?/m.exec(yaml);
  return m ? m[1] : '';
};

function build() {
  const files = {};
  for (const rel of integrity.CRITICAL) {
    const file = path.join(ADDON, rel);
    if (!fs.existsSync(file)) throw new Error('липсва критичен файл: ' + rel + ' — манифестът не може да се строи');
    files[rel] = integrity.sha256(file);
  }
  return { version: readVersion(), generatedAt: new Date().toISOString(), files };
}

function main(argv) {
  const check = argv.includes('--check');
  const next = build();
  if (!check) {
    fs.writeFileSync(MANIFEST, JSON.stringify(next, null, 2) + '\n');
    console.log('integrity-manifest: записан ' + path.relative(ROOT, MANIFEST) + ' (' + Object.keys(next.files).length + ' файла, ' + next.version + ')');
    return 0;
  }
  const current = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { files: {} };
  const problems = [];
  for (const [rel, hash] of Object.entries(next.files)) {
    if (!(rel in current.files)) problems.push(rel + ' липсва в манифеста');
    else if (current.files[rel] !== hash) problems.push(rel + ' е променен след манифеста');
  }
  for (const rel of Object.keys(current.files)) if (!(rel in next.files)) problems.push(rel + ' вече не е критичен файл');
  if (current.version !== next.version) problems.push('версията в манифеста е ' + current.version + ', а в config.yaml — ' + next.version);
  if (problems.length) {
    console.error('integrity-manifest --check: ' + problems.join(' · '));
    console.error('поправка: node scripts/integrity-manifest.cjs');
    return 1;
  }
  console.log('integrity-manifest --check: ' + Object.keys(next.files).length + ' критични файла съвпадат (' + next.version + ')');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { build, MANIFEST, ROOT };
