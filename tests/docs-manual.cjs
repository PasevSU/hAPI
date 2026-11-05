'use strict';
// ПЪЛНОТО РЪКОВОДСТВО НЕ БИВА ДА ЛЪЖЕ (0.69.161).
//
// Дотук документацията имаше дупки, които никой не проверяваше: нови опции влизаха в
// `config.yaml` без нито едно изречение за тях, а таблиците в README-тата се местеха ръчно.
// Този тест пази три неща:
//   1. приложенията (опции + маршрути) са в синхрон с кода — пуска генератора с `--check`;
//   2. ВСЯКА опция от `config.yaml` се среща по име в ръководството;
//   3. всяка глава, на която индексът сочи, съществува.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'documentation', '09_COMPLETE_MANUAL');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── 1. Приложенията са в синхрон (същият генератор, който ги строи) ─────────
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'docs-manual.cjs'), '--check'], {
  stdio: 'pipe',
});

// ── 2. Всяка опция е спомената по име някъде в ръководството ───────────────
const cfg = read('hapi_enterprise/config.yaml').split('\n');
const start = cfg.indexOf('options:');
assert.ok(start >= 0, 'config.yaml: липсва блок options');
const options = [];
for (let i = start + 1; i < cfg.length; i++) {
  if (/^[A-Za-z_]/.test(cfg[i])) break;
  const m = /^ {2}([a-z0-9_]+):/.exec(cfg[i]);
  if (m) options.push(m[1]);
}
assert.ok(options.length >= 40, `очаквам поне 40 опции, намерих ${options.length}`);

const manual = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => fs.readFileSync(path.join(DIR, f), 'utf8'))
  .join('\n');
const missing = options.filter((o) => !manual.includes(o));
assert.deepEqual(missing, [], `опции без нито едно изречение в ръководството: ${missing.join(', ')}`);

// ── 3. Всяка глава от индекса съществува ───────────────────────────────────
const index = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
const links = [...index.matchAll(/\]\(([A-Z0-9][^)]*\.md)(?:#[^)]*)?\)/gi)].map((m) => m[1]);
assert.ok(links.length >= 8, `индексът трябва да сочи поне 8 файла, намери ${links.length}`);
const brokenLinks = links.filter((l) => !fs.existsSync(path.join(DIR, l)));
assert.deepEqual(brokenLinks, [], `индексът сочи липсващи файлове: ${brokenLinks.join(', ')}`);

// ── 4. Всяко приложение е непразно и с бройки ──────────────────────────────
for (const file of ['APPENDIX-A-OPTIONS.md', 'APPENDIX-B-API.md']) {
  const text = fs.readFileSync(path.join(DIR, file), 'utf8');
  assert.match(text, /Общо: \*\*\d+\*\*/, `${file} не съдържа ред „Общо: N“`);
  assert.ok(text.split('\n').length > 20, `${file} изглежда празен`);
}

console.log(
  `PASS docs-manual: ${options.length} опции описани · ${links.length} глави от индекса · ` +
  'приложенията в синхрон с кода',
);
