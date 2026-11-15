'use strict';
// Сверка на ВСЕКИ ключ от схемата на add-on-а с кода, който би го прочел.
// Option, който никъде не се споменава (нито като `process.env.X`, нито като низ), е
// „мъртва“ настройка в интерфейса на Supervisor: човек я сменя, а нищо не се променя.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const yaml = fs.readFileSync(path.join(root, 'hapi_enterprise', 'config.yaml'), 'utf8');
const lines = yaml.split('\n');
const start = lines.findIndex((l) => /^schema:\s*$/.test(l));
const keys = [];
for (let i = start + 1; i < lines.length; i++) {
  const line = lines[i];
  if (/^[a-z_]+:/.test(line)) break;
  const m = line.match(/^ {2}([a-z_][a-z0-9_]*):/);
  if (m) keys.push(m[1]);
}

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|cjs)$/.test(entry.name)) files.push(full);
  }
};
walk(path.join(root, 'hapi_enterprise'));
const code = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const envOf = (key) => key.split('_').map((p) => p.toUpperCase()).join('_');
const hits = {};
const dead = [];
for (const key of keys) {
  const env = envOf(key);
  const re = new RegExp('\\b' + env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
  const count = (code.match(re) || []).length;
  hits[key] = count;
  if (!count) dead.push(key);
}
const sorted = Object.entries(hits).sort((a, b) => a[1] - b[1]);
console.log(JSON.stringify({ schemaKeys: keys.length, dead, deadCount: dead.length, rarest: sorted.slice(0, 8) }, null, 2));
