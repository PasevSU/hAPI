'use strict';
// Договор между публичния API и OpenAPI спецификацията.
//
// `api-spec.js` е обещанието към външните клиенти; `server.js` е истината. Ако някой
// добави публичен маршрут и забрави спецификацията (или махне път от нея), клиентите
// научават за промяната от 404. Тестът затваря точно тази дупка:
//   1. всеки JSON маршрут от публичния блок на портала трябва да е описан в OpenAPI;
//   2. спецификацията не бива да описва административни пътища (изтичане на повърхност);
//   3. описанието носи двете схеми за достъп (ключ на портал и ключ на файл).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const spec = require(path.join(ROOT, 'hapi_enterprise', 'api-spec.js'));
const serverSrc = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'server.js'), 'utf8');

// Пътища, които съзнателно НЕ са в OpenAPI: не са JSON API и не се ползват от
// външен клиент, който чете спецификацията.
const NOT_IN_SPEC = {
  'qr.svg': 'връща SVG картинка за печат/скан, не JSON — описан е в README, не в схемата',
  qr: 'legacy 301 към qr.svg (съвместимост с линкове от преди 0.55)',
  'tree/qr.svg': 'SVG картинка за папката — същата причина като qr.svg',
};

// Изважда публичния блок на портала: от `parts[2] === 'p'` до следващия top-level
// маршрут (`parts[0] === '...'` на нов ред).
function publicBlock(src) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /parts\[0\]\s*===\s*'api'\s*&&\s*parts\[1\]\s*===\s*'v1'\s*&&\s*parts\[2\]\s*===\s*'p'/.test(l));
  assert.ok(start >= 0, 'намирам публичния блок на портала в server.js');
  const out = [];
  for (let i = start; i < lines.length; i++) {
    if (i > start && /parts\[0\]\s*===\s*'/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

const block = publicBlock(serverSrc);

// tail[0] === 'x' → подмаршрут след /api/v1/p/<slug>/
const segments = new Set();
for (const m of block.matchAll(/tail\[0\]\s*===\s*'([^']+)'/g)) segments.add(m[1]);
// tail[2] === 'download' → /files/<id>/download
const nested = new Set();
for (const m of block.matchAll(/tail\[(\d)\]\s*===\s*'([^']+)'/g)) if (m[1] !== '0') nested.add(m[2]);

// Долната граница на договора: базовият път винаги съществува.
assert.ok(segments.size >= 5, 'публичният блок има поне 5 подмаршрута (намерени: ' + [...segments].join(', ') + ')');

const openapi = spec.buildOpenApi({ id: 'p1', slug: 'demo', title: 'Demo' }, { baseUrl: 'https://hapi.example.bg' });
const paths = Object.keys(openapi.paths);
const base = '/api/v1/p/demo';

const expected = new Set([base]);
for (const seg of segments) {
  if (NOT_IN_SPEC[seg]) continue;
  expected.add(base + '/' + seg);
}
if (nested.has('download')) expected.add(base + '/files/{fileId}/download');
// Подпът на дървото: готовата API карта за папка.
if (/tail\[1\]\s*===\s*'api\.json'/.test(block)) expected.add(base + '/tree/api.json');
// Единичен файл по id (ако блокът го обслужва по път, не само като download).
if (/tail\[0\]\s*===\s*'files'/.test(block)) expected.add(base + '/files/{fileId}');

const missing = [...expected].filter((p) => !paths.includes(p));
assert.deepEqual(missing, [], 'OpenAPI описва всички публични маршрути; липсват: ' + missing.join(', '));

// Обратната посока: нищо извън /api/v1/p/<slug>/ не бива да влиза в публичната схема.
for (const p of paths) {
  assert.ok(p.startsWith(base), `спецификацията описва само публичния портал, намерено: ${p}`);
  assert.equal(/\/admin|internal|\/users|\/secrets|\/sends/.test(p), false, `в схемата не влиза административен път: ${p}`);
}

// Схемите за достъп са част от договора: без тях клиентът не знае как се удостоверява.
const schemes = Object.keys(openapi.components.securitySchemes || {});
assert.ok(schemes.includes('portalKey'), 'има схема portalKey');
assert.ok(schemes.includes('fileKey'), 'има схема fileKey');
assert.equal(openapi.openapi, '3.1.0', 'версията на спецификацията е 3.1.0');
assert.ok(openapi.info && openapi.info.title, 'спецификацията има заглавие');

// Всеки описан път има поне една операция — иначе е обещание без съдържание.
for (const [p, ops] of Object.entries(openapi.paths)) {
  const methods = Object.keys(ops).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m));
  assert.ok(methods.length >= 1, `пътят ${p} има поне една операция`);
}

const skipped = [...segments].filter((s) => NOT_IN_SPEC[s]);
console.log(
  `PASS api-spec-coverage: ${paths.length} пътя в OpenAPI · ${expected.size} публични маршрута проверени · ` +
  `${skipped.length} извън схемата (${skipped.join(', ') || '—'}) · схеми: ${schemes.join(', ')}`,
);
