'use strict';
// Крипто опции на add-on-а: tsa_enabled/адреси, шифроване по подразбиране,
// приоритет на X-File-Encrypt и fail-closed TLS конфигурация.
const { stopChild } = require('./helpers.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const SERVER = path.join(__dirname, '../hapi_enterprise/server.js');
const MAGIC = Buffer.from('hapiE1', 'ascii');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-crypto-'));
  const port = 33000 + Math.floor(Math.random() * 1200);
  const adminPort = port + 1;
  const token = 'crypto-options-admin-token-0987654321';
  const base = `http://127.0.0.1:${port}`;
  const admin = `http://127.0.0.1:${adminPort}`;
  let child;

  const env = (extra) => ({
    ...process.env,
    DATA_DIR: dir,
    OPTIONS_PATH: path.join(dir, 'missing-options.json'),
    PORT: String(port),
    ADMIN_TOKEN: token,
    INGRESS_MODE: 'true',
    ADMIN_PORT: String(adminPort),
    ADMIN_BIND_HOST: '127.0.0.1',
    ...extra,
  });
  const wait = async () => {
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(base + '/health')).status === 200) return true;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  const call = async (url, { method = 'GET', body, raw = false, headers = {} } = {}) => {
    const res = await fetch(url, {
      method,
      headers: { ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), Authorization: 'Bearer ' + token, ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    let value = null;
    try {
      value = await res.json();
    } catch {}
    return { status: res.status, value };
  };

  try {
    child = spawn(process.execPath, [SERVER], { env: env({}), stdio: 'ignore' });
    assert.equal(await wait(), true, 'сървърът стартира');

    // 1. По подразбиране RFC 3161 е изключен: GET казва enabled=false, POST е 409.
    const status = await call(admin + '/admin/api/v2/rfc3161');
    assert.equal(status.status, 200);
    assert.equal(status.value.enabled, false, 'tsa_enabled=false по подразбиране');
    const blocked = await call(admin + '/admin/api/v2/rfc3161', {
      method: 'POST',
      body: { phase: 'start', digest: 'ab'.repeat(32) },
    });
    assert.equal(blocked.status, 409, 'изключен TSA не създава токени');
    assert.match(blocked.value.error, /disabled/i);

    // 2. encrypt_files не е включен: качване без header остава plaintext.
    const portal = await call(admin + '/admin/api/portals', { method: 'POST', body: { slug: 'crypto', title: 'Crypto' } });
    assert.equal(portal.status, 201);
    const portalId = portal.value.id;
    const plainUpload = await call(`${admin}/admin/api/portals/${portalId}/files`, {
      method: 'POST',
      raw: true,
      headers: { 'X-File-Name': 'plain.txt', 'Content-Type': 'application/octet-stream' },
      body: 'plain text',
    });
    assert.equal(plainUpload.status, 201);
    assert.equal(plainUpload.value.encrypted, false, 'без ENCRYPT_FILES файлът е plaintext');

    await stopChild(child);

    // 3. С ENCRYPT_FILES=true и TSA_ENABLED=true.
    child = spawn(process.execPath, [SERVER], {
      env: env({ ENCRYPT_FILES: 'true', TSA_ENABLED: 'true', TSA_START_URL: 'https://tsa.example.start/', TSA_STOP_URL: 'https://tsa.example.stop/' }),
      stdio: 'ignore',
    });
    assert.equal(await wait(), true, 'сървърът стартира с крипто опциите');
    const enabled = await call(admin + '/admin/api/v2/rfc3161');
    assert.equal(enabled.value.enabled, true);
    assert.deepEqual(enabled.value.tsa, { start: 'https://tsa.example.start/', stop: 'https://tsa.example.stop/' }, 'адресите идват от опциите');

    const encryptedUpload = await call(`${admin}/admin/api/portals/${portalId}/files`, {
      method: 'POST',
      raw: true,
      headers: { 'X-File-Name': 'secret.txt', 'Content-Type': 'application/octet-stream' },
      body: 'top secret payload',
    });
    assert.equal(encryptedUpload.status, 201);
    assert.equal(encryptedUpload.value.encrypted, true, 'ENCRYPT_FILES=true шифрова по подразбиране');
    const storedPath = path.join(dir, 'files', portalId, encryptedUpload.value.id);
    const stored = fs.readFileSync(storedPath);
    assert.equal(stored.subarray(0, 6).equals(MAGIC), true, 'на диска има hapiE1 контейнер');
    assert.equal(stored.includes(Buffer.from('top secret payload')), false, 'няма plaintext на диска');
    assert.equal(encryptedUpload.value.sha256, require('node:crypto').createHash('sha256').update('top secret payload').digest('hex'), 'SHA-256 е на plaintext-а');

    // 4. Явният header има приоритет пред опцията.
    const optedOut = await call(`${admin}/admin/api/portals/${portalId}/files`, {
      method: 'POST',
      raw: true,
      headers: { 'X-File-Name': 'open.txt', 'X-File-Encrypt': '0', 'Content-Type': 'application/octet-stream' },
      body: 'not encrypted',
    });
    assert.equal(optedOut.status, 201);
    assert.equal(optedOut.value.encrypted, false, 'X-File-Encrypt: 0 изключва шифроването');
    const openStored = fs.readFileSync(path.join(dir, 'files', portalId, optedOut.value.id));
    assert.equal(openStored.subarray(0, 6).equals(MAGIC), false);

    await stopChild(child);

    // 5. TLS fail-closed: само сертификат без ключ не стартира.
    const broken = spawn(process.execPath, [SERVER], {
      env: env({ PORT: String(port + 2), ADMIN_PORT: String(port + 3), TLS_CERT: '/nonexistent/cert.pem' }),
      stdio: 'pipe',
    });
    let stderr = '';
    broken.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    const code = await new Promise((resolve) => broken.on('exit', (value) => resolve(value)));
    assert.notEqual(code, 0, 'липсващ tls_key спира старта');
    assert.match(stderr, /TLS:/, 'съобщението за TLS е в stderr');

    console.log('PASS crypto options: TSA enabled/адреси, encrypt_files по подразбиране, header приоритет, TLS fail-closed');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
