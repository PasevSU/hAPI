'use strict';
// Scenario matrix: exercises every portal role against every evidence action,
// per-case scoping, credential TTL expiry, and probes "orphan" backend endpoints
// (features that exist in server.js but have no admin GUI panel yet).
const { spawn } = require('node:child_process');
const { create: authCreate } = require('../hapi_enterprise/portal-auth');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-matrix-'));
  const port = 22000 + Math.floor(Math.random() * 500);
  const token = 'scenario-matrix-admin-token-1234567890';
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: token };
  let child;

  const req = async (route, method = 'GET', data, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers, ...(data === undefined ? {} : { body: data }) });
    const buf = Buffer.from(await r.arrayBuffer());
    let v; try { v = JSON.parse(buf.toString()); } catch { v = buf.toString(); }
    return { status: r.status, value: v };
  };

  const boot = async () => {
    child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) { try { if ((await req('/health')).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 50)); }
    throw Error('Startup failed');
  };
  const stop = async () => { if (child) { child.kill(); await new Promise(r => child.once('exit', r)); } };

  const line = () => console.log('  ' + '-'.repeat(58));

  try {
    await boot();
    const auth = authCreate({ secret: token });
    const roles = ['judge', 'prosecutor', 'clerk', 'investigator', 'expert', 'public'];
    const creds = {};
    for (const role of roles) creds[role] = auth.issue({ sub: role + '@court.bg', role, caseIds: (role === 'investigator' || role === 'expert') ? ['case-1'] : [] });

    const admin = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const portal = await req('/admin/api/portals', 'POST', JSON.stringify({ title: 'Сценарий', slug: 'scen' }), admin);
    const slug = portal.value.slug;

    // Seed one evidence record (case-1) as prosecutor.
    const body = Buffer.from('scenario-evidence-bytes');
    const up = await req(`/api/v1/p/${slug}/evidence`, 'POST', body, { Authorization: 'Bearer ' + creds.prosecutor, 'X-File-Name': 'a.pdf', 'X-Case-Id': 'case-1' });
    const fileId = up.value.receipt.fileId;

    // ---- Scenario 1: role x action matrix ----
    console.log('\n=== СЦЕНАРИЙ 1: матрица роля × действие (WORM evidence API) ===');
    console.log('  роля        | списък | качване | проверка | верига | изтегл. |');
    line();
    for (const role of roles) {
      const h = { Authorization: 'Bearer ' + creds[role] };
      const list = (await req(`/api/v1/p/${slug}/evidence`, 'GET', undefined, h)).status === 200;
      const upS = (await req(`/api/v1/p/${slug}/evidence`, 'POST', body, { ...h, 'X-File-Name': 'b.pdf', 'X-Case-Id': 'case-1' })).status === 201;
      const verify = (await req(`/api/v1/p/${slug}/evidence/${fileId}/verify`, 'GET', undefined, h)).status === 200;
      const chain = (await req(`/api/v1/p/${slug}/evidence/${fileId}/chain`, 'GET', undefined, h)).status === 200;
      const dl = (await req(`/api/v1/p/${slug}/evidence/${fileId}/download`, 'GET', undefined, h)).status === 200;
      const x = (v) => v ? '  ДА ' : ' не  ';
      console.log(`  ${role.padEnd(11)} |${x(list)} |${x(upS)} |${x(verify)} |${x(chain)} |${x(dl)} |`);
    }
    line();

    // ---- Scenario 2: per-case scoping (investigator/expert) ----
    console.log('\n=== СЦЕНАРИЙ 2: обхват по дело (investigator, case-1 само) ===');
    const inv = { Authorization: 'Bearer ' + creds.investigator };
    const ownCase = (await req(`/api/v1/p/${slug}/evidence`, 'POST', body, { ...inv, 'X-File-Name': 'c.pdf', 'X-Case-Id': 'case-1' })).status;
    const otherCase = (await req(`/api/v1/p/${slug}/evidence`, 'POST', body, { ...inv, 'X-File-Name': 'd.pdf', 'X-Case-Id': 'case-999' })).status;
    console.log(`  качване в case-1 (собствено):  ${ownCase} (201=ДА)`);
    console.log(`  качване в case-999 (чуждо):    ${otherCase} (403=не)`);

    // ---- Scenario 3: credential TTL expiry ----
    console.log('\n=== СЦЕНАРИЙ 3: изтичане на пълномощия (TTL=1s) ===');
    // NB: exp се сравнява на цяла секунда (Math.floor), затова TTL=1s реално
    // важи до ~2s. Чакаме 3s, за да е недвусмислено изтекло.
    const short = auth.issue({ sub: 'temp@court.bg', role: 'clerk', ttlSeconds: 1 });
    await new Promise(r => setTimeout(r, 3000));
    const expired = (await req(`/api/v1/p/${slug}/evidence`, 'GET', undefined, { Authorization: 'Bearer ' + short })).status;
    console.log(`  достъп след изтичане:  ${expired} (401=ДА, коректно отхвърлен)`);

    // ---- Scenario 4: orphan backend endpoints (no GUI panel) ----
    console.log('\n=== СЦЕНАРИЙ 4: backend функции БЕЗ GUI (осиротели) ===');
    const probes = [
      ['POST /admin/api/migrate/preflight', '/admin/api/migrate/preflight', 'POST', JSON.stringify({ source: dir, destination: path.join(dir, 'dest') })],
      ['GET  /admin/api/qr-artifacts', '/admin/api/qr-artifacts', 'GET'],
      ['POST /admin/api/notify/dispatch', '/admin/api/notify/dispatch', 'POST', JSON.stringify({ title: 't', body: 'b', level: 'info' })],
      ['GET  /admin/api/audit', '/admin/api/audit', 'GET'],
      ['GET  /admin/api/audit/export', '/admin/api/audit/export', 'GET'],
      ['GET  /admin/api/metrics', '/admin/api/metrics', 'GET'],
      ['POST /admin/api/portals/{id}/credentials', `/admin/api/portals/${portal.value.id}/credentials`, 'POST', JSON.stringify({ sub: 'j@court.bg', role: 'judge' })],
      ['POST /admin/api/portals/{id}/signing-key', `/admin/api/portals/${portal.value.id}/signing-key`, 'POST', '{}'],
    ];
    for (const [label, route, method, data] of probes) {
      let status;
      try { status = (await req(route, method, data, admin)).status; } catch (e) { status = 'ERR ' + e.message; }
      console.log(`  ${label.padEnd(46)} -> ${status}`);
    }

    console.log('\nСценариите приключиха успешно.');
  } finally {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error('SCENARIO FAIL:', e); process.exitCode = 1; });
