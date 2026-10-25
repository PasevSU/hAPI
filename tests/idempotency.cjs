'use strict';
// IDEMPOTENCY-KEY — повторена заявка не изпълнява действието втори път (docs/plan/17, F4-5).
//
// Проверява се договорът, а не „модулът се зарежда“:
//   1. без заглавката нищо не се променя (старото поведение остава);
//   2. повторение със СЪЩИЯ ключ и същото тяло връща СЪЩИЯ отговор и НЕ създава втори запис;
//   3. същият ключ с ДРУГО тяло е 422 — иначе клиентът щеше да получи потвърждение за
//      действие, което не е извършено;
//   4. докато първата заявка още се изпълнява, повторението получава 409 с `Retry-After`;
//   5. ключът е обвързан със САМОЛИЧНОСТТА: друг клиент със същия ключ не получава чужд
//      отговор и не може да заеме ключа;
//   6. отговор, който не може да се върне байт-в-байт (двоичен, > 512 KB, 5xx), НЕ се пази —
//      ключът се освобождава, вместо да заключи клиента за 24 часа.
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { stopChild, freePort } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const idempotencyModule = require(path.join(ROOT, 'hapi_enterprise', 'idempotency.js'));
let step = 'старт';

// ── помощни обекти: истинската форма на `req`/`res`, но без сокет ─────────────
class FakeRes extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.writableFinished = false;
  }
  setHeader(key, value) { this.headers[String(key).toLowerCase()] = String(value) }
  getHeader(key) { return this.headers[String(key).toLowerCase()] }
  writeHead(status, headers = {}) {
    this.statusCode = Number(status);
    for (const [key, value] of Object.entries(headers)) this.setHeader(key, value);
    return this;
  }
  write(chunk, encoding) {
    if (chunk !== undefined && chunk !== null) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'));
    return true;
  }
  end(chunk, encoding, callback) {
    if (typeof chunk === 'function') { callback = chunk; chunk = undefined }
    if (chunk !== undefined && chunk !== null) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'));
    this.writableFinished = true;
    if (typeof callback === 'function') callback();
    this.emit('finish');
    this.emit('close');
    return this;
  }
  get text() { return Buffer.concat(this.chunks).toString('utf8') }
}

function fakeReq({ headers = {}, body = Buffer.alloc(0), address = '127.0.0.1' } = {}) {
  return {
    headers,
    socket: { remoteAddress: address },
    async *[Symbol.asyncIterator]() { if (body.length) yield body },
  };
}

/** Хранилище в паметта със СЪЩИЯ договор като `sqlite-store.js`. */
function fakeStore() {
  const rows = new Map();
  return {
    rows,
    reserveIdempotency(key, fingerprint, expiresAt) {
      if (rows.has(key)) return false;
      rows.set(key, { key, fingerprint, status: null, contentType: '', body: null, createdAt: new Date().toISOString(), expiresAt });
      return true;
    },
    getIdempotency(key) { return rows.get(key) || null },
    completeIdempotency(key, fingerprint, { status, contentType, body }) {
      const row = rows.get(key);
      if (!row || row.fingerprint !== fingerprint) return false;
      Object.assign(row, { status, contentType, body });
      return true;
    },
    forgetIdempotency(key) { return rows.delete(key) },
    purgeIdempotency(before) {
      let removed = 0;
      for (const [key, row] of rows) if (row.expiresAt <= before) { rows.delete(key); removed++ }
      return removed;
    },
  };
}

function harness(overrides = {}) {
  const store = overrides.store || fakeStore();
  const events = [];
  const component = idempotencyModule.create({
    store,
    audit: (event, details) => { events.push({ event, details }); return Promise.resolve() },
    limit: () => 1024 * 1024,
    fail: (res, status, message) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: message }));
    },
  });
  return { store, events, handle: component.handle };
}

