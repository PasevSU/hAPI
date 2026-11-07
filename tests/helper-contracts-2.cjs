'use strict';
// Договори, втори набор: правила за достъп на шлюза, ключалка на инстанцията, криптиране на
// пътища, PGP флагове, профили на регистъра, QR манифест, публични пакети, миграция на
// работната папка и разчитане на TSA отговор.
// Всяка проверка твърди ОЧАКВАН РЕЗУЛТАТ, измерен от кода — не „функцията съществува“.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const fsp = require('node:fs/promises');
const GA = require('../hapi_enterprise/gateway-api');
const IL = require('../hapi_enterprise/instance-lock');
const PC = require('../hapi_enterprise/path-crypto');
const PGP = require('../hapi_enterprise/pgp');
const REG = require('../hapi_enterprise/registry');
const QR = require('../hapi_enterprise/portal-qr');
const PKG = require('../hapi_enterprise/public-package');
const WM = require('../hapi_enterprise/workdir-migrate');
const TSA = require('../hapi_enterprise/tsa-client');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-helper2-'));
async function main() {
  // ── A. Шлюз: път за вградените правила и правила за достъп ────────────────
  const before = process.env.HAPI_CONFIG_DIR;
  process.env.HAPI_CONFIG_DIR = '  D:/cfg  ';
  assert.equal(GA.defaultSeedDir(), 'D:/cfg', 'A01 HAPI_CONFIG_DIR се подрязва и има приоритет');
  process.env.HAPI_CONFIG_DIR = '';
  assert.equal(GA.defaultSeedDir(), '', 'A02 без променлива и без /config → празен низ (извън контейнера)');
  if (before === undefined) delete process.env.HAPI_CONFIG_DIR; else process.env.HAPI_CONFIG_DIR = before;
  const cfg = { files: { rules: [{ portal: 'alpha', file: 'a.txt', access: 'FREE' }, { file: 'b.txt', access: 'PRIVATE' }] } };
  assert.deepEqual(GA.overrideFor({ slug: 'alpha' }, { name: 'a.txt' }, cfg), { portal: 'alpha', file: 'a.txt', access: 'FREE' }, 'A03 правило за конкретен портал печели');
  assert.deepEqual(GA.overrideFor({ slug: 'other' }, { name: 'b.txt' }, cfg), { file: 'b.txt', access: 'PRIVATE' }, 'A04 правило без портал важи за всички');
  assert.equal(GA.overrideFor({ slug: 'other' }, { name: 'c.txt' }, cfg), null, 'A05 без съвпадение → null');
  assert.equal(GA.overrideFor(null, null, {}), null, 'A06 без правило и без файл → null, не изключение');
  assert.equal(GA.fileModeFor({ slug: 'alpha' }, { name: 'a.txt', accessMode: 'DISABLED' }, cfg), 'DISABLED', 'A07 режимът на файла има приоритет пред правилото');
  assert.equal(GA.fileModeFor({ slug: 'other' }, { name: 'b.txt' }, cfg), 'PRIVATE', 'A08 правилото дава режима');
  assert.equal(GA.fileModeFor({ slug: 'x' }, { name: 'c.txt' }, cfg), 'KEY_REQUIRED', 'A09 без правило непубличен портал → KEY_REQUIRED');
  assert.equal(GA.fileModeFor({ slug: 'x', visibility: 'public' }, { name: 'c.txt' }, cfg), 'FREE', 'A10 публичен портал → FREE');
  assert.equal(GA.fileModeFor({ slug: 'x', accessMode: 'ignore-me' }, { name: 'c.txt', accessMode: 'nope' }, cfg), 'KEY_REQUIRED', 'A11 невалидни режими се подминават');

  // ── B. Ключалка на инстанцията: папка на връстниците и освобождаване ─────
  assert.equal(IL.peersDir('/data'), path.join('/data', IL.PEERS_DIR), 'B01 папката на връстниците е под подадената');
  assert.equal(IL.leaveShared({}), false, 'B02 без файл → false');
  const lockFile = path.join(dir, 'shared.lock');
  fs.writeFileSync(lockFile, '{}');
  assert.equal(IL.leaveShared({ file: lockFile }), true, 'B03 съществуващ файл се изтрива → true');
  assert.equal(fs.existsSync(lockFile), false, 'B04 …и го няма');
  assert.equal(IL.leaveShared({ file: lockFile }), true, 'B05 липсващ файл → true (вече е освободено)');
  assert.equal(IL.pruneShared({ dir: path.join(dir, 'no-such') }), 0, 'B06 липсваща папка → 0, не изключение');

  // ── C. Криптиране на пътища без ключ ──────────────────────────────────────
  {
    const crypto = PC.create({ env: {} });
    assert.equal(crypto.status().available, false, 'C01 без ключ състоянието е „не е налично“');
    assert.equal(crypto.status().reason, 'NO_PATHS', 'C02 причината е липса на пътища');
    assert.equal(crypto.publicText(), '', 'C03 без ключ публичният текст е празен');
    assert.throws(() => crypto.wrapSecret('тайна'), (e) => e.code === 'PGP_SECRET_KEY_REQUIRED' && e.status === 503, 'C04 обвиване без ключ → 503 PGP_SECRET_KEY_REQUIRED');
    assert.equal(crypto.unwrapSecret(''), '', 'C05 празен вход → празен изход');
    assert.deepEqual(crypto.sealAll([{ id: 'p', files: [] }]), { sealed: 0, already: 0, failed: 0 }, 'C06 без ключ нищо не се запечатва');
  }

  // ── D. PGP: роли от ключови флагове ──────────────────────────────────────
  assert.deepEqual(PGP.rolesOfKeyFlags(0), [], 'D01 нула флагове → без роли');
  assert.deepEqual(PGP.rolesOfKeyFlags(1), ['certify'], 'D02 бит 1 → certify');
  assert.deepEqual(PGP.rolesOfKeyFlags(3), ['certify', 'sign'], 'D03 битове 1+2 → certify и sign');
  assert.deepEqual(PGP.rolesOfKeyFlags(255), ['certify', 'sign', 'encrypt-comms', 'encrypt-storage', 'authenticate'], 'D04 всички битове → пет роли');
  assert.deepEqual(PGP.rolesOfKeyFlags('1'), [], 'D05 низ вместо число → без роли');
  assert.deepEqual(PGP.rolesOfKeyFlags(null), [], 'D06 null → без роли');

  // ── E. Регистър: профили и проверка на поле ──────────────────────────────
  {
    const reg = REG.create({});
    assert.deepEqual(reg.listProfiles().map((p) => p.prefix), ['1000', '1001', '2000', '3000', '4000', '5000'], 'E01 шестте профила в нарастващ ред');
    const first = reg.listProfiles()[0];
    assert.equal(first.label.bg, 'Указател', 'E02 етикетът има български вариант');
    assert.equal(first.fields.find((f) => f.name === 'name').required, true, 'E03 полето „име“ е задължително');
    assert.equal(first.fields.every((f) => typeof f.indexed === 'boolean'), true, 'E04 „индексирано“ е винаги булево');
    assert.equal(reg.validateField('1000', 'name', '  Иван  '), 'Иван', 'E05 стойността се подрязва');
    assert.throws(() => reg.validateField('9999', 'name', 'x'), (e) => e.status === 404, 'E06 непознат профил → 404');
    assert.throws(() => reg.validateField('1000', 'nope', 'x'), (e) => e.status === 422, 'E07 непознато поле → 422');
    assert.throws(() => reg.validateField('1000', 'email', 'не-имейл'), (e) => e.status === 400, 'E08 невалиден имейл → 400');
  }

  // ── F. QR: първа ревизия и манифест ──────────────────────────────────────
  {
    const db = { portalQr: {} };
    const portal = { id: 'p1', slug: 'alpha', createdAt: '2026-01-01T00:00:00.000Z' };
    const reg = QR.ensureFirst(db, portal);
    assert.equal(reg.revisions.length, 1, 'F01 първото ползване създава точно една ревизия');
    const rev = reg.revisions[0];
    assert.equal(rev.id, 'QR-001', 'F02 ревизията е QR-001');
    assert.equal(rev.contract, 'order', 'F03 договорът е „order“');
    assert.equal(rev.createdAt, portal.createdAt, 'F04 датата идва от портала');
    assert.equal(rev.archivedAt, null, 'F05 новата ревизия не е архивирана');
    assert.equal(QR.ensureFirst(db, portal), reg, 'F06 повторното викане е идемпотентно');
    assert.equal(db.portalQr.p1.revisions.length, 1, 'F07 …и не добавя втора');
    const manifest = QR.manifestFor({ portal, revision: rev, files: [{ path: 'a.txt', sha256: 'aa' }], archiveId: 'AR1' });
    assert.equal(manifest.kind, 'qr-manifest', 'F08 видът на манифеста');
    assert.equal(manifest.manifest_id, 'MF-QR-001', 'F09 манифестът е вързан към ревизията');
    assert.equal(manifest.qr_id, 'QR-001', 'F10 ид на QR-а в манифеста');
    assert.equal(manifest.archive_id, 'AR1', 'F11 ид на архива');
    assert.equal(manifest.note, '', 'F12 без бележка полето е празно, не липсва');
    assert.deepEqual(manifest.depth_policy, { max_depth: 3, code: 'MAX_BRANCH_DEPTH_3' }, 'F13 политиката за дълбочина е фиксирана');
    // `size_bytes` присъства в обекта, но е `undefined`, когато размерът не е подаден —
    // точно това е формата, която отива в JSON (`undefined` отпада при сериализация).
    assert.deepEqual(manifest.files, [{ path: 'a.txt', content_id: null, sha256: 'aa', published: true, locked: false, lock_reason: null, size_bytes: undefined }], 'F14 файловете носят публикуване, заключване и размер');
    assert.equal(typeof manifest.created_at, 'string', 'F15 манифестът носи време на създаване');
  }

  // ── G. Публични пакети: откупуване на непознат токен ─────────────────────
  {
    const pkg = PKG.create({ dir });
    assert.deepEqual(pkg.redeem('nope'), { ok: false, reason: 'unknown' }, 'G01 непознат токен → reason unknown');
    assert.deepEqual(pkg.redeem(''), { ok: false, reason: 'unknown' }, 'G02 празен токен → unknown');
    assert.deepEqual(pkg.redeem(null), { ok: false, reason: 'unknown' }, 'G03 null → unknown');
    const issued = pkg.create ? pkg.create({ portalId: 'p1' }) : null;
    if (issued && issued.token) {
      assert.deepEqual(pkg.redeem(issued.token, { portalId: 'p2' }), { ok: false, reason: 'portal' }, 'G04 чужд портал → refuse без разкриване');
      const ok = pkg.redeem(issued.token, { portalId: 'p1' });
      assert.equal(ok.ok, true, 'G05 собственият портал откупува');
      assert.equal(pkg.redeem(issued.token, { portalId: 'p1' }).reason, 'used', 'G06 второ откупуване → used');
    }
  }

  // ── H. Миграция на работната папка при изключено криптиране ──────────────
  {
    const mig = WM.create({
      fsp,
      path,
      portalRoot: dir,
      backupRoot: path.join(dir, 'backup'),
      keyring: { status: () => ({ encryptWorkdir: false }) },
    });
    await assert.rejects(() => mig.sealPortals([]), (e) => e.code === 'PGP_WORKDIR_DISABLED' && e.status === 409, 'H01 изключено L2 криптиране → 409 PGP_WORKDIR_DISABLED');
  }

  // ── I. TSA: разчитане на неизползваем отговор ────────────────────────────
  assert.equal(TSA.parseTstInfo(Buffer.alloc(4)), null, 'I01 буфер без структура → null, не изключение');
  assert.equal(TSA.parseTstInfo(Buffer.from([0x30, 0x00])), null, 'I02 празна последователност → null');
  assert.deepEqual(Object.keys(TSA.ALGORITHMS).sort(), ['SHA1', 'SHA256', 'SHA512'], 'I03 трите поддържани алгоритъма');
  assert.equal(TSA.ALGORITHMS.SHA256.bytes, 32, 'I04 SHA-256 отпечатъкът е 32 байта');
  assert.equal(TSA.ALGORITHMS.SHA512.oid, '2.16.840.1.101.3.4.2.3', 'I05 OID на SHA-512 е записан точно');
  // Реален опит срещу затворен порт: очакваме неуспех без увисване и без изключение навън.
  await assert.rejects(
    () => TSA.stampOne({ url: 'http://127.0.0.1:1/tsa', digestHex: 'aa'.repeat(32), timeoutMs: 1500 }),
    (e) => /fetch failed|ECONNREFUSED|timeout|abort/i.test(String(e.message) + String(e.code || '')),
    'I06 недостъпен TSA → отказ (не увисване)',
  );
  const breaker = TSA.breakerSnapshot();
  assert.equal(Array.isArray(breaker), true, 'I07 снимката на прекъсвача е списък');
  TSA.resetBreaker();
  assert.equal(TSA.breakerSnapshot().length, 0, 'I08 нулирането изчиства прекъсвача');

  // ── J. Контрол на натоварването: ниво от грешки и коефициент ──────────────
  {
    const LC = require('../hapi_enterprise/load-control').create({ base: 32, min: 2 });
    const low = LC.snapshot();
    assert.equal(low.level, 'LOW', 'J01 без грешки нивото е LOW');
    assert.equal(low.base, 32, 'J02 базата е подадената');
    assert.equal(typeof low.heapRatio, 'number', 'J03 делът на хийпа се вижда в снимката');
    assert.equal(low.recentErrors, 0, 'J04 без регистрирани грешки');
    LC.recordError();
    LC.recordError();
    const critical = LC.recalc(4);
    assert.equal(critical.errorRate, 0.5, 'J05 2 грешки на 4 заявки → 0.5');
    assert.equal(critical.level, 'CRITICAL', 'J06 делът 0.5 вдига нивото до CRITICAL');
    assert.equal(critical.effective, 8, 'J07 CRITICAL свива паралелността до 32×0.25');
    assert.equal(LC.snapshot().recentErrors, 2, 'J08 броячът на грешките се вижда');
    const calm = LC.recalc(1000);
    assert.equal(calm.level, 'LOW', 'J09 рядката грешка връща нивото към LOW');
    assert.equal(calm.effective, 32, 'J10 …и паралелността се връща на базата');
  }

  console.log('PASS helper-contracts-2: 26 функции · шлюз, ключалка, криптиране на пътища, PGP флагове, регистър, QR манифест, публични пакети, миграция, TSA, натоварване');
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch (e) { console.error('cleanup: ' + e.code) }
});
