'use strict';
// ТОКЕНЪТ НЕ ВЛИЗА В АДРЕСА — живият поток получава ЕДНОКРАТЕН БИЛЕТ (0.69.206).
//
// Проблемът: `EventSource` в браузъра не може да слага заглавка `Authorization`, затова
// панелът отваряше потока като `/admin/api/events/stream?token=<администраторски токен>`.
// Токенът в адрес влиза в историята на браузъра, в `Referer` на всяка следваща заявка от
// страницата, в логовете на обратния прокси и в одита на достъпа. Това е дълготраен
// администраторски ключ на най-видимото място в системата.
//
// Решението: потокът вече НЕ приема `?token=`. Панелът иска билет с обикновен `POST` и
// заглавка `Authorization`, а потокът получава `?ticket=` — случаен, ЕДНОКРАТЕН и
// краткотраен низ, който не дава нищо друго освен едно отваряне на потока.
//
// Тестът проверява договора отвън (истински сървър, истински HTTP):
//   1. `?token=` на потока → 401 (вече не се приема);
//   2. билет се издава само с токен и носи само правото „четене на метрики“;
//   3. билетът се изразходва при отваряне (втори опит → 401);
//   4. изтеклият билет → 401;
//   5. билетът не е токенът и не го съдържа.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-ticket-data-'));
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-ticket-st-'));
  fs.mkdirSync(path.join(storageRoot, 'addon_config'), { recursive: true });
  const token = 'ticket-test-token-0123456789abcdef';
  const port = await freePort();
  const TTL_MS = 400;
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      STORAGE_ROOT_OVERRIDE: storageRoot,
      STORAGE_LOCATION: 'addon_config',
      STORAGE_SUBDIRECTORY: 'hapi_enterprise',
      ADMIN_TOKEN: token,
      SSE_TICKET_TTL_MS: String(TTL_MS),
      PORT: String(port),
      ADMIN_PORT: '0',
      PUBLIC_GATEWAY_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });
  const base = 'http://127.0.0.1:' + port;
  const auth = { Authorization: 'Bearer ' + token };

  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i += 1) {
      try {
        up = (await fetch(base + '/health')).status === 200;
      } catch {
        /* още не слуша */
      }
      if (!up) await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(up, 'сървърът не вдигна /health: ' + stderr.slice(0, 300));

    // ── 1. Администраторският токен вече НЕ се приема в адреса ───────────────
    const viaToken = await fetch(base + '/admin/api/events/stream?token=' + encodeURIComponent(token));
    assert.equal(viaToken.status, 401, '?token= на потока е 401 — токенът не влиза в адрес');

    // ── 2. Билет се издава само с токен ─────────────────────────────────────
    const anon = await fetch(base + '/admin/api/events/ticket', { method: 'POST' });
    assert.equal(anon.status, 401, 'без токен не се издава билет');

    const issued = await fetch(base + '/admin/api/events/ticket', { method: 'POST', headers: auth });
    assert.equal(issued.status, 200, 'с токен билетът се издава');
    const body = await issued.json();
    assert.equal(body.ok, true);
    assert.match(body.ticket, /^[0-9a-f]{32,}$/, 'билетът е случаен низ, не токен: ' + body.ticket);
    assert.equal(body.ticket.includes(token), false, 'билетът не съдържа администраторския токен');
    assert.ok(body.ticket !== token, 'билетът не е самият токен');
    assert.ok(Number(body.expiresIn) > 0, 'билетът има срок: ' + body.expiresIn);

    // Билетът не отваря другите администраторски маршрути.
    const other = await fetch(base + '/admin/api/events?ticket=' + body.ticket);
    assert.equal(other.status, 401, 'билетът не важи за другите маршрути');

    // ── 3. Еднократен: отваря потока веднъж и се изразходва ─────────────────
    const controller = new AbortController();
    const opened = await fetch(base + '/admin/api/events/stream?ticket=' + body.ticket, { signal: controller.signal });
    assert.equal(opened.status, 200, 'билетът отваря потока');
    assert.match(String(opened.headers.get('content-type')), /^text\/event-stream/);
    controller.abort();

    const reused = await fetch(base + '/admin/api/events/stream?ticket=' + body.ticket);
    assert.equal(reused.status, 401, 'същият билет втори път не отваря — еднократен е');

    // ── 4. Изтеклият билет не отваря нищо ───────────────────────────────────
    const second = await (await fetch(base + '/admin/api/events/ticket', { method: 'POST', headers: auth })).json();
    await new Promise((r) => setTimeout(r, TTL_MS + 300));
    const expired = await fetch(base + '/admin/api/events/stream?ticket=' + second.ticket);
    assert.equal(expired.status, 401, 'изтеклият билет е 401');

    // ── 5. Издаването на билет иска POST ────────────────────────────────────
    const viaGet = await fetch(base + '/admin/api/events/ticket', { headers: auth });
    assert.notEqual(viaGet.status, 200, 'GET не издава билет');

    // Потокът със заглавка `Authorization` продължава да работи (curl и тестове).
    const viaHeader = new AbortController();
    const headerStream = await fetch(base + '/admin/api/events/stream', { headers: auth, signal: viaHeader.signal });
    assert.equal(headerStream.status, 200, 'потокът със заглавка работи');
    viaHeader.abort();

    console.log('PASS sse-ticket: ?token= отпадна · билетът е еднократен, краткотраен и само за потока');
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.on('exit', r));
    for (const dir of [dataDir, storageRoot]) fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
