'use strict';
// Криптиране на експортния пакет — РЕАЛНО, не „планирано“.
//
// До 0.69.52 `export-rules.capabilities()` връщаше `encrypt_package: implemented: false`
// и единственият начин да се защити пакет беше PGP подпис (който НЕ крие съдържанието).
// Тук се проверява, че:
//   1. поисканото криптиране наистина произвежда контейнер hapiPKG1, а не ZIP;
//   2. разшифроването с ВЯРНА парола връща байт-в-байт ZIP-а, чийто sha256 съвпада с
//      `meta.sha256` (хешът в индекса е на ПРЕДИ-криптирания пакет);
//   3. грешна парола, подправен шифротекст и подправен хедър се отхвърлят (GCM tag);
//   4. генерираната парола се връща ЕДИН път и НЕ се записва в <id>.json на диска;
//   5. скриптът за получателя `scripts/decrypt-package.cjs` работи без add-on;
//   6. къса парола и непознат режим са 400, а способността е обявена за готова.
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-encrypt-'));
const pack = packager.create({ root: dir });
const portal = { id: 'p1', slug: 'demo', title: 'Demo', storage_root: '/share' };
const files = [{ name: 'report.txt', data: Buffer.from('hAPI Enterprise evidence '.repeat(500), 'utf8') }];
const PASSWORD = 'Korektna-Parola-2026';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  // ── 1. Криптиран пакет с подадена парола ──────────────────────────────────
  const one = await pack.build({ portal, files, encryption: 'password', password: PASSWORD });
  assert.equal(one.hasEncryption, true, 'пакетът е криптиран');
  assert.match(one.fileName, /\.zip\.enc$/, 'името на файла показва контейнера');
  assert.equal(one.generatedPassword, undefined, 'при подадена парола не се връща парола');
  assert.equal(one.encryption.cipher, 'AES-256-GCM');
  assert.equal(one.encryption.kdf, 'scrypt');
  assert.equal(one.encryption.mode, 'password');
  assert.equal(one.encryption.passwordGenerated, false);
  assert.equal(one.encryption.packageSha256, one.sha256, 'sha256 в индекса е на PLAINTEXT пакета');

  const stored = fs.readFileSync(path.join(dir, 'packages', `${one.id}.zip`));
  assert.equal(sha256(stored), one.encryption.sha256, 'файлът на диска е точно описаният контейнер');
  assert.equal(stored.includes(Buffer.from([0x50, 0x4b, 0x03, 0x04])), false, 'в шифротекста няма ZIP заголове');
  assert.equal(stored.subarray(0, 8).toString('ascii'), 'hapiPKG1', 'контейнерът носи собствената си магия');
  assert.equal(one.size, one.encryption.bytes, 'размерът в метаданните е на доставяния файл');
  assert.equal(one.size, stored.length, 'размерът съвпада с файла на диска');
  assert.equal(one.size, one.encryption.packageBytes + one.encryption.overheadBytes, 'контейнерът = ZIP + хедър и tag');

  // ── 2. Разшифроване: байт-в-байт същият ZIP ──────────────────────────────
  const plain = await pkgcrypto.decrypt(stored, PASSWORD);
  assert.equal(sha256(plain), one.sha256, 'разшифрованото съвпада с sha256 от метаданните');
  const entries = ooxml.unzip(plain);
  assert.ok(entries.get('originals/report.txt'), 'след разшифроване архивът се отваря');
  const index = JSON.parse(entries.get('PACKAGE_INDEX.json')().toString('utf8'));
  assert.equal(index.package_id, one.id);
  assert.equal(index.files[0].sha256, sha256(files[0].data), 'хешовете в индекса са на оригинала');

  // ── 3. Грешна парола, подправен шифротекст, подправен хедър ──────────────
  await assert.rejects(() => pkgcrypto.decrypt(stored, 'Greshna-Parola-1'), (e) => e.status === 401, 'грешна парола → AUTH_FAILED');
  const tampered = Buffer.from(stored);
  tampered[tampered.length - 1] ^= 0xff;
  await assert.rejects(() => pkgcrypto.decrypt(tampered, PASSWORD), (e) => e.status >= 400, 'подправен шифротекст се хваща от GCM');
  const weakened = Buffer.from(stored);
  weakened.writeUInt32BE(1024, 10); // подменена цена на scrypt → хедърът е AAD
  await assert.rejects(() => pkgcrypto.decrypt(weakened, PASSWORD), (e) => e.status >= 400, 'подменен хедър се хваща от GCM');
  const truncated = stored.subarray(0, 40);
  assert.throws(() => pkgcrypto.info(truncated), (e) => e.status === 400, 'отрязан контейнер не се приема');

  // ── 4. Генерирана парола: връща се веднъж, не се пази на диска ───────────
  const gen = await pack.build({ portal, files, encryption: true });
  assert.match(gen.generatedPassword, /^[A-Za-z0-9]{24}$/, 'генерираната парола е 24 знака');
  assert.equal(gen.encryption.passwordGenerated, true);
  const genStored = fs.readFileSync(path.join(dir, 'packages', `${gen.id}.zip`));
  assert.equal(sha256(await pkgcrypto.decrypt(genStored, gen.generatedPassword)), gen.sha256, 'генерираната парола отваря пакета');
  const metaOnDisk = JSON.parse(fs.readFileSync(path.join(dir, 'packages', `${gen.id}.json`), 'utf8'));
  assert.equal(metaOnDisk.generatedPassword, undefined, 'паролата НЕ се записва в метаданните');
  assert.equal(metaOnDisk.password, undefined, 'паролата НЕ се записва в метаданните');
  assert.equal(JSON.stringify(metaOnDisk).includes(gen.generatedPassword), false, 'паролата не се среща никъде в <id>.json');
  const listed = await pack.readMeta(gen.id);
  assert.equal(listed.hasEncryption, true, 'метаданните помнят, че пакетът е криптиран');

  // ── 5. Скриптът за получателя работи без add-on ──────────────────────────
  const cliIn = path.join(dir, 'recipient.zip.enc');
  fs.writeFileSync(cliIn, stored);
  const cliOut = path.join(dir, 'recipient.zip');
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'decrypt-package.cjs'), cliIn, PASSWORD, cliOut], { encoding: 'utf8' });
  assert.equal(run.status, 0, 'скриптът завършва успешно: ' + run.stderr);
  assert.equal(sha256(fs.readFileSync(cliOut)), one.sha256, 'CLI връща същия ZIP');
  assert.match(run.stdout, new RegExp(one.sha256), 'CLI отпечатва sha256 за сверка с индекса');
  const info = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'decrypt-package.cjs'), cliIn, '--info'], { encoding: 'utf8' });
  assert.equal(info.status, 0, 'режимът --info работи без парола');
  assert.match(info.stdout, /"cipher": "AES-256-GCM"/, '--info показва алгоритъма от хедъра');
  const cliBad = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'decrypt-package.cjs'), cliIn, 'Greshna-Parola-1'], { encoding: 'utf8' });
  assert.equal(cliBad.status, 3, 'грешна парола в CLI → код 3');

  // ── 6. Откази и обявена способност ───────────────────────────────────────
  await assert.rejects(() => pack.build({ portal, files, encryption: 'password', password: 'kratka' }), (e) => e.status === 400, 'къса парола → 400');
  await assert.rejects(() => pack.build({ portal, files, encryption: 'pgp' }), (e) => e.status === 400, 'непознат режим → 400');
  const plainPack = await pack.build({ portal, files });
  assert.equal(plainPack.hasEncryption, false, 'без поискване пакетът остава ZIP');
  assert.match(plainPack.fileName, /\.zip$/, 'некриптираният файл си остава .zip');
  assert.equal(plainPack.encryption, null);

  const caps = rules.capabilities();
  const enc = caps.find((c) => c.id === 'encrypt_package');
  assert.equal(enc.implemented, true, 'encrypt_package е обявена за готова');
  assert.equal(enc.status, 'ready');
  assert.deepEqual(
    caps.filter((c) => c.implemented).map((c) => c.id),
    ['compression', 'split_archive', 'rate_limit', 'parallel_transfers', 'encrypt_package'],
    'точно пет готови способности'
  );

  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(
    `PASS package-encryption: hapiPKG1 + AES-256-GCM · ZIP ${one.encryption.packageBytes} B → ${one.size} B · разшифровано съвпада по sha256 · грешна/подправена → 401 · генерирана парола не се пази · CLI работи · 4 готови способности\n`
  );
})().catch((e) => {
  process.stderr.write('FAIL package-encryption: ' + (e && e.message ? e.message : e) + '\n');
  process.exitCode = 1;
});