const ADMIN_PATH = '/admin/api/portals';
const asUrl = (p) => new URL(p, 'http://localhost');
const OK_BODY = Buffer.from(JSON.stringify({ slug: 'ponc', title: 'Повторение' }), 'utf8');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-idempotency-'));
  const port = await freePort();
  const token = 'idempotency-token-at-least-24-chars';
  const child = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: token },
    cwd: dir,
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const once = async (p, method = 'GET', data, headers = {}) => {
    const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, ...headers }, body: data });
    const type = r.headers.get('content-type') || '';
    const value = type.includes('application/json') ? await r.json() : await r.text();
    return { status: r.status, value, headers: r.headers };
  };
  const call = async (p, method = 'GET', data, headers = {}) => {
    try {
      return await once(p, method, data, headers);
    } catch (e) {
      if (!/fetch failed|UND_ERR_SOCKET/i.test(String(e && e.message))) throw e;
      await new Promise((r) => setTimeout(r, 200));
      return once(p, method, data, headers);
    }
  };
  const post = (p, body, key) => call(p, 'POST', JSON.stringify(body), { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) });
  const upload = (portalId, name, data, key) => call(`/admin/api/portals/${portalId}/files`, 'POST', data, { 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream', ...(key ? { 'Idempotency-Key': key } : {}) });
  const portals = async () => (await call('/admin/api/portals')).value.portals || [];
  const filesOf = async (portalId) => (await call(`/admin/api/portals/${portalId}`)).value.files || [];

  try {
    // ── 1. Без заглавката: нищо не се променя ───────────────────────────────────
    step = 'без заглавка';
    {
      const h = harness();
      const req = fakeReq({ headers: { authorization: 'Bearer x' }, body: OK_BODY });
      const res = new FakeRes();
      assert.equal(await h.handle({ req, res, url: asUrl(ADMIN_PATH), method: 'POST' }), false, 'без Idempotency-Key заявката продължава по нормалния път');
      assert.equal(h.store.rows.size, 0, 'нищо не е запазено');
    }
    // ── 2. Извън обхвата: GET и път извън /admin/api/ ───────────────────────────
    step = 'извън обхвата';
    {
      const h = harness();
      const get = new FakeRes();
      assert.equal(await h.handle({ req: fakeReq({ headers: { 'idempotency-key': 'klyuch-123456' } }), res: get, url: asUrl(ADMIN_PATH), method: 'GET' }), false, 'GET не се кешира');
      const other = new FakeRes();
      assert.equal(await h.handle({ req: fakeReq({ headers: { 'idempotency-key': 'klyuch-123456' } }), res: other, url: asUrl('/t/abc'), method: 'POST' }), false, 'публичен път не се кешира');
      assert.equal(h.store.rows.size, 0, 'нищо не е запазено');
    }
    // ── 3. Невалиден ключ ──────────────────────────────────────────────────────
    step = 'невалиден ключ';
    {
      const h = harness();
      const res = new FakeRes();
      assert.equal(await h.handle({ req: fakeReq({ headers: { 'idempotency-key': 'abc' } }), res, url: asUrl(ADMIN_PATH), method: 'POST' }), true, 'къс ключ се отказва');
      assert.equal(res.statusCode, 400, 'къс ключ → 400');
      assert.match(res.text, /Idempotency-Key/, 'съобщението назовава заглавката');
    }
    // ── 4. Повторение: същият отговор, без второ изпълнение ─────────────────────
    step = 'повторение';
    {
      const h = harness();
      const headers = { authorization: 'Bearer tajna-1', 'idempotency-key': 'klyuch-123456' };
      const first = new FakeRes();
      assert.equal(await h.handle({ req: fakeReq({ headers, body: OK_BODY }), res: first, url: asUrl(ADMIN_PATH), method: 'POST' }), false, 'първата заявка минава към маршрута');
      assert.equal(h.store.rows.size, 1, 'ключът е зает');
      assert.equal([...h.store.rows.values()][0].status, null, 'до края на отговора ключът е „в ход“');
      first.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
      first.end(JSON.stringify({ id: 'p-1' }));
      const row = [...h.store.rows.values()][0];
      assert.equal(row.status, 201, 'отговорът е запазен');
      assert.equal(String(row.body), '{"id":"p-1"}', 'тялото се пази байт-в-байт');

      const second = new FakeRes();
      assert.equal(await h.handle({ req: fakeReq({ headers, body: OK_BODY }), res: second, url: asUrl(ADMIN_PATH), method: 'POST' }), true, 'повторението се обслужва от ключа');
      assert.equal(second.statusCode, 201, 'статусът е същият');
      assert.equal(second.text, '{"id":"p-1"}', 'тялото е същото');
      assert.equal(second.getHeader('idempotency-replayed'), 'true', 'казва, че е повторено');
      assert.ok(h.events.some((e) => e.event === 'idempotency.replay'), 'повторението влиза в одита');
    }
    // ── 5. Същият ключ с друго тяло → 422 ──────────────────────────────────────
    step = 'различно тяло';
    {
      const h = harness();
      const headers = { authorization: 'Bearer tajna-1', 'idempotency-key': 'klyuch-123456' };
      const first = new FakeRes();
      await h.handle({ req: fakeReq({ headers, body: OK_BODY }), res: first, url: asUrl(ADMIN_PATH), method: 'POST' });
      first.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
      first.end('{"id":"p-1"}');
      const clash = new FakeRes();
      const other = Buffer.from(JSON.stringify({ slug: 'drugo', title: 'Друго' }), 'utf8');
      assert.equal(await h.handle({ req: fakeReq({ headers, body: other }), res: clash, url: asUrl(ADMIN_PATH), method: 'POST' }), true, 'конфликтът се решава тук');
      assert.equal(clash.statusCode, 422, 'същият ключ с друго тяло → 422');
      assert.ok(h.events.some((e) => e.event === 'idempotency.conflict' && e.details.reason === 'fingerprint'), 'конфликтът се записва с причина');
    }
    // ── 6. Докато първата още се изпълнява → 409 + Retry-After ─────────────────
    step = 'в ход';
    {
      const h = harness();
      const headers = { authorization: 'Bearer tajna-1', 'idempotency-key': 'klyuch-123456' };
      await h.handle({ req: fakeReq({ headers, body: OK_BODY }), res: new FakeRes(), url: asUrl(ADMIN_PATH), method: 'POST' });
      const busy = new FakeRes();
      assert.equal(await h.handle({ req: fakeReq({ headers, body: OK_BODY }), res: busy, url: asUrl(ADMIN_PATH), method: 'POST' }), true, 'втората заявка не минава');
      assert.equal(busy.statusCode, 409, 'докато тече → 409');
      assert.equal(busy.getHeader('retry-after'), '1', 'казва кога да опита пак');
    }
    // ── 7. Друга самоличност → собствен ключ, не чужд отговор ──────────────────
    step = 'друга самоличност';
    {
      const h = harness();
      const mine = { authorization: 'Bearer tajna-1', 'idempotency-key': 'klyuch-123456' };
      const first = new FakeRes();
      await h.handle({ req: fakeReq({ headers: mine, body: OK_BODY }), res: first, url: asUrl(ADMIN_PATH), method: 'POST' });
      first.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
      first.end('{"id":"p-1"}');
      const theirs = new FakeRes();
      const stranger = { authorization: 'Bearer druga-tajna', 'idempotency-key': 'klyuch-123456' };
      assert.equal(await h.handle({ req: fakeReq({ headers: stranger, body: OK_BODY }), res: theirs, url: asUrl(ADMIN_PATH), method: 'POST' }), false, 'чужд ключ не връща чужд отговор, а се изпълнява');
      assert.notEqual(theirs.statusCode, 201, 'нищо не е върнато от чуждия запис');
      assert.equal(h.store.rows.size, 2, 'ключовете са два — по един на самоличност');
    }
    // ── 8. Отговор, който не може да се върне байт-в-байт, освобождава ключа ───
    step = 'незапазваем отговор';
    {
      for (const [label, status, type] of [['двоичен', 200, 'application/pdf'], ['сървърна грешка', 500, 'application/json; charset=utf-8']]) {
        const h = harness();
        const headers = { authorization: 'Bearer tajna-1', 'idempotency-key': 'klyuch-123456' };
        const res = new FakeRes();
        await h.handle({ req: fakeReq({ headers, body: OK_BODY }), res, url: asUrl(ADMIN_PATH), method: 'POST' });
        res.writeHead(status, { 'Content-Type': type });
        res.end('x');
        assert.equal(h.store.rows.size, 0, label + ' отговор не се пази, ключът се освобождава');
        const again = new FakeRes();
        assert.equal(await h.handle({ req: fakeReq({ headers, body: OK_BODY }), res: again, url: asUrl(ADMIN_PATH), method: 'POST' }), false, label + ': повторението пак изпълнява');
      }
    }
    // ── 9. Изтекъл ключ не блокира завинаги ────────────────────────────────────
    step = 'изтекъл ключ';
    {
      const h = harness();
      const headers = { authorization: 'Bearer tajna-1', 'idempotency-key': 'klyuch-123456' };
      const first = new FakeRes();
      await h.handle({ req: fakeReq({ headers, body: OK_BODY }), res: first, url: asUrl(ADMIN_PATH), method: 'POST' });
      first.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
      first.end('{"id":"p-1"}');
      for (const row of h.store.rows.values()) row.expiresAt = '2000-01-01T00:00:00.000Z';
      const after = new FakeRes();
      assert.equal(await h.handle({ req: fakeReq({ headers, body: OK_BODY }), res: after, url: asUrl(ADMIN_PATH), method: 'POST' }), false, 'след срока ключът се заема наново');
    }
    // ── 10. Тялото остава четливо за маршрута след проверката ──────────────────
    step = 'тялото се връща обратно';
    {
      const h = harness();
      const req = fakeReq({ headers: { authorization: 'Bearer tajna-1', 'idempotency-key': 'klyuch-123456' }, body: OK_BODY });
      await h.handle({ req, res: new FakeRes(), url: asUrl(ADMIN_PATH), method: 'POST' });
      const seen = [];
      for await (const chunk of req) seen.push(chunk);
      assert.equal(Buffer.concat(seen).toString('utf8'), OK_BODY.toString('utf8'), 'маршрутът чете същите байтове');
    }

    // ── 11. Живият сървър: повтореният POST не създава втори портал ────────────
    step = 'жив сървър';
    let ready = false;
    for (let i = 0; i < 200; i++) {
      try { if ((await call('/health')).status === 200) { ready = true; break } } catch { /* сървърът още пали */ }
      await new Promise((r) => setTimeout(r, 30));
    }
    assert(ready, 'сървърът трябва да стартира');

    step = 'портал с ключ';
    const first = await post('/admin/api/portals', { slug: 'ponc', title: 'Повторение' }, 'portal-klyuch-1');
    assert.equal(first.status, 201, 'порталът е създаден: ' + JSON.stringify(first.value));
    const again = await post('/admin/api/portals', { slug: 'ponc', title: 'Повторение' }, 'portal-klyuch-1');
    assert.equal(again.status, 201, 'повторението връща същия статус');
    assert.equal(again.value.id, first.value.id, 'повторението връща същия портал');
    assert.equal(again.headers.get('idempotency-replayed'), 'true', 'заглавката казва, че е повторено');
    assert.equal((await portals()).length, 1, 'порталът е ТОЧНО един — повторението не създаде втори');

    step = 'същият ключ, друго тяло';
    const clash = await post('/admin/api/portals', { slug: 'vtor', title: 'Друго' }, 'portal-klyuch-1');
    assert.equal(clash.status, 422, 'същият ключ с друго тяло → 422');
    assert.equal((await portals()).length, 1, 'нищо не е създадено при конфликт');

    step = 'качване на файл с ключ';
    const portalId = first.value.id;
    const bytes = Buffer.from('съдържание, което не бива да се дублира', 'utf8');
    const up1 = await upload(portalId, 'dokument.txt', bytes, 'file-klyuch-1');
    assert.equal(up1.status, 201, 'файлът е качен: ' + JSON.stringify(up1.value));
    const up2 = await upload(portalId, 'dokument.txt', bytes, 'file-klyuch-1');
    assert.equal(up2.status, 201, 'повторното качване връща същия статус');
    assert.equal(up2.value.id, up1.value.id, 'повторното качване връща СЪЩИЯ файл');
    const files = await filesOf(portalId);
    assert.equal(files.length, 1, 'файлът е ТОЧНО един — байтовете не са качени два пъти');

    step = 'без ключ поведението е старото';
    const noKey1 = await post('/admin/api/portals', { slug: 'bez-klyuch', title: 'Без ключ' });
    const noKey2 = await post('/admin/api/portals', { slug: 'bez-klyuch-2', title: 'Без ключ 2' });
    assert.equal(noKey1.status, 201, 'без ключ първият опит минава');
    assert.equal(noKey2.status, 201, 'без ключ вторият опит също минава (нищо не се кешира)');
    assert.equal((await portals()).length, 3, 'три портала: един с ключ и два без');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('PASS idempotency: повторение → същият отговор · друго тяло → 422 · в ход → 409 · друга самоличност → собствен ключ · жив сървър: нито втори портал, нито втори файл');
})().catch((e) => {
  console.error('FAIL idempotency (' + step + '):', e && e.message);
  process.exitCode = 1;
});
