'use strict';
// Договор на чистите помощни функции: OIDC (роли, групи, бисквитка, живи входове, откриване,
// ключове), QR ревизии, наблюдател на файлове, тайни връзки за изпращане, пароли на пакети,
// печати в отчета и предупреждението за криптиране без ключ.
// Всяка проверка твърди ОЧАКВАН РЕЗУЛТАТ (низ, обект, статус на грешката), а не „има поле“.
const assert = require('node:assert/strict');
const OIDC = require('../hapi_enterprise/oidc');
const QR = require('../hapi_enterprise/portal-qr');
const OBS = require('../hapi_enterprise/observer');
const SEND = require('../hapi_enterprise/send');
const PKG = require('../hapi_enterprise/package-crypto');
const STAMP = require('../hapi_enterprise/report-stamp');
const SKIN = require('../hapi_enterprise/portal-skin');

async function main() {

// ── A. OIDC: роля от групи (roleFor) ────────────────────────────────────────
{
  const cfg = { adminGroup: 'hapi-admins', allowedGroups: ['hapi-users'] };
  assert.equal(OIDC.roleFor(cfg, ['hapi-admins']), 'admin', 'A01 админската група дава admin');
  assert.equal(OIDC.roleFor(cfg, ['hapi-users']), 'viewer', 'A02 разрешена група дава viewer');
  assert.equal(OIDC.roleFor(cfg, ['hapi-admins', 'hapi-users']), 'admin', 'A03 двете групи → admin (по-силната)');
  assert.equal(OIDC.roleFor(cfg, ['other']), null, 'A04 неразрешена група → null (отказ)');
  assert.equal(OIDC.roleFor(cfg, []), null, 'A05 без групи → null');
  assert.equal(OIDC.roleFor({ adminGroup: '', allowedGroups: [] }, []), 'viewer', 'A06 без ограничения всяка удостоверена самоличност е viewer');
  assert.equal(OIDC.roleFor({ adminGroup: 'a', allowedGroups: [] }, ['a']), 'admin', 'A07 админската група пуска и при празен списък');
}

// ── B. OIDC: групи от твърдения (groupsOf) ──────────────────────────────────
{
  const cfg = { groupsClaim: 'groups' };
  assert.deepEqual(OIDC.groupsOf(cfg, { groups: ['a', 'b'] }), ['a', 'b'], 'B01 масив от групи минава както е');
  assert.deepEqual(OIDC.groupsOf(cfg, { groups: 'a, b  c' }), ['a', 'b', 'c'], 'B02 низ се разделя по запетая и интервал');
  // `String(null)` дава „null“ — празните низове падат, но null става група с име „null“.
  // Безвредно е (иска се изрично „null“ в allowedGroups), затова се документира, не се „поправя“.
  assert.deepEqual(OIDC.groupsOf(cfg, { groups: ['a', '', null, 3] }), ['a', 'null', '3'], 'B03 празните низове се изхвърлят, числата и null стават текст');
  assert.deepEqual(OIDC.groupsOf(cfg, {}), [], 'B04 липсващо твърдение → празен списък');
  assert.deepEqual(OIDC.groupsOf(cfg, null), [], 'B05 без твърдения → празен списък');
  assert.deepEqual(OIDC.groupsOf({ groupsClaim: 'roles' }, { roles: ['x'], groups: ['y'] }), ['x'], 'B06 името на твърдението се взима от конфигурацията');
  assert.deepEqual(OIDC.groupsOf({ groupsClaim: 'roles' }, { roles: 42 }), [], 'B07 число вместо списък → празен списък');
}

// ── C. OIDC: SSO бисквитка (sessionCookie) ──────────────────────────────────
assert.equal(OIDC.sessionCookie({}, 'tok', false), 'hapi_sso=tok; Path=/; HttpOnly; SameSite=Lax', 'C01 без HTTPS точният низ');
assert.equal(OIDC.sessionCookie({}, 'tok', true), 'hapi_sso=tok; Path=/; HttpOnly; SameSite=Lax; Secure', 'C02 с HTTPS се добавя Secure');
assert.equal(OIDC.sessionCookie({}, 'tok', false).includes('HttpOnly'), true, 'C03 бисквитката е недостъпна за скрипт');

// ── D. OIDC: живи входове (createFlows) ────────────────────────────────────
{
  let clock = 1_000_000;
  const flows = OIDC.createFlows({ now: () => clock, random: (n) => Buffer.alloc(n, 7) });
  const started = flows.start({ redirectUrl: 'https://ha/auth' });
  assert.equal(started.state.length, 43, 'D01 state е 43 base64url знака (32 байта)');
  assert.equal(started.nonce.length, 43, 'D02 nonce е 43 знака');
  assert.equal(started.verifier.length, 43, 'D03 verifier е 43 знака');
  assert.equal(started.challenge, OIDC.b64url(OIDC.sha256(started.verifier)), 'D04 challenge е S256 на verifier');
  assert.equal(started.redirectUrl, 'https://ha/auth', 'D05 адресът за връщане се връща обратно');
  assert.equal(flows.size(), 1, 'D06 един чакащ вход');
  const taken = flows.take(started.state);
  assert.equal(taken.nonce, started.nonce, 'D07 взетият вход носи същия nonce');
  assert.equal(taken.until, clock + OIDC.FLOW_TTL_MS, 'D08 срокът е TTL от момента на започване');
  assert.equal(flows.take(started.state), null, 'D09 състоянието се харчи веднъж');
  assert.equal(flows.size(), 0, 'D10 …и изчезва от картата');
  assert.equal(flows.take('nope'), null, 'D11 непознато състояние → null');
  const expiring = flows.start({ redirectUrl: 'x' });
  clock += OIDC.FLOW_TTL_MS + 1;
  assert.equal(flows.take(expiring.state), null, 'D12 изтекъл вход → null');
}

// ── E. OIDC: откриване и ключове (createDiscovery, createJwks) ──────────────
{
  const issuer = 'https://id.example';
  const calls = [];
  const good = {
    issuer,
    authorization_endpoint: issuer + '/auth',
    token_endpoint: issuer + '/token',
    jwks_uri: issuer + '/keys',
  };
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => good } };
  const discover = OIDC.createDiscovery({ fetchImpl, now: () => 0 });
  const first = await discover(issuer);
  assert.equal(first.token_endpoint, issuer + '/token', 'E01 откриването връща endpoint-ите');
  const second = await discover(issuer);
  assert.equal(second, first, 'E02 второто викане идва от кеша');
  assert.equal(calls.length, 1, 'E03 …тоест мрежата е ударена веднъж');
  await discover(issuer, { force: true });
  assert.equal(calls.length, 2, 'E04 force презарежда');
  const inconsistent = OIDC.createDiscovery({ fetchImpl: async () => ({ ok: true, json: async () => ({ issuer: 'https://other' }) }), now: () => 0 });
  await assert.rejects(() => inconsistent(issuer), (e) => e.status === 502 && e.code === 'OIDC_DISCOVERY', 'E05 несъответно откриване → 502 OIDC_DISCOVERY');
  const failing = OIDC.createDiscovery({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }), now: () => 0 });
  await assert.rejects(() => failing(issuer), (e) => e.status === 502, 'E06 недостъпен доставчик → 502');

  const keyCalls = [];
  const jwksFetch = async (url) => {
    keyCalls.push(url);
    return { ok: true, json: async () => ({ keys: [{ kty: 'RSA', kid: 'k1', n: 'AA', e: 'AQAB' }, { kty: 'EC', kid: 'k2' }] }) };
  };
  const jwks = OIDC.createJwks({ fetchImpl: jwksFetch, now: () => 0 });
  const keys = await jwks(issuer + '/keys');
  assert.deepEqual(keys.map((k) => k.kid), ['k1'], 'E07 не-RSA ключовете се изхвърлят');
  await jwks(issuer + '/keys');
  assert.equal(keyCalls.length, 1, 'E08 ключовете се кешират');
  const empty = OIDC.createJwks({ fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [] }) }), now: () => 0 });
  await assert.rejects(() => empty('u'), (e) => e.status === 502 && e.code === 'OIDC_KEYS', 'E09 без използваеми ключове → 502 OIDC_KEYS');
}

