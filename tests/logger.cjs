'use strict';
// Структуриран debug лог: нива, namespace-и, редакция на тайни, ring buffer,
// JSONL файл с ротация и fail-open поведение при недостъпен storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create, redact } = require('../hapi_enterprise/logger');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-logger-'));
const fileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-logfile-'));

try {
  // ── нива ────────────────────────────────────────────────────────────────
  const log = create({ dir, level: 'info', console: false });
  assert.equal(log.level(), 'info');
  assert.equal(log.enabled('debug'), false);
  assert.equal(log.trace('no'), false);
  assert.equal(log.debug('no'), false);
  assert.equal(log.info('hello', { portal: 'files' }), true);
  log.warn('careful');
  assert.deepEqual(
    log.entries().map((e) => e.msg),
    ['careful', 'hello'],
  );

  // ── child namespace и сливане на контекст ───────────────────────────────
  const http = log.child({ ns: 'http', reqId: 'abc123' });
  http.info('request', { path: '/admin', status: 200, ms: 4 });
  const request = log.entries({ limit: 1 })[0];
  assert.equal(request.ns, 'http');
  assert.equal(request.ctx.reqId, 'abc123');
  assert.equal(request.ctx.path, '/admin');
  assert.equal(request.ctx.status, 200);
  assert.equal(request.ctx.ns, undefined, 'ns не се дублира в payload');

  // ── редакция на тайни ───────────────────────────────────────────────────
  log.info('redacted', {
    token: 'supersecretvalue',
    authorization: 'Bearer abcdefghijklmnop',
    portal_key: 'pk_live_123',
    nested: { password: 'p', ok: 1 },
  });
  const secret = log.entries({ limit: 1 })[0];
  assert.equal(secret.ctx.token, '***');
  assert.equal(secret.ctx.authorization, '***');
  assert.equal(secret.ctx.portal_key, '***');
  assert.equal(secret.ctx.nested.password, '***');
  assert.equal(secret.ctx.nested.ok, 1);
  log.info('hdr Authorization: Bearer abcdefghijklmnop');
  const header = log.entries({ limit: 1 })[0];
  assert.match(header.msg, /\*\*\*$/);
  assert.doesNotMatch(header.msg, /abcdefghijklmnop/);
  assert.equal(redact({ secret: 'x', list: [{ token: 'y' }] }).list[0].token, '***');

  // ── смяна на нивото в runtime ───────────────────────────────────────────
  assert.equal(log.setLevel('debug'), 'debug');
  assert.throws(() => log.setLevel('verbose'), /Unknown log level/);
  http.debug('now visible');
  assert.equal(log.entries({ limit: 1 })[0].msg, 'now visible');

  // ── ограничен ring buffer ───────────────────────────────────────────────
  const small = create({ dir: null, level: 'info', console: false, maxEntries: 10 });
  for (let i = 0; i < 25; i++) small.info('e' + i);
  assert.equal(small.stats().inMemory, 10);
  assert.equal(small.stats().dropped, 15);
  assert.equal(small.entries()[0].msg, 'e24');
  assert.equal(small.stats().dir, null);

  // ── файлов sink: JSONL, ротация, брой запазени файлове ─────────────────
  const keeper = create({ dir: fileDir, level: 'debug', console: false, maxBytes: 4096, maxFiles: 2 });
  for (let i = 0; i < 200; i++) keeper.debug('line ' + i, { i });
  const files = keeper.files();
  assert.ok(files.length >= 1, 'трябва да има поне един лог файл');
  assert.ok(files.length <= 2, 'старите файлове се изтриват, намерени: ' + files.length);
  const newest = path.join(fileDir, 'logs', files[files.length - 1]);
  const lines = fs.readFileSync(newest, 'utf8').trim().split('\n');
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.level, 'debug');
  assert.match(parsed.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(fs.statSync(newest).size <= 4096 + 512, 'файлът се реже по размер');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(newest).mode & 0o777, 0o600, 'лог файлът е 0600');
  }

  // ── fail-open: недостъпен storage не чупи извикващия ────────────────────
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'x');
  const broken = create({ dir: blocker, level: 'info', console: false });
  assert.doesNotThrow(() => broken.info('still fine'));
  assert.equal(broken.entries({ limit: 1 })[0].msg, 'still fine');

  console.log(
    'PASS logger: нива, child/ns, редакция на тайни, runtime level, ring buffer, JSONL с ротация и 0600, fail-open',
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(fileDir, { recursive: true, force: true });
}
