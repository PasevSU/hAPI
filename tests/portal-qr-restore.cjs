'use strict';
// 0.69.84 — възстановяване от архив (§10.2, §22) и публичен ръкостиск („връзката работи“).
//
// Проверява се РЕДЪТ на действията, а не само отговорът:
//   1. преди да се пише по диска, текущото състояние се АРХИВИРА (нищо не се губи);
//   2. архивът се ПРОВЕРЯВА преди възстановяване — при повреда нищо не се променя;
//   3. файловете от архива се връщат с ТОЧНИТЕ си байтове, а „излишните“ НЕ се трият;
//   4. новият QR помни откъде е възстановен (`restoredFrom`);
//   5. `GET /api/v1/p/<slug>/ping` доказва, че връзката до портала е изградена.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const shareRoot = path.resolve('/share');
const cleaned = [];

(async () => {
  const server = await startServer();
  try {
    const api = (p, method = 'GET', body) => server.authFetch(server.base + p, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const jsonOf = async (p, method, body) => {
      const res = await api(p, method, body);
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      return { status: res.status, data };
    };

    const slug = 'restore-' + Date.now().toString(36);
    const portal = (await jsonOf('/admin/api/portals', 'POST', { slug, title: 'Възстановяване', visibility: 'public' })).data;
    cleaned.push(portal.slug);
    const folder = path.join(shareRoot, slug);
    fs.mkdirSync(path.join(folder, 'тема'), { recursive: true });
    const read = (rel) => fs.readFileSync(path.join(folder, ...rel.split('/')), 'utf8');

    // ── 1. Състояние „първа версия“ и архив QR-001 ───────────────────────────
    fs.writeFileSync(path.join(folder, 'договор.txt'), 'първа версия');
    fs.writeFileSync(path.join(folder, 'тема', 'фактура.txt'), 'фактура v1');
    const first = await jsonOf(`/admin/api/portals/${portal.id}/qr/archive`, 'POST', { note: 'преди редакция' });
    assert.equal(first.status, 201, 'първият архив минава');
    assert.equal(first.data.archive.qrId, 'QR-001');

    // ── 2. Животът продължава: файлът е сменен и има нов ────────────────────
    fs.writeFileSync(path.join(folder, 'договор.txt'), 'ВТОРА версия — важна');
    fs.writeFileSync(path.join(folder, 'нов.txt'), 'добавен след първия QR');

    // ── 3. Ръкостиск: връзката до портала работи ────────────────────────────
    console.log('· ping доказва, че връзката е изградена');
    {
      const ping = await jsonOf(`/api/v1/p/${slug}/ping`);
      assert.equal(ping.status, 200, 'ping отговаря');
      assert.equal(ping.data.ok, true);
      assert.equal(ping.data.portal.slug, slug);
      assert.equal(ping.data.active, 'QR-002', 'активният QR е известен');
      assert.deepEqual(ping.data.contracts, ['order', 'file', 'html', 'blok'], 'договорите са изброени');
      assert.equal(ping.data.policy.maxDepth, 3);
      assert.ok(ping.data.time, 'има време на отговора');
      assert.equal('files' in ping.data, false, 'ping не връща съдържание');
      assert.equal((await api('/api/v1/p/няма-такъв/ping')).status, 404, 'непознат портал → 404');
    }

    // ── 4. Възстановяване на QR-001 ─────────────────────────────────────────
    console.log('· restore архивира текущото ПРЕДИ да върне старото');
    {
      const done = await jsonOf(`/admin/api/portals/${portal.id}/qr/QR-001/restore`, 'POST');
      assert.equal(done.status, 200, 'възстановяването минава: ' + JSON.stringify(done.data).slice(0, 200));
      assert.equal(done.data.restoredFrom, 'QR-001');
      assert.ok(done.data.safetyArchive, 'текущото състояние е архивирано ПРЕДИ връщането');
      assert.equal(read('договор.txt'), 'първа версия', 'файлът е върнат с ТОЧНИТЕ си байтове');
      assert.equal(read('тема/фактура.txt'), 'фактура v1', 'подпапката също е върната');
      assert.equal(fs.existsSync(path.join(folder, 'нов.txt')), true, 'файл, който не е бил в архива, НЕ се трие');
      assert.deepEqual(done.data.keptExtra, ['нов.txt'], 'излишните са отчетени, не изтрити');
      assert.deepEqual(done.data.written.sort(), ['договор.txt', 'тема/фактура.txt'], 'отчетено е какво е записано');

      const state = (await jsonOf(`/admin/api/portals/${portal.id}/qr`)).data;
      const restoredRev = state.revisions.find((r) => r.id === done.data.active);
      assert.equal(restoredRev.restoredFrom, 'QR-001', 'новият QR помни откъде е възстановен');
      assert.ok(restoredRev.restoredAt, 'и кога');
      assert.equal(state.archives.length, 2, 'има два архива: преди редакцията и предпазният');
    }

    // ── 5. Проверка ПРЕДИ възстановяване: повреден архив не се прилага ──────
    console.log('· повреден архив не се възстановява и нищо не се променя');
    {
      const broken = Buffer.from('не е ZIP');
      const dir = path.join(server.dir, 'archives', portal.id);
      const target = fs.readdirSync(dir).find((n) => n.includes('QR-001'));
      assert.ok(target, 'архивът на QR-001 е на диска');
      fs.writeFileSync(path.join(dir, target), broken);
      const before = read('договор.txt');
      const refused = await jsonOf(`/admin/api/portals/${portal.id}/qr/QR-001/restore`, 'POST');
      assert.equal(refused.status, 409, 'повреден архив → 409');
      assert.match(String(refused.data.error || refused.data), /цялост/, 'причината е казана');
      assert.equal(read('договор.txt'), before, 'файловете НЕ са пипани');
      assert.equal((await jsonOf(`/admin/api/portals/${portal.id}/qr/QR-999/restore`, 'POST')).status, 404, 'непознат QR → 404');
    }

    console.log('PASS portal-qr-restore: ping · предпазен архив · точни байтове · излишните не се трият · повреден архив се отказва');
  } finally {
    await server.stop().catch(() => { });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(() => {
  for (const name of cleaned) {
    try { fs.rmSync(path.join(shareRoot, name), { recursive: true, force: true }) } catch { /* Linux */ }
  }
});