// ── F. QR ревизии и дълбочина ───────────────────────────────────────────────
assert.equal(QR.depthOf('a/b/c'), 3, 'F01 дълбочината е броят сегменти');
assert.equal(QR.depthOf('/a//b/'), 2, 'F02 празните сегменти не се броят');
assert.equal(QR.depthOf(null), 0, 'F03 null → нула');
assert.equal(QR.depthOf(''), 0, 'F04 празен низ → нула');
assert.equal(QR.depthOf('една'), 1, 'F05 един сегмент → 1');
assert.equal(QR.depthOf('a/b/' + QR.MAX_DEPTH + '/x'), 4, 'F06 четири сегмента → 4');
assert.equal(QR.tooDeep('a/b'), false, 'F07 плитка папка не е твърде дълбока');
assert.equal(QR.tooDeep('a/b/c/d'), true, 'F08 над лимита → твърде дълбока');
assert.equal(QR.qrIdOf(1), 'QR-001', 'F09 първият QR е QR-001');
assert.equal(QR.qrIdOf(42), 'QR-042', 'F10 номерът се допълва до три цифри');
assert.equal(QR.qrIdOf(1234), 'QR-1234', 'F11 над 999 не се реже');
assert.equal(QR.activeRevision({ revisions: [] }), null, 'F12 без ревизии няма активна');
const r1 = { id: 'QR-001' };
assert.equal(QR.activeRevision({ revisions: [r1] }), r1, 'F13 последната неблокирана е активна');
assert.equal(QR.activeRevision({ revisions: [r1, { id: 'QR-003', blockedAt: '2026-01-01' }] }), null, 'F14 блокирана последна ревизия → НЯМА активна (връща се null, не предишната)');
assert.equal(QR.activeRevision({}), null, 'F15 липсващ списък → null');

