'use strict';
// Договор на порталната политика (бисквитки, HTTPS преценка, ACL) и на тайните връзки
// (валидност на идентификатор/IV, чек за подателя, нормализиране на подсказка).
// Очакванията са точни стойности: име на бисквитка, брой секунди, дължина на чека.
const assert = require('node:assert/strict');
const P = require('../hapi_enterprise/portal-policy');
const S = require('../hapi_enterprise/secret-links');

// ── A. HTTPS преценка (isSecureRequest) ──────────────────────────────────────
assert.equal(P.isSecureRequest(null), false, 'A01 без заявка → false');
assert.equal(P.isSecureRequest({ headers: {} }), false, 'A02 без заглавки → false');
assert.equal(P.isSecureRequest({ headers: {}, socket: { encrypted: true } }), true, 'A03 шифрован сокет → true');
assert.equal(P.isSecureRequest({ headers: { 'x-forwarded-proto': 'https' } }), true, 'A04 прокси казва https → true');
assert.equal(P.isSecureRequest({ headers: { 'x-forwarded-proto': 'HTTPS' } }), true, 'A05 главни букви не пречат');
assert.equal(P.isSecureRequest({ headers: { 'x-forwarded-proto': 'https, http' } }), true, 'A06 взима се ПЪРВИЯТ протокол от веригата');
assert.equal(P.isSecureRequest({ headers: { 'x-forwarded-proto': 'http, https' } }), false, 'A07 първият е http → false, дори при https по-нататък');
assert.equal(P.isSecureRequest({ headers: { 'x-forwarded-proto': 'h2' } }), false, 'A08 друго значение → false');

// ── B. Четене на сесийната бисквитка (readSessionToken) ─────────────────────
assert.equal(P.readSessionToken({ headers: {} }), '', 'B01 без бисквитки → празен низ');
assert.equal(P.readSessionToken(null), '', 'B02 без заявка → празен низ');
assert.equal(P.readSessionToken({ headers: { cookie: 'hapi_session=abc' } }), 'abc', 'B03 обикновеното име се чете');
assert.equal(P.readSessionToken({ headers: { cookie: '__Host-hapi_session=xyz' } }), 'xyz', 'B04 __Host- името се чете');
assert.equal(
  P.readSessionToken({ headers: { cookie: 'other=1; __Host-hapi_session=secure; hapi_session=plain' } }),
  'secure',
  'B05 при двете имена печели __Host- (подправеното обикновено не се ползва)',
);
assert.equal(P.readSessionToken({ headers: { cookie: 'hapi_session=a%2Bb' } }), 'a+b', 'B06 стойността се декодира');
assert.equal(P.readSessionToken({ headers: { cookie: 'broken=%E0%A4%A; hapi_session=ok' } }), 'ok', 'B07 повредено кодиране не чупи четенето');
assert.equal(P.readSessionToken({ headers: { cookie: 'noequals; hapi_session=ok' } }), 'ok', 'B08 част без „=“ се прескача');

// ── C. Задаване и чистене на бисквитка ──────────────────────────────────────
const plain = P.sessionCookie({ headers: {} }, 'tok-1', 600);
assert.equal(plain.name, 'hapi_session', 'C01 по HTTP името е обикновено (Secure би я скрил от LAN)');
assert.equal(plain.secure, false, 'C02 по HTTP не е secure');
assert.match(plain.header, /^hapi_session=tok-1; Path=\/; HttpOnly; SameSite=Strict; Max-Age=600$/, 'C03 точният формат на заглавката');
assert.equal(plain.header.includes('Secure'), false, 'C04 по HTTP няма Secure');
const secure = P.sessionCookie({ headers: { 'x-forwarded-proto': 'https' } }, 'tok-2', 60.9);
assert.equal(secure.name, '__Host-hapi_session', 'C05 по HTTPS името е с __Host- префикс');
assert.equal(secure.secure, true, 'C06 по HTTPS е secure');
assert.match(secure.header, /Max-Age=60; Secure$/, 'C07 секундите се закръглят надолу');
assert.match(secure.header, /; Secure$/, 'C08 Secure е последен в заглавката');
assert.match(P.sessionCookie({ headers: {} }, 't', 0).header, /Max-Age=1$/, 'C09 нула секунди → минимум 1');
assert.equal(P.sessionCookie({ headers: {} }, 'a b&c', 10).header.startsWith('hapi_session=a%20b%26c;'), true, 'C10 токенът се кодира в бисквитката');
const cleared = P.clearCookie({ headers: { 'x-forwarded-proto': 'https' } });
assert.equal(cleared.name, '__Host-hapi_session', 'C11 чистенето ползва същото име като задаването');
assert.match(cleared.header, /^__Host-hapi_session=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0; Secure$/, 'C12 точната заглавка за изчистване');
assert.match(P.clearCookie({ headers: {} }).header, /^hapi_session=;.*Max-Age=0$/, 'C13 по HTTP — обикновеното име');

