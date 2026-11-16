'use strict';
// НИКАКЪВ ВГРАДЕН СТИЛ В ПАНЕЛА И В ПОРТАЛА (DEF-62, 0.69.218).
//
// Защо има тест: панелът се сервира с `Content-Security-Policy: style-src 'self'`
// (`server.js`, страницата на интерфейса) — тоест `style="…"` в генерирания HTML се
// БЛОКИРА. Живата конзола на потребителя в Home Assistant (ingress) показа точно това при
// качване: `Applying inline style violates the following Content Security Policy directive
// 'style-src 'self'` на `upload-progress.js:133/219`. Последицата не е козметична —
// `<span style="width:42%">` е лентата на напредъка: блокирана, тя остава празна през целия
// трансфер, тоест „реален напредък“ няма. Същото чакаше и прегледа на отчет (лого
// `max-height`, колони `flex:1`), но там никой не го видя, защото няма конзола.
//
// Правилото, което тестът пази:
//   • в `ui/*.js` и `portal/*.js` (и интеграционното им копие) НЯМА `style="…"`,
//     `setAttribute('style', …)`, `.cssText =` и инжектиран `<style>` — всичко статично
//     живее в `.css` файл, а динамичното минава през атрибут на елемента (`<progress value>`)
//     или през CSSOM (`el.style.width = …`, което CSP НЕ блокира — то не е style атрибут);
//   • CSP-то на панела остава `style-src 'self'`: ако някой „поправи“ проблема с
//     `'unsafe-inline'`, тестът пада — това би изключило защитата вместо да я спази.
//
// Изключенията са СЪЩИНСКИ различни повърхности с изрично разрешен вграден стил и се
// проверяват за това разрешение; извън тях няма изключения.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ── 1. Повърхности с `style-src 'self'`: вграденият стил е забранен ─────────
const dirs = [
  path.join(root, 'hapi_enterprise', 'ui'),
  path.join(root, 'hapi_enterprise', 'portal'),
  path.join(root, 'custom_components', 'hapi_enterprise'),
];
const files = [];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    files.push(path.join(dir, entry.name));
  }
}
assert.ok(files.length >= 30, 'очакваха се поне 30 файла на панела и портала, намерени ' + files.length);

/** Какво точно е забранено — всяко от тях е „вграден стил“ по смисъла на CSP. */
const BANNED = [
  { re: /\sstyle\s*=\s*["'`]/g, what: 'атрибут style="…"' },
  { re: /setAttribute\(\s*['"]style['"]/g, what: "setAttribute('style', …)" },
  { re: /\.cssText\s*=/g, what: '.cssText = …' },
  { re: /<style[\s>]/g, what: 'инжектиран <style>' },
];

const offenders = [];
// Коментарите се махат: те говорят ЗА забраната (включително с пример как изглежда
// нарушението) и не се изпълняват от браузъра.
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
for (const file of files) {
  const text = stripComments(fs.readFileSync(file, 'utf8'));
  const rel = path.relative(root, file);
  for (const rule of BANNED) {
    const hits = [...text.matchAll(rule.re)];
    if (!hits.length) continue;
    const line = text.slice(0, hits[0].index).split('\n').length;
    offenders.push(`${rel}:${line} — ${rule.what}`);
  }
}
assert.deepEqual(
  offenders,
  [],
  'вграденият стил се блокира от `style-src \'self\'` и лентата/оформлението остават празни; ' +
    'сложи го в .css файл или го дай като атрибут (напр. <progress value>):\n  ' + offenders.join('\n  '),
);

// ── 2. CSP-то на панела НЕ се разширява, за да „мине“ тестът ────────────────
const server = read(path.join('hapi_enterprise', 'server.js'));
const panelCsp = /'Content-Security-Policy':\s*"default-src 'none'; style-src ([^;"]+);/.exec(server);
assert.ok(panelCsp, 'страницата на панела трябва да носи Content-Security-Policy с style-src');
assert.equal(panelCsp[1].trim(), "'self'", 'style-src на панела остава \'self\' — иначе защитата се изключва, вместо да се спази');

// ── 2б. Забраненият вграден стил е ЗАМЕНЕН със стил от файла, не просто махнат ──
// Лентата и логото изглеждат както преди, защото правилата са в `components.css`; иначе
// „поправката“ би била да изчезне оформлението, а не да се премести.
const css = read(path.join('hapi_enterprise', 'ui', 'components.css'));
for (const selector of ['.up-bar-progress', '.up-bar-progress::-webkit-progress-value', '.up-bar-progress::-moz-progress-bar', '.pv-logo img', '.pv-cols']) {
  assert.ok(css.includes(selector + ' {'), 'липсва правилото ' + selector + ' в components.css');
}

// ── 3. Изключенията имат изрично разрешение, не обещание ────────────────────
// SVG-ите (QR код, миниатюри) се сервират с `style-src 'unsafe-inline'` — там вграденият
// стил Е разрешен и е част от формата на самия SVG.
const svgCsp = [...server.matchAll(/Content-Security-Policy':\s*"default-src 'none'; style-src 'unsafe-inline'/g)];
assert.ok(svgCsp.length >= 3, 'SVG отговорите трябва да носят style-src \'unsafe-inline\' (намерени ' + svgCsp.length + ')');
const qr = read(path.join('hapi_enterprise', 'qrcode.js'));
assert.match(qr, /<table style="/, 'QR кодът рисува с вграден стил — това е позволено само защото SVG-то носи unsafe-inline');

// Страниците, които НЕ са панелът (тайна връзка, споделен файл, печат на QR), имат собствен
// CSP с `style-src 'unsafe-inline'` — проверява се, че не са го загубили.
for (const [name, csp] of [
  ['SECRET_CSP', /const SECRET_CSP = "default-src 'none'; style-src 'unsafe-inline'/],
  ['SEND_CSP', /const SEND_CSP = "default-src 'none'; style-src 'unsafe-inline'/],
]) {
  assert.match(server, csp, name + ' трябва да позволява вградения стил на своята страница');
}

console.log(
  `PASS ui-inline-style-csp: ${files.length} файла без вграден стил · style-src на панела е 'self' · ` +
    'SVG/тайна/споделен файл със своя unsafe-inline',
);
