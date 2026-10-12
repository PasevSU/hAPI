'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-cred-'));
  const port = 20000 + Math.floor(Math.random() * 1000);
  const token = 'portal-credential-test-token-long-enough-1';
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: token };
  let child;

  const req = async (route, method = 'GET', data, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers, ...(data === undefined ? {} : { body: data }) });
    const b = await r.arrayBuffer();
    let v; try { v = JSON.parse(Buffer.from(b).toString()); } catch { v = Buffer.from(b).toString(); }
    return { status: r.status, value: v, headers: r.headers };
  };

  const boot = async () => {
    child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await req('/health')).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 50)); }
    throw Error('Startup failed');
  };
  const stop = async () => { if (child) { child.kill(); await new Promise(r => child.once('exit', r)); } };

  try {
    await boot();
    const admin = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const portal = await req('/admin/api/portals', 'POST', JSON.stringify({ title: 'Evidence', slug: 'cred-evidence' }), admin);
    assert.equal(portal.status, 201);
    const id = portal.value.id, slug = portal.value.slug;

    // 1. valid judge issue
    const judge = await req(`/admin/api/portals/${id}/credentials`, 'POST', JSON.stringify({ sub: 'judge@court.bg', role: 'judge' }), admin);
    assert.equal(judge.status, 201);
    assert.equal(judge.value.sub, 'judge@court.bg');
    assert.equal(judge.value.role, 'judge');
    assert.ok(Array.isArray(judge.value.caseIds));
    assert.ok(judge.value.credential.includes('.'));
    assert.ok(judge.value.expiresAt > new Date().toISOString());

    // 2. investigator with case scoping
    const inv = await req(`/admin/api/portals/${id}/credentials`, 'POST', JSON.stringify({ sub: 'inv@police.bg', role: 'investigator', caseIds: ['case-1', 'case-2'], ttlSeconds: 60 }), admin);
    assert.equal(inv.status, 201);
    assert.deepEqual(inv.value.caseIds, ['case-1', 'case-2']);

    // 3. invalid role -> 400
    assert.equal((await req(`/admin/api/portals/${id}/credentials`, 'POST', JSON.stringify({ sub: 'x@y.bg', role: 'admin' }), admin)).status, 400);
    // 4. missing sub -> 400
    assert.equal((await req(`/admin/api/portals/${id}/credentials`, 'POST', JSON.stringify({ role: 'judge' }), admin)).status, 400);
    // 5. empty body -> 400
    assert.equal((await req(`/admin/api/portals/${id}/credentials`, 'POST', JSON.stringify({}), admin)).status, 400);
    // 6. invalid caseIds (not array) -> 400
    assert.equal((await req(`/admin/api/portals/${id}/credentials`, 'POST', JSON.stringify({ sub: 'x@y.bg', role: 'investigator', caseIds: 'case-1' }), admin)).status, 400);
    // 7. unknown portal -> 404
    assert.equal((await req('/admin/api/portals/nope/credentials', 'POST', JSON.stringify({ sub: 'x@y.bg', role: 'judge' }), admin)).status, 404);
    // 8. no admin auth -> 401
    assert.equal((await req(`/admin/api/portals/${id}/credentials`, 'POST', JSON.stringify({ sub: 'x@y.bg', role: 'judge' }))).status, 401);

    // 9. issued credential works end-to-end against the evidence API
    const ev = await req(`/api/v1/p/${slug}/evidence`, 'GET', undefined, { Authorization: 'Bearer ' + judge.value.credential });
    assert.equal(ev.status, 200);
    assert.equal(ev.value.total, 0);

    // 10. CSP: portal page allows branding images and blocks framing/embedding
    const pub = await req(`/admin/api/portals/${id}`, 'PATCH', JSON.stringify({ visibility: 'public' }), admin);
    assert.equal(pub.status, 200);
    const page = await req(`/p/${slug}`);
    assert.equal(page.status, 200);
    const csp = page.headers.get('content-security-policy') || '';
    assert.ok(/img-src[^;]*https:/.test(csp), 'CSP should allow https images: ' + csp);
    assert.ok(/object-src 'none'/.test(csp), 'CSP should disable object-src');
    assert.ok(/frame-ancestors 'none'/.test(csp), 'CSP should block framing');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');

    // 11. static portal assets served
    assert.equal((await req('/portal.css')).status, 200);
    assert.equal((await req('/portal.js')).status, 200);

    console.log('PASS portal-credential: issuer endpoint + role/scope validation + CSP/branding headers');
  } finally {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