// ── G. Наблюдател: нормализиране на път и броячи на файлове ────────────────
assert.equal(OBS.normalizePath('/api/v1/p/abc/site/x'), '/api/v1/p/:slug/site/x', 'G01 публичният път губи слага');
assert.equal(OBS.normalizePath('/p/some-portal/2026/doc.pdf'), '/p/:slug/2026/doc.pdf', 'G02 порталният път губи слага');
assert.equal(OBS.normalizePath('/qr/slug.png?v=1'), '/qr/:slug', 'G03 заявката се отрязва преди „?“ и целият QR път става :slug');
assert.equal(OBS.normalizePath('/site/portal/project/file.html'), '/site/:portal/:project/file.html', 'G04 проектът се заменя с две места');
assert.equal(OBS.normalizePath('/x/0123456789abcdef01234567/y'), '/x/:id/y', 'G05 24 hex става :id');
assert.equal(OBS.normalizePath('/x/2f1a5c3e-1111-4222-8333-444455556666'), '/x/:uuid', 'G06 UUID става :uuid');
assert.equal(OBS.normalizePath('/x/report.tsr'), '/x/:file', 'G07 файл с разширение става :file');
assert.equal(OBS.normalizePath(null), '/', 'G08 без път → „/“');
{
  const obs = OBS.create({ dir: null });
  obs.fileUpload({ bytes: 120 });
  obs.fileUpload({ bytes: 80, encrypted: true });
  obs.fileDelete({ bytes: 50 });
  const status = obs.snapshot ? obs.snapshot() : obs.status();
  assert.equal(status.files.uploaded, 2, 'G09 две качвания');
  assert.equal(status.files.uploadBytes, 200, 'G10 байтовете се сумират');
  assert.equal(status.files.encrypted, 1, 'G11 едно от тях е криптирано');
  assert.equal(status.files.deleted, 1, 'G12 едно изтриване');
  assert.equal(status.files.deleteBytes, 50, 'G13 изтритите байтове');
}

// ── H. Тайни връзки за изпращане: изтекъл/изчерпан ─────────────────────────
assert.equal(SEND.isExpired({ expiresAt: new Date(Date.now() - 1000).toISOString() }), true, 'H01 минал срок → изтекъл');
assert.equal(SEND.isExpired({ expiresAt: new Date(Date.now() + 60_000).toISOString() }), false, 'H02 бъдещ срок → не е изтекъл');
assert.equal(SEND.isExpired({}), false, 'H03 без срок → не изтича');
assert.equal(SEND.isExpired(null), false, 'H04 без запис → false');
assert.equal(SEND.isExpired({ expiresAt: 'не-дата' }), false, 'H05 невалидна дата не се брои за изтекла');
assert.equal(SEND.isExhausted({ maxAccess: 0, accessCount: 10 }), false, 'H06 нула значи без лимит');
assert.equal(SEND.isExhausted({ maxAccess: 2, accessCount: 2 }), true, 'H07 точно до лимита → изчерпан');
assert.equal(SEND.isExhausted({ maxAccess: 3, accessCount: 2 }), false, 'H08 под лимита → не е');
assert.equal(SEND.isExhausted({}), false, 'H09 без лимит → не е');
assert.equal(SEND.isExhausted(null), false, 'H10 без запис → false');

