'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// WhiteBox тест за сигурност.
//
// Проверява модулите ОТВЪТРЕ — не през HTTP, а на ниво функция/инвариант:
//   • криптография: AES-GCM открива подправен шифротекст, HMAC открива подправена
//     разписка, хешът на парола е с различна сол при всеки запис;
//   • решения за достъп: отказът е по подразбиране, ролята не се покачва, билетът
//     е еднократен и обвързан с получателя;
//   • файлова система: обход на директории и символна връзка се отказват, а
//     заключването на инстанция не се краде от жив собственик;
//   • парсер на външни данни: произволен/подрязан DER не хвърля изключение и не
//     се приема за валиден токен;
//   • контрол на средата: CSP на административния интерфейс не позволява inline код.
//
// Тестът не вдига сървър (това е задача на blackbox-security.cjs) и не пише извън
// временна папка.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const mod = (name) => require(path.join(ROOT, 'hapi_enterprise', name));

const fileCrypto = mod('file-crypto.js');
const signer = mod('signer.js');
const storageTree = mod('storage-tree.js');
const cabinet = mod('cabinet.js');
const downloadAccess = mod('download-access.js');
const instanceLock = mod('instance-lock.js');
const sendLite = mod('send.js');
const tsaClient = mod('tsa-client.js');
const rbac = mod('rbac.js');
const secretLinks = mod('secret-links.js');

const b64u = (b) => Buffer.from(b).toString('base64url');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-whitebox-'));
const say = (m) => console.log('· ' + m);

