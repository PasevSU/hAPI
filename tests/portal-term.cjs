'use strict';
// СРОК И ДОСТЪП НА ПОРТАЛА — решения, които се взимат при създаването (0.69.210).
//
// Защо има тест: две решения, взети веднъж, управляват достъпа после — срокът (безсрочно /
// срочно с дни) и достъпът (свободен / заключен с парола). Ако проверката е само във формата,
// един POST на ръка я заобикаля; ако е само на сървъра, формата подвежда. Затова тук се
// проверяват И двете страни, а политиката се пита директно за изтекъл и заключен портал.
const assert = require('node:assert/strict');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const term = require(path.join(__dirname, '..', 'hapi_enterprise', 'portal-term.js'));
const policyLib = require(path.join(__dirname, '..', 'hapi_enterprise', 'portal-policy.js'));

const DAY = 24 * 60 * 60 * 1000;

// ── 1. Правилата: срок ──────────────────────────────────────────────────────
console.log('· срок: безсрочно не носи край, срочно изисква дни');
{
  const open = term.normalize({ term: 'unlimited', access: 'free' });
  assert.equal(open.ok, true);
  assert.equal(open.term, 'unlimited');
  assert.equal(open.expiresAt, null, '„безсрочно“ не значи „много дни“ — няма expiresAt');
  assert.equal(open.access, 'free');
  assert.equal(open.passwordHash, null, 'свободният портал не носи парола');

  const at = 1760000000000;
  const limited = term.normalize({ term: 'limited', termDays: '7', access: 'free' }, { now: () => at });
  assert.equal(limited.ok, true);
  assert.equal(limited.expiresAt, new Date(at + 7 * DAY).toISOString(), 'expiresAt = сега + 7 дни');

  for (const days of ['0', '3651', '7.5', '-3', 'седем', '']) {
    assert.equal(
      term.normalize({ term: 'limited', termDays: days, access: 'free' }).ok,
      false,
      'невалидни дни трябва да се откажат: ' + JSON.stringify(days),
    );
  }
}

// ── 2. Правилата: достъп ────────────────────────────────────────────────────
console.log('· достъп: заключеният изисква парола и я пази като хеш');
{
  assert.equal(term.normalize({ term: 'unlimited', access: 'locked' }).ok, false, 'без парола — отказ');
  assert.equal(
    term.normalize({ term: 'unlimited', access: 'locked', password: 'кратка' }).ok,
    false,
    'под 8 знака — отказ',
  );
  const locked = term.normalize({ term: 'unlimited', access: 'locked', password: 'Dve-tri-dumi-9' });
  assert.equal(locked.ok, true);
  assert.match(locked.passwordHash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/, 'формат scrypt$salt$hash');
  assert.equal(locked.passwordHash.includes('Dve-tri-dumi-9'), false, 'паролата НЕ стои в записа');
  assert.equal(term.verifyPassword('Dve-tri-dumi-9', locked.passwordHash), true, 'вярната парола минава');
  assert.equal(term.verifyPassword('dve-tri-dumi-9', locked.passwordHash), false, 'сгрешената — не');
  assert.equal(term.verifyPassword('', locked.passwordHash), false);
  assert.equal(term.verifyPassword('каквото-и-да-е', 'не-е-хеш'), false, 'счупен запис значи „не съвпада“');
  // Два портала с еднаква парола имат РАЗЛИЧНИ хешове (сол на всеки запис).
  const again = term.normalize({ term: 'unlimited', access: 'locked', password: 'Dve-tri-dumi-9' });
  assert.notEqual(again.passwordHash, locked.passwordHash, 'солта е различна за всеки портал');
}

// ── 3. Правилата: съвместимост и частични решения ──────────────────────────
console.log('· заявка без нито едно решение остава валидна (стари клиенти), частична — не');
{
  const legacy = term.normalize({ slug: 'x', title: 'X' });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.term, 'unlimited');
  assert.equal(legacy.access, 'free');
  assert.equal(term.normalize({ term: 'limited', access: 'free' }).ok, false, 'срочно без дни — отказ');
  assert.equal(term.normalize({ access: 'locked', password: 'osем-знака' }).ok, false, 'достъп без срок — отказ');
}

// ── 4. Срокът важи и за публичен портал (политиката) ───────────────────────
console.log('· изтекъл портал се отказва дори когато е публичен; заключен не пада в „публичния“ клон');
{
  const policy = policyLib.create({ store: { getPortalSession: () => null, getSession: () => null, getUserPortals: () => [] } });
  const now = Date.now();
  const expired = policy.decide({ req: { headers: {} }, url: new URL('http://h/api/v1/p/x'), portal: { id: 'p1', visibility: 'public', expiresAt: new Date(now - DAY).toISOString() } });
  assert.equal(expired.allowed, false, 'изтеклият портал не се сервира');
  assert.equal(expired.reason, 'expired', 'причината е названа, не „няма идентичност“');

  const alive = policy.decide({ req: { headers: {} }, url: new URL('http://h/api/v1/p/x'), portal: { id: 'p1', visibility: 'public', expiresAt: new Date(now + DAY).toISOString() } });
  assert.equal(alive.allowed, true, 'порталът в срока си минава като публичен');

  const locked = policy.decide({ req: { headers: {} }, url: new URL('http://h/api/v1/p/x'), portal: { id: 'p1', visibility: 'public', access: 'locked' } });
  assert.equal(locked.allowed, false, 'заключеният портал НЕ минава с флаг „публичен“');
  assert.equal(locked.reason, 'locked');

  const legacy = policy.decide({ req: { headers: {} }, url: new URL('http://h/api/v1/p/x'), portal: { id: 'p1', visibility: 'public' } });
  assert.equal(legacy.allowed, true, 'старият портал (без полета) работи както преди');
}