// ── I. Пароли на пакети (isContainer, generatePassword) ────────────────────
assert.equal(PKG.isContainer(Buffer.from('PKG1')), false, 'I01 къс буфер не е контейнер');
assert.equal(PKG.isContainer('низ'), false, 'I02 не-буфер → false');
assert.equal(PKG.isContainer(null), false, 'I03 null → false');
const pwd = PKG.generatePassword(24);
assert.equal(pwd.length, 24, 'I04 исканата дължина се спазва');
assert.match(pwd, /^[A-HJ-NP-Za-km-z2-9]+$/, 'I05 азбуката е без подвеждащи знаци (0/O/1/l/I)');
assert.notEqual(PKG.generatePassword(24), pwd, 'I06 две пароли не съвпадат');
assert.equal(PKG.generatePassword(4).length, 24, 'I07 под минимума → подразбиращите се 24');
assert.equal(PKG.generatePassword(500).length, 500, 'I08 исканата дълга парола се спазва');

// ── J. Печати в отчета (startFields, stopFields) ───────────────────────────
{
  const start = STAMP.startFields('abcdef', { id: 'E1', title: 'Доказателство' });
  assert.equal(Array.isArray(start), true, 'J01 началните полета са редове');
  assert.equal(start.some(([k, v]) => k === 'Marker' && v === 'START'), true, 'J02 първият ред е маркерът START');
  assert.equal(start.some(([k, v]) => k === 'Evidence-Set SHA-256' && v === 'ABCDEF'), true, 'J03 хашът се вдига до главни букви');
  // Интервалите НЕ се подрязват: `upper` само вдига регистъра. Документира се, защото
  // отчетът показва стойността точно както е подадена от извикващия.
  assert.equal(STAMP.startFields('  abc  ', null).find(([k]) => k === 'Evidence-Set SHA-256')[1], '  ABC  ', 'J03б интервалите се запазват както са подадени');
  assert.equal(start.some(([k, v]) => k === 'START Binding' && v === STAMP.BINDING), true, 'J04 връзката към спецификацията е в полетата');
  const empty = STAMP.startFields('', null);
  assert.equal(empty.some(([k, v]) => k === 'Evidence-Set SHA-256' && /not established/.test(v)), true, 'J05 без хаш се пише „not established“');
  const stop = STAMP.stopFields('abcdef', '0123', null, 'f'.repeat(64));
  assert.equal(stop.some(([k, v]) => k === 'Marker' && v === 'STOP'), true, 'J06 крайните полета носят маркера STOP');
  assert.equal(stop.some(([k, v]) => k === 'STOP Closing Message Imprint' && v === '0123'), true, 'J07 затварящият отпечатък присъства');
  assert.equal(stop.some(([k, v]) => k === 'START Anchor Used by STOP' && v === 'F'.repeat(64)), true, 'J08 котвата към началото е с главни букви');
}

// ── K. Криптиране без ключ (warnEncryptionWithoutKey) ──────────────────────
{
  const warned = [];
  const log = { warn: (event, data) => warned.push([event, data]) };
  assert.equal(SKIN.warnEncryptionWithoutKey({ status: () => ({ encryptPaths: false, encryptWorkdir: false, available: true }) }, log), false, 'K01 без криптиране → няма предупреждение');
  assert.equal(warned.length, 0, 'K02 …и логът е празен');
  assert.equal(SKIN.warnEncryptionWithoutKey({ status: () => ({ encryptPaths: true, available: true }) }, log), false, 'K03 ключът е наличен → няма предупреждение');
  assert.equal(warned.length, 0, 'K04 …пак празно');
  assert.equal(SKIN.warnEncryptionWithoutKey({ status: () => ({ encryptPaths: true, available: false, reason: 'NO_KEY' }) }, log), true, 'K05 криптиране без ключ → предупреждение');
  assert.equal(warned[0][0], 'pgp.encryption.without-key', 'K06 събитието има точно това име');
  assert.equal(warned[0][1].reason, 'NO_KEY', 'K07 причината се предава');
  assert.equal(SKIN.warnEncryptionWithoutKey({ status: () => ({ encryptWorkdir: true, available: false }) }, log), true, 'K08 работната папка също вдига предупреждение');
  assert.equal(warned[1][1].reason, 'NO_KEY', 'K09 без причина се пише NO_KEY');
  assert.equal(SKIN.warnEncryptionWithoutKey({ status: () => ({ encryptPaths: true, available: false }) }, null), true, 'K10 без лог пак връща true');
}

  console.log('PASS helper-contracts: 19 функции · OIDC роли/групи/бисквитка/входове/откриване/ключове, QR ревизии, наблюдател, изтекли връзки, пароли, печати, криптиране без ключ');
}

main().catch((e) => { console.error(e); process.exit(1) });
