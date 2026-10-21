'use strict';
// Стабилност на интерфейса: всички използвани икони съществуват в спрайта.
//
// Проверява, че `ico('име')`, `icon: 'име'` и `window.HapiIcons.ico('име')` в ui/*.js
// сочат към реален символ в ui/icons.js. Така липсваща икона не се превръща в празно
// място в интерфейса (грешка, която се вижда само на око).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const uiDir = path.join(__dirname, '..', 'ui');
const iconsSrc = fs.readFileSync(path.join(uiDir, 'icons.js'), 'utf8');

// Символите се дефинират като ключове в обекта P: `  name: '<path .../>'`.
const block = iconsSrc.slice(iconsSrc.indexOf('const P = {'), iconsSrc.indexOf('let injected'));
const defined = new Set([...block.matchAll(/^\s{4}'?([a-zA-Z0-9-]+)'?:\s*'/gm)].map((m) => m[1]));
assert.ok(defined.size > 20, `спрайтът изглежда празен (${defined.size} икони)`);
for (const required of ['preview', 'download', 'lock', 'unlock', 'eye', 'eyeOff', 'gear', 'file', 'folder']) {
  assert.ok(defined.has(required), `липсва задължителната икона ${required}`);
}

// Само тези модули ползват SVG спрайта (останалите имат свои типографски глифове).
const MODULES = ['app.js', 'files-manager.js', 'portal-control.js', 'portal-folders.js', 'portal-files.js'];
const used = new Map(); // име → къде се ползва
for (const file of MODULES) {
  const src = fs.readFileSync(path.join(uiDir, file), 'utf8');
  // Имената в аргумента на ico(...) — включително тернарни изрази: ico(open ? 'a' : 'b').
  for (const call of src.matchAll(/\bico\(([^)]*)\)/g)) {
    for (const m of call[1].matchAll(/'([a-zA-Z0-9-]+)'/g)) used.set(m[1], file);
  }
  for (const re of [/\bico:\s*'([a-zA-Z0-9-]+)'/g, /\bicon:\s*'([a-zA-Z0-9-]+)'/g]) {
    for (const m of src.matchAll(re)) used.set(m[1], file);
  }
}
assert.ok(used.size > 20, `намерени са само ${used.size} имена на икони`);

const missing = [...used].filter(([name]) => !defined.has(name));
assert.deepEqual(missing, [], `икони без символ в спрайта: ${JSON.stringify(missing)}`);

// Всяка икона се ползва някъде (без резервната `dot`, която е при непознато име).
const unused = [...defined].filter((name) => name !== 'dot' && !used.has(name));
assert.deepEqual(unused, [], `неизползвани икони (мъртъв код в спрайта): ${unused.join(', ')}`);

// Спрайтът е изцяло локален (xmlns е само име на пространство, не адрес за сваляне),
// а цветът/размерът идват от CSS (currentColor + 1em).
assert.equal(/<image|xlink:href|href="https?:|url\(https?:/.test(iconsSrc), false, 'спрайтът е изцяло локален');
const css = fs.readFileSync(path.join(uiDir, 'styles.css'), 'utf8');
assert.match(css, /\.ui-ico \{[\s\S]*?stroke: currentColor;/, 'иконите наследяват цвета на текста');
assert.match(css, /\.ui-ico \{[\s\S]*?width: 1\.05em; height: 1\.05em;/, 'иконите се оразмеряват спрямо шрифта');

console.log(`PASS ui-icons: ${defined.size} икони — всички дефинирани и използвани`);
