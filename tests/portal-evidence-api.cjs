'use strict';
const { spawn } = require('node:child_process');
const { create: authCreate } = require('../hapi_enterprise/portal-auth');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-evid-api-'));
  const port = 20000 + Math.floor(Math.random() * 1000);
  const token = 'evidence-test-token-long-enough-12345';
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: token };
  let child;

  const req = async (route, method = 'GET', data, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers, ...(data === undefined ? {} : { body: data }) });
    const b = await r.arrayBuffer();
    let v; try { v = JSON.parse(Buffer.from(b).toString()); } catch { v = Buffer.from(b).toString(); }
    return { status: r.status, value: v };
  };

  const boot = async () => {
    child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await req('/health')).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 50)); }
    throw Error('Startup failed');
  };

  const stop = async () => { if (child) { child.kill(); await new Promise(r => child.once('exit', r)); } };

  try {
    await boot();
    const auth = authCreate({ secret: token });
    const prosecutor = auth.issue({ sub: 'pros@court.bg', role: 'prosecutor' });
    const clerk = auth.issue({ sub: 'clerk@court.bg', role: 'clerk' });
    const publicRole = auth.issue({ sub: 'anon@public.bg', role: 'public' });

    const admin = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    const portal = await req('/admin/api/portals', 'POST', JSON.stringify({ title: 'Evidence', slug: 'evidence' }), admin);
    assert.equal(portal.status, 201);
    const slug = portal.value.slug;

    // no credential -> 401
    assert.equal((await req(`/api/v1/p/${slug}/evidence`)).status, 401);
    // public role cannot upload
    const deny = await req(`/api/v1/p/${slug}/evidence`, 'POST', 'secret', { Authorization: 'Bearer ' + publicRole, 'X-File-Name': 'x.pdf', 'X-Case-Id': 'case-1' });
    assert.equal(deny.status, 403);

    const body = Buffer.from('court-evidence-bytes-приложение');
    const up = await req(`/api/v1/p/${slug}/evidence`, 'POST', body, { Authorization: 'Bearer ' + prosecutor, 'X-File-Name': 'appendix.pdf', 'X-Case-Id': 'case-2026-001', 'X-Classification': 'EVIDENCE', 'X-Tags': 'fin,z' });
    assert.equal(up.status, 201);
    const fileId = up.value.receipt.fileId;
    assert.equal(up.value.receipt.size, body.length);

    const list = await req(`/api/v1/p/${slug}/evidence`, 'GET', undefined, { Authorization: 'Bearer ' + clerk });
    assert.equal(list.status, 200);
    assert.equal(list.value.total, 1);
    assert.equal(list.value.evidence[0].fileId, fileId);

    const one = await req(`/api/v1/p/${slug}/evidence/${fileId}`, 'GET', undefined, { Authorization: 'Bearer ' + clerk });
    assert.equal(one.status, 200);
    assert.equal(one.value.evidence.name, 'appendix.pdf');

    const verify = await req(`/api/v1/p/${slug}/evidence/${fileId}/verify`, 'GET', undefined, { Authorization: 'Bearer ' + prosecutor });
    assert.equal(verify.status, 200);
    assert.equal(verify.value.valid, true);

    const chain = await req(`/api/v1/p/${slug}/evidence/${fileId}/chain`, 'GET', undefined, { Authorization: 'Bearer ' + prosecutor });
    assert.equal(chain.status, 200);
    assert.equal(chain.value.integrity.valid, true);
    assert.equal(chain.value.events[0].event, 'evidence.upload');
    // clerk cannot read chain of custody
    assert.equal((await req(`/api/v1/p/${slug}/evidence/${fileId}/chain`, 'GET', undefined, { Authorization: 'Bearer ' + clerk })).status, 403);

    const dl = await req(`/api/v1/p/${slug}/evidence/${fileId}/download`, 'GET', undefined, { Authorization: 'Bearer ' + prosecutor });
    assert.equal(dl.status, 200);
    assert.equal(Buffer.from(dl.value).toString(), body.toString());

    const pkg = await req(`/api/v1/p/${slug}/evidence/${fileId}/package`, 'GET', undefined, { Authorization: 'Bearer ' + prosecutor });
    assert.equal(pkg.status, 200);
    assert.equal(pkg.value.receipt.fileId, fileId);
    assert.equal(pkg.value.verification.valid, true);

    console.log('PASS portal-evidence-api: upload/list/get/verify/chain/download/package + role gates');
  } finally {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
