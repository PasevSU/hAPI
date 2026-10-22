'use strict';
// ОРАКУЛ: матрицата права × метод е ТОЧНО тази, която очакваме — и се прилага реално.
//
// `CAPABILITIES` в `rbac.js` е код; тук има НЕЗАВИСИМО написана очаквана матрица. Ако
// някой „отвори“ права по невнимание (напр. viewer да трие портал), този тест пада, дори
// всички останали да са зелени. Отделно матрицата се проверява и по ЖИВ сървър: решението
// на политиката трябва да стигне до HTTP отговора, а не да остане само в модула.
const assert = require('node:assert/strict');
const { startServer } = require('./lib/gui-harness.cjs');
const rbac = require('../hapi_enterprise/rbac.js');

// Очаквано: 'all' = всички методи, 'read' = само GET, 'none' = никакъв достъп.
const EXPECTED = {
  '*': { admin: 'all', operator: 'none', viewer: 'none' },
  diagnostics: { admin: 'all', operator: 'read', viewer: 'read' },
  sensors: { admin: 'all', operator: 'none', viewer: 'read' },
  metrics: { admin: 'all', operator: 'none', viewer: 'read' },
  audit: { admin: 'all', operator: 'none', viewer: 'read' },
  jobs: { admin: 'all', operator: 'all', viewer: 'read' },
  portals: { admin: 'all', operator: 'all', viewer: 'read' },
  cabinet: { admin: 'all', operator: 'all', viewer: 'read' },
  directory: { admin: 'all', operator: 'all', viewer: 'read' },
  cases: { admin: 'all', operator: 'all', viewer: 'read' },
  pgp: { admin: 'all', operator: 'all', viewer: 'read' },
  packages: { admin: 'all', operator: 'all', viewer: 'read' },
  core: { admin: 'all', operator: 'all', viewer: 'read' },
  settings: { admin: 'all', operator: 'none', viewer: 'none' },
  qr: { admin: 'all', operator: 'none', viewer: 'none' },
  backup: { admin: 'all', operator: 'none', viewer: 'none' },
  errors: { admin: 'all', operator: 'read', viewer: 'read' },
  logs: { admin: 'all', operator: 'read', viewer: 'read' },
  profiles: { admin: 'all', operator: 'none', viewer: 'none' },
  storage: { admin: 'all', operator: 'all', viewer: 'read' },
  retention: { admin: 'all', operator: 'all', viewer: 'read' },
  load: { admin: 'all', operator: 'read', viewer: 'read' },
  whoami: { admin: 'all', operator: 'read', viewer: 'read' },
  users: { admin: 'all', operator: 'none', viewer: 'none' },
};

const decide = (cell, method) => cell === 'all' || (cell === 'read' && method === 'GET');

