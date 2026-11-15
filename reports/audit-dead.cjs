'use strict';
// 1) Кои опции от схемата НИКОЙ не чете (нито OPTION_ENV, нито optionText/optionValue).
// 2) Кои имена на функции са дефинирани в ПОВЕЧЕ от един модул на ui/ (дублиране/копие).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const yaml = fs.readFileSync(path.join(root, 'hapi_enterprise', 'config.yaml'), 'utf8');
const lines = yaml.split('\n');
const start = lines.findIndex((l) => /^schema:\s*$/.test(l));
const keys = [];
for (let i = start + 1; i < lines.length; i++) {
  if (/^[a-z_]+:/.test(lines[i])) break;
  const m = lines[i].match(/^ {2}([a-z_][a-z0-9_]*):/);
  if (m) keys.push(m[1]);
}

const serverFiles = fs.readdirSync(path.join(root, 'hapi_enterprise'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => path.join(root, 'hapi_enterprise', f))
  .concat(fs.readdirSync(path.join(root, 'hapi_enterprise', 'routes')).filter((f) => f.endsWith('.js'))
    .map((f) => path.join(root, 'hapi_enterprise', 'routes', f)));
const server = serverFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const read = (key) => {
  const env = key.split('_').map((p) => p.toUpperCase()).join('_');
  if (new RegExp('\\b' + env + '\\b').test(server)) return true;
  if (server.includes(`'${key}'`) || server.includes(`"${key}"`)) return true;
  return false;
};
const dead = keys.filter((k) => !read(k));

// Дублирани имена на функции между модулите на панела.
const uiDir = path.join(root, 'hapi_enterprise', 'ui');
const seen = new Map();
for (const file of fs.readdirSync(uiDir).filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(uiDir, file), 'utf8');
  for (const m of src.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (!seen.has(name)) seen.set(name, new Set());
    seen.get(name).add(file);
  }
}
const dupes = [...seen].filter(([, files]) => files.size > 1)
  .map(([name, files]) => name + ' (' + [...files].sort().join(', ') + ')');

console.log(JSON.stringify({ schemaKeys: keys.length, dead, deadCount: dead.length, duplicateFunctionNames: dupes.length, dupes }, null, 2));
