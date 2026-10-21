'use strict';
// Едновременни линкове: 3 паралелни изтегляния при лимит 1 трябва да се изчакат в
// опашка, а не да връщат 503. Регенерацията на API файловете не бива да оставя
// частично записан JSON при паралелни заявки.
const { stopChild } = require('./helpers.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-concurrent-'));
  const port = 31000 + Math.floor(Math.random() * 900);
  const adminPort = port + 1;
  const token = 'concurrent-links-admin-token-123456789';
  const base = `http://127.0.0.1:${port}`;
  const adminBase = `http://127.0.0.1:${adminPort}`;
  let child;

  const auth = { authorization: 'Bearer ' + token };

  try {
    child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
      env: {
        ...process.env,
        DATA_DIR: dir,
        PORT: String(port),
        ADMIN_TOKEN: token,
        MAX_DOWNLOAD_STREAMS: '1',
        DOWNLOAD_WAIT_MS: '10000',
        INGRESS_MODE: 'true',
        ADMIN_PORT: String(adminPort),
        ADMIN_BIND_HOST: '127.0.0.1',
      },
      stdio: 'ignore',
    });
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try {
        if ((await fetch(base + '/health')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, 'сървърът не стартира');

    const created = await fetch(adminBase + '/admin/api/portals', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'links', title: 'Links', visibility: 'public' }),
    });
    assert.equal(created.status, 201);
    const portal = await created.json();

    const names = ['a.pdf', 'b.pdf', 'c.pdf'];
    const ids = [];
    for (const name of names) {
      const res = await fetch(`${adminBase}/admin/api/portals/${portal.id}/files`, {
        method: 'POST',
        headers: { ...auth, 'x-file-name': name, 'content-type': 'application/octet-stream' },
        body: Buffer.from('payload-' + name),
      });
      assert.equal(res.status, 201, 'качването на ' + name + ' се провали');
      ids.push((await res.json()).id);
    }

    // 1. Три едновременни линка за изтегляне при лимит 1 → всички 200, без 503.
    const downloads = await Promise.all(ids.map((id) => fetch(`${base}/api/v1/p/links/files/${id}/download`)));
    assert.deepEqual(
      downloads.map((r) => r.status),
      [200, 200, 200],
      'нито един паралелен линк не бива да получава 503',
    );
    const bodies = await Promise.all(downloads.map((r) => r.text()));
    assert.deepEqual(bodies, names.map((n) => 'payload-' + n), 'съдържанието на всеки файл е коректно');

    // 2. Три едновременни отваряния на порталната страница.
    const pages = await Promise.all([fetch(`${base}/p/links`), fetch(`${base}/p/links`), fetch(`${base}/p/links`)]);
    assert.deepEqual(pages.map((r) => r.status), [200, 200, 200]);

    // 3. Паралелна регенерация на API файловете не оставя частичен JSON.
    const regen = await Promise.all(
      [1, 2, 3].map(() => fetch(`${adminBase}/admin/api/v2/portals/links/api`, { method: 'POST', headers: auth })),
    );
    const regenBodies = await Promise.all(regen.map((r) => r.text()));
    assert.deepEqual(
      regen.map((r) => r.status),
      [201, 201, 201],
      'отговори: ' + regenBodies.map((body) => body.slice(0, 200)).join(' | '),
    );
    const apiDir = path.join(dir, 'api', 'links');
    for (const file of ['api.json', 'openapi.json']) {
      const text = fs.readFileSync(path.join(apiDir, file), 'utf8');
      assert.doesNotThrow(() => JSON.parse(text), file + ' е частично записан');
    }

    console.log('PASS concurrent links: 3 паралелни изтегляния (лимит 1) без 503, коректно съдържание, атомарни API файлове');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
