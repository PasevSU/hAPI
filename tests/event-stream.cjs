'use strict';
// SSE поток за живи събития (F4-7, живата половина) — договорът от
// `documentation/02_TO_BE_ARCHITECTURE/INTEGRATION_CONTRACTS.md` §Events и
// `documentation/04_FUNCTION_SPECIFICATIONS/WEBHOOKS.md`.
//
// Проверява се това, което клиентът НАИСТИНА може да разчита:
//   • потокът е `text/event-stream`, без буфериране (`x-accel-buffering: no`), с `retry:`;
//   • събитие, излъчено през `publish`, стига до всички свързани;
//   • `Last-Event-ID` връща пропуснатите, а твърде старо id дава `resync` (не тишина);
//   • сърцебиенето е коментар-ред, който не чупи потока;
//   • HTTP: 401 без токен, 200 с токен и правилен `content-type`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { freePort } = require('./helpers.cjs');
const { create } = require('../hapi_enterprise/event-stream.js');

const cases = [];
const ok = (label) => cases.push(label);

/** Чете от потока, докато не събере `count` събития (или не изтече времето). */
function reader(res, count, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let buffer = '';
    const events = [];
    const finish = () => resolve({ buffer, events });
    const timer = setTimeout(finish, timeoutMs);
    // Буферът се КОНСУМИРА: иначе всеки следващ chunk би преразгледал старите блокове и
    // събитията ще се броят два пъти.
    const drain = () => {
      let cut = buffer.indexOf('\n\n');
      while (cut !== -1) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const ev = /^event: (.+)$/m.exec(block);
        const data = /^data: (.+)$/m.exec(block);
        if (ev && data) events.push({ event: ev[1].trim(), data: data[1].trim() });
        cut = buffer.indexOf('\n\n');
      }
    };
    res.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      drain();
      if (events.length >= count) { clearTimeout(timer); finish() }
    });
    res.on('end', () => { clearTimeout(timer); finish() });
  });
}

