'use strict';
// ПОВТОРЕНИЕ НА ЗАГЛАВЕН РЕД при нов лист (v2, план 18 §7).
//
// Защо: таблица, която продължава на втора страница, се чете наизуст, ако заглавията на
// колоните останат само на първата. Проблемът не се вижда в HTML — вижда се само в PDF-а,
// който е доказателственият изход. Затова проверката е върху САМИЯ PDF: разархивират се
// потоците и се брои колко пъти е нарисуван текстът на заглавието.
//
// Как се брои без познаване на шрифта: ToUnicode картата дава кой глиф кой символ е. Заглавието
// започва с „З“, което НЕ се среща в данните (те са цифри), тоест всеки `<hex> Tj`, който
// съдържа глифа на „З“, е нарисуван заглавен ред.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const M = require('../hapi_enterprise/report-manifest.js');
const R = require('../hapi_enterprise/report-render.js');
const W = require('../hapi_enterprise/pdf-writer.js');

const cases = [];
const ok = (label) => cases.push(label);

function inflateStreams(buf) {
  const parts = [];
  const S = Buffer.from('stream'), E = Buffer.from('endstream');
  let i = 0;
  while ((i = buf.indexOf(S, i)) !== -1) {
    let start = i + S.length;
    if (buf[start] === 0x0d) start += 1;
    if (buf[start] === 0x0a) start += 1;
    const end = buf.indexOf(E, start);
    if (end === -1) break;
    const slice = buf.subarray(start, end);
    try {
      parts.push(zlib.inflateSync(slice).toString('latin1'));
    } catch {
      parts.push(slice.toString('latin1'));
    }
    i = end + E.length;
  }
  return parts.join('\n');
}

/** Глифът (4 hex знака) за даден Unicode символ, според ToUnicode картата на PDF-а. */
function glyphFor(streams, char) {
  const wanted = char.codePointAt(0).toString(16).padStart(4, '0');
  const hit = /<([0-9a-f]{4})> <([0-9a-f]{4,8})>/g;
  let match;
  while ((match = hit.exec(streams)) !== null) {
    if (match[2] === wanted) return match[1];
  }
  return null;
}

/** Колко пъти е нарисуван текст, който съдържа този глиф (`<...> Tj`). */
function runsWithGlyph(streams, glyph) {
  const runs = [...streams.matchAll(/<([0-9a-f]+)>\s*Tj/g)].map((m) => m[1]);
  return runs.filter((run) => (run.match(/.{4}/g) || []).includes(glyph)).length;
}

const pagesOf = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

function manifest() {
  return M.normalize({
    schemaVersion: 1,
    profile: 'default',
    page: { format: 'A4', orientation: 'portrait', marginsMm: [15, 15, 15, 15] },
    blocks: [
      { id: 'start', type: 'rfc3161-start', locked: true },
      { id: 'tbl', type: 'table', source: 'records:1000', columns: ['Заглавие', 'Стойност'] },
      { id: 'stop', type: 'rfc3161-stop', locked: true },
    ],
  });
}

// ── 1. Дълга таблица: заглавието се повтаря на всеки нов лист ─────────────
const rows = Array.from({ length: 90 }, (_, i) => ['ред ' + (i + 1), String(i + 1)]);
const data = { 'records:1000': rows };
const items = R.toPdfBlocks(manifest(), { data });
const pdf = W.render(items, { title: 'Дълга таблица' });
const streams = inflateStreams(Buffer.from(pdf));
const glyph = glyphFor(streams, 'З');
assert.ok(glyph, 'глифът за „З“ е намерен в ToUnicode картата');
const pages = pagesOf(Buffer.from(pdf));
assert.ok(pages >= 2, 'таблицата минава на втори лист (иначе проверката е безсмислена), страници: ' + pages);
const headers = runsWithGlyph(streams, glyph);
assert.equal(headers, pages, 'заглавието е нарисувано веднъж на всяка страница: ' + headers + ' от ' + pages);
ok('дълга таблица (' + pages + ' страници): заглавието се повтаря на всяка страница');

// ── 2. Обратната посока: без `header` заглавието е само на първата ────────
// Същите блокове, но таблицата е обявена без заглавен ред — тогава повторение не бива да
// има, защото няма какво да се повтаря. Ако числата не се различават, тестът горе би минал
// и без новата логика.
const plainItems = items.map((b) => (b.type === 'table' ? Object.assign({}, b, { header: false }) : b));
const plainPdf = W.render(plainItems, { title: 'Дълга таблица' });
const plainStreams = inflateStreams(Buffer.from(plainPdf));
const plainGlyph = glyphFor(plainStreams, 'З');
const plainHeaders = runsWithGlyph(plainStreams, plainGlyph);
assert.equal(plainHeaders, 1, 'без заглавен ред текстът се появява само веднъж, получено: ' + plainHeaders);
assert.equal(pagesOf(Buffer.from(plainPdf)), pages, 'броят страници не се променя от повторението');
ok('без заглавен ред няма повторение — логиката не рисува заглавие „ей така“');

// ── 3. Къса таблица не получава излишно заглавие ─────────────────────────
const shortItems = R.toPdfBlocks(manifest(), { data: { 'records:1000': rows.slice(0, 3) } });
const shortPdf = W.render(shortItems, { title: 'Къса' });
const shortStreams = inflateStreams(Buffer.from(shortPdf));
const shortHeaders = runsWithGlyph(shortStreams, glyphFor(shortStreams, 'З'));
assert.equal(pagesOf(Buffer.from(shortPdf)), 1, 'късата таблица е на една страница');
assert.equal(shortHeaders, 1, 'и заглавието е точно веднъж');
ok('къса таблица: заглавието е веднъж, без излишно повторение');

console.log('PASS report-table-header-repeat: ' + cases.length + ' проверки — ' + cases.join('; '));
