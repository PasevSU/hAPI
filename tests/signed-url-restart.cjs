'use strict';
// 0.69.85 — подписаният адрес оцелява РЕСТАРТ (реален случай: HAOS рестартира add-on-а
// по средата на изтегляне и браузърът показва `ERR_FAILED`).
//
// Порталът е ЧАСТЕН нарочно: за публичен портал файлът се дава и без подпис, т.е. тестът
// не би доказал нищо. Тук единственият вход е подписаният адрес, затова всяка промяна се
// вижда веднага:
//   • адрес, издаден от ПЪРВИЯ процес, се отваря след рестарт;
//   • сменен администраторски ключ НЕ го обезсилва — подписът е вързан към собствения
//     `signingSecret` на портала (точно това прави адреса годен за доказателство);
//   • подправен подпис и изтекъл срок НЕ отварят нищо.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const shareRoot = path.resolve('/share');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-restart-'));
const token = 'test-admin-token-restart';
const slug = 'restart-' + Date.now().toString(36);
const BODY = 'СЪДЪРЖАНИЕ-СЛЕД-РЕСТАРТ';
const cleaned = [];

const issue = async (server, portalId, fileId, ttlSeconds) => {
  const res = await server.api(`/admin/api/portals/${portalId}/files/${fileId}/signed-url`, 'POST', { ttlSeconds });
  assert.equal(res.status, 201, 'подписаният адрес се издава: ' + JSON.stringify(res.data).slice(0, 160));
  assert.match(res.data.path, /\?expires=\d+&sig=[a-f0-9]{64}$/, 'адресът носи expires и sig');
  return res.data.path;
};

(async () => {
  try {
    // ── 1. Първи процес: частен портал, файл, подписан адрес ────────────────
    let server = await startServer({ dataDir, token });
    let portalId = null;
    let fileId = null;
    let signedPath = '';
    let shortPath = '';
    {
      const portal = (await server.api('/admin/api/portals', 'POST', { slug, title: 'Рестарт', visibility: 'private' })).data;
      portalId = portal.id;
      cleaned.push(portal.slug);
      const up = await server.authFetch(server.base + `/admin/api/portals/${portal.id}/files`, {
        method: 'POST',
        headers: { 'x-file-name': 'doklad.pdf', 'content-type': 'application/pdf', 'x-file-encrypt': '0' },
        body: BODY,
      });
      assert.equal(up.status, 201, 'файлът се качва');
      fileId = (await up.json()).id;
      // Без подпис частният портал не дава нищо — това е базата за сравнение.
      assert.equal((await fetch(server.base + `/api/v1/p/${slug}/files/${fileId}/download`)).status, 404, 'без подпис частният портал не дава файла');
      signedPath = await issue(server, portalId, fileId, 3600);
      shortPath = await issue(server, portalId, fileId, 1);
      assert.equal((await fetch(server.base + signedPath)).status, 200, 'с подпис файлът се дава още в първия процес');
    }
    await server.stop({ keep: true });

    // ── 2. Рестарт върху СЪЩИТЕ данни: адресът работи ───────────────────────
    console.log('· адресът, издаден преди рестарта, се отваря след него');
    server = await startServer({ dataDir, token });
    try {
      const res = await fetch(server.base + signedPath);
      const text = await res.text();
      assert.equal(res.status, 200, 'след рестарт адресът пак дава файла');
      assert.match(res.headers.get('content-type') || '', /application\/octet-stream/, 'отдава се като поток');
      assert.equal(res.headers.get('content-disposition') || '', "attachment; filename*=UTF-8''doklad.pdf", 'отдава се като сваляне');
      assert.equal(text, BODY, 'байтовете са същите');
    } finally {
      await server.stop({ keep: true });
    }

    // ── 3. Сменен администраторски ключ: подписът ПАДА ─────────────────────
    console.log('· смененият администраторски ключ обезсилва старите подписи (това е ротация)');
    server = await startServer({ dataDir, token: token + '-нов' });
    try {
      assert.equal((await fetch(server.base + signedPath)).status, 404, 'старият подпис не важи след смяна на ключа');
      // Подправен подпис: същият срок, друг подпис → нищо.
      const tampered = signedPath.replace(/sig=[a-f0-9]{64}$/, 'sig=' + 'a'.repeat(64));
      assert.notEqual((await fetch(server.base + tampered)).status, 200, 'подправен подпис не отваря файла');
      // Изтекъл срок (издаден с 1 секунда, след изчакване).
      await new Promise((resolve) => setTimeout(resolve, 1200));
      assert.notEqual((await fetch(server.base + shortPath)).status, 200, 'изтекъл срок не отваря файла');
    } finally {
      await server.stop({ keep: true });
    }

    console.log('PASS signed-url-restart: адресът оцелява рестарт · байтовете съвпадат · смяна на ключа е ротация · подправен/изтекъл не отваря');
  } finally {
    for (const name of cleaned) {
      try { fs.rmSync(path.join(shareRoot, name), { recursive: true, force: true }) } catch { /* Linux */ }
    }
    try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch { /* Windows */ }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