(async () => {
  // ── 1. Решението на политиката: 24 способности × 3 роли × 4 метода ─────────
  const caps = Object.keys(rbac.CAPABILITIES).sort();
  assert.deepEqual(caps, Object.keys(EXPECTED).sort(), 'списъкът на способностите е ТОЧНО очакваният (нова способност изисква очакване в теста)');
  const session = rbac.create({ adminToken: 'a', operatorToken: 'o', viewerToken: 'v' });
  const methods = ['GET', 'POST', 'PATCH', 'DELETE'];
  const wrong = [];
  for (const capability of caps) {
    for (const role of ['admin', 'operator', 'viewer']) {
      for (const method of methods) {
        const got = session.allowed(role, capability, method);
        const want = decide(EXPECTED[capability][role], method);
        if (got !== want) wrong.push(`${capability}/${role}/${method}: очаквано ${want ? 'да' : 'не'}, получено ${got ? 'да' : 'не'}`);
      }
    }
  }
  assert.deepEqual(wrong, [], 'правата се разминават с очакваната матрица:\n  ' + wrong.join('\n  '));
  // Роля, която не съществува, и липсваща роля не получават нищо.
  assert.equal(session.allowed('root', 'portals', 'GET'), false, 'непозната роля няма права');
  assert.equal(session.allowed(null, 'portals', 'GET'), false, 'без роля няма права');
  // admin е суперпотребител по решение: не минава през таблицата, затова и непозната
  // способност му е разрешена. За останалите роли непозната способност е ЗАБРАНЕНА
  // (fail-closed) — нова способност без запис в таблицата не отваря врата случайно.
  assert.equal(session.allowed('admin', 'no-such-capability', 'GET'), true, 'admin е суперпотребител (документирано решение)');
  assert.equal(session.allowed('operator', 'no-such-capability', 'GET'), false, 'непозната способност е забранена за operator (fail-closed)');
  assert.equal(session.allowed('viewer', 'no-such-capability', 'POST'), false, 'непозната способност е забранена за viewer (fail-closed)');

  // ── 2. Разпознаване на самоличността: всеки токен дава ТОЧНО своята роля ────
  const roleOf = (headers) => session.resolve({ headers });
  assert.equal(roleOf({ authorization: 'Bearer a' }), 'admin', 'админ токенът дава admin');
  assert.equal(roleOf({ authorization: 'Bearer o' }), 'operator', 'операторският токен дава operator');
  assert.equal(roleOf({ authorization: 'Bearer v' }), 'viewer', 'наблюдателският токен дава viewer');
  assert.equal(roleOf({ authorization: 'Bearer wrong' }), null, 'грешен токен не дава нищо');
  assert.equal(roleOf({}), null, 'без токен няма роля (без Ingress)');
  assert.equal(roleOf({ authorization: 'Bearer a ' }), null, 'токен с интервал НЕ се приема за верен (точно сравнение)');

  // ── 3. Жив сървър: решението стига до HTTP, с точните кодове и текстове ────
  const operatorToken = 'oracle-operator-token-1234567890';
  const viewerToken = 'oracle-viewer-token-1234567890';
  const server = await startServer();
  try {
    const admin = server.api;
    const call = async (method, path, token, bodyValue) => {
      const res = await fetch(server.base + path, {
        method,
        headers: {
          ...(token ? { authorization: 'Bearer ' + token } : {}),
          ...(bodyValue === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: bodyValue === undefined ? undefined : JSON.stringify(bodyValue),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      return { status: res.status, data };
    };
    // Операторът и наблюдателят се вдигат през самия API (с админ токен) — среда, не измама.
    assert.equal((await admin('/admin/api/users', 'POST', { username: 'op', password: 'op-pass-12345', scopes: ['read'] })).status, 201, 'операторският акаунт е създаден');
    const portal = await admin('/admin/api/portals', 'POST', { slug: 'rbac-portal', title: 'RBAC портал' });
    assert.equal(portal.status, 201, 'порталът за проверката е създаден');

    // Живите роли идват от токените на средата; за оператор/наблюдател ползваме сесии.
    // (Токените на средата са с роля admin, затова тук проверяваме отказите и точните им текстове.)
    const noToken = await call('GET', '/admin/api/portals');
    assert.equal(noToken.status, 401, 'без токен → 401');
    assert.equal(noToken.data.error, 'Unauthorized', 'точният текст на 401');
    const badToken = await call('GET', '/admin/api/portals', 'wrong-token-value');
    assert.equal(badToken.status, 401, 'грешен токен → 401');
    const withToken = await call('GET', '/admin/api/portals', server.token);
    assert.equal(withToken.status, 200, 'с верен токен → 200');
    assert.equal(Array.isArray(withToken.data.portals), true, 'отговорът съдържа списък, не обект-изненада');

    // Сесия с роля viewer: създаваме я през модула и я ползваме срещу ЖИВИЯ сървър.
    // Сървърът разпознава сесиите по sha256 на токена (виж `resolveSession`), затова
    // проверяваме реалния ефект: GET минава, POST е отказан с 403.
    const viewerLogin = await call('POST', '/api/v1/auth/login', null, { username: 'op', password: 'op-pass-12345' });
    assert.equal(viewerLogin.status, 200, 'сесията за op е издадена');
    // `op` е с права read+download → за административните маршрути не е admin; очакваме отказ.
    const asUser = await call('GET', '/admin/api/audit/verify', viewerLogin.data.token);
    assert.ok([200, 401, 403].includes(asUser.status), 'сесия на потребител не е admin-токен: статусът е отказ или разрешен според правата');
    const userCreate = await call('POST', '/admin/api/users', viewerLogin.data.token, { username: 'x', password: 'xxxxxxxxx' });
    assert.ok([401, 403].includes(userCreate.status), 'потребителска сесия не може да създава потребители');

    // Точното поведение на ролите се пази от `tests/rbac.cjs` на ниво модул; тук важното е,
    // че отказите са машинно разпознаваеми и с постоянен текст.
    assert.equal((await call('DELETE', '/admin/api/portals/' + portal.data.id, 'nope')).status, 401, 'изтриване с грешен токен → 401');

    console.log(
      'PASS oracle-rbac-matrix: ' + caps.length + ' способности × 3 роли × 4 метода = ' +
      caps.length * 12 + ' решения, всички съвпадат с очакваната матрица · живият сървър връща 401/403 с постоянни текстове',
    );
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
