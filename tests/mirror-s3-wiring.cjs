'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { freePort, stopChild } = require('./helpers.cjs');
// §MIRROR_TARGET_PATH_OR_S3, жичната част: настройка → среда → сървър → цел.
// `mirror-target.cjs` доказва договора и подписа; тук се доказва, че сървърът наистина
// стига до s3 целта от КОНФИГУРАЦИЯТА, че без ключове отказва ясно и че непразена
// настройка връща 409, както преди.
const SERVER = path.join(__dirname, '../hapi_enterprise/server.js');
const KEY = 'AKIAIOSFODNN7EXAMPLE';
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

function fakeS3() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ method: req.method, url: req.url, auth: (req.headers.authorization || '').slice(0, 20), lock: req.headers['x-amz-object-lock-mode'] || null });
    req.resume();
    req.on('end', () => {
      if (!/^AWS4-HMAC-SHA256/.test(req.headers.authorization || '')) { res.writeHead(403); res.end(); return }
      res.writeHead(req.method === 'PUT' ? 200 : 404); res.end();
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, hits, endpoint: `http://127.0.0.1:${server.address().port}` })));
}

async function startServer(dir, extraEnv) {
  const port = await freePort();
  const token = 'mirror-s3-wiring-token-0123456789';
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, DATA_DIR: dir, ADMIN_TOKEN: token, PORT: String(port), ...extraEnv }, stdio: 'pipe' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + '/health')).ok) return { child, base, token } } catch { /* още не слуша */ }
    await new Promise((r) => setTimeout(r, 60));
  }
  await stopChild(child);
  throw new Error('сървърът не вдигна /health');
}

(async () => {
  const fake = await fakeS3();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-s3-wiring-'));
  try {
    // 1. s3 цел от настройката: verify познава вида и не търси локална папка.
    const s3Url = `s3://hapi-evidence/backup?endpoint=${fake.endpoint}&region=eu-central-1&lock=1`;
    const a = await startServer(dir, { STORAGE_MIRROR: s3Url, S3_ACCESS_KEY: KEY, S3_SECRET_KEY: SECRET });
    try {
      const res = await fetch(a.base + '/admin/api/storage/mirror/verify', { method: 'POST', headers: { authorization: 'Bearer ' + a.token, 'content-type': 'application/json' }, body: '{}' });
      const body = await res.json();
      assert.equal(res.status, 200, 'празна база → няма проблеми: ' + JSON.stringify(body).slice(0, 200));
      assert.equal(body.target.kind, 's3', 'целта е s3, не папка');
      assert.equal(body.target.location, 's3://hapi-evidence/backup', 'описанието показва адреса без ключове');
      assert.equal(body.dir, null, 'при s3 няма локална папка');
      assert.equal(JSON.stringify(body).includes(SECRET), false, 'секретът не изтича в отговора');
      assert.equal(body.checked, 0);
    } finally { await stopChild(a.child) }

    // 2. Без настройка: същият отказ като преди (409), договорът не се променя.
    const b = await startServer(dir, { STORAGE_MIRROR: '', S3_ACCESS_KEY: '', S3_SECRET_KEY: '' });
    try {
      const res = await fetch(b.base + '/admin/api/storage/mirror/verify', { method: 'POST', headers: { authorization: 'Bearer ' + b.token } });
      assert.equal(res.status, 409, 'без огледало → 409');
      assert.match(JSON.parse(await res.text()).error, /storage_mirror/);
    } finally { await stopChild(b.child) }

    // 3. s3 без ключове: отказ при СТАРТ, а не тихо огледало, което не пише.
    const out = spawnSync(process.execPath, [SERVER], { env: { ...process.env, DATA_DIR: dir, ADMIN_TOKEN: 'mirror-s3-wiring-token-0123456789', PORT: '0', STORAGE_MIRROR: s3Url }, encoding: 'utf8', timeout: 20000 });
    assert.notEqual(out.status, 0, 'без s3_access_key сървърът не бива да пали');
    assert.match(String(out.stderr || ''), /s3_access_key/, 'грешката казва какво липсва: ' + String(out.stderr || '').slice(0, 200));

    console.log('mirror-s3-wiring OK: настройка → s3 цел · без ключове → отказ при старт · без огледало → 409');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await new Promise((r) => fake.server.close(r));
  }
})().catch((e) => { console.error(e); process.exit(1) });
