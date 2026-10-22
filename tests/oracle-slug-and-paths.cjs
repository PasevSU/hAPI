'use strict';
// ОРАКУЛ: смяната на slug мести АДРЕСА, а не само полето в базата (BUG-06).
//
// Очакваме конкретно: след преименуване старата директория на API-то я НЯМА, новата
// съществува с артефактите вътре, публичният адрес със стария slug дава 404, а със
// новия — 200. Отделно: отказ (дубликат) НЕ мести нищо, а QR адресът не се чупи, защото
// сочи към ИДЕНТИФИКАТОРА на портала, не към slug-а.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const json = async (url) => {
  const res = await fetch(url);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
};

(async () => {
  const server = await startServer();
  try {
    const apiRoot = path.join(server.dir, 'api');
    const listing = () => {
      try {
        return fs.readdirSync(apiRoot).sort();
      } catch {
        return [];
      }
    };

    const created = await server.api('/admin/api/portals', 'POST', { slug: 'oracle-old', title: 'Портал за преименуване', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът е създаден');
    const portal = created.data;
    const uploadRes = await server.authFetch(server.base + '/admin/api/portals/' + portal.id + '/files', {
      method: 'POST',
      headers: { 'x-file-name': 'akt.txt' },
      body: 'фиксирано съдържание',
    });
    const file = await uploadRes.json();

    // ── 1. Преди преименуването: директорията съществува с ТОЧНО тези артефакти ─
    assert.deepEqual(listing(), ['oracle-old'], 'има точно една API директория — на стария slug');
    const artifacts = fs.readdirSync(path.join(apiRoot, 'oracle-old')).sort();
    assert.deepEqual(artifacts, ['api.json', 'openapi.json', 'qr.svg'], 'артефактите са точно тези три');
    const apiJsonBefore = JSON.parse(fs.readFileSync(path.join(apiRoot, 'oracle-old', 'api.json'), 'utf8'));
    assert.ok(JSON.stringify(apiJsonBefore).includes('/api/v1/p/oracle-old'), 'api.json сочи стария slug');
    assert.equal((await json(server.base + '/api/v1/p/oracle-old')).status, 200, 'старият публичен адрес работи преди смяната');
    const qrTargetBefore = (await json(server.base + '/api/v1/p/oracle-old/manifest')).data.portal.urls.qrTarget;

    // ── 2. Отказ: дубликат НЕ мести нищо ───────────────────────────────────────
    await server.api('/admin/api/portals', 'POST', { slug: 'oracle-taken', title: 'Друг портал' });
    const dup = await server.api('/admin/api/portals/' + portal.id, 'PATCH', { slug: 'oracle-taken' });
    assert.equal(dup.status, 400, 'зает slug се отказва');
    assert.equal(dup.data.error, 'Invalid or duplicate slug', 'точният текст на отказа');
    assert.deepEqual(listing(), ['oracle-old', 'oracle-taken'], 'след отказа директориите са НЕПРОМЕНЕНИ');
    const stillOld = await json(server.base + '/api/v1/p/oracle-old');
    assert.equal(stillOld.status, 200, 'старият адрес продължава да работи');
    assert.equal(stillOld.data.slug, 'oracle-old', 'slug-ът в базата НЕ е сменен при отказа');

    // ── 3. Успешна смяна: мести се И директорията, И адресът ───────────────────
    const patched = await server.api('/admin/api/portals/' + portal.id, 'PATCH', { slug: 'oracle-new' });
    assert.equal(patched.status, 200, 'смяната на slug минава');
    assert.equal(patched.data.slug, 'oracle-new', 'новото поле е точното');
    assert.equal(patched.data.id, portal.id, 'идентификаторът НЕ се променя (връзките остават валидни)');
    assert.deepEqual(listing(), ['oracle-new', 'oracle-taken'], 'старата API директория я НЯМА, новата съществува');
    const newArtifacts = fs.readdirSync(path.join(apiRoot, 'oracle-new')).sort();
    assert.deepEqual(newArtifacts, ['api.json', 'openapi.json', 'qr.svg'], 'артефактите са ПРЕМЕСТЕНИ, не изгубени');
    const apiJsonAfter = JSON.parse(fs.readFileSync(path.join(apiRoot, 'oracle-new', 'api.json'), 'utf8'));
    assert.ok(JSON.stringify(apiJsonAfter).includes('/api/v1/p/oracle-new'), 'преместеният api.json вече сочи НОВИЯ slug');
    assert.equal(JSON.stringify(apiJsonAfter).includes('/api/v1/p/oracle-old'), false, 'в артефакта не е останал старият slug');

    // ── 4. Публичните адреси: стар 404, нов 200, съдържанието е същото ─────────
    assert.equal((await json(server.base + '/api/v1/p/oracle-old')).status, 404, 'старият адрес вече не съществува');
    assert.equal((await json(server.base + '/api/v1/p/oracle-old/manifest')).status, 404, 'старият манифест също е 404');
    const newPortal = await json(server.base + '/api/v1/p/oracle-new');
    assert.equal(newPortal.status, 200, 'новият адрес работи');
    assert.equal(newPortal.data.slug, 'oracle-new', 'публичният изглед показва новия slug');
    const newManifest = await json(server.base + '/api/v1/p/oracle-new/manifest');
    assert.equal(newManifest.status, 200, 'новият манифест е достъпен');
    assert.ok(newManifest.data.portal.urls.api.endsWith('/api/v1/p/oracle-new'), 'манифестът строи адресите с новия slug');
    assert.equal(newManifest.data.portal.urls.qrTarget, qrTargetBefore, 'QR адресът НЕ се чупи — сочи идентификатора, не slug-а');
    const fileAfter = newManifest.data.portal.fileCount;
    assert.equal(fileAfter, 1, 'файлът е на място след преименуването');
    const backToFile = await json(server.base + '/api/v1/p/oracle-new/files/' + file.id);
    assert.equal(backToFile.status, 200, 'файлът се чете по новия адрес');
    assert.equal(backToFile.data.sha256 || (backToFile.data.file && backToFile.data.file.sha256), file.sha256, 'отпечатъкът на файла е непроменен');

    // ── 5. Обратна смяна: пак мести и пак не оставя сираци ─────────────────────
    const back = await server.api('/admin/api/portals/' + portal.id, 'PATCH', { slug: 'oracle-old' });
    assert.equal(back.status, 200, 'връщането на стария slug минава');
    assert.deepEqual(listing(), ['oracle-old', 'oracle-taken'], 'директорията се върна на старото място, без дубликат');

    console.log('PASS oracle-slug-and-paths: API директорията следва slug-а (старата я няма) · артефактите се преместват и сочат новия адрес · стар адрес 404 · QR адресът не се чупи · отказ не мести нищо');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
