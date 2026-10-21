'use strict';
// Фаза 11 / RS-01: валидатор на report-manifest (без сървър, чист unit тест).
const assert = require('node:assert/strict');
const M = require('../hapi_enterprise/report-manifest.js');

const codes = (result) => result.errors.map((e) => e.code);
const has = (result, code) => codes(result).includes(code);

// 1. Шаблонът е валиден.
let r = M.check(M.template('forensic-full'));
assert.equal(r.ok, true, JSON.stringify(r.errors));
assert.deepEqual(r.manifest.blocks.map((b) => b.type), ['rfc3161-start', 'rfc3161-stop']);
assert.equal(r.manifest.page.format, 'A4');
assert.equal(r.manifest.schemaVersion, 1);

// 2. Пълен отчет с таблица и хеш таблица.
const full = M.template('forensic-full');
full.blocks.splice(1, 0,
  { id: 't1', type: 'table', source: 'records:1000', columns: ['name', 'adresse', 'telefon'] },
  { id: 'h1', type: 'hash-table', algorithms: ['CRC32', 'SHA256', 'sha512'] },
  { id: 's1', type: 'signature', label: 'Подпис' });
r = M.check(full);
assert.equal(r.ok, true, JSON.stringify(r.errors));

// 3. Липсващи/незаключени граници.
assert.equal(has(M.validate({ ...M.template(), blocks: [] }), 'INVALID_BLOCKS'), true);
assert.equal(has(M.validate({ ...M.template(), blocks: [{ id: 'stop', type: M.STOP, locked: true }] }), 'INVALID_BLOCKS'), true);
const noStart = M.template();
noStart.blocks[0] = { id: 'b1', type: 'text' };
assert.equal(has(M.validate(noStart), 'START_NOT_FIRST'), true);
assert.equal(has(M.validate(noStart), 'MISSING_START'), true);

const unlocked = M.template();
unlocked.blocks[0].locked = false;
assert.equal(has(M.validate(unlocked), 'START_NOT_LOCKED'), true);

const stopUnlocked = M.template();
stopUnlocked.blocks[1].locked = false;
assert.equal(has(M.validate(stopUnlocked), 'STOP_NOT_LOCKED'), true);

// 4. Системен блок по средата се отхвърля.
const middle = M.template();
middle.blocks.splice(1, 0, { id: 'x', type: M.START, locked: true });
assert.equal(has(M.validate(middle), 'SYSTEM_BLOCK_IN_MIDDLE'), true);

// 5. Дубликати и невалидни id / типове.
const dup = M.template();
dup.blocks.splice(1, 0, { id: 'start', type: 'text' });
assert.equal(has(M.validate(dup), 'DUPLICATE_BLOCK_ID'), true);

const badId = M.template();
badId.blocks.splice(1, 0, { id: 'Bad ID!', type: 'text' });
assert.equal(has(M.validate(badId), 'INVALID_BLOCK_ID'), true);

const badType = M.template();
badType.blocks.splice(1, 0, { id: 'b1', type: 'iframe' });
assert.equal(has(M.validate(badType), 'UNKNOWN_BLOCK_TYPE'), true);

// 6. Таблица: източник и колони.
const badSource = M.template();
badSource.blocks.splice(1, 0, { id: 't1', type: 'table', source: '../../etc', columns: ['a'] });
assert.equal(has(M.validate(badSource), 'INVALID_TABLE_SOURCE'), true);

const badCols = M.template();
badCols.blocks.splice(1, 0, { id: 't1', type: 'table', source: 'records:1000', columns: [] });
assert.equal(has(M.validate(badCols), 'INVALID_TABLE_COLUMNS'), true);

// 7. Хеш алгоритми.
const badAlg = M.template();
badAlg.blocks.splice(1, 0, { id: 'h1', type: 'hash-table', algorithms: ['SHA3', 'SHA256'] });
assert.equal(has(M.validate(badAlg), 'UNKNOWN_ALGORITHM'), true);

// 8. Никакви издадени TSA/подпис стойности в манифеста (вкл. вложени).
const fake = M.template();
fake.blocks[1].tsaToken = 'MIIB...fake';
assert.equal(has(M.validate(fake), 'FORBIDDEN_FIELD'), true);

const nested = M.template();
nested.print.certificate = { pem: '-----BEGIN CERTIFICATE-----' };
assert.equal(has(M.validate(nested), 'FORBIDDEN_FIELD'), true);

// 9. Схема/страница.
assert.equal(has(M.validate({ ...M.template(), schemaVersion: 2 }), 'UNSUPPORTED_SCHEMA_VERSION'), true);
assert.equal(has(M.validate({ ...M.template(), profile: '  ' }), 'INVALID_PROFILE'), true);
const badPage = M.template();
badPage.page.format = 'A3';
assert.equal(has(M.validate(badPage), 'INVALID_PAGE'), true);

// 10. normalize е идемпотентен; хешът е стабилен и зависи от подредбата.
const n1 = M.normalize({ profile: 'x' });
const n2 = M.normalize(n1);
assert.deepEqual(n1, n2);
assert.equal(M.digest({ profile: 'x' }), M.digest(n2));

const a = M.template('p');
const b = M.template('p');
b.blocks.splice(1, 0, { id: 't1', type: 'text', value: 'Здравей' });
assert.notEqual(M.digest(a), M.digest(b));
assert.equal(M.digest(a), M.digest(M.template('p')), 'един и същ манифест → един и същ хеш');

// 11. canonical сортира ключовете (стабилен JSON независимо от реда).
assert.equal(M.canonical({ b: 1, a: [2, { d: 3, c: 4 }] }), M.canonical({ a: [2, { c: 4, d: 3 }], b: 1 }));

// 12. assertValid хвърля с код и списък грешки.
assert.throws(
  () => M.assertValid({ ...M.template(), blocks: [] }),
  (e) => e.code === 'INVALID_BLOCKS' && e.status === 400 && Array.isArray(e.errors),
);

// 13. JSON Schema е генерируем и описва границите.
const s = M.schema();
assert.equal(s.properties.schemaVersion.const, 1);
assert.deepEqual(s.properties.blocks.items.properties.type.enum.slice(-2), ['rfc3161-start', 'rfc3161-stop']);

// 14. Примерният манифест на GUI-я минава същия валидатор (един договор, един код).
const example = require('../hapi_enterprise/ui/manifest.example.json');
const exampleResult = M.check(example);
assert.equal(exampleResult.ok, true, JSON.stringify(exampleResult.errors));
assert.equal(exampleResult.manifest.blocks[0].type, 'rfc3161-start');
assert.equal(exampleResult.manifest.blocks.at(-1).type, 'rfc3161-stop');

// 15. Browser/Node хешът е един и същ (UMD + WebCrypto път).
(async () => {
  const syncHash = M.digest(example);
  const asyncHash = await M.digestAsync(example);
  assert.match(syncHash, /^[0-9a-f]{64}$/);
  assert.equal(asyncHash, syncHash);
  console.log('report-manifest OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
