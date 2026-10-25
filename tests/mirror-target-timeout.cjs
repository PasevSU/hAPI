'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const mirror = require('../hapi_enterprise/mirror-target.js');
// §MIRROR_TARGET_PATH_OR_S3, устойчивост: мъртъв или забавен S3 не бива да блокира
// проверката/поправката на огледалото. `verify` минава файл по файл, а `fetch` без
// `AbortSignal` чака по подразбиране минути — един висящ endpoint би спрял целия цикъл.
// Затова целта има таймаут и отчита `timeout` като причина, а не като общ провал.
const KEY = 'AKIAIOSFODNN7EXAMPLE';
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

/** Сървър, който приема заявката и НЕ отговаря — точно поведението на увиснал S3. */
function hangingServer() {
  const sockets = [];
  const server = http.createServer(() => { /* нарочно без res.end */ });
  server.on('connection', (s) => sockets.push(s));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server,
    endpoint: `http://127.0.0.1:${server.address().port}`,
    close: () => { for (const s of sockets) s.destroy(); return new Promise((r) => server.close(r)) },
  })));
}

/** Сървър, който отговаря бавно (за да се види, че таймаутът идва от нас, не от него). */
function slowServer(ms) {
  const server = http.createServer((req, res) => {
    req.resume();
    setTimeout(() => { res.writeHead(200); res.end() }, ms);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server,
    endpoint: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  })));
}

(async () => {
  assert.equal(mirror.DEFAULT_TIMEOUT_MS > 0, true, 'има подразбиращ се таймаут');

  // ── 1. Увиснал сървър: записът се проваля с `timeout`, а не виси ────────────
  const hang = await hangingServer();
  try {
    const target = mirror.create({
      raw: `s3://hapi-evidence/backup?endpoint=${hang.endpoint}&region=eu-central-1`,
      accessKey: KEY,
      secretKey: SECRET,
      timeoutMs: 300,
    });
    const started = Date.now();
    const out = await target.put('p1', 'f1', crypto.randomBytes(64));
    const elapsed = Date.now() - started;
    assert.equal(out.ok, false, 'записът не минава');
    assert.equal(out.reason, 'timeout', 'причината е точно `timeout`: ' + out.reason);
    assert.ok(elapsed < 3000, 'таймаутът идва от нас, не след минути: ' + elapsed + 'ms');

    const del = await target.remove('p1', 'f1');
    assert.equal(del.ok, false, 'триенето също не виси');
    assert.equal(del.reason, 'timeout', 'и там причината е `timeout`');

    const read = await target.get('p1', 'f1');
    assert.equal(read, null, 'четенето връща null, а не хвърля');
  } finally { await hang.close() }

  // ── 2. Бавен, но жив сървър: с достатъчен таймаут минава ────────────────────
  const slow = await slowServer(250);
  try {
    const patient = mirror.create({
      raw: `s3://hapi-evidence/backup?endpoint=${slow.endpoint}&region=eu-central-1`,
      accessKey: KEY,
      secretKey: SECRET,
      timeoutMs: 5000,
    });
    // PUT минава, но четенето обратно ще върне празен обект (сървърът не пази нищо) →
    // сверката трябва да го хване като разминаване, не като успех.
    const out = await patient.put('p2', 'f2', Buffer.from('данни'));
    assert.equal(out.ok, false, 'запис без запазване не е успех');
    assert.notEqual(out.reason, 'timeout', 'това не е таймаут: ' + out.reason);
  } finally { await slow.close() }

  // ── 3. Недостъпен порт: бърз отказ, без да чака таймаут ────────────────────
  const dead = mirror.create({ raw: 's3://hapi-evidence/backup?endpoint=http://127.0.0.1:1&region=eu-central-1', accessKey: KEY, secretKey: SECRET, timeoutMs: 5000 });
  const deadOut = await dead.put('p3', 'f3', Buffer.from('x'));
  assert.equal(deadOut.ok, false, 'мъртъв порт не пише');
  assert.equal(typeof deadOut.reason, 'string', 'причината е текст: ' + deadOut.reason);

  console.log('mirror-target-timeout OK: увиснал S3 → `timeout` за <3s · бавен жив → не е таймаут · мъртъв порт → бърз отказ');
})().catch((e) => { console.error(e); process.exit(1) });
