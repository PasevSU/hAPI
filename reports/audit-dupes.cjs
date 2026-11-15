'use strict';
// Кои едноименни функции в ui/ са ЕДНАКВИ по тяло (копие), а не просто съвпадение на име.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const uiDir = path.join(root, 'hapi_enterprise', 'ui');

const bodies = new Map();
for (const file of fs.readdirSync(uiDir).filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(uiDir, file), 'utf8');
  const re = /(?:^|\n)(\s*)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[2];
    // Грубо тяло: от `{` до съответната затваряща скоба по баланс.
    let i = src.indexOf('{', m.index + m[0].length - 1);
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (!depth) break; }
    }
    const body = src.slice(i, j + 1).replace(/\s+/g, ' ').trim();
    if (!bodies.has(name)) bodies.set(name, []);
    bodies.get(name).push({ file, body });
  }
}
const identical = [];
for (const [name, list] of bodies) {
  if (list.length < 2) continue;
  const byBody = new Map();
  for (const item of list) {
    if (!byBody.has(item.body)) byBody.set(item.body, []);
    byBody.get(item.body).push(item.file);
  }
  for (const [, files] of byBody) {
    if (files.length > 1) identical.push(`${name}: ${files.sort().join(' = ')} (${list[0].body.length} знака)`);
  }
}
console.log(JSON.stringify({ identicalCount: identical.length, identical }, null, 2));