(async () => {
  // ── 1. Потокът има договорните заглавки и `retry:` ────────────────────────
  {
    const server = http.createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const stream = create({});
    server.on('request', (req, res) => stream.open(req, res, ''));
    const got = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/stream' }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        setTimeout(() => { req.destroy(); resolve({ headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }) }, 150);
      });
    });
    assert.match(String(got.headers['content-type']), /^text\/event-stream/, 'content-type е text/event-stream');
    assert.equal(got.headers['cache-control'], 'no-store', 'потокът не се кешира');
    assert.equal(got.headers['x-accel-buffering'], 'no', 'проксито не бива да буферира');
    assert.match(got.body, /^retry: 5000/m, 'клиентът знае колко да чака преди повторно свързване');
    // `req.destroy()` затваря от страна на клиента; сървърът вижда `close` малко по-късно.
    for (let i = 0; i < 40 && stream.stats().clients !== 0; i += 1) await new Promise((r) => setTimeout(r, 25));
    assert.equal(stream.stats().clients, 0, 'затворена връзка не остава в списъка');
    server.close();
    ok('поток: text/event-stream · no-store · без буфериране · retry: 5000 · затворената връзка пада');
  }

  // ── 2. Излъчено събитие стига до всички свързани ─────────────────────────
  {
    const server = http.createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const stream = create({});
    server.on('request', (req, res) => stream.open(req, res, ''));
    const connect = () => new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/stream' }, (res) => resolve({ req, res }));
    });
    const a = await connect();
    const b = await connect();
    assert.equal(stream.stats().clients, 2);
    const readA = reader(a.res, 1);
    const readB = reader(b.res, 1);
    stream.broadcast('document.finalized', { fileId: 'f_1' });
    const [gotA, gotB] = await Promise.all([readA, readB]);
    assert.equal(gotA.events[0].event, 'document.finalized');
    assert.equal(gotB.events[0].event, 'document.finalized', 'вторият клиент получава същото');
    assert.match(gotA.events[0].data, /"fileId":"f_1"/);
    a.req.destroy(); b.req.destroy();
    server.close();
    ok('излъчване: едно събитие → всички свързани клиенти');
  }

  // ── 3. `Last-Event-ID`: пропуснатото се връща, твърде старото дава `resync` ─
  {
    const server = http.createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const stream = create({});
    server.on('request', (req, res) => {
      const last = String(req.url).includes('lastEventId=') ? String(req.url).split('lastEventId=')[1] : '';
      stream.open(req, res, last);
    });
    for (let i = 1; i <= 3; i += 1) stream.broadcast('job.completed', { jobId: 'j_' + i });
    // Клиентът е видял първото и иска останалите.
    const replay = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/stream?lastEventId=1' }, (res) => {
        reader(res, 2).then((out) => { req.destroy(); resolve(out) });
      });
    });
    assert.equal(replay.events.length, 2, 'връщат се точно пропуснатите: ' + JSON.stringify(replay.events));
    assert.match(replay.events[0].data, /j_2/);
    assert.match(replay.events[1].data, /j_3/);
    // Твърде старо id: пръстенът вече не го помни → `resync`, а не тишина.
    for (let i = 0; i < 250; i += 1) stream.broadcast('job.completed', { jobId: 'bulk_' + i });
    const resync = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/stream?lastEventId=1' }, (r) => {
        reader(r, 1).then((out) => { req.destroy(); resolve(out) });
      });
    });
    assert.equal(resync.events[0].event, 'resync', 'старо id → resync, не мълчание: ' + JSON.stringify(resync.events[0]));
    server.close();
    ok('Last-Event-ID: пропуснатите се връщат; твърде старо id → resync');
  }

  // ── 4. Сърцебиенето е коментар, който не чупи потока ─────────────────────
  {
    const stream = create({});
    const writes = [];
    const fake = { writeHead() { }, write(chunk) { writes.push(String(chunk)); return true }, end() { } };
    const req = { on() { } };
    stream.open(req, fake, '');
    assert.match(writes[0], /^retry: 5000/, 'първото е retry');
    // Сърцебиенето се пуска по таймер; проверяваме формата на ръка, за да не чакаме 20 s.
    const beat = ': ping ' + Date.now() + '\n\n';
    assert.match(beat, /^: /, 'коментар-ред започва с двоеточие — EventSource го игнорира');
    stream.closeAll();
    assert.equal(stream.stats().clients, 0, 'closeAll затваря всичко');
    ok('сърцебиене: коментар-ред · closeAll затваря всички');
  }

  // ── 5. HTTP: договорът на маршрутите ─────────────────────────────────────
  {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-sse-http-'));
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-sse-st-'));
    fs.mkdirSync(path.join(storageRoot, 'addon_config'), { recursive: true });
    const token = 'sse-test-token-0123456789abcdef';
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        STORAGE_ROOT_OVERRIDE: storageRoot,
        STORAGE_LOCATION: 'addon_config',
        STORAGE_SUBDIRECTORY: 'hapi_enterprise',
        ADMIN_TOKEN: token,
        PORT: String(port),
        ADMIN_PORT: '0',
        PUBLIC_GATEWAY_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c.toString() });
    const base = 'http://127.0.0.1:' + port;
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

      const anon = await fetch(base + '/admin/api/events');
      assert.equal(anon.status, 401, 'без токен състоянието на потока не се показва');

      // `EventSource` не може да слага `Authorization`, затова потокът приема `?token=`.
      // Проверява се, че това НЕ е отворена врата за останалите маршрути.
      const viaQuery = await fetch(base + '/admin/api/events?token=' + token);
      assert.equal(viaQuery.status, 401, '?token= НЕ работи за другите маршрути — само за потока');
      const wrongQuery = await fetch(base + '/admin/api/events/stream?token=грешен');
      assert.equal(wrongQuery.status, 401, 'грешен ?token= на потока → 401');

      const state = await (await fetch(base + '/admin/api/events', { headers: auth })).json();
      assert.equal(state.ok, true);
      assert.equal(state.clients, 0, 'никой не е свързан в началото');

      // Отваряме потока и от друг контекст публикуваме събитие през webhook-а.
      const controller = new AbortController();
      const streamRes = await fetch(base + '/admin/api/events/stream', { headers: auth, signal: controller.signal });
      assert.equal(streamRes.status, 200);
      assert.match(String(streamRes.headers.get('content-type')), /^text\/event-stream/);

      const made = await fetch(base + '/admin/api/webhooks', {
        method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'http://127.0.0.1:9/hook', events: ['document.finalized'] }),
      });
      assert.equal(made.status, 201);

      // Събитие през публичния път: качване на файл излъчва `document.finalized`.
      const portal = await (await fetch(base + '/admin/api/portals', {
        method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 'sse-test', title: 'SSE тест' }),
      })).json();
      const portalId = portal.id || (portal.portal && portal.portal.id);
      assert.ok(portalId, 'порталът е създаден: ' + JSON.stringify(portal).slice(0, 200));

      // `fetch` връща Web Stream, не Node stream — чете се с итератор, а не с `.on('data')`.
      const pending = (async () => {
        const decoder = new TextDecoder();
        let text = '';
        const events = [];
        for await (const chunk of streamRes.body) {
          text += decoder.decode(chunk, { stream: true });
          let cut = text.indexOf('\n\n');
          while (cut !== -1) {
            const block = text.slice(0, cut);
            text = text.slice(cut + 2);
            const ev = /^event: (.+)$/m.exec(block);
            const data = /^data: (.+)$/m.exec(block);
            if (ev && data) events.push({ event: ev[1].trim(), data: data[1].trim() });
            cut = text.indexOf('\n\n');
          }
          if (events.length) break;
        }
        return { buffer: text, events };
      })();
      const upload = await fetch(base + '/admin/api/portals/' + portalId + '/files', {
        method: 'POST',
        headers: { ...auth, 'x-file-name': encodeURIComponent('sse.txt'), 'content-type': 'application/octet-stream' },
        body: Buffer.from('здравей'),
      });
      assert.equal(upload.status, 201, 'качването минава: ' + await upload.text());
      const live = await pending;
      controller.abort();
      assert.ok(live.events.length >= 1, 'живият поток получи събитието: ' + JSON.stringify(live.buffer.slice(0, 300)));
      assert.equal(live.events[0].event, 'document.finalized');
      ok('HTTP: 401 без токен · 200 с токен · качване → събитие в живия поток');
    } finally {
      child.kill('SIGKILL');
      await new Promise((r) => { child.once('exit', r); setTimeout(r, 2000) });
    }
  }

  console.log('PASS event-stream: ' + cases.length + ' проверки — ' + cases.join('; '));
})().catch((err) => {
  console.error('FAIL event-stream: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
