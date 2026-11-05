'use strict';
// СРАВНЯВА ЖИВИТЕ ОПЦИИ НА ADD-ON-А С defaults В `config.yaml` — БЕЗ ДА ПЕЧАТА ТАЙНИ.
//
// Защо: издание, което при инсталация показва празни/чужди стойности, стартира по начин,
// който не е изпитан. Затова defaults трябва да съвпадат с реалното разпределение, а
// тайните (token/пароли/ключове) да останат празни и да се задават от човека.
//
//   node scripts/compare-live-options.cjs "$env:TEMP\hapi-info.json"
const fs = require('node:fs');
const path = require('node:path');

const SECRET = /token|password|secret|_key$|_pass$|^pgp_key_pass$|^pgp_path_pass$/i;
const infoPath = process.argv[2];
if (!infoPath) {
  console.error('употреба: node scripts/compare-live-options.cjs <hapi-info.json>');
  process.exit(2);
}

const raw = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
// `ha apps info --raw-json` връща { result, data }, а опциите са в `data.options` —
// без това разгъване сравнението вижда 0 живи опции и мълчаливо „минава“.
const info = raw.data && raw.data.options ? raw.data : raw;
const live = info.options || {};
const cfg = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'config.yaml'), 'utf8');

// Минимален четец на блока `options:` (двустепенна YAML карта, без вложени структури).
function optionsBlock(text) {
  const lines = text.split('\n');
  const start = lines.indexOf('options:');
  if (start < 0) throw new Error('config.yaml: липсва блок options');
  const out = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[A-Za-z_]/.test(line)) break;
    const m = /^ {2}([a-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^-?\d+$/.test(value)) value = Number(value);
    out[m[1]] = value;
  }
  return out;
}

const repo = optionsBlock(cfg);
const rows = [];
const onlyLive = [];
const onlyRepo = [];
for (const key of Object.keys(live).sort()) {
  if (!(key in repo)) { onlyLive.push(key); continue; }
  const same = JSON.stringify(live[key]) === JSON.stringify(repo[key]);
  rows.push({ key, live: SECRET.test(key) ? '<скрито>' : live[key], repo: SECRET.test(key) ? '<скрито>' : repo[key], same });
}
for (const key of Object.keys(repo).sort()) if (!(key in live)) onlyRepo.push(key);

const diff = rows.filter((r) => !r.same);
const printable = diff.filter((r) => r.live !== '<скрито>');

console.log(`Живи опции: ${Object.keys(live).length} · в config.yaml: ${Object.keys(repo).length}`);
console.log(`Съвпадат: ${rows.length - diff.length} · различават се: ${diff.length}`);
if (onlyLive.length) console.log('Само в живото: ' + onlyLive.join(', '));
if (onlyRepo.length) console.log('Само в config.yaml: ' + onlyRepo.join(', '));
if (printable.length) {
  console.log('');
  console.log('| опция | живо | config.yaml |');
  console.log('| --- | --- | --- |');
  for (const r of printable) {
    console.log(`| ${r.key} | ${JSON.stringify(r.live)} | ${JSON.stringify(r.repo)} |`);
  }
}
const secretDiff = diff.filter((r) => r.live === '<скрито>');
if (secretDiff.length) {
  console.log('');
  console.log('Тайни, които се различават (не се показват): ' + secretDiff.map((r) => r.key).join(', '));
  console.log('Това е ОЧАКВАНО: defaults не носят тайни — те се задават от човека след инсталация.');
}
// Провал само за РЕАЛНИ разминавания: тайна, която е празна в репото, не е дефект.
process.exit(printable.length || onlyLive.length ? 1 : 0);
