'use strict';
// ГЛОБАЛНАТА ФУНКЦИЯ „http“ ИМА ТАЙМАУТ, ЧЕТЕ ТЯЛОТО ВЕДНЪЖ И ХВЪРЛЯ ТИПИЗИРАНА ГРЕШКА.
//
// Защо има тест: 8 места в кода правят изходящи заявки и всяко решава само какво да прави при
// грешка. Договорът от `docs/plan/25-global-functions-catalogue.md` казва: таймаут ВИНАГИ, при
// `!ok` грешка със `status` и `data`, невалиден JSON не е провал. Този тест пази точно това,
// без нито една истинска мрежа — `fetchImpl` е подправен.
const assert = require('node:assert/strict');

const http = require('../hapi_enterprise/core_module/http.js').create({}, {});

/** Подправен fetch: връща зададения отговор и записва какво е поискано. */
function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: reply.ok !== false,
      status: reply.status == null ? 200 : reply.status,
      statusText: reply.statusText || '',
      headers: { fake: '1' },
      text: async () => (reply.body == null ? '' : reply.body),
    };
  };
  return { impl, calls };
}

(async () => {
  assert.equal(http.name, 'http', 'модулът се казва „http“');
  assert.equal(typeof http.fn.client, 'function', 'http.client е функция');

  // ── 1. Успешен JSON: връща се данните, не Response ───────────────────────
  const ok = fakeFetch({ body: '{"a":1}' });
  const client = http.fn.client({ baseUrl: 'http://x.test/', fetchImpl: ok.impl });
  const result = await client.get('/health');
  assert.deepEqual(result.data, { a: 1 }, 'тялото е разчетено');
  assert.equal(result.status, 200, 'връща статуса');
  assert.equal(client.baseUrl, 'http://x.test', 'завършващата наклонена черта се маха');
  assert.equal(ok.calls[0].url, 'http://x.test/health', 'адресът се строи с една наклонена черта');

  // ── 2. Адрес без наклонена черта пак е валиден ───────────────────────────
  const bare = fakeFetch({ body: '' });
  await http.fn.client({ baseUrl: 'http://x.test', fetchImpl: bare.impl }).get('status');
  assert.equal(bare.calls[0].url, 'http://x.test/status', 'липсващата наклонена черта се добавя');

  // ── 3. Невалиден JSON не е провал — връща се текстът ─────────────────────
  const plain = fakeFetch({ body: 'OK' });
  const text = await http.fn.client({ fetchImpl: plain.impl }).get('/x');
  assert.equal(text.data, 'OK', 'текстът се връща непроменен');
  assert.equal(text.ok, true, 'заявката е успешна');

  // ── 4. `!ok` хвърля грешка със статус и данни ─────────────────────────────
  const fail = fakeFetch({ ok: false, status: 500, statusText: 'Internal', body: '{"error":"boom"}' });
  await assert.rejects(
    () => http.fn.client({ fetchImpl: fail.impl }).get('/x'),
    (err) => {
      assert.equal(err.status, 500, 'грешката носи статуса');
      assert.deepEqual(err.data, { error: 'boom' }, 'грешката носи и разчетеното тяло');
      assert.match(err.message, /HTTP 500/, 'съобщението казва статуса');
      return true;
    },
  );

  // ── 5. POST носи JSON и заглавка ─────────────────────────────────────────
  const post = fakeFetch({ body: '{"done":true}' });
  await http.fn.client({ fetchImpl: post.impl }).post('/hook', { a: 1 });
  assert.equal(post.calls[0].init.method, 'POST', 'методът е POST');
  assert.equal(post.calls[0].init.headers['content-type'], 'application/json', 'тялото е JSON');
  assert.equal(post.calls[0].init.body, '{"a":1}', 'тялото е сериализирано');

  // ── 6. Таймаутът е ЗАДЪЛЖИТЕЛЕН и има свой код ───────────────────────────
  const slow = (url, init) =>
    new Promise((resolve, reject) => {
      const abort = () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (init.signal.aborted) abort();
      else init.signal.addEventListener('abort', abort, { once: true });
    });
  await assert.rejects(
    () => http.fn.client({ timeout: 20, fetchImpl: slow }).get('/slow'),
    (err) => err.code === 'ETIMEDOUT',
    'без отговор заявката приключва с ETIMEDOUT, не виси вечно',
  );

  // ── 7. Лоши настройки се отказват веднага ────────────────────────────────
  assert.throws(() => http.fn.client({ timeout: 0, fetchImpl: slow }), (e) => e.code === 'HTTP_BAD_OPTION', 'timeout 0 е отказ');
  assert.throws(() => http.fn.client({ timeout: -5, fetchImpl: slow }), (e) => e.code === 'HTTP_BAD_OPTION', 'отрицателен timeout е отказ');

  console.log(
    'PASS core-http: един таймаут за всички · тялото се чете веднъж · !ok носи status и data · POST е JSON · лоши настройки се отказват',
  );
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
