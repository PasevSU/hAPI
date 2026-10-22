'use strict';
// Лимит на честотата за ПУБЛИЧНИТЕ маршрути: един клиент не бива да дърпа един и същ
// файл хиляди пъти, но лимитът не може да заключи другите клиенти, да счупи голямо
// сваляне (Range) или да засегне администраторския канал.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-rate-'));
const geoFile = path.join(tmp, 'geoip.json');
fs.writeFileSync(geoFile, JSON.stringify({ ranges: [{ cidr: '203.0.113.0/24', country: 'BG' }] }));

const CLIENT_A = { 'X-Forwarded-For': '203.0.113.9', 'User-Agent': 'rate-test-a' };
const CLIENT_B = { 'X-Forwarded-For': '203.0.113.10', 'User-Agent': 'rate-test-b' };

const text = async (res) => { const body = await res.text(); return { status: res.status, body, retryAfter: res.headers.get('retry-after'), cache: res.headers.get('cache-control') } };

(async () => {
  // Пет заявки на прозорец, прозорец 1.2 s — достатъчно да се види и отказът, и възстановяването.
  const server = await startServer({ env: { TRUST_PROXY: 'true', GEOIP_DB_PATH: geoFile, VISITOR_IP_MODE: 'full', PUBLIC_RATE_LIMIT: '5', PUBLIC_RATE_WINDOW_MS: '1200' } });
  const { api, authFetch, base } = server;

  try {
    const portal = await api('/admin/api/portals', 'POST', { slug: 'rate', title: 'Лимит' });
    assert.equal(portal.status, 201, JSON.stringify(portal.data));
    const portalId = portal.data.id;
    assert.equal((await api(`/admin/api/portals/${portalId}`, 'PATCH', { visibility: 'public' })).status, 200);
    const up = await authFetch(`${base}/admin/api/portals/${portalId}/files`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-File-Name': 'golqm.bin', 'X-File-Encrypt': '0' }, body: 'x'.repeat(64),
    });
    assert.equal(up.status, 201);
    const fileId = (await up.text(), (await api(`/admin/api/portals/${portalId}`)).data.files[0].id);

    // ── 1. Пет заявки минават, шестата е отказана ─────────────────────────────
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await text(await fetch(`${base}/p/${portalId}`, { headers: CLIENT_A }))).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200], 'петте заявки в рамките на лимита минават');

    const sixth = await text(await fetch(`${base}/p/${portalId}`, { headers: CLIENT_A }));
    assert.equal(sixth.status, 429, 'шестата е 429');
    assert.match(sixth.body, /Too many requests/);
    assert.ok(Number(sixth.retryAfter) >= 1, 'има Retry-After: ' + sixth.retryAfter);
    assert.equal(sixth.cache, 'no-store', 'отказът не се кешира');

    // ── 2. Лимитът е ПО КЛИЕНТ, не глобален ───────────────────────────────────
    const other = await text(await fetch(`${base}/p/${portalId}`, { headers: CLIENT_B }));
    assert.equal(other.status, 200, 'друг клиент има свой бюджет');

    // ── 3. Администраторският канал не е засегнат ─────────────────────────────
    for (let i = 0; i < 12; i++) assert.equal((await api('/admin/api/sensors')).status, 200, 'админът не се ограничава');

    // ── 4. Range заявката не се брои (продължение на голямо сваляне) ──────────
    const ranged = [];
    for (let i = 0; i < 8; i++) {
      const res = await fetch(`${base}/api/v1/p/rate/files/${fileId}/download`, { headers: { ...CLIENT_B, Range: 'bytes=0-3' } });
      await res.arrayBuffer();
      ranged.push(res.status);
    }
    assert.equal(ranged.every((s) => s === 206 || s === 200), true, 'Range заявките минават: ' + ranged.join(','));

    // ── 5. След прозореца достъпът се възстановява ────────────────────────────
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const recovered = await text(await fetch(`${base}/p/${portalId}`, { headers: CLIENT_A }));
    assert.equal(recovered.status, 200, 'след прозореца клиентът пак минава');

    // ── 6. Отказът се вижда в сензорите като причина RATE_LIMIT ───────────────
    const intel = (await api('/admin/api/sensors')).data.visitorsIntel;
    assert.equal(intel.denied.reasons.RATE_LIMIT >= 1, true, 'отказът е отчетен: ' + JSON.stringify(intel.denied.reasons));

    // ── 7. Лимитът се изключва с PUBLIC_RATE_LIMIT=0 ──────────────────────────
    const free = await startServer({ env: { TRUST_PROXY: 'true', PUBLIC_RATE_LIMIT: '0' } });
    try {
      const p2 = await free.api('/admin/api/portals', 'POST', { slug: 'free', title: 'Без лимит' });
      assert.equal(p2.status, 201);
      assert.equal((await free.api(`/admin/api/portals/${p2.data.id}`, 'PATCH', { visibility: 'public' })).status, 200);
      const many = [];
      for (let i = 0; i < 15; i++) many.push((await fetch(`${free.base}/p/${p2.data.id}`, { headers: CLIENT_A })).status);
      assert.equal(many.every((s) => s === 200), true, 'с изключен лимит всички минават: ' + many.join(','));
    } finally {
      await free.stop({ keep: true }).catch(() => { });
      try { fs.rmSync(free.dir, { recursive: true, force: true }) } catch { /* Windows може да държи файла */ }
    }

    console.log('PASS public-rate-limit: 429 след лимита · свой бюджет на клиент · админът е свободен · Range не се брои · възстановяване · изключване');
  } catch (e) {
    console.error('\n✘ ПРОВАЛ: ' + (e && e.message ? e.message : e) + '\n');
    throw e;
  } finally {
    await server.stop({ keep: true }).catch(() => { });
    try { fs.rmSync(server.dir, { recursive: true, force: true }) } catch { /* Windows може да държи файла */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* същото */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
