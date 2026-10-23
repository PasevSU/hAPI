'use strict';
// Ограничаване на скоростта на изтегляне — РЕАЛНО, не „планирано“.
//
// До 0.69.54 `export-rules.capabilities()` връщаше `rate_limit: implemented: false`, а
// изтеглянето вървеше с максималната скорост на мрежата. Тук се проверява, че:
//   1. ограничителят наистина ЗАБАВЯ потока (измерено време, не „има функция“);
//   2. настройката се пази (`PATCH /admin/api/packages/settings`) и се прилага на живо;
//   3. ограничението се вижда в отговора (`X-RateLimit-BytesPerSec`);
//   4. съдържанието не се променя при ограничен трансфер (sha256 съвпада с индекса);
//   5. невалидна стойност е 400, а 0 изключва ограничението.
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { stopChild, freePort } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const throttle = require(path.join(ROOT, 'hapi_enterprise', 'throttle.js'));
const rules = require(path.join(ROOT, 'hapi_enterprise', 'export-rules.js'));
const { PassThrough } = require('node:stream');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ── 1. Ограничителят забавя наистина (без сървър) ───────────────────────────
async function runThrough(bytesPerSec, totalBytes) {
  const chunk = Buffer.alloc(16 * 1024, 7);
  let sent = 0;
  const src = new PassThrough();
  const out = new PassThrough();
  const started = Date.now();
  let received = 0;
  out.on('data', (d) => { received += d.length });
  const done = new Promise((resolve) => out.on('end', resolve));
  throttle.paceStream(src, out, bytesPerSec);
  while (sent < totalBytes) {
    if (!src.write(chunk)) await new Promise((r) => src.once('drain', r));
    sent += chunk.length;
  }
  src.end();
  await done;
  return { ms: Date.now() - started, received };
}

