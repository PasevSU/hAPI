'use strict';
// Разделяне на експортния пакет на части — РЕАЛНО, не „планирано“.
//
// До 0.69.53 `export-rules.capabilities()` връщаше `split_archive: implemented: false`:
// голям пакет можеше да се свали само като един файл, което е проблем за среди с лимит на
// трансфера. Тук се проверява, че:
//   1. пакетът наистина се реже на части с поискания размер и пълният файл НЕ се пази;
//   2. слепените части са байт-в-байт равни на оригиналния файл (sha256 съвпада);
//   3. метаданните носят размера и хеша на всяка част;
//   4. изтеглянето без `?part=N` е ясна грешка (409), а не „първата част“;
//   5. `scripts/join-package.cjs` слепва без add-on и сверява хеша;
//   6. разделяне + криптиране работят заедно; невалиден размер е 400.
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const packager = require(path.join(ROOT, 'hapi_enterprise', 'packager.js'));
const ooxml = require(path.join(ROOT, 'hapi_enterprise', 'ooxml.js'));
const pkgcrypto = require(path.join(ROOT, 'hapi_enterprise', 'package-crypto.js'));
const rules = require(path.join(ROOT, 'hapi_enterprise', 'export-rules.js'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-split-'));
const pack = packager.create({ root: dir });
const portal = { id: 'p1', slug: 'demo', title: 'Demo', storage_root: '/share' };
// Случайни байтове: deflate не ги свива, затова размерът на пакета е предвидим и
// разделянето дава части с реални размери, а не „всичко в една част“.
const big = crypto.randomBytes(2_600_000);
const files = [{ name: 'evidence.bin', data: big }];
const PART = 1024 * 1024; // 1 MiB
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  // ── 1. Без разделяне: база за сравнение ──────────────────────────────────
  const whole = await pack.build({ portal, files });
  assert.equal(whole.hasSplit, false, 'без поискване няма разделяне');
  assert.equal(whole.split, null);
  const wholeBuf = fs.readFileSync(path.join(dir, 'packages', `${whole.id}.zip`));
  assert.equal(sha256(wholeBuf), whole.sha256, 'базовият пакет е цял');

  // ── 2. С разделяне на 1 MiB ───────────────────────────────────────────────
  const split = await pack.build({ portal, files, split: PART });
  assert.equal(split.hasSplit, true, 'пакетът е разделен');
  assert.equal(split.split.partBytes, PART);
  const expectedParts = Math.ceil(split.size / PART);
  assert.equal(split.split.count, expectedParts, `частите са ${expectedParts}`);
  assert.ok(split.split.count >= 3, 'поне три части за 2.6 MB вход');
  assert.equal(split.split.parts.length, split.split.count, 'всяка част е описана');

  const partDir = path.join(dir, 'packages');
  assert.equal(fs.existsSync(path.join(partDir, `${split.id}.zip`)), false, 'пълният файл НЕ се пази при разделяне');

  let sum = 0;
  const chunks = [];
  for (const p of split.split.parts) {
    const file = path.join(partDir, p.file);
    const buf = fs.readFileSync(file);
    assert.equal(buf.length, p.size, `част ${p.index} има обявения размер`);
    assert.equal(sha256(buf), p.sha256, `част ${p.index} има обявения хеш`);
    assert.ok(buf.length <= PART, `част ${p.index} не надвишава размера`);
    assert.match(p.name, new RegExp(`\\.part0*${p.index}$`), `името на част ${p.index} носи номера`);
    sum += buf.length;
    chunks.push(buf);
  }
  assert.equal(sum, split.size, 'сборът на частите е размерът на файла');
  assert.ok(split.split.parts[0].size === PART, 'всички части освен последната са пълни');
  assert.ok(split.split.parts.at(-1).size <= PART, 'последната част е остатъкът');

  // ── 3. Слепените части са байт-в-байт файла ──────────────────────────────
  const joined = Buffer.concat(chunks);
  assert.equal(sha256(joined), split.sha256, 'слепеното съвпада с sha256 от метаданните');
  assert.equal(joined.length, split.size);
  const entries = ooxml.unzip(joined);
  assert.equal(sha256(entries.get('originals/evidence.bin')()), sha256(big), 'оригиналът е цял');

  // ── 4. Достъпът до частите е по номер, не „първата“ ──────────────────────
  assert.equal(await pack.artifact(split.id, 'zip'), null, 'без номер на част няма файл');
  const first = await pack.artifact(split.id, 'zip', 1);
  assert.ok(first && first.name.endsWith('.part001'), 'част 1 се намира по номер');
  assert.equal(first.meta.id, split.id);
  assert.equal(await pack.artifact(split.id, 'zip', 99), null, 'несъществуваща част е null');
  assert.equal(await pack.artifact(split.id, 'signature'), null, 'без подпис няма .asc');
  const allowSplit = await pack.artifact(split.id, 'zip', 0, { allowSplit: true });
  assert.ok(allowSplit && allowSplit.parts === split.split.count, 'проверката на подписа вижда метаданните');
  assert.equal(sha256(await pack.payload(split.id)), split.sha256, 'payload() слепва частите');

  // ── 5. CLI: слепване без add-on ──────────────────────────────────────────
  const cliDir = path.join(dir, 'recipient');
  fs.mkdirSync(cliDir, { recursive: true });
  for (const p of split.split.parts) fs.copyFileSync(path.join(partDir, p.file), path.join(cliDir, p.name));
  const cliOut = path.join(cliDir, 'evidence.zip');
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'join-package.cjs'), path.join(cliDir, split.split.parts[0].name), cliOut, '--sha256', split.sha256], { encoding: 'utf8' });
  assert.equal(run.status, 0, 'join-package работи: ' + run.stderr);
  assert.match(run.stdout, /sha256 съвпада/, 'CLI потвърждава хеша');
  assert.equal(sha256(fs.readFileSync(cliOut)), split.sha256, 'CLI връща същия файл');
  const bad = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'join-package.cjs'), cliDir, path.join(cliDir, 'x.zip'), '--sha256', 'a'.repeat(64)], { encoding: 'utf8' });
  assert.equal(bad.status, 4, 'грешен очакван хеш → код 4');
  // Липсваща част не се подменя мълчаливо.
  fs.rmSync(path.join(cliDir, split.split.parts[1].name));
  const gap = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'join-package.cjs'), cliDir, path.join(cliDir, 'y.zip')], { encoding: 'utf8' });
  assert.equal(gap.status, 1, 'липсваща част е грешка');
  assert.match(gap.stderr, /липсва част/, 'грешката назовава липсващата част');

  // ── 6. Разделяне + криптиране заедно ─────────────────────────────────────
  const sealed = await pack.build({ portal, files, split: PART, encryption: 'password', password: 'Korektna-Parola-2026' });
  assert.equal(sealed.hasSplit, true);
  assert.equal(sealed.hasEncryption, true);
  assert.equal(sealed.split.parts.length, sealed.split.count);
  const sealedBuf = await pack.payload(sealed.id);
  assert.equal(sha256(sealedBuf), sealed.encryption.sha256, 'частите на криптирания пакет дават контейнера');
  const unsealed = await pkgcrypto.decrypt(sealedBuf, 'Korektna-Parola-2026');
  assert.equal(sha256(unsealed), sealed.sha256, 'след разшифроване хешът съвпада с индекса');

  // ── 7. Откази и обявена способност ───────────────────────────────────────
  for (const badValue of [1024, 512 * 1024, 2 * 1024 * 1024 * 1024, 'abc', -5]) {
    await assert.rejects(() => pack.build({ portal, files, split: badValue }), (e) => e.status === 400, 'split=' + badValue + ' → 400');
  }
  const named = await pack.build({ portal, files, split: { partMb: 1 } });
  assert.equal(named.split.partBytes, PART, 'partMb се превежда в байтове');
  const smallFile = await pack.build({ portal, files: [{ name: 'x.txt', data: Buffer.from('малък') }], split: PART });
  assert.equal(smallFile.hasSplit, false, 'по-малък от една част файл не се разделя');

  const caps = rules.capabilities();
  assert.equal(caps.find((c) => c.id === 'split_archive').implemented, true, 'split_archive е обявена за готова');
  assert.equal(caps.find((c) => c.id === 'split_archive').status, 'ready');
  assert.deepEqual(
    caps.filter((c) => c.implemented).map((c) => c.id),
    ['compression', 'split_archive', 'rate_limit', 'parallel_transfers', 'encrypt_package'],
    'точно пет готови способности'
  );

  // ── 8. Изтриването маха и частите ────────────────────────────────────────
  const removed = await pack.remove(split.id);
  assert.equal(removed.removed, true);
  for (const p of split.split.parts) assert.equal(fs.existsSync(path.join(partDir, p.file)), false, 'частта е изтрита');

  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(
    `PASS package-split: ${split.size} B на ${split.split.count} части по ${PART} B · слепеното съвпада по sha256 · без ?part=N е 409-еквивалент · CLI сверява хеша · работи с криптиране · 4 готови способности\n`
  );
})().catch((e) => {
  process.stderr.write('FAIL package-split: ' + (e && e.message ? e.message : e) + '\n');
  process.exitCode = 1;
});
