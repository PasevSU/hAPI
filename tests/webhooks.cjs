'use strict';
// Webhooks с HMAC (F4-7) — договорът от `documentation/02_TO_BE_ARCHITECTURE/INTEGRATION_CONTRACTS.md`
// §„Events / webhooks“ и `documentation/04_FUNCTION_SPECIFICATIONS/WEBHOOKS.md`.
//
// Проверява се това, което получателят НАИСТИНА може да разчита:
//   • подписът е HMAC-SHA256 върху `<t>.<тяло>` и се проверява със същата функция;
//   • старо `t` се отказва (иначе прихванато съобщение минава повторно);
//   • ключът се вижда ЕДИН път при създаването, после само последните 4 знака;
//   • отказ (500) води до повторение с изчакване, а не до тихо изчезване;
//   • след последния опит доставката е „изчерпана“ и се вижда, вместо да се трие;
//   • в тялото НЕ излизат пътища, пароли и ключове;
//   • HTTP: 401 без токен, 201 с ключ, 400 при непознато събитие, 404 при чужд id.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { freePort } = require('./helpers.cjs');
const { create, EVENTS, sign, verifySignature, publicDetails } = require('../hapi_enterprise/webhooks.js');
const { open: openStore } = require('../hapi_enterprise/sqlite-store.js');

const cases = [];
const ok = (label) => cases.push(label);

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-webhooks-'));
  const store = openStore(path.join(dir, 'metadata.json'));
  store.save({ portals: [], users: [] });
  return { dir, store };
}

/** Получател, който приема всичко и пази какво е получил. */
function receiver() {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return { server, received };
}

