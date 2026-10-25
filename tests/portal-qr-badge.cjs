'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
// §QR_BADGE_IN_LIST: списъкът на порталите показва „QR vN / архиви“ без нито една
// допълнителна заявка на портал. Затова данните идват в GET /admin/api/portals (`qr`),
// а не се събират от `/portal/{id}/qr`. Тестът проверява точно това число, за да не
// остане баджът декорация: нов портал → QR-001 · след архив → QR-002 + 1 архив ·
// след прекратяване → `blocked` с основание.
const shareRoot = path.resolve('/share');

(async () => {
  const server = await startServer();
  const slug = 'qr-badge-' + Date.now().toString(36);
  const folder = path.join(shareRoot, slug);
  try {
    const call = async (p, method = 'GET', bodyJson) => {
      const res = await server.authFetch(server.base + p, {
        method,
        headers: bodyJson === undefined ? {} : { 'content-type': 'application/json' },
        body: bodyJson === undefined ? undefined : JSON.stringify(bodyJson),
      });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      return { status: res.status, data };
    };
    const portalOf = async (id) => {
      const list = await call('/admin/api/portals');
      assert.equal(list.status, 200, 'списъкът се чете');
      const hit = (list.data.portals || []).find((p) => p.id === id);
      assert.ok(hit, 'порталът е в списъка');
      return hit;
    };

    // ── 1. Нов портал: QR-001, нула архиви ───────────────────────────────────
    const created = await call('/admin/api/portals', 'POST', { slug, title: 'QR бадж', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data).slice(0, 200));
    const id = created.data.id;
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'документ.txt'), 'съдържание');

    let p = await portalOf(id);
    assert.ok(p.qr, 'списъкът носи `qr` — баджът няма нужда от втора заявка');
    assert.equal(p.qr.active, 'QR-001', 'нов портал → QR-001');
    assert.equal(p.qr.seq, 1);
    assert.equal(p.qr.revisions, 1);
    assert.equal(p.qr.archives, 0);
    assert.equal(p.qr.blocked, false);
    assert.equal(p.qr.manifestId, null, 'манифест има само след архив');

    // ── 2. След архивиране: QR-002 и един архив ─────────────────────────────
    const archived = await call(`/admin/api/portals/${id}/qr/archive`, 'POST', { note: 'за баджа' });
    assert.equal(archived.status, 201, 'архивирането минава');
    p = await portalOf(id);
    assert.equal(p.qr.active, 'QR-002', 'активният QR е наследникът');
    assert.equal(p.qr.seq, 2);
    assert.equal(p.qr.revisions, 2, 'историята пази и QR-001');
    assert.equal(p.qr.archives, 1);
    assert.match(String(p.qr.manifestId), /^MF-QR-001$/, 'манифестът на архивираната ревизия: ' + p.qr.manifestId);

    // ── 3. След прекратяване: баджът трябва да е предупредителен ────────────
    const blocked = await call(`/admin/api/portals/${id}/qr/block`, 'POST', { reason: 'тестово прекратяване' });
    assert.equal(blocked.status, 200, 'прекратяването минава');
    p = await portalOf(id);
    assert.equal(p.qr.active, null, 'няма активен QR след прекратяване');
    assert.equal(p.qr.blocked, true);
    assert.equal(p.qr.blockReason, 'тестово прекратяване');
    assert.equal(p.qr.archives, 1, 'архивите остават');

    // ── 4. Баджът е в интерфейса и се рисува от тези данни ──────────────────
    const ui = fs.readFileSync(path.join(__dirname, '../hapi_enterprise/ui/files-manager.js'), 'utf8');
    assert.match(ui, /x\.qr/, 'списъкът на порталите чете `qr` от отговора');
    assert.match(ui, /QR v\$\{/, 'баджът показва номера на ревизията');

    console.log('portal-qr-badge OK: QR-001 → QR-002 + 1 архив → прекратен с основание · данните идват със списъка');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
    await new Promise((r) => server.stop ? server.stop().then(r) : r());
  }
})().catch((e) => { console.error(e); process.exit(1) });