(async () => {
  const TOTAL = 256 * 1024;
  const free = await runThrough(0, TOTAL);
  const limited = await runThrough(128 * 1024, TOTAL); // 128 KiB/s → ~2 s
  assert.equal(free.received, TOTAL, 'без ограничение минават всички байтове');
  assert.equal(limited.received, TOTAL, 'с ограничение минават същите байтове');
  assert.ok(free.ms < 600, `без ограничение е бързо (${free.ms} ms)`);
  assert.ok(limited.ms >= 1500, `при 128 KiB/s трансферът трае поне 1.5 s (измерено ${limited.ms} ms)`);
  assert.ok(limited.ms > free.ms * 3, `ограниченият е поне 3× по-бавен (${limited.ms} срещу ${free.ms} ms)`);

  // ── 2. Валидация на стойността ────────────────────────────────────────────
  assert.equal(throttle.spec(0), 0, '0 = без ограничение');
  assert.equal(throttle.spec(512), 512 * 1024, 'KB/s се превежда в байтове');
  assert.equal(throttle.paced(0), null, 'без ограничение няма излишен stream');
  for (const bad of [-1, 0.5, 2 * 1024 * 1024, 'abc', {}]) {
    assert.throws(() => throttle.spec(bad), (e) => e.status === 400, 'spec(' + JSON.stringify(bad) + ') → 400');
  }

  // ── 3. Живо: настройка + ограничен трансфер ───────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-rate-'));
  const port = await freePort();
  const token = 'rate-limit-test-token-at-least-24-chars';
  const child = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: token },
    cwd: os.tmpdir(),
    stdio: 'ignore',
  });
  const call = async (p, method = 'GET', data, headers = {}) => {
    const r = await fetch('http://127.0.0.1:' + port + p, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...headers },
      body: data,
    });
    const type = r.headers.get('content-type') || '';
    const value = type.includes('application/json') ? await r.json() : await r.arrayBuffer();
    return { status: r.status, value, headers: r.headers };
  };
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await call('/health')).status === 200) { ready = true; break } } catch { /* сървърът още пали */ }
      await new Promise((r) => setTimeout(r, 30));
    }
    assert(ready, 'сървърът трябва да стартира');

    const portal = (await call('/admin/api/portals', 'POST', JSON.stringify({ slug: 'rl', title: 'Скорост', category: 'Правни дела' }), { 'Content-Type': 'application/json' })).value;
    assert.ok(portal.id, 'порталът е създаден');
    const payload = crypto.randomBytes(300 * 1024); // случайни байтове: не се свиват
    const upload = await call(`/admin/api/portals/${portal.id}/files`, 'POST', payload, { 'X-File-Name': 'dok.bin' });
    assert.equal(upload.status, 201, 'файлът е качен: ' + upload.status);

    const pkg = (await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id, compression: 'none' }), { 'Content-Type': 'application/json' })).value;
    assert.ok(pkg.id, 'пакетът е създаден');

    // Без ограничение: бързо и без заглавка.
    const fastStart = Date.now();
    const fast = await call(`/admin/api/packages/${pkg.id}/download`);
    const fastMs = Date.now() - fastStart;
    assert.equal(fast.status, 200, 'изтеглянето работи');
    assert.equal(sha256(Buffer.from(fast.value)), pkg.sha256, 'съдържанието съвпада с индекса');
    assert.equal(fast.headers.get('x-ratelimit-bytespersec'), null, 'без ограничение няма заглавка');

    // Ограничение 128 KB/s → ~300 KiB трае поне ~2 s.
    const patched = await call('/admin/api/packages/settings', 'PATCH', JSON.stringify({ rateKbps: 128 }), { 'Content-Type': 'application/json' });
    assert.equal(patched.value.rateKbps, 128, 'настройката се пази');
    const slowStart = Date.now();
    const slow = await call(`/admin/api/packages/${pkg.id}/download`);
    const slowMs = Date.now() - slowStart;
    assert.equal(slow.status, 200, 'ограниченото изтегляне също работи');
    assert.equal(sha256(Buffer.from(slow.value)), pkg.sha256, 'ограниченото изтегляне дава същите байтове');
    assert.equal(slow.headers.get('x-ratelimit-bytespersec'), String(128 * 1024), 'ограничението се обявява в отговора');
    assert.ok(slowMs >= 1500, `на живо ограничението се усеща (${slowMs} ms)`);
    assert.ok(slowMs > fastMs * 3, `ограниченото е по-бавно на живо (${slowMs} срещу ${fastMs} ms)`);

    // Невалидна стойност се отхвърля; 0 изключва.
    const badRate = await call('/admin/api/packages/settings', 'PATCH', JSON.stringify({ rateKbps: 5_000_000 }), { 'Content-Type': 'application/json' });
    assert.equal(badRate.status, 400, 'невалидна стойност → 400');
    const off = await call('/admin/api/packages/settings', 'PATCH', JSON.stringify({ rateKbps: 0 }), { 'Content-Type': 'application/json' });
    assert.equal(off.value.rateKbps, 0, '0 изключва ограничението');
    const afterOff = Date.now();
    await call(`/admin/api/packages/${pkg.id}/download`);
    const afterMs = Date.now() - afterOff;
    assert.ok(afterMs < slowMs, `след изключване отново е бързо (${afterMs} срещу ${slowMs} ms)`);

    // ── 4. Способността е обявена за готова ─────────────────────────────────
    const caps = rules.capabilities();
    assert.equal(caps.find((c) => c.id === 'rate_limit').implemented, true, 'rate_limit е обявена за готова');
    assert.equal(caps.find((c) => c.id === 'rate_limit').status, 'ready');
    assert.deepEqual(
      caps.filter((c) => c.implemented).map((c) => c.id),
      ['compression', 'split_archive', 'rate_limit', 'parallel_transfers', 'encrypt_package'],
      'точно пет готови способности'
    );

    process.stdout.write(
      `PASS rate-limit: 256 KiB при 128 KiB/s за ${limited.ms} ms срещу ${free.ms} ms без ограничение · живо изтегляне ${slowMs} ms срещу ${fastMs} ms · заглавка X-RateLimit-BytesPerSec · 400 при невалидна стойност · 4 готови способности\n`
    );
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  process.stderr.write('FAIL rate-limit: ' + (e && e.message ? e.message : e) + '\n');
  process.exitCode = 1;
});