(async () => {
  // ── 1. Подписът: същата функция от двете страни, старо `t` се отказва ─────
  {
    const secret = 'whsec_test_0123456789';
    const body = '{"event":"document.finalized"}';
    const t = 1_800_000_000;
    const header = 't=' + t + ',v1=' + sign(secret, t, body);
    assert.equal(verifySignature(secret, header, body, 300, t * 1000).ok, true, 'верен подпис минава');
    assert.equal(verifySignature(secret, header, body, 300, (t + 301) * 1000).reason, 'STALE', 'старо t → STALE');
    assert.equal(verifySignature(secret, header, body + ' ', 300, t * 1000).reason, 'BAD_SIGNATURE', 'променено тяло → BAD_SIGNATURE');
    assert.equal(verifySignature('друг-ключ', header, body, 300, t * 1000).reason, 'BAD_SIGNATURE', 'друг ключ → BAD_SIGNATURE');
    assert.equal(verifySignature(secret, 'боклук', body, 300, t * 1000).reason, 'MALFORMED', 'счупена заглавка → MALFORMED');
    ok('подпис: верен минава, старо t → STALE, друго тяло/ключ → BAD_SIGNATURE');
  }

  // ── 2. Тялото не изнася тайни и пътища ────────────────────────────────────
  {
    const details = publicDetails({
      fileId: 'f_123',
      portalId: 'p_1',
      count: 3,
      done: true,
      password: 'x',
      secretKey: 'y',
      token: 'z',
      path: '/share/hapi/data/x.pdf',
      nested: { anything: 1 },
      long: 'a'.repeat(400),
    });
    assert.equal(details.fileId, 'f_123');
    assert.equal(details.count, 3);
    assert.equal(details.done, true);
    assert.ok(!('password' in details) && !('secretKey' in details) && !('token' in details), 'ключовете по име не излизат');
    assert.ok(!('path' in details), 'път до файл не излиза');
    assert.ok(!('nested' in details), 'обект не излиза');
    assert.equal(details.long.length, 200, 'дълъг низ се реже');
    ok('тялото: без пароли/ключове/пътища/обекти, дългите низове се режат');
  }

  // ── 3. Абонамент: ключът се вижда веднъж, в базата е само отпечатък ───────
  const { store } = tempStore();
  const hooks = create({ store, audit: () => { } });
  let created;
  {
    created = hooks.subscribe({ url: 'http://127.0.0.1:9/hook', events: ['document.finalized'], label: 'тест' });
    assert.match(created.id, /^wh_[a-f0-9]{18}$/);
    assert.match(created.secret, /^whsec_[A-Za-z0-9_-]{40,}$/, 'ключът е дълъг и с префикс');
    assert.equal(created.secretHint, created.secret.slice(-4), 'виждат се само последните 4 знака');
    const listed = hooks.status().subscriptions;
    assert.equal(listed.length, 1);
    assert.ok(!JSON.stringify(listed).includes(created.secret), 'ключът НЕ се връща при четене');
    assert.ok(!JSON.stringify(store.listWebhooks()).includes(created.secret), 'ключът НЕ е в базата');
    ok('абонамент: ключ веднъж при създаване, после само последните 4 знака');
  }

  // ── 4. Непознат адрес/събитие се отказва с 400, не се записва ─────────────
  {
    assert.throws(() => hooks.subscribe({ url: 'ftp://x/y', events: ['document.finalized'] }), (e) => e.status === 400);
    assert.throws(() => hooks.subscribe({ url: 'http://x/y', events: ['no.such.event'] }), (e) => e.status === 400 && /Unknown event/.test(e.message));
    assert.throws(() => hooks.subscribe({ url: 'http://x/y', events: [] }), (e) => e.status === 400);
    assert.equal(hooks.status().subscriptions.length, 1, 'отказаните не са се записали');
    ok('невалиден адрес/събитие → 400 и нищо не се записва');
  }

  // ── 5. Доставка: подписът стига до получателя и се проверява ─────────────
  const { server, received } = receiver();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  {
    // Първият абонамент (от проверка 3) сочи към затворен порт — той е „неуспешният“
    // получател. Тук се добавя втори, който наистина слуша.
    const live = hooks.subscribe({ url: 'http://127.0.0.1:' + port + '/hook', events: ['document.finalized'] });
    hooks.remember(live.id, live.secret);
    const queued = hooks.publish('document.finalized', { fileId: 'f_9', portalId: 'p_1' });
    assert.equal(queued, 2, 'излъчването стига до ВСЕКИ абониран, не само до първия');
    const counts = await hooks.drain();
    assert.equal(counts.sent, 1, 'работещият получател е получил: ' + JSON.stringify(counts));
    // Затвореният порт или дава неуспех, или (ако ключът не е в паметта на този
    // екземпляр) се изчерпва веднага — и двете са „не е доставено“, но НЕ „тишина“.
    assert.equal(counts.failed + counts.exhausted, 1, 'затвореният порт е отчетен, не премълчан: ' + JSON.stringify(counts));
    const mine = received.filter((r) => r.body.includes('f_9'));
    assert.equal(mine.length, 1, 'получателят е получил точно едно от нашите съобщения');
    const got = mine[0];
    assert.equal(got.headers['x-hapi-event'], 'document.finalized');
    assert.match(got.headers['x-hapi-delivery'], /^wd_[a-f0-9]{18}$/);
    const verdict = verifySignature(live.secret, got.headers['x-hapi-signature'], got.body);
    assert.equal(verdict.ok, true, 'получателят проверява подписа със своя ключ: ' + verdict.reason);
    assert.equal(hooks.status().pending, counts.failed, 'в опашката остава точно неуспешната доставка');
    ok('доставка: подписът се проверява от получателя, неуспехът остава в опашката');
  }

  // ── 6. Отказ → повторение с изчакване; след последния опит е „изчерпано“ ──
  {
    const broken = hooks.subscribe({ url: 'http://127.0.0.1:9/nothing', events: ['job.completed'] });
    hooks.remember(broken.id, broken.secret);
    hooks.publish('job.completed', { jobId: 'j_1' });
    const first = await hooks.drain();
    assert.equal(first.failed, 1, 'неуспехът се брои, а не се премълчава: ' + JSON.stringify(first));
    assert.equal(hooks.status().pending, 1, 'доставката остава в опашката за нов опит');
    // Веднага втори цикъл: още не е дължима (изчакването е 30 s), затова не се пипа.
    const second = await hooks.drain();
    assert.equal(second.sent + second.failed + second.exhausted, 0, 'не се опитва преди изчакването');
    // „Превъртаме“ часовника: всеки следващ опит е с часовник след изчакването.
    let counts = { exhausted: 0 };
    for (let i = 0; i < 6 && counts.exhausted === 0; i += 1) {
      const shifted = create({ store, audit: () => { }, now: () => Date.now() + (i + 1) * 8 * 3600_000 });
      shifted.remember(broken.id, broken.secret);
      counts = await shifted.drain();
      shifted.stop();
    }
    assert.ok(counts.exhausted >= 1, 'след изчерпване на опитите доставката е отбелязана: ' + JSON.stringify(counts));
    ok('отказ → повторение с изчакване, после „изчерпано“ (вижда се, не се трие)');
  }

  // ── 7. Спиране и изтриване ────────────────────────────────────────────────
  {
    assert.equal(hooks.setDisabled(created.id, true), true);
    assert.equal(hooks.status().subscriptions.find((s) => s.id === created.id).disabled, true);
    assert.equal(hooks.publish('document.finalized', { fileId: 'f_10' }), 1, 'спреният не получава, другият получава');
    assert.equal(hooks.setDisabled(created.id, false), true);
    assert.equal(hooks.remove(created.id), true);
    assert.equal(hooks.remove(created.id), false, 'повторно триене не лъже, че е станало');
    ok('спиране/пускане/триене: спреният не получава, триенето е еднократно');
  }

  server.close();

  // ── 8. HTTP: договорът на маршрутите ──────────────────────────────────────
  {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-webhooks-http-'));
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-webhooks-st-'));
    fs.mkdirSync(path.join(storageRoot, 'addon_config'), { recursive: true });
    const token = 'webhook-test-token-0123456789';
    const httpPort = await freePort();
    const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        STORAGE_ROOT_OVERRIDE: storageRoot,
        STORAGE_LOCATION: 'addon_config',
        STORAGE_SUBDIRECTORY: 'hapi_enterprise',
        ADMIN_TOKEN: token,
        PORT: String(httpPort),
        ADMIN_PORT: '0',
        PUBLIC_GATEWAY_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c.toString() });
    const base = 'http://127.0.0.1:' + httpPort;
    const health = async () => {
      for (let i = 0; i < 100; i += 1) {
        try {
          const r = await fetch(base + '/health');
          if (r.status === 200) return true;
        } catch { /* още не слуша */ }
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    };
    try {
      assert.ok(await health(), 'сървърът не вдигна /health: ' + stderr.slice(0, 300));
      const auth = { Authorization: 'Bearer ' + token };

      const anon = await fetch(base + '/admin/api/webhooks');
      assert.equal(anon.status, 401, 'без токен абонаментите не се показват');

      const listed = await fetch(base + '/admin/api/webhooks', { headers: auth });
      assert.equal(listed.status, 200);
      const state = await listed.json();
      assert.equal(state.enabled, true);
      assert.deepEqual(state.events, EVENTS, 'конзолата знае ТОЧНО събитията, които кодът излъчва');
      assert.deepEqual(state.subscriptions, []);

      const bad = await fetch(base + '/admin/api/webhooks', {
        method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'http://127.0.0.1:9/x', events: ['no.such'] }),
      });
      assert.equal(bad.status, 400, 'непознато събитие → 400');

      const made = await fetch(base + '/admin/api/webhooks', {
        method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'http://127.0.0.1:9/hook', events: ['document.finalized'], label: 'http' }),
      });
      assert.equal(made.status, 201);
      const body = await made.json();
      assert.match(body.secret, /^whsec_/, 'ключът идва в отговора на създаването');
      assert.equal(body.signatureHeader, 'x-hapi-signature');

      const after = await (await fetch(base + '/admin/api/webhooks', { headers: auth })).json();
      assert.equal(after.subscriptions.length, 1);
      assert.ok(!JSON.stringify(after).includes(body.secret), 'ключът НЕ се връща при следващо четене');

      const missing = await fetch(base + '/admin/api/webhooks/wh_000000000000000000/test', { method: 'POST', headers: auth });
      assert.equal(missing.status, 404, 'непознат абонамент → 404');

      const del = await fetch(base + '/admin/api/webhooks/' + body.id, { method: 'DELETE', headers: auth });
      assert.equal(del.status, 200);
      assert.equal((await del.json()).deleted, true);
      ok('HTTP: 401 без токен, 201 + ключ, 400 непознато събитие, 404 непознат id, DELETE 200');
    } finally {
      child.kill('SIGKILL');
      await new Promise((r) => { child.once('exit', r); setTimeout(r, 2000) });
    }
  }

  store.close();
  console.log('PASS webhooks: ' + cases.length + ' проверки — ' + cases.join('; '));
})().catch((err) => {
  console.error('FAIL webhooks: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
