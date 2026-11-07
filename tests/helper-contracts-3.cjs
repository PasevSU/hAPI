'use strict';
// Договори, трети набор: подписване на папки (път и списък), PGP опции и публичен ключ,
// архивен пакет на QR (създаване и разопаковане), индекс на доказателствата за задържане.
// Всяка проверка твърди ОЧАКВАН РЕЗУЛТАТ — стойност, брой, статус на грешката.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const PS = require('../hapi_enterprise/pgp-sign');
const PT = require('../hapi_enterprise/pgp-tools');
const QR = require('../hapi_enterprise/portal-qr');
const RET = require('../hapi_enterprise/retention');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-helper3-'));
const root = path.join(dir, 'media');
async function main() {
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello');
  fs.writeFileSync(path.join(root, 'sub', 'b.txt'), 'world!');

  // ── A. Подписване: логически път към реален (resolveInput) ────────────────
  const sign = PS.create({ tools: {}, root: path.join(dir, 'archives'), roots: { media: root } });
  assert.equal(sign.resolveInput('media/a.txt'), path.join(root, 'a.txt'), 'A01 логическият корен се разгръща до реалния път');
  assert.equal(sign.resolveInput('media'), root, 'A02 самият корен се разгръща до папката');
  assert.equal(sign.resolveInput('  media/a.txt  '), path.join(root, 'a.txt'), 'A03 интервалите се подрязват');
  assert.throws(() => sign.resolveInput(''), (e) => e.status === 400 && e.code === 'INVALID_PATH', 'A04 празен път → 400 INVALID_PATH');
  assert.throws(() => sign.resolveInput('друг/файл'), (e) => e.status === 400, 'A05 непознат корен → 400');
  assert.throws(() => sign.resolveInput('media/a\0b'), (e) => e.status === 400, 'A06 нулев байт в пътя → 400');

  // ── B. Подписване: списък на папка (listFolder) ──────────────────────────
  const flat = await sign.listFolder(root, false);
  assert.deepEqual(flat.map((e) => e.rel), ['a.txt'], 'B01 без рекурсия се виждат само файловете от първо ниво');
  const deep = await sign.listFolder(root, true);
  assert.deepEqual(deep.map((e) => e.rel).sort(), ['a.txt', 'sub/b.txt'], 'B01б с рекурсия се виждат и подпапките');
  assert.equal(flat.find((e) => e.rel === 'a.txt').size, 5, 'B02 размерът е в байтове');
  assert.equal(flat.every((e) => path.isAbsolute(e.abs)), true, 'B03 всеки запис носи абсолютен път');
  // Липсваща папка НЕ се гълта: `walk` хвърля ENOENT и това е нарочно — иначе подписът
  // би покрил „нула файла“ и би изглеждал успешен.
  await assert.rejects(() => sign.listFolder(path.join(root, 'няма'), false), (e) => e.code === 'ENOENT', 'B04 липсваща папка → ENOENT, а не тих празен списък');

  // ── C. PGP опции: ключ за подпис и публичен ключ ─────────────────────────
  {
    const tools = PT.create({ keyring: { status: () => ({ available: false }), publicText: () => '' }, listKeys: () => [], decryptSecret: async () => null, pgp: {} });
    assert.equal(tools.optionsKey(), null, 'C01 без наличен ключ → null (не изключение)');
    assert.equal(tools.publicKeyFor('abc', '  -----BEGIN PGP PUBLIC KEY-----  '), '-----BEGIN PGP PUBLIC KEY-----', 'C02 подаденият ключ се ползва подрязан');
    assert.equal(tools.publicKeyFor('nope', ''), '', 'C03 непознат ид без ключ в конзолата → пада към публичния текст на ключалката (тук празен)');
    const withKey = PT.create({
      keyring: { status: () => ({ available: true, primaryKeyId: 'K1', keys: [{ keyId: 'K1' }] }), signing: () => ({ keyId: 'K1' }), publicText: () => 'ARMORED' },
      listKeys: () => [{ keyId: 'K1', fingerprint: 'FF11', publicArmored: 'FROM-CONSOLE' }],
      decryptSecret: async () => null,
      pgp: {},
    });
    const opt = withKey.optionsKey();
    assert.equal(opt && opt.keyId, 'K1', 'C04 ключът за подпис се взима от състоянието');
    assert.equal(withKey.publicKeyFor('k1', ''), 'FROM-CONSOLE', 'C05 ключът се намира по ид без значение от регистъра');
    assert.equal(withKey.publicKeyFor('ff11', ''), 'FROM-CONSOLE', 'C06 …и по отпечатък');
    assert.equal(withKey.publicKeyFor('zzz', ''), 'ARMORED', 'C07 непознат ид → публичният текст на ключалката');
  }

  // ── D. QR архив: създаване и разопаковане ────────────────────────────────
  {
    const portal = { id: 'p1', slug: 'alpha' };
    const revision = { id: 'QR-001' };
    const built = await QR.buildArchive({
      portal, revision, archiveId: 'AR1', note: 'проба',
      files: [{ path: 'a.txt', sha256: 'aa', bytes: Buffer.from('hello') }],
    });
    assert.equal(Buffer.isBuffer(built.buffer), true, 'D01 архивът е буфер');
    assert.equal(built.size, built.buffer.length, 'D02 размерът съвпада с дължината');
    assert.equal(built.hash, QR.sha256(built.buffer), 'D03 хашът е SHA-256 на буфера');
    assert.equal(built.manifest.manifest_id, 'MF-QR-001', 'D04 манифестът вътре в архива сочи ревизията');
    const back = QR.unpack(built.buffer);
    assert.equal(back.files.length, 1, 'D05 разопакова се един файл');
    assert.equal(back.files[0].path, 'a.txt', 'D06 пътят се запазва');
    assert.equal(back.files[0].sha256, 'aa', 'D07 хашът на файла се запазва');
    assert.equal(back.files[0].data.toString('utf8'), 'hello', 'D08 съдържанието оцелява');
    assert.equal(back.manifest.note, 'проба', 'D09 бележката оцелява');
    const empty = await QR.buildArchive({ portal, revision, archiveId: 'AR2', files: [] });
    assert.equal(QR.unpack(empty.buffer).files.length, 0, 'D10 празен архив се разопакова без файлове');
    assert.throws(() => QR.unpack(Buffer.from('не е архив')), (e) => e.status === 400 && /Not a valid ZIP/.test(e.message), 'D11 боклук вместо архив → 400 (не е ZIP)');
  }

  // ── E. Индекс на доказателствата (evidenceIndex) ─────────────────────────
  {
    const ret = RET.create({
      filesRoot: dir,
      auditPath: path.join(dir, 'audit.jsonl'),
      getSettings: () => ({ retention: {} }),
      getQrRegistry: () => ({
        p1: { revisions: [
          { id: 'QR-001', archiveId: 'A1', archivedAt: '2026-01-01', manifest: { files: [{ sha256: 'aa', content_id: 'c1' }] } },
          { id: 'QR-002', archivedAt: '2026-01-02' },
          { id: 'QR-003' },
        ] },
        p2: { revisions: [] },
      }),
    });
    const index = ret.evidenceIndex();
    assert.equal(index.ids instanceof Set, true, 'E01 идентификаторите са множество (без дубликати)');
    assert.deepEqual([...index.ids], ['c1'], 'E02 индексира се идентификаторът на съдържанието');
    // Файл с `content_id` НЕ влиза и в списъка с хашове — индексът е или по ид, или по хаш.
    assert.deepEqual([...index.hashes], [], 'E03 файл с идентификатор не дублира записа по хаш');
    assert.deepEqual([...index.unindexed], ['p1'], 'E04 ревизия с архив, но без манифест, влиза в „неиндексирани“');
    assert.equal(index.ids.has('c1'), true, 'E05 проверката по идентификатор работи');
    const empty = RET.create({ filesRoot: dir, auditPath: path.join(dir, 'a2.jsonl'), getSettings: () => ({ retention: {} }), getQrRegistry: () => ({}) }).evidenceIndex();
    assert.equal(empty.ids.size + empty.hashes.size + empty.unindexed.size, 0, 'E06 без регистър индексът е празен');
  }

  console.log('PASS helper-contracts-3: 9 функции · подписване на папки, PGP опции, QR архив (създаване+разопаковане), индекс на доказателства');
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch (e) { console.error('cleanup: ' + e.code) }
});
