'use strict';
// ПРОЗОРЦИТЕ СЕ МЕРИ В ПРОЦЕНТИ ОТ ЕКРАНА, С ТОЧЕН ОТСТЪП ОТ РЪБА.
//
// Защо има тест: досега QR прозорецът беше `760px` ширина и `900px` таван на височината, а
// панелът на опциите — `42%` с друг таван. На 1366×768 „760px“ е половината екран, на 4K — една
// четвърт; едно и също число значи различно нещо. Правилото (вж. план 26) е: ширина и височина
// в `vw`/`vh`, отстъп `--dlg-gap` от всеки ръб, а съдържанието се побира цялото или скролва в
// тялото — главата и кракът остават видими.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = (name) => fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', name), 'utf8');
const tokens = ui('tokens.css');
const css = ui('components.css');
const qr = ui('qr-studio.js');

const block = (source, selector) => {
  const at = source.indexOf('\n' + selector + ' {');
  assert.ok(at >= 0, 'липсва правилото ' + selector);
  const open = source.indexOf('{', at);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
};

// ── 1. Токените: скала в проценти + точен отстъп ───────────────────────────
for (const [name, value] of [
  ['--dlg-gap', '6vh'],
  ['--dlg-w-sm', '38vw'],
  ['--dlg-w-md', '56vw'],
  ['--dlg-w-lg', '74vw'],
  ['--dlg-w-full', '92vw'],
]) {
  assert.match(tokens, new RegExp(name + ': ' + value + ';'), 'tokens.css трябва да има ' + name + ' = ' + value);
}
assert.ok(
  tokens.indexOf('--dlg-w-sm') < tokens.indexOf('--dlg-w-md') &&
    tokens.indexOf('--dlg-w-md') < tokens.indexOf('--dlg-w-lg') &&
    tokens.indexOf('--dlg-w-lg') < tokens.indexOf('--dlg-w-full'),
  'скалата расте: sm < md < lg < full',
);

// ── 2. Общият прозорец: проценти, отстъп, скрол само в тялото ──────────────
const dialog = block(css, '.dialog');
assert.match(dialog, /width: clamp\(22em, var\(--dlg-w-md\), calc\(100vw - 2 \* var\(--dlg-gap\)\)\);/, '.dialog мери в vw с долна граница за четене и отстъп от ръба');
assert.match(dialog, /max-height: calc\(100vh - 2 \* var\(--dlg-gap\)\);/, '.dialog не закрива екрана по височина');
assert.match(dialog, /display: flex;/, '.dialog е колона (глава · тяло · крак)');
assert.match(dialog, /flex-direction: column;/, '.dialog подрежда вертикално');
assert.match(css, /\.dialog > \.dialog-body \{\s*overflow: auto;/, 'само тялото скролва');
assert.match(css, /\.dialog > \.dialog-head,\s*\n\.dialog > \.dialog-foot \{\s*position: sticky;/, 'главата и кракът остават видими');
assert.match(block(css, '.dialog.dialog-full'), /max-height: 92vh;/, 'пълният режим пак оставя 8% от екрана');

// ── 3. QR прозорецът мина на скалата (без старите px тавани) ───────────────
const qs = block(css, '.qs-window');
assert.match(qs, /var\(--dlg-w-lg\)/, 'QR прозорецът ползва голямата стъпка от скалата');
assert.match(qs, /calc\(100vw - 2 \* var\(--dlg-gap\)\)/, 'QR прозорецът пази отстъп от ръба');
assert.match(qs, /max-height: calc\(100vh - 2 \* var\(--dlg-gap\)\);/, 'QR прозорецът не закрива екрана');
assert.equal(/760px|900px/.test(qs), false, 'старите px тавани са махнати');
assert.match(qr, /class="qs-window dialog dialog-lg"/, 'маркъпът носи класа на скалата');

console.log(
  'PASS ui-dialog-size: ширини 38/56/74/92% от екрана · --dlg-gap отстъп · само тялото скролва · QR прозорецът е на голямата стъпка',
);