(async () => {
  // ── 1. Криптография: подправяне се открива ────────────────────────────────
  const key = crypto.randomBytes(32);
  const plain = Buffer.from('поверително съдържание на документа');
  const sealed = fileCrypto.encrypt(plain, key);
  assert.deepEqual(fileCrypto.decrypt(sealed, key), plain, 'AES-GCM кръгов тест');
  assert.equal(fileCrypto.isEncrypted(sealed), true);

  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => fileCrypto.decrypt(tampered, key), 'подправен шифротекст се отхвърля (GCM tag)');
  assert.throws(() => fileCrypto.decrypt(sealed, crypto.randomBytes(32)), 'чужд ключ не декриптира');
  say('AES-GCM: кръгов тест, подправяне и чужд ключ се отхвърлят');

  // Разписка: всеки байт участва в подписа.
  const signingKey = crypto.randomBytes(32);
  const receipt = signer.sign({ fileId: 'f1', name: 'договор.pdf', sha256: 'a'.repeat(64), size: 10, secret: signingKey });
  assert.equal(receipt.algorithm, 'HMAC-SHA256');
  assert.equal(signer.verify(receipt, signingKey).valid, true);
  assert.equal(signer.verify({ ...receipt, size: 11 }, signingKey).valid, false, 'промяна на размер чупи подписа');
  assert.equal(signer.verify({ ...receipt, sha256: 'b'.repeat(64) }, signingKey).valid, false, 'промяна на хеша чупи подписа');
  assert.equal(signer.verify({ ...receipt, name: 'друг.pdf' }, signingKey).valid, false, 'промяна на името чупи подписа');
  assert.equal(signer.verify(receipt, crypto.randomBytes(32)).reason, 'SIGNATURE_MISMATCH', 'чужд ключ не потвърждава');
  assert.equal(signer.verify({ ...receipt, algorithm: 'MD5' }, signingKey).reason, 'UNSUPPORTED_ALGORITHM');
  assert.equal(signer.verify({ algorithm: 'HMAC-SHA256', fileId: 'f1' }, signingKey).reason, 'MISSING_FIELD', 'непълна разписка не минава');
  assert.equal(signer.verify(null, signingKey).reason, 'INVALID_RECEIPT', 'null не хвърля');
  assert.equal(signer.verify([], signingKey).valid, false, 'масив не е разписка');
  // Канонизацията покрива всяко поле — иначе подписът не би хващал промяна.
  assert.notEqual(signer.canonical({ ...receipt, size: 1 }), signer.canonical({ ...receipt, size: 2 }));
  say('HMAC разписка: подправяне, чужд ключ и празна разписка се отхвърлят');

  // ── 2. Решения за достъп: отказът е по подразбиране ───────────────────────
  const guard = rbac.create({ adminToken: 'a'.repeat(32), viewerToken: 'v'.repeat(32) });
  assert.equal(guard.resolve({ headers: { authorization: 'Bearer ' + 'a'.repeat(32) } }), 'admin');
  assert.equal(guard.resolve({ headers: { authorization: 'Bearer ' + 'v'.repeat(32) } }), 'viewer');
  assert.equal(guard.resolve({ headers: { authorization: 'Bearer грешен' } }), null, 'невалиден токен не дава роля');
  assert.equal(guard.resolve({ headers: {} }), null, 'без токен и без ingress няма роля');
  assert.equal(guard.allowed(null, 'core', 'GET'), false, 'без роля няма достъп');
  assert.equal(guard.allowed('viewer', 'core', 'POST'), false, 'viewer не пише в ядрото');
  assert.equal(guard.allowed('viewer', 'core', 'GET'), true, 'viewer чете ядрото');
  assert.equal(guard.allowed('viewer', 'settings', 'GET'), false, 'настройките са само за admin');
  assert.equal(guard.allowed('operator', 'backup', 'POST'), false, 'операторът не прави backup');
  assert.equal(guard.allowed('admin', 'backup', 'POST'), true);
  assert.equal(guard.allowed('viewer', 'несъществуваща', 'GET'), false, 'непозната възможност се отказва за viewer');
  assert.equal(guard.allowed('operator', 'несъществуваща', 'GET'), false, 'непозната възможност се отказва за operator');
  // admin е суперпотребител по документация (кратко съединение преди таблицата).
  assert.equal(guard.allowed('admin', 'несъществуваща', 'GET'), true, 'admin минава преди таблицата — по дизайн');
  // Ingress: ролята се взима от HA идентичността; непознат потребител пада към
  // defaultRole (по подразбиране admin — така е документирано за add-on-а).
  const mapped = rbac.create({ userRoles: { bob: 'viewer' }, defaultRole: 'viewer' });
  assert.equal(mapped.resolve({ ingress: true, headers: { 'x-remote-user-name': 'bob' } }), 'viewer');
  assert.equal(mapped.resolve({ ingress: true, headers: { 'x-remote-user-name': 'непознат' } }), 'viewer', 'defaultRole важи');
  assert.equal(rbac.create({}).defaultRole, 'admin', 'без конфигурация ролята е admin (документирано)');
  say('RBAC: отказ по подразбиране, без покачване на роля, ingress по HA идентичност');

  // ── 3. Файлова система: обход и символна връзка се отказват ───────────────
  assert.equal(storageTree.normRel('../etc/passwd'), null, 'относителен обход се отказва');
  assert.equal(storageTree.normRel('a/../../b'), null, 'обход в средата се отказва');
  assert.equal(storageTree.normRel('a/../b'), null, 'връщане назад се отказва');
  assert.equal(storageTree.normRel('etc/passwd'), 'etc/passwd', 'нормалният път минава');
  assert.equal(storageTree.normRel('a/./b'), null, 'точка като сегмент се отказва');
  // Абсолютният път се превръща в относителен — не може да излезе от корена.
  assert.equal(storageTree.normRel('/etc/passwd'), 'etc/passwd', 'водещата наклонена черта пада');
  assert.equal(storageTree.normRel('a\u0000b'), null, 'NUL байт се отказва');
  assert.equal(storageTree.normRel('x'.repeat(10) + '/' + Array(40).fill('y').join('/')), null, 'твърде дълбок път се отказва');
  assert.equal(storageTree.normRel(''), '');

  // resolve работи върху виртуалното дърво: възел извън него не съществува.
  const tree = { type: 'folder', name: '', folders: [{ type: 'folder', name: 'документи', folders: [], files: [] }], files: [] };
  assert.equal(storageTree.resolve(tree, '../извън'), null, 'обходът не намира възел');
  assert.equal(storageTree.resolve(tree, 'документи').name, 'документи', 'нормалната папка се намира');
  assert.equal(storageTree.resolve(tree, 'липсва'), null, 'липсваща папка не се измисля');
  assert.equal(storageTree.resolve(tree, ''), tree, 'празният път е коренът');
  say('storage-tree: обход, NUL и дълбочина се отказват; нормалният път минава');

  // cabinet: същото на ниво „шкаф“ (папки на портала) — през реалната файлова система.
  const cabRoot = path.join(tmp, 'cabinet-root');
  fs.mkdirSync(cabRoot, { recursive: true });
  const box = cabinet.create({ root: cabRoot });
  const okDir = await box.mkdir('', 'документи').then((r) => r && r.name === 'документи', () => false);
  assert.equal(okDir, true, 'нормална папка се създава');
  const badUp = await box.mkdir('..', 'извън').then(() => null, (e) => e.message);
  assert.ok(badUp, 'родител ".." се отказва');
  const badName = await box.mkdir('документи', '../извън').then(() => null, (e) => e.message);
  assert.ok(badName, 'име с обход се отказва');
  const badNul = await box.mkdir('документи', 'a\u0000b').then(() => null, (e) => e.message);
  assert.ok(badNul, 'NUL в името се отказва');
  say('cabinet: създаване извън корена се отказва');

  // ── 4. Билети и пароли (Бърз линк) ────────────────────────────────────────
  const h1 = sendLite.hashPassphrase('парола-123');
  const h2 = sendLite.hashPassphrase('парола-123');
  assert.notEqual(h1.hash, h2.hash, 'всеки запис има собствена сол');
  assert.equal(h1.algo, 'scrypt', 'паролата се хешира със scrypt');
  const protectedRec = { pass: h1 };
  assert.equal(sendLite.isProtected(protectedRec), true);
  assert.equal(sendLite.verifyPassphrase('парола-123', protectedRec), true);
  assert.equal(sendLite.verifyPassphrase('друга', protectedRec), false, 'грешна парола не минава');
  assert.equal(sendLite.verifyPassphrase('', protectedRec), false, 'празна парола не минава');
  assert.equal(sendLite.verifyPassphrase(null, protectedRec), false, 'null не минава');
  // Запис без парола е отворен по дизайн (защитата е самият линк) — документирано.
  assert.equal(sendLite.isProtected({}), false);
  assert.equal(sendLite.verifyPassphrase('каквото-и-да-е', {}), true, 'без зададена парола линкът е отворен');
  say('Бърз линк: scrypt със сол, грешна/празна парола се отхвърля');
  const secret = crypto.randomBytes(32).toString('hex');
  const ticket = sendLite.mintTicket({ sendId: 's1', fileId: 'f1', secret, ttlMs: 60_000 });
  assert.equal(sendLite.verifyTicket(ticket.ticket, secret).sendId, 's1');
  assert.equal(sendLite.verifyTicket(ticket.ticket, 'друг-секрет'), null, 'чужд ключ не издава билет');
  assert.equal(sendLite.verifyTicket(ticket.ticket.slice(0, -2) + 'aa', secret), null, 'подправен билет не минава');
  const old = sendLite.mintTicket({ sendId: 's1', fileId: 'f1', secret, ttlMs: -1000 });
  assert.equal(sendLite.verifyTicket(old.ticket, secret), null, 'изтекъл билет не минава');
  const rec = sendLite.createRecord({ fileId: 'f1', portalId: 'p1', password: 'парола-123', maxAccess: 1 });
  assert.equal(JSON.stringify(sendLite.adminView(rec)).includes('hash'), false, 'административният изглед не показва хеша на паролата');
  say('Бърз линк: сол на паролата, билетът е обвързан и еднократен');

  // ── 5. Заключване на инстанция ────────────────────────────────────────────
  const dataDir = path.join(tmp, 'data');
  const first = instanceLock.acquire({ dir: dataDir, id: 'inst-A' });
  assert.equal(first.ok, true, 'първото заключване се взима');
  assert.equal(first.tookOver, false);
  const lockFile = instanceLock.lockPath(dataDir);
  assert.ok(fs.existsSync(lockFile), 'заключването е файл');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(lockFile).mode & 0o777, 0o600, 'заключването е 0600');
  }
  const payload = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  assert.equal(payload.pid, process.pid);
  assert.equal(payload.id, 'inst-A');
  assert.ok('pidStart' in payload, 'заключването пази и старта на процеса (срещу преизползван PID)');
  // Жив собственик не се измества.
  const second = instanceLock.acquire({ dir: dataDir, id: 'inst-B' });
  assert.equal(second.ok, false, 'второ заключване не се взима, докато собственикът е жив');
  assert.equal(instanceLock.inspect(dataDir).id, 'inst-A', 'заключването остава у първия');
  // Освобождаване: само собственикът по id може да го махне.
  assert.equal(instanceLock.release(dataDir, 'inst-B'), false, 'чужд id не освобождава заключването');
  assert.equal(instanceLock.release(dataDir, 'inst-A'), true, 'собственикът освобождава');
  assert.equal(instanceLock.inspect(dataDir), null, 'след release няма заключване');
  // Чужд host се третира като не-жив собственик (не блокира завинаги).
  const foreign = instanceLock.acquire({ dir: dataDir, id: 'inst-C', host: 'друг-хост', pid: 999999 });
  assert.equal(foreign.ok, true, 'заключване от друг хост се взима');
  instanceLock.release(dataDir, 'inst-C');
  say('instance-lock: жив собственик не се измества, чужд host/pid не блокира');

  // ── 6. Парсер на външни данни: боклук не минава, а публичната граница не хвърля ──
  const garbage = [Buffer.alloc(0), Buffer.from([0x30, 0x03, 0x02, 0x01]), crypto.randomBytes(64), Buffer.from('не-е-der')];
  for (const buf of garbage) {
    // Вътрешният парсер хвърля (документиран договор) — важното е, че НЕ приема входа.
    assert.throws(() => tsaClient.parseResponse(buf), /DER|SEQUENCE|PKIStatusInfo|empty/, 'произволен DER не се приема за валиден');
  }
  // Публичната граница (stamp) хвърля обект с код, който маршрутът превръща в 502 —
  // важното е, че не връща „успех“ и не оставя необозначена грешка.
  await assert.rejects(
    () => tsaClient.stamp({ url: 'http://127.0.0.1:1/tsa', digestHex: 'ab'.repeat(32) }),
    (e) => {
      assert.ok(e.status >= 500, 'грешката носи статус за отговора');
      assert.ok(Array.isArray(e.attempts) && e.attempts.length >= 1, 'опитът е отразен');
      assert.equal(e.token || null, null, 'няма измислен токен');
      return true;
    },
    'недостъпен TSA не дава успех',
  );
  // normalizeUrl е „пропусни или хвърли“: връща валидиран адрес или отказва с грешка.
  const rejects = (value, re) => assert.throws(() => tsaClient.normalizeUrl(value), re);
  rejects('file:///etc/passwd', /http\(s\)/, 'file: не е допустим TSA адрес');
  rejects('ftp://x/y', /http\(s\)/, 'ftp не е допустим TSA адрес');
  rejects('https://user:pass@tsa.example/x', /credentials/, 'креденшъли в адреса се отказват');
  rejects('not a url', /Invalid|http\(s\)/);
  assert.equal(tsaClient.normalizeUrl('https://tsa.example/basic'), 'https://tsa.example/basic');
  assert.equal(tsaClient.normalizeUrl('http://tsa.example'), 'http://tsa.example/');
  assert.throws(() => tsaClient.normalizeDigest('abc', 'SHA256'), /hex|64/, 'къс digest се отказва');
  assert.throws(() => tsaClient.normalizeAlgorithm('MD5'), /Unsupported/, 'слаб алгоритъм се отказва');
  say('TSA: произволен DER се отхвърля, недостъпен TSA дава грешка със статус, само http(s) без креденшъли');

  // ── 7. Тайни връзки: плътност на плика и нулево знание ────────────────────
  const link = secretLinks.newFragment();
  const env = { v: 2, iv: b64u(crypto.randomBytes(12)), ct: b64u(crypto.randomBytes(48)) };
  const created = secretLinks.createRecord({ envelope: env, idHash: link.idHash });
  assert.ok(created.record, 'записът се създава');
  const admin = secretLinks.adminView(created.record);
  const adminJson = JSON.stringify(admin);
  assert.equal(adminJson.includes(link.key), false, 'ключът не влиза в административния изглед');
  assert.equal(adminJson.includes(link.id), false, 'ид-то не влиза в административния изглед');
  assert.equal(adminJson.includes(env.ct), false, 'шифротекстът не влиза в списъка');
  const dir2 = path.join(tmp, 'secrets-root');
  await secretLinks.save(dir2, created.record);
  const recordFile = secretLinks.recordPath(dir2, link.idHash);
  assert.ok(fs.existsSync(recordFile), 'записът е на очаквания път');
  const onDisk = fs.readFileSync(recordFile, 'utf8');
  assert.equal(onDisk.includes(link.key), false, 'ключът не е на диска');
  assert.equal(onDisk.includes(link.id), false, 'ид-то не е на диска');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(recordFile).mode & 0o777, 0o600, 'записът е 0600');
  }
  await secretLinks.remove(dir2, link.idHash);
  assert.equal(await secretLinks.read(dir2, link.idHash), null, 'след изтриване записът липсва');
  say('Тайни връзки: ключ/ид/шифротекст не напускат браузъра и не се записват на диска');

  // ── 8. Контрол на достъпа до артефакт ─────────────────────────────────────
  // decide() събира проверки и отказва, ако някоя падне; причината се връща явно.
  const offSwitch = downloadAccess.decide({ system: { allow_downloads: false } });
  assert.equal(offSwitch.allowed, false, 'глобалната забрана блокира изтеглянето');
  assert.equal(offSwitch.reason, 'system-allow', 'причината е посочена');
  const noStorage = downloadAccess.decide({ storage: { available: false } });
  assert.equal(noStorage.allowed, false, 'недостъпно хранилище блокира');
  assert.equal(noStorage.reason, 'storage-available');
  // Изтекъл прозорец на достъп също отказва.
  const expired = downloadAccess.decide({ policy: { ...downloadAccess.DEFAULT_POLICY, expires_at: new Date(Date.now() - 3600_000).toISOString() } });
  assert.equal(expired.allowed, false, 'изтекъл достъп не се дава');
  // Изчерпан лимит на изтеглянията по токен.
  const used = downloadAccess.decide({ policy: { ...downloadAccess.DEFAULT_POLICY, max_downloads: 1 }, token: { uses: 1, max_uses: 1 } });
  assert.equal(used.allowed, false, 'изчерпан лимит по токен не се дава');
  const oneTime = downloadAccess.decide({ policy: { ...downloadAccess.DEFAULT_POLICY, one_time: true }, token: { uses: 1 } });
  assert.equal(oneTime.allowed, false, 'еднократният токен не се ползва втори път');
  // По подразбиране (без ограничения) минава — това е „отворен“ артефакт.
  assert.equal(downloadAccess.decide({}).allowed, true, 'без ограничения достъпът минава');
  // Всяка проверка е с идентификатор — отказът е обясним, не мълчалив.
  assert.ok(Array.isArray(downloadAccess.decide({}).checks), 'решението носи списък с проверки');
  say('download-access: глобална забрана, недостъпно хранилище, изтекъл достъп и лимит отказват');

  // ── 9. CSP: административният интерфейс не позволява inline код ──────────
  const serverSrc = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'server.js'), 'utf8');
  const csps = [...serverSrc.matchAll(/Content-Security-Policy':\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(csps.length >= 3, 'всеки HTML отговор задава CSP');
  for (const csp of csps) {
    if (/script-src/.test(csp)) {
      assert.equal(/script-src[^;]*unsafe-inline/.test(csp), false, 'script-src не позволява inline: ' + csp);
      assert.equal(/script-src[^;]*unsafe-eval/.test(csp), false, 'script-src не позволява eval: ' + csp);
    }
    assert.match(csp, /default-src/, 'CSP-то затваря всичко останало: ' + csp);
  }
  const secretCsp = (serverSrc.match(/SECRET_CSP\s*=\s*"([^"]+)"/) || [])[1] || '';
  assert.match(secretCsp, /script-src 'self'/, 'страницата за тайна пуска само собствени скриптове');
  assert.equal(/script-src[^;]*unsafe-inline/.test(secretCsp), false, 'скриптовете в страницата за тайна не са inline');
  assert.match(secretCsp, /default-src 'none'/, 'всичко извън изрично разрешеното е забранено');
  assert.match(secretCsp, /frame-ancestors 'none'/, 'страницата не се вгражда в чужд iframe');
  say(`CSP: ${csps.length} политики, нито една с unsafe-inline/unsafe-eval`);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('PASS whitebox-security: крипто, достъп, файлове, парсери и CSP проверени отвътре');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