// ── 5. Живият сървър: създаване и отключване ────────────────────────────────
(async () => {
  const server = await startServer();
  try {
    console.log('· създаване: пълните решения се пазят, а паролата не се показва');
    {
      const res = await server.api('/admin/api/portals', 'POST', {
        slug: 'term-locked',
        title: 'Term locked',
        visibility: 'public',
        term: 'limited',
        termDays: 5,
        access: 'locked',
        password: 'Dve-tri-dumi-9',
      });
      assert.equal(res.status, 201, 'порталът е създаден');
      const p = res.data;
      assert.equal(p.term, 'limited');
      assert.equal(p.access, 'locked');
      assert.ok(p.expiresAt, 'има краен срок');
      const days = (Date.parse(p.expiresAt) - Date.now()) / DAY;
      assert.ok(days > 4.9 && days <= 5.01, 'срокът е 5 дни, измерено: ' + days.toFixed(2));
      assert.equal(JSON.stringify(p).includes('Dve-tri-dumi-9'), false, 'паролата не се връща в отговора');
      assert.equal(JSON.stringify(p).includes('scrypt$'), false, 'и хешът не се връща');
    }

    console.log('· създаване: невалидни решения се отказват с 400');
    {
      const missingDays = await server.api('/admin/api/portals', 'POST', {
        slug: 'term-bad-1',
        title: 'Bad',
        term: 'limited',
        access: 'free',
      });
      assert.equal(missingDays.status, 400, 'срочно без дни → 400');
      const noPassword = await server.api('/admin/api/portals', 'POST', {
        slug: 'term-bad-2',
        title: 'Bad',
        term: 'unlimited',
        access: 'locked',
      });
      assert.equal(noPassword.status, 400, 'заключен без парола → 400');
      const badTerm = await server.api('/admin/api/portals', 'POST', {
        slug: 'term-bad-3',
        title: 'Bad',
        term: 'forever',
        access: 'free',
      });
      assert.equal(badTerm.status, 400, 'непознат срок → 400');
      const legacy = await server.api('/admin/api/portals', 'POST', { slug: 'term-legacy', title: 'Legacy' });
      assert.equal(legacy.status, 201, 'старият вид заявка остава валиден');
      assert.equal(legacy.data.term, 'unlimited');
      assert.equal(legacy.data.access, 'free');
    }

    console.log('· заключен портал: без парола не се отваря, с парола дава подписан достъп');
    {
      const created = await server.api('/admin/api/portals', 'POST', {
        slug: 'term-locked-2',
        title: 'Locked two',
        visibility: 'public',
        term: 'unlimited',
        access: 'locked',
        password: 'Osem-znaka-1',
      });
      assert.equal(created.status, 201);
      const slug = created.data.slug;

      const closed = await fetch(server.base + '/api/v1/p/' + slug);
      assert.ok([401, 404].includes(closed.status), 'без достъп порталът не се показва: ' + closed.status);

      const wrong = await server.api('/api/v1/p/' + slug + '/unlock', 'POST', { password: 'greshna-parola' });
      assert.equal(wrong.status, 401, 'грешната парола е 401');

      const ok = await server.api('/api/v1/p/' + slug + '/unlock', 'POST', { password: 'Osem-znaka-1' });
      assert.equal(ok.status, 200, 'вярната парола отключва');
      assert.match(String(ok.data.query || ''), /expires=\d+&sig=[0-9a-f]+/, 'връща се подписан достъп');

      const open = await fetch(server.base + '/api/v1/p/' + slug + ok.data.query);
      assert.equal(open.status, 200, 'с подписания достъп порталът се отваря');

      const notLocked = await server.api('/api/v1/p/term-legacy/unlock', 'POST', { password: 'Osem-znaka-1' });
      assert.equal(notLocked.status, 400, 'свободен портал не се отключва — няма какво');
    }

    console.log('· изтекъл портал не се отключва (410), дори с вярна парола');
    {
      // Проверява се САМИЯТ компонент, не базата: срокът се измества в миналото, както го
      // прави времето, и компонентът трябва да откаже преди да е пипнал паролата.
      const unlock = require(path.join(__dirname, '..', 'hapi_enterprise', 'routes', 'portal-unlock.js')).create({
        json: (res, status, body) => {
          res.statusCode = status;
          res.body = body;
          return true;
        },
        fail: (res, status) => {
          res.statusCode = status;
          return true;
        },
        parse: async () => ({ password: 'Osem-znaka-2' }),
        audit: () => {},
        resolvePortal: () => ({
          id: 'p_expired',
          slug: 'term-expired',
          access: 'locked',
          expiresAt: new Date(Date.now() - DAY).toISOString(),
          passwordHash: term.hashPassword('Osem-znaka-2'),
        }),
        portalTerm: term,
        portalAccess: { issue: () => ({ query: '?expires=1&sig=00', expires: 1 }) },
        fallbackSecret: 'x'.repeat(64),
      });
      const res = {};
      const handled = await unlock.handle({ req: {}, res, parts: ['api', 'v1', 'p', 'term-expired', 'unlock'], method: 'POST' });
      assert.equal(handled, true, 'маршрутът е негов');
      assert.equal(res.statusCode, 410, 'изтекъл портал → 410, преди проверката на паролата');
    }

    console.log('PASS portal-term: срок (безсрочно/срочно с дни) · достъп (свободен/заключен с парола) · задължителни в панела, съвместими в API · изтекъл → отказ · unlock → подписан достъп · грешна парола → 401 · 410 след срока');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error('FAIL portal-term:', e && e.message);
  process.exitCode = 1;
});
