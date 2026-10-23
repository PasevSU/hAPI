'use strict';
// Възобновяване на прекъснат трансфер — РЕАЛНО, не „планирано“.
//
// До 0.69.59 `export-rules.capabilities()` връщаше `resume_transfer: implemented: false`:
// прекъснато теглене се започваше отначало. Тук се проверява, че:
//   1. сървърът дава ETag върху СЪДЪРЖАНИЕТО и прилага Range само при съвпадащ `If-Range`;
//   2. `scripts/resume-package.cjs` продължава от вече изтеглените байтове (не от 0) и
//      резултатът съвпада по sha256;
//   3. при СМЕНЕНО съдържание (чужда ETag) сървърът връща целия файл, а скриптът започва
//      отначало — не се слепват две различни съдържания;
//   4. невалидно/липсващо състояние също води до чисто ново теглене;
//   5. способността е обявена за готова (всички шест).
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-resume-'));
  const port = await freePort();
  const token = 'resume-test-token-at-least-24-chars';
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
  // След пауза (дъщерни процеси) клиентът може да вземе мъртва връзка от пула си.
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

    step = 'пакет';
    const payload = crypto.randomBytes(512 * 1024);
    const portal = (await call('/admin/api/portals', 'POST', JSON.stringify({ slug: 'res', title: 'Възобновяване', category: 'Правни дела' }), { 'Content-Type': 'application/json' })).value;
    assert.ok(portal.id, 'порталът е създаден');
    assert.equal((await call(`/admin/api/portals/${portal.id}/files`, 'POST', payload, { 'X-File-Name': 'dok.bin' })).status, 201, 'файлът е качен');
    const pkg = (await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id, compression: 'none' }), { 'Content-Type': 'application/json' })).value;
    assert.ok(pkg.id, 'пакетът е създаден');
    const url = `${base}/admin/api/packages/${pkg.id}/download`;

    // ── 1. ETag върху съдържанието ───────────────────────────────────────────
    step = 'etag';
    const head = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Range: 'bytes=0-0' } });
    await head.arrayBuffer();
    const etag = head.headers.get('etag') || '';
    assert.equal(head.status, 206, 'Range 0-0 връща частично съдържание');
    assert.equal(etag, `"${pkg.sha256}"`, 'ETag е хешът на доставяното съдържание');

    // ── 2. Продължаване от вече изтеглени байтове ───────────────────────────
    step = 'продължаване';
    const out = path.join(dir, 'package.zip');
    const firstChunk = 200 * 1024;
    const partial = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Range: `bytes=0-${firstChunk - 1}` } });
    assert.equal(partial.status, 206, 'първата част е 206');
    fs.writeFileSync(out, Buffer.from(await partial.arrayBuffer()));
    fs.writeFileSync(`${out}.resume.json`, JSON.stringify({ url, etag, size: pkg.size }));
    assert.equal(fs.statSync(out).size, firstChunk, 'имаме първите 200 KiB');

    const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'resume-package.cjs'), url, out, '--token', token, '--sha256', pkg.sha256], { encoding: 'utf8' });
    assert.equal(cli.status, 0, 'resume-package работи: ' + cli.stderr);
    const report = JSON.parse(cli.stdout);
    assert.equal(report.resumedFrom, firstChunk, 'продължава от 200 KiB, не от 0');
    assert.equal(report.restart, false, 'няма рестарт при същия ETag');
    assert.equal(report.bytes, pkg.size, 'файлът е цял');
    assert.equal(report.sha256, pkg.sha256, 'sha256 съвпада с индекса');
    assert.equal(sha256(fs.readFileSync(out)), pkg.sha256, 'файлът на диска е правилният');

    // ── 3. Сменено съдържание → сървърът дава целия файл, скриптът започва от 0 ──
    step = 'смяна на съдържанието';
    const foreign = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Range: 'bytes=100-', 'If-Range': '"nesushtestvuvasht-hesh"' } });
    const foreignBody = Buffer.from(await foreign.arrayBuffer());
    assert.equal(foreign.status, 200, 'чужда If-Range → 200 (цялото съдържание)');
    assert.equal(sha256(foreignBody), pkg.sha256, 'върнатото съдържание е цялото');
    assert.equal(foreignBody.length, pkg.size, 'дължината е на целия файл');

    // Със счупено състояние (чужд ETag) скриптът започва отначало и пак успява.
    step = 'рестарт при чужд etag';
    const out2 = path.join(dir, 'package2.zip');
    fs.writeFileSync(out2, Buffer.alloc(1024, 1));
    fs.writeFileSync(`${out2}.resume.json`, JSON.stringify({ url, etag: '"drug-hesh"', size: pkg.size }));
    const restart = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'resume-package.cjs'), url, out2, '--token', token, '--sha256', pkg.sha256], { encoding: 'utf8' });
    assert.equal(restart.status, 0, 'рестартът работи: ' + restart.stderr);
    const restartReport = JSON.parse(restart.stdout);
    assert.equal(restartReport.restart, true, 'скриптът разбира, че файлът е друг');
    assert.equal(restartReport.resumedFrom, 0, 'започва от 0');
    assert.equal(restartReport.sha256, pkg.sha256, 'и пак стига до правилния файл');

    // ── 4. Липсващо състояние → чисто ново теглене ─────────────────────────
    step = 'без състояние';
    const out3 = path.join(dir, 'package3.zip');
    fs.writeFileSync(out3, Buffer.alloc(2048, 2)); // „откъснат“ файл без .resume.json
    const fresh = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'resume-package.cjs'), url, out3, '--token', token], { encoding: 'utf8' });
    assert.equal(fresh.status, 0, 'ново теглене без състояние: ' + fresh.stderr);
    const freshReport = JSON.parse(fresh.stdout);
    assert.equal(freshReport.resumedFrom, 0, 'без състояние се започва от 0');
    assert.equal(freshReport.sha256, pkg.sha256, 'резултатът е правилният');
    assert.equal(freshReport.complete, true, 'файлът е отбелязан като цял');

    // ── 5. Всички шест способности са готови ───────────────────────────────
    step = 'способности';
    const caps = rules.capabilities();
    assert.equal(caps.find((c) => c.id === 'resume_transfer').implemented, true, 'resume_transfer е обявена за готова');
    assert.deepEqual(caps.filter((c) => !c.implemented), [], 'няма останали планирани способности');
    assert.equal(caps.filter((c) => c.implemented).length, 6, 'всички шест са готови');

    process.stdout.write(
      `PASS resume-transfer: продължено от ${report.resumedFrom} B до ${report.bytes} B без повторно теглене · ETag="${etag.slice(1, 9)}…" · чужда If-Range → 200 цяло съдържание · рестарт и ново теглене дават същия sha256 · 6/6 способности готови\n`
    );
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  const cause = e && e.cause ? ` (причина: ${e.cause.code || e.cause.message})` : '';
  process.stderr.write(`FAIL resume-transfer [етап: ${step}]: ${e && e.message ? e.message : e}${cause}\n`);
  process.exitCode = 1;
});
