'use strict';
// Паралелни трансфери — РЕАЛНО, не „планирано“.
//
// До 0.69.55 `export-rules.capabilities()` връщаше `parallel_transfers: implemented: false`:
// пакетът се теглеше само с един поток. Тук се проверява, че:
//   1. сървърът обявява Range поддръжка и колко паралелни заявки допуска (`X-Parallel-Chunks`);
//   2. `scripts/fetch-package.cjs` тегли НАИСТИНА паралелно (N Range заявки) и слепеният
//      файл съвпада байт-в-байт по sha256;
//   3. паралелизмът НЕ заобикаля ограничението на скоростта — бюджетът е общ за пакета,
//      затова 4 потока не дават 4× скорост;
//   4. настройката `parallelChunks` се пази и се валидира (1–8, иначе 400).
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { stopChild, freePort } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const rules = require(path.join(ROOT, 'hapi_enterprise', 'export-rules.js'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

let step = 'старт';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-parallel-'));
  const port = await freePort();
  const token = 'parallel-test-token-at-least-24-chars';
  const child = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: token },
    cwd: os.tmpdir(),
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const once = async (p, method = 'GET', data, headers = {}) => {
    const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + token, ...headers }, body: data });
    const type = r.headers.get('content-type') || '';
    const value = type.includes('application/json') ? await r.json() : await r.arrayBuffer();
    return { status: r.status, value, headers: r.headers };
  };
  // При пауза (докато текат дъщерните процеси на CLI) сървърът затваря бездействащата
  // връзка (keep-alive 5 s), а клиентът може да я вземе от пула си и да падне с
  // UND_ERR_SOCKET. Това е свойство на КЛИЕНТА, не на продукта — затова се повтаря веднъж.
  const call = async (p, method = 'GET', data, headers = {}) => {
    try {
      return await once(p, method, data, headers);
    } catch (e) {
      if (!/fetch failed|UND_ERR_SOCKET/i.test(String(e && e.message))) throw e;
      await new Promise((r) => setTimeout(r, 200));
      return once(p, method, data, headers);
    }
  };
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      try { if ((await call('/health')).status === 200) { ready = true; break } } catch { /* сървърът още пали */ }
      await new Promise((r) => setTimeout(r, 30));
    }
    assert(ready, 'сървърът трябва да стартира');

    // Пакет от ~1 MiB случайни байтове (не се свиват, размерът е предвидим).
    step = 'портал';
    const payload = crypto.randomBytes(1024 * 1024);
    const portal = (await call('/admin/api/portals', 'POST', JSON.stringify({ slug: 'par', title: 'Паралел', category: 'Правни дела' }), { 'Content-Type': 'application/json' })).value;
    assert.ok(portal.id, 'порталът е създаден');
    assert.equal((await call(`/admin/api/portals/${portal.id}/files`, 'POST', payload, { 'X-File-Name': 'golqm.bin' })).status, 201, 'файлът е качен');
    step = 'пакет';
    const pkg = (await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id, compression: 'none' }), { 'Content-Type': 'application/json' })).value;
    assert.ok(pkg.id, 'пакетът е създаден');

    // ── 1. Сървърът обявява паралелизъм ─────────────────────────────────────
    step = 'проба';
    const url = `${base}/admin/api/packages/${pkg.id}/download`;
    const probe = async () => {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Range: 'bytes=0-0' } }).catch(async (e) => {
        // същата причина като в `call`: мъртва връзка от пула след пауза
        if (!/fetch failed|UND_ERR_SOCKET/i.test(String(e && e.message))) throw e;
        await new Promise((res) => setTimeout(res, 200));
        return fetch(url, { headers: { Authorization: 'Bearer ' + token, Range: 'bytes=0-0' } });
      });
      // Тялото се чете докрай: прекратен отговор оставя мъртва връзка в пула.
      const headers = r.headers;
      await r.arrayBuffer();
      return { status: r.status, headers };
    };
    const head = await probe();
    assert.equal(head.status, 206, 'Range 0-0 връща частично съдържание');
    assert.equal((head.headers.get('accept-ranges') || '').toLowerCase(), 'bytes', 'Range е обявен');
    assert.equal(head.headers.get('x-parallel-chunks'), '4', 'по подразбиране 4 паралелни заявки');

    // ── 2. CLI тегли паралелно и слепва правилно ────────────────────────────
    const out = path.join(dir, 'parallel.zip');
    const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'fetch-package.cjs'), url, out, '--token', token, '--parallel', '4', '--sha256', pkg.sha256], { encoding: 'utf8' });
    assert.equal(cli.status, 0, 'fetch-package работи: ' + cli.stderr);
    const report = JSON.parse(cli.stdout);
    assert.equal(report.parallel, 4, 'наистина 4 паралелни заявки');
    assert.equal(report.chunks.length, 4, 'четири свалени парчета');
    assert.equal(report.bytes, pkg.size, 'свалени са всички байтове');
    assert.equal(report.sha256, pkg.sha256, 'слепеният файл съвпада по sha256');
    assert.equal(sha256(fs.readFileSync(out)), pkg.sha256, 'файлът на диска е същият');
    // Всяко парче е различен диапазон — иначе „паралелизмът“ е един и същ байт 4 пъти.
    const ranges = new Set(report.chunks.map((c) => `${c.start}-${c.end}`));
    assert.equal(ranges.size, 4, 'диапазоните са различни');
    assert.equal(report.chunks.reduce((n, c) => n + c.bytes, 0), pkg.size, 'покритието е пълно');

    // ── 3. Паралелизмът не заобикаля ограничението на скоростта ─────────────
    step = 'ограничение';
    await call('/admin/api/packages/settings', 'PATCH', JSON.stringify({ rateKbps: 256, parallelChunks: 4 }), { 'Content-Type': 'application/json' });
    const expectedMs = (pkg.size / (256 * 1024)) * 1000;
    const parStart = Date.now();
    const cliRate = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'fetch-package.cjs'), url, path.join(dir, 'parallel2.zip'), '--token', token, '--parallel', '4'], { encoding: 'utf8' });
    const parMs = Date.now() - parStart;
    assert.equal(cliRate.status, 0, 'паралелното теглене с ограничение работи: ' + cliRate.stderr);
    assert.ok(parMs >= expectedMs * 0.6, `4 потока не дават 4× скорост (${parMs} ms при очаквани ~${Math.round(expectedMs)} ms за ${pkg.size} B)`);
    assert.ok(parMs < expectedMs * 3, `и не са по-бавни от разумното (${parMs} ms)`);

    // Един поток при същото ограничение: времето е същото, защото бюджетът е общ.
    const seqStart = Date.now();
    const seq = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'fetch-package.cjs'), url, path.join(dir, 'single.zip'), '--token', token, '--parallel', '1'], { encoding: 'utf8' });
    const seqMs = Date.now() - seqStart;
    assert.equal(seq.status, 0, 'единичното теглене работи: ' + seq.stderr);
    assert.equal(JSON.parse(seq.stdout).parallel, 1, 'един поток при --parallel 1');
    assert.ok(seqMs >= expectedMs * 0.6, `един поток също е ограничен (${seqMs} ms)`);

    // ── 4. Настройката се пази и се валидира ────────────────────────────────
    step = 'валидация';
    const patched = await call('/admin/api/packages/settings', 'PATCH', JSON.stringify({ parallelChunks: 8 }), { 'Content-Type': 'application/json' });
    assert.equal(patched.value.parallelChunks, 8, 'осем паралелни заявки се приемат');
    const head8 = await probe();
    assert.equal(head8.headers.get('x-parallel-chunks'), '8', 'новата стойност се обявява');
    for (const bad of [0, 9, 2.5, 'mnogo']) {
      const res = await call('/admin/api/packages/settings', 'PATCH', JSON.stringify({ parallelChunks: bad }), { 'Content-Type': 'application/json' });
      assert.equal(res.status, 400, 'parallelChunks=' + bad + ' → 400');
    }

    // ── 5. Способността е обявена за готова ─────────────────────────────────
    const caps = rules.capabilities();
    assert.equal(caps.find((c) => c.id === 'parallel_transfers').implemented, true, 'parallel_transfers е обявена за готова');
    assert.equal(caps.find((c) => c.id === 'parallel_transfers').status, 'ready');
    assert.deepEqual(
      caps.filter((c) => c.implemented).map((c) => c.id),
      ['compression', 'split_archive', 'rate_limit', 'parallel_transfers', 'encrypt_package'],
      'точно пет готови способности'
    );

    process.stdout.write(
      `PASS parallel-transfers: ${pkg.size} B с 4 паралелни Range заявки · sha256 съвпада · при 256 KB/s 4 потока ${parMs} ms (очаквани ~${Math.round(expectedMs)} ms) · 1 поток ${seqMs} ms · X-Parallel-Chunks 4→8 · 400 при невалидно · 5 готови способности\n`
    );
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  const cause = e && e.cause ? ` (причина: ${e.cause.code || e.cause.message})` : '';
  process.stderr.write(`FAIL parallel-transfers [етап: ${step}]: ${e && e.message ? e.message : e}${cause}\n`);
  process.exitCode = 1;
});