// ── D. ACL: userMayPortal ───────────────────────────────────────────────────
{
  const store = {
    getUserPortals: (u) => (u === 'empty' ? [] : u === 'limited' ? ['p1'] : ['p1', 'p2']),
    getPortalSession: () => null,
    getSession: () => null,
    purgeExpiredPortalAccess: () => ({ sessions: 0 }),
  };
  const denials = [];
  const policy = P.create({ store, signedPortal: () => false, sessionTtlSeconds: 600, onDeny: (e) => denials.push(e) });
  assert.equal(policy.userMayPortal('empty', 'anything'), true, 'D01 празен ACL значи „всички портали“');
  assert.equal(policy.userMayPortal('limited', 'p1'), true, 'D02 портал от ACL минава');
  assert.equal(policy.userMayPortal('limited', 'p2'), false, 'D03 портал извън ACL не минава');
  assert.equal(policy.userMayPortal('full', 'p2'), true, 'D04 портал от по-дълъг ACL минава');
  assert.equal(policy.sessionTtlSeconds, 600, 'D05 TTL се връща както е подаден');
  const snap = policy.snapshot();
  assert.equal(snap.requireToken, false, 'D06 по подразбиране токен не се изисква');
  assert.equal(snap.cookie.secure, P.COOKIE_SECURE, 'D07 снимката показва името за HTTPS');
  assert.equal(snap.cookie.plain, P.COOKIE_PLAIN, 'D08 …и обикновеното име');
  assert.equal(typeof snap.validationFailures, 'number', 'D09 сборният показател за откази е число');
  assert.equal(snap.activePortalSessions, 0, 'D10 активните портални сесии идват от хранилището');
  // Отказ без идентичност: причината се вижда в сензорите, но не и в отговора навън.
  const denied = policy.decide({ req: { headers: {} }, url: new URL('http://x/p/p1'), portal: { id: 'p1', visibility: 'private' } });
  assert.deepEqual(denied, { allowed: false, via: '', reason: 'no-identity' }, 'D11 без идентичност → отказ с причина no-identity');
  assert.deepEqual(denials, [{ reason: 'no-identity', portalId: 'p1', action: 'read' }], 'D12 отказът влиза в одита с причина и портал, без токен и IP');
  const open = policy.decide({ req: { headers: {} }, url: new URL('http://x/p/p1'), portal: { id: 'p1', visibility: 'public' } });
  assert.deepEqual(open, { allowed: true, via: 'public', reason: '' }, 'D13 публичен портал пуска без идентичност');
  const missing = policy.decide({ req: { headers: {} }, url: new URL('http://x/p/p1'), portal: {} });
  assert.equal(missing.allowed, false, 'D14 портал без видимост не е публичен');
}

// ── E. Тайни връзки: идентификатор и IV ─────────────────────────────────────
assert.equal(S.isValidId('ABCDEFGHJKMNPQRSTVWXY2'), true, 'E01 22 знака от азбуката → валиден');
assert.equal(S.isValidId('ABCDEFGHJKMNPQRSTVWXY'), false, 'E02 21 знака → невалиден');
assert.equal(S.isValidId('ABCDEFGHJKMNPQRSTVWXYZZ'), false, 'E03 23 знака → невалиден');
assert.equal(S.isValidId('ABCDEFGHJKMNPQRSTVWXYI'), false, 'E04 буквата I не е в азбуката');
assert.equal(S.isValidId('ABCDEFGHJKMNPQRSTVWXYO'), false, 'E05 буквата O не е в азбуката');
assert.equal(S.isValidId('abcdefghjkmnpqrstvwxy2'), false, 'E06 малки букви → невалиден');
assert.equal(S.isValidId(12345), false, 'E07 не-низ → невалиден');
assert.equal(S.isValidId(null), false, 'E08 null → невалиден');
assert.equal(S.isValidIv('AAAAAAAAAAAAAAAA'), true, 'E09 16 base64url знака → валиден IV');
assert.equal(S.isValidIv('AAAAAAAAAAAAAAA'), false, 'E10 15 знака → невалиден IV');
assert.equal(S.isValidIv('AAAAAAAAAAAAAAAAA'), false, 'E11 17 знака → невалиден IV');
assert.equal(S.isValidIv('AAAAAAAAAAAAAAA+'), false, 'E12 стандартен base64 „+“ не е разрешен');
assert.equal(S.isValidIv('AAAAAAAAAAAAAAA='), false, 'E13 подпълване „=“ не е разрешено');
assert.equal(S.isValidIv(undefined), false, 'E14 undefined → невалиден IV');

// ── F. Чек за подателя (newReceipt) ─────────────────────────────────────────
const seen = new Set();
for (let i = 0; i < 200; i++) {
  const r = S.newReceipt();
  assert.equal(typeof r, 'string', 'F01 чекът е низ');
  assert.equal(r.length, 8, 'F02 чекът е 8 знака');
  assert.match(r, /^[0-9A-HJKMNP-TV-Z]{8}$/, 'F03 чекът ползва азбуката без I/L/O/U');
  seen.add(r);
}
assert.ok(seen.size >= 195, 'F04 200 чека дават почти всички различни (измерено: ' + seen.size + ')');

// ── G. Подсказка (normalizeHint) ────────────────────────────────────────────
assert.equal(S.normalizeHint(null), '', 'G01 null → празно');
assert.equal(S.normalizeHint(undefined), '', 'G02 undefined → празно');
assert.equal(S.normalizeHint('  тайна  '), 'тайна', 'G03 подрязва се');
assert.equal(S.normalizeHint('a\u0000b\nc\td'), 'a b c d', 'G04 контролите стават интервал');
assert.equal(S.normalizeHint('x'.repeat(500)).length, 200, 'G05 дължината се ограничава до 200');
assert.equal(S.normalizeHint(42), '42', 'G06 число се превръща в текст');
assert.equal(S.normalizeHint('   '), '', 'G07 само интервали → празно');

console.log('PASS portal-policy-secret-links: 6 функции на политиката + 4 на тайните връзки · бисквитки, HTTPS, ACL, азбука, чек, подсказка');
