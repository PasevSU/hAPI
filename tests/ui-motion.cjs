'use strict';
// ДВИЖЕНИЕТО Е ДОГОВОР: едни продължителности, евтини свойства, спокойно състояние.
//
// Защо има тест: анимация, която анимира `width`/`left`, кара браузъра да преизчислява
// подредбата на всяко кадро — на голяма таблица това е видимо забавяне. А анимация без
// `prefers-reduced-motion` е нечетима за хора, които изключват движението. Затова тук се пази:
//   1. продължителностите идват от `--dur-*`, кривите — от `--ease-*` (tokens.css);
//   2. ключовите кадри анимират САМО `transform`, `opacity`, `background-position`;
//   3. всеки индикатор (.spin/.think/.work/.bar/.skel/бутон „заето“) има спокойно състояние;
//   4. QR студиото показва работата с `aria-busy` и лента, без вграден стил.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = (name) => fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', name), 'utf8');
const tokens = ui('tokens.css');
const css = ui('components.css');
const qr = ui('qr-studio.js');

/** Тялото на първото правило за селектор (същият помощник като в другите UI тестове). */
const block = (source, selector) => {
  const at = source.indexOf('\n' + selector + ' {');
  assert.ok(at >= 0, 'липсва правилото ' + selector);
  const open = source.indexOf('{', at);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
};

// ── 1. Токените за движение са договорът ───────────────────────────────────
for (const [name, value] of [
  ['--dur-1', '140ms'],
  ['--dur-2', '260ms'],
  ['--dur-3', '520ms'],
]) {
  assert.match(tokens, new RegExp(name + ': ' + value + ';'), 'tokens.css трябва да има ' + name + ' = ' + value);
}
for (const name of ['--ease-out', '--ease-in-out']) {
  assert.match(tokens, new RegExp(name + ': cubic-bezier\\('), 'tokens.css трябва да има ' + name);
}

// ── 2. Ключовите кадри анимират САМО евтини свойства ───────────────────────
const motionAt = css.indexOf('@keyframes hapi-spin');
assert.ok(motionAt > 0, 'липсва секцията за движение');
const motion = css.slice(motionAt);
const names = [...motion.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].map((m) => m[1]);
for (const name of ['hapi-spin', 'hapi-dots', 'hapi-slide', 'hapi-shimmer']) {
  assert.ok(names.includes(name), 'липсват ключови кадри ' + name + ' (има: ' + names.join(', ') + ')');
}
const CHEAP = new Set(['transform', 'opacity', 'background-position']);
/** Тялото на ключовите кадри — по скоби, а не „до следващия @keyframes“ (последният няма следващ). */
const keyframesBody = (name) => {
  const start = motion.indexOf('@keyframes ' + name + ' {');
  assert.ok(start >= 0, 'липсват ключови кадри ' + name);
  const open = motion.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < motion.length; i += 1) {
    if (motion[i] === '{') depth += 1;
    else if (motion[i] === '}') {
      depth -= 1;
      if (depth === 0) return motion.slice(open, i + 1);
    }
  }
  throw new Error('незатворени ключови кадри ' + name);
};
for (const name of names) {
  const body = keyframesBody(name);
  for (const decl of [...body.matchAll(/\{\s*([^{}]*)\}/g)]) {
    for (const line of decl[1].split(';')) {
      const prop = (line.split(':')[0] || '').trim();
      if (!prop) continue;
      assert.ok(CHEAP.has(prop), '@keyframes ' + name + ' анимира „' + prop + '“ — позволени са само transform/opacity/background-position');
    }
  }
}

// ── 3. Примитивите ползват токените, не свои числа ────────────────────────
for (const [selector, keyframes] of [
  ['.spin', 'hapi-spin'],
  ['.think > i', 'hapi-dots'],
  ['.work', 'hapi-spin'],
  ['.bar > i', 'hapi-slide'],
  ['.skel', 'hapi-shimmer'],
  [".btn[aria-busy='true']::before", 'hapi-spin'],
]) {
  const body = block(motion, selector);
  assert.match(body, new RegExp('animation:\\s*' + keyframes), selector + ' се движи с ' + keyframes);
  const animation = (body.match(/animation:\s*([^;]+)/) || [])[1] || '';
  assert.match(animation, /var\(--dur-/, selector + ' взима продължителността от --dur-* (иначе ритъмът се разминава)');
  assert.equal(/\d+m?s\b/.test(animation), false, selector + ' не пише голо време: ' + animation);
}

// Изчакването на точките е стъпка между тях, не нова скорост.
assert.match(block(motion, '.think > i:nth-child(2)'), /animation-delay:\s*var\(--dur-1\);/, 'точките „мислене“ са раздалечени с токен');

// ── 4. Спокойно състояние за всички (prefers-reduced-motion) ───────────────
const reducedAt = motion.indexOf('@media (prefers-reduced-motion: reduce)');
assert.ok(reducedAt > 0, 'липсва блок prefers-reduced-motion');
const reduced = motion.slice(reducedAt, motion.indexOf('\n}\n', reducedAt) + 3);
for (const selector of ['.spin', '.work', ".btn[aria-busy='true']::before", '.think > i', '.bar > i', '.skel']) {
  assert.ok(reduced.includes(selector), 'prefers-reduced-motion трябва да спира ' + selector);
}
assert.match(reduced, /animation:\s*none;/, 'движението се изключва изрично');

// ── 5. Движението не заобикаля другите закони ─────────────────────────────
assert.equal(/!important/.test(motion), false, 'секцията за движение не ползва !important');
assert.equal(/animation:[^;]*\d+m?s[^;]*infinite/.test(motion.replace(/calc\([^)]*\)/g, '')), false, 'без голи времена в безкрайните цикли');

// ── 6. QR студиото показва работата си ────────────────────────────────────
assert.match(qr, /aria-busy="\$\{state\.busy \? 'true' : 'false'\}"/, 'бутонът обявява „заето“ с aria-busy');
assert.match(qr, /data-indeterminate role="status"/, 'докато чака, има лента с role=status');
assert.equal(/style="/.test(qr), false, 'никакъв вграден стил (CSP style-src self)');

console.log(
  'PASS ui-motion: три скорости от токени · само transform/opacity/background-position · спокойно състояние при reduced-motion · QR студиото обявява работата с aria-busy и лента',
);
