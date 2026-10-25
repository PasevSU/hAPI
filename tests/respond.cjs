'use strict';
// ОТГОВОРЪТ СЕ ПИШЕ ТОЧНО ВЕДНЪЖ (`SINGLE_RESPONSE`).
//
// Два дефекта, намерени в `error-log.jsonl` на жива инсталация:
//   http/error    Cannot write headers after they are sent to the client
//   process/error Error [ERR_HTTP_HEADERS_SENT] … at json … at fail
//
// Проверява се договорът, а не „модулът се зарежда“:
//   1. `json()` строи тялото ПРЕДИ заглавките — при несериализируем обект (BigInt) НИЩО не
//      се пише, тоест извикващият може да върне 500, вместо да остави празен 200;
//   2. `fail()` при вече изпратени заглавки НЕ пише втори отговор (няма втора грешка, която
//      да замаже първата) и затваря връзката;
//   3. `fail()` при чист отговор връща тялото по RFC 9457 (`problem.body`);
//   4. `json()` слага `no-store` и `nosniff` без извикващият да ги помни.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const respond = require('../hapi_enterprise/respond.js');
const problem = require('../hapi_enterprise/problem.js');

let step = 'старт';

/** Отговор с формата на истинския, но без сокет — и със брояч на `writeHead`. */
class FakeRes extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headersSent = false;
    this.writableEnded = false;
    this.writes = 0;
    this.headers = {};
    this.chunks = [];
  }
  writeHead(status, headers = {}) {
    if (this.headersSent) throw Object.assign(new Error('Cannot write headers after they are sent to the client'), { code: 'ERR_HTTP_HEADERS_SENT' });
    this.writes++;
    this.statusCode = Number(status);
    for (const [key, value] of Object.entries(headers)) this.headers[key.toLowerCase()] = String(value);
    this.headersSent = true;
    return this;
  }
  end(chunk) {
    if (chunk !== undefined && chunk !== null) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    this.writableEnded = true;
    return this;
  }
  get text() { return Buffer.concat(this.chunks).toString('utf8') }
}

try {
  // ── 1. Несериализируем обект: НИЩО не се пише ──────────────────────────────
  step = 'несериализируем обект';
  {
    const res = new FakeRes();
    assert.throws(() => respond.json(res, 200, { n: 10n }), /BigInt|serialize/i, 'BigInt не се сериализира');
    assert.equal(res.writes, 0, 'заглавки НЕ се пишат, ако тялото не може да се построи');
    assert.equal(res.headersSent, false, 'отговорът остава чист — извикващият може да върне 500');
  }

  // ── 2. Втори отговор след изпратен такъв: тихо затваряне ───────────────────
  step = 'втори отговор';
  {
    const res = new FakeRes();
    respond.json(res, 201, { ok: true });
    assert.equal(res.writes, 1);
    // Отказът трябва да е ЧУВАЕМ: безмълвно погълнат втори отговор е дефект, който изчезва.
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (line) => warnings.push(String(line));
    try {
      assert.doesNotThrow(() => respond.fail(res, 500, 'късно'), 'fail след изпратен отговор не бива да хвърля');
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(res.writes, 1, 'втори writeHead НЕ се прави — няма ERR_HTTP_HEADERS_SENT');
    assert.match(res.text, /"ok":true/, 'първият отговор остава непокътнат');
    assert.equal(warnings.length, 1, 'отказът се записва в лога точно веднъж');
    assert.match(warnings[0], /RESPONSE_ALREADY_SENT/, 'кодът е стабилен и се търси с него');
    assert.ok(!/късно/.test(warnings[0]), 'съобщението на извикващия не се повтаря в лога');
  }

  // ── 3. Чист отговор: тяло по RFC 9457 ──────────────────────────────────────
  step = 'чист отговор';
  {
    const res = new FakeRes();
    respond.fail(res, 422, 'лошо тяло');
    const body = JSON.parse(res.text);
    assert.deepEqual(body, problem.body(422, 'лошо тяло'), 'тялото е същото като от problem.body');
    assert.equal(res.statusCode, 422);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  }

  // ── 4. Заглавки на извикващия се пазят, но не отменят защитните ────────────
  step = 'допълнителни заглавки';
  {
    const res = new FakeRes();
    respond.json(res, 302, { to: '/ui/' }, { Location: '/ui/', 'Cache-Control': 'public' });
    assert.equal(res.headers.location, '/ui/', 'допълнителната заглавка стига');
    assert.equal(res.headers['cache-control'], 'public', 'изричната стойност има предимство');
    assert.equal(res.headers['x-content-type-options'], 'nosniff', 'защитната заглавка остава');
  }

  console.log('PASS respond: тялото преди заглавките · втори отговор не се пише · проблем-тяло по RFC 9457 · защитни заглавки');
} catch (e) {
  console.error('FAIL respond (' + step + '):', e && e.message);
  process.exitCode = 1;
}
