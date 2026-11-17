'use strict';
// КАРТАТА „БУТОН → ИКОНА“ Е МАШИННА И ВСЯКА ИКОНА В НЕЯ СЪЩЕСТВУВА В СПРАЙТА.
//
// Защо има тест: картата се строи от `hierarchy.json` на пакета и ще движи бутоните в панела.
// Ако име в картата не съществува в спрайта, бутонът излиза празен — а това не се вижда от
// нито един друг тест (спрайтът е валиден, картата е валиден JSON, само връзката липсва).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'hapi_enterprise', 'ui');
const mapRaw = fs.readFileSync(path.join(dir, 'icons-v4-map.json'), 'utf8');
const sprite = fs.readFileSync(path.join(dir, 'icons-v4.svg'), 'utf8');

assert.equal(mapRaw.includes('\r'), false, 'картата е само с LF');
const map = JSON.parse(mapRaw);

// ── 1. Формата на картата ─────────────────────────────────────────────────
assert.equal(map.generatedFrom, 'hierarchy.json', 'картата казва откъде е генерирана');
assert.equal(map.style, 'standard', 'по подразбиране бутоните ползват стандартния стил');
const scopes = Object.keys(map.scopes || {});
assert.deepEqual(
  scopes,
  ['Портал', 'Папка', 'Файл', 'QR студио', 'Избор и състояния'],
  'петте скопа от йерархията (днес: ' + scopes.join(', ') + ')',
);

let groups = 0;
let buttons = 0;
const referenced = new Set();
for (const [scope, byGroup] of Object.entries(map.scopes)) {
  const names = Object.keys(byGroup);
  assert.ok(names.length >= 3, scope + ' има поне три групи (днес: ' + names.length + ')');
  for (const name of names) {
    const group = byGroup[name];
    groups += 1;
    assert.match(group.icon, /^[a-z0-9][a-z0-9-]*$/, scope + '/' + name + ' има икона на групата');
    referenced.add(group.icon);
    assert.ok(Array.isArray(group.items) && group.items.length, scope + '/' + name + ' има бутони');
    for (const item of group.items) {
      buttons += 1;
      assert.ok(item.label && typeof item.label === 'string', scope + '/' + name + ': всеки бутон има надпис');
      assert.match(item.icon, /^[a-z0-9][a-z0-9-]*$/, scope + '/' + name + ' → „' + item.label + '“ има икона');
      referenced.add(item.icon);
    }
  }
}
assert.ok(buttons >= 40, 'картата покрива поне 40 бутона (днес: ' + buttons + ')');

// ── 2. Всяка икона от картата съществува в спрайта ────────────────────────
for (const icon of referenced) {
  assert.match(
    sprite,
    new RegExp('<symbol id="' + icon + '--standard"'),
    'иконата „' + icon + '“ от картата липсва в спрайта — бутонът ще е празен',
  );
}
assert.deepEqual(
  [...referenced].sort(),
  map.iconsUsed,
  'списъкът iconsUsed е точно това, което картата ползва (иначе остарява тихо)',
);

console.log(
  'PASS icons-v4-map: ' + scopes.length + ' скопа · ' + groups + ' групи · ' + buttons + ' бутона · ' +
    map.iconsUsed.length + ' икони — всички съществуват в спрайта',
);
