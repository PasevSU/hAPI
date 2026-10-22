'use strict';
// Сценарий: устойчивост под хаос — паралелни заявки, прекъснати клиенти, рестарт.
//
// Продуктът не бива да губи данни или да „пада“ частично, когато:
//   • 40 заявки тръгват едновременно (четене, писане, изтегляне, одит);
//   • част от клиентите прекъснат връзката по средата (AbortController);
//   • add-on-ът бъде рестартиран веднага след това.
// След хаоса: сървърът е здрав, одит веригата е валидна, няма остатъчни .tmp файлове
// и данните са същите след рестарт.
const { stopChild, freePort, waitHealthy } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const TOKEN = 'chaos-resilience-admin-token-0123456789';

async function boot(dir, port) {
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      OPTIONS_PATH: path.join(dir, 'missing-options.json'),
      PORT: String(port),
      ADMIN_TOKEN: TOKEN,
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  await waitHealthy(child, base);
  return { child, base };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-chaos-'));
  const port = await freePort();
  let server = await boot(dir, port);
  let portalId = '';

  const auth = { Authorization: 'Bearer ' + TOKEN };

  try {
    const api = async (route, { method = 'GET', body, raw, headers = {}, signal } = {}) => {
      const res = await fetch(server.base + route, {
        method,
        signal,
        headers: {
          ...auth,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : raw,
      });
      const type = res.headers.get('content-type') || '';
      return {
        status: res.status,
        value: type.includes('application/json') ? await res.json() : null,
        buffer: type.includes('application/json') ? null : Buffer.from(await res.arrayBuffer()),
      };
    };

    // 1. Основа: портал с три файла, за да има какво да се чете и изтегля.
    const portal = await api('/admin/api/portals', {
      method: 'POST',
      body: { slug: 'chaos', title: 'Chaos' },
    });
    assert.equal(portal.status, 201, JSON.stringify(portal.value));
    portalId = portal.value.id;
    const fileIds = [];
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      const up = await api(`/admin/api/portals/${portalId}/files`, {
        method: 'POST',
        raw: `съдържание ${name}`.repeat(200),
        headers: { 'X-File-Name': name },
      });
      assert.equal(up.status, 201);
      fileIds.push(up.value.id);
    }

    // 2. Хаос: 40 паралелни заявки, 10 от тях прекъснати по средата.
    const tasks = [];
    for (let i = 0; i < 40; i++) {
      const kind = i % 5;
      if (kind === 0) {
        tasks.push(api('/admin/api/portals'));
      } else if (kind === 1) {
        tasks.push(api('/admin/api/metrics'));
      } else if (kind === 2) {
        tasks.push(
          api(`/admin/api/portals/${portalId}/files`, {
            method: 'POST',
            raw: 'четвърти файл '.repeat(500),
            headers: { 'X-File-Name': `extra-${i}.txt` },
          }),
        );
      } else if (kind === 3) {
        const controller = new AbortController();
        const promise = api(`/api/v1/p/chaos/files/${fileIds[0]}/download`, {
          signal: controller.signal,
        }).catch((e) => ({ aborted: true, error: e.name }));
        setTimeout(() => controller.abort(), 5);
        tasks.push(promise);
      } else {
        tasks.push(api('/admin/api/audit?limit=50'));
      }
    }
    const results = await Promise.all(tasks);
    const aborted = results.filter((r) => r && r.aborted).length;
    assert.ok(aborted >= 5, `очаквам прекъснати заявки, получих ${aborted}`);
    const failed = results.filter((r) => r && !r.aborted && (r.status >= 500 || r.status === 0));
    assert.deepEqual(
      failed.map((r) => r.status),
      [],
      'никоя завършена заявка не бива да е 5xx',
    );
    const created = results.filter((r) => r && r.status === 201).length;
    assert.ok(created >= 1, 'част от качванията минават');

    // 3. След хаоса: жив, готов и без остатъчни временни файлове.
    assert.equal((await fetch(server.base + '/health')).status, 200);
    const ready = await (await fetch(server.base + '/ready')).json();
    assert.equal(ready.ready, true, JSON.stringify(ready));
    assert.equal(ready.db.state, 'ok');

    const leftovers = [];
    const walk = (dirPath) => {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(tmp|partial)$/.test(entry.name)) leftovers.push(full);
      }
    };
    walk(path.join(dir, 'files'));
    assert.deepEqual(leftovers, [], `остатъчни временни файлове: ${leftovers.join(', ')}`);

    const portalAfter = await api(`/admin/api/portals/${portalId}`);
    assert.ok(portalAfter.value.files.length >= 3, 'оригиналните файлове са налице');
    const integrity = await api(`/admin/api/portals/${portalId}/integrity`);
    assert.equal(integrity.value.verified, true, 'файловете са непокътнати след хаоса');

    // 4. Одит веригата остава последователна.
    const chain = await api('/admin/api/audit/verify');
    assert.equal(chain.status, 200, JSON.stringify(chain.value));
    assert.equal(chain.value.valid, true);

    // 5. Рестарт веднага след хаоса: няма загуба на данни.
    const before = portalAfter.value.files.length;
    await stopChild(server.child);
    server = await boot(dir, await freePort());
    const restored = await fetch(`${server.base}/admin/api/portals/${portalId}`, { headers: auth });
    assert.equal(restored.status, 200, 'порталът е налице след рестарт');
    const restoredBody = await restored.json();
    assert.equal(restoredBody.files.length, before, 'броят файлове е същият');
    const chainAfter = await (await fetch(`${server.base}/admin/api/audit/verify`, { headers: auth })).json();
    assert.equal(chainAfter.valid, true, 'одит веригата оцелява рестарта');
    const readyAfter = await (await fetch(`${server.base}/ready`)).json();
    assert.equal(readyAfter.ready, true);

    console.log(
      `PASS chaos resilience: 40 паралелни заявки, ${aborted} прекъснати, без 5xx, без .tmp, рестарт без загуба`,
    );
  } finally {
    await stopChild(server.child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
