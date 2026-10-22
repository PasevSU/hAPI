'use strict';
// ПАКЕТ С ДОКАЗАТЕЛСТВА (W7) — СТАТУСЪТ НЕ СЕ ЗАКРЪГЛЯ НАГОРЕ.
//
// Правилата, които този тест пази:
//   • READY само когато има START и STOP токени (и подпис, ако е поискан);
//   • INCOMPLETE изрежда какво липсва — диагностичен пакет, не „готов“;
//   • DRAFT е чернова и не се подпечатва;
//   • ZIP-ът съдържа PDF, манифеста, evidence.json и суми, които се проверяват;
//   • живият маршрут връща статуса в заглавка, а без токен — 401.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const ooxml = require('../hapi_enterprise/ooxml');
const reportPackage = require('../hapi_enterprise/report-package');
const manifests = require('../hapi_enterprise/report-manifest');

const pdf = Buffer.from('%PDF-1.7\n% тестов отчет\n%%EOF\n', 'latin1');
const manifest = manifests.normalize(manifests.template('default'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const token = (label) => ({ token: { sha256: sha256(Buffer.from(label)), genTime: '2026-10-23T00:00:00Z' }, tokenDer: Buffer.from('TSR-' + label), url: 'https://tsa.example/' });

// ── 1. Класификация: READY / INCOMPLETE / DRAFT ─────────────────────────────
assert.equal(reportPackage.classify({ draft: true }).status, 'DRAFT', 'черновата е DRAFT');
const incomplete = reportPackage.classify({ draft: false, stamps: null, cms: null });
assert.equal(incomplete.status, 'INCOMPLETE', 'без токени пакетът НЕ е завършен');
assert.deepEqual(incomplete.missing, ['START токен (RFC 3161)', 'STOP токен (RFC 3161)'], 'липсите са изброени');
const halfDone = reportPackage.classify({ stamps: { start: token('start'), stop: { token: null } } });
assert.equal(halfDone.status, 'INCOMPLETE', 'само START не стига');
assert.deepEqual(halfDone.missing, ['STOP токен (RFC 3161)'], 'липсва само STOP');
const signedMissing = reportPackage.classify({ stamps: { start: token('s'), stop: token('e') }, cms: { requested: true, p7s: null } });
assert.equal(signedMissing.status, 'INCOMPLETE', 'поискан, но липсващ подпис също е липса');
const ready = reportPackage.classify({ stamps: { start: token('s'), stop: token('e') }, cms: { requested: true, p7s: Buffer.from('CMS') } });
assert.equal(ready.status, 'READY', 'START + STOP + подпис = READY');
assert.deepEqual(ready.missing, [], 'READY няма липси');

// ── 2. Съдържание на ZIP-а и суми ──────────────────────────────────────────
const built = reportPackage.build({ manifest, pdf, stamps: { start: token('start'), stop: token('stop'), closingDigest: 'a'.repeat(64) }, cms: { requested: true, p7s: Buffer.from('CMS-BYTES') }, draft: false, createdAt: '2026-10-23T10:00:00.000Z' });
assert.equal(built.evidence.status, 'READY');
assert.match(built.name, /^report-[A-Za-z0-9._-]+-READY-20261023-100000\.zip$/, 'името носи профил, статус и време: ' + built.name);
const entries = ooxml.unzip(built.zip);
const read = (map, name) => map.get(name)();
for (const name of ['report.pdf', 'manifest.json', 'evidence.json', 'tsa/start.tsr', 'tsa/stop.tsr', 'signature.p7s', 'SHA256SUMS.txt']) {
  assert.ok(entries.has(name), 'пакетът съдържа ' + name);
}
assert.deepEqual(read(entries, 'report.pdf'), pdf, 'PDF-ът е същият байт по байт');
const evidence = JSON.parse(read(entries, 'evidence.json').toString('utf8'));
assert.equal(evidence.format, 'hapi-evidence-v1');
assert.equal(evidence.status, 'READY');
assert.equal(evidence.pdfSha256, sha256(pdf), 'отпечатъкът на PDF-а е верен');
assert.equal(evidence.manifestSha256, manifests.digest(manifest), 'отпечатъкът на манифеста е верен');
assert.equal(evidence.tsa.start.sha256, sha256(Buffer.from('start')), 'START токенът е описан');
// Сумите трябва наистина да пасват — иначе SHA256SUMS.txt е декорация.
const sums = read(entries, 'SHA256SUMS.txt').toString('utf8').trim().split('\n');
assert.equal(sums.length, entries.size - 1, 'по една сума за всеки файл без самите суми');
for (const line of sums) {
  const [hash, name] = line.split(/\s+/);
  assert.equal(hash, sha256(read(entries, name)), 'сумата пасва за ' + name);
}

// ── 3. Живият маршрут: 401 без токен, DRAFT и INCOMPLETE със статус в заглавка ─
(async () => {
  const server = await startServer({});
  try {
    const URL = '/admin/api/v2/reports/package';
    const anon = await fetch(server.base + URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manifest }) });
    assert.equal(anon.status, 401, 'без токен пакетът не се дава');

    const draftRes = await fetch(server.base + URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + server.token },
      body: JSON.stringify({ manifest, draft: true }),
    });
    assert.equal(draftRes.status, 201, 'черновата се създава');
    assert.equal(draftRes.headers.get('x-evidence-status'), 'DRAFT', 'статусът е в заглавка');
    const draftZip = Buffer.from(await draftRes.arrayBuffer());
    const draftEntries = ooxml.unzip(draftZip);
    assert.ok(draftEntries.has('evidence.json'), 'пакетът носи evidence.json');
    assert.equal(draftEntries.has('tsa/start.tsr'), false, 'черновата не носи TSA токени');

    const plainRes = await fetch(server.base + URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + server.token },
      body: JSON.stringify({ manifest }),
    });
    assert.equal(plainRes.status, 201);
    assert.equal(plainRes.headers.get('x-evidence-status'), 'INCOMPLETE', 'без TSA пакетът е INCOMPLETE');
    const missingHeader = decodeURIComponent(plainRes.headers.get('x-evidence-missing') || '');
    assert.match(missingHeader, /START токен/, 'липсата е изброена в заглавка (URL-кодирана, защото HTTP е Latin-1)');
    const plainEntries = ooxml.unzip(Buffer.from(await plainRes.arrayBuffer()));
    const plainRead = (name) => plainEntries.get(name)();
    const plainEvidence = JSON.parse(plainRead('evidence.json').toString('utf8'));
    assert.equal(plainEvidence.status, 'INCOMPLETE');
    assert.ok(plainEvidence.missing.length >= 2, 'evidence.json изрежда липсите');
    // Статусът е авторитетен в evidence.json. PDF-ът се рисува с вграден шрифт, затова
    // текстът не се търси буквално; проверява се, че статусът РЕАЛНО стига до рендера —
    // PDF-ът на незеления пакет е различен от този на черновата (различен воден знак).
    const plainPdf = plainRead('report.pdf');
    const draftPdf = draftEntries.get('report.pdf')();
    assert.ok(plainPdf.length > 0 && plainPdf.subarray(0, 5).toString('latin1') === '%PDF-', 'PDF-ът е валиден');
    assert.notDeepEqual(plainPdf, draftPdf, 'различният статус дава различен воден знак в PDF-а');

    console.log(
      'PASS report-package: READY само с START+STOP · INCOMPLETE изрежда липсите · DRAFT е чернова · ZIP с evidence.json и верни суми · 401 без токен',
    );
  } finally {
    await server.stop().catch(() => { });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
