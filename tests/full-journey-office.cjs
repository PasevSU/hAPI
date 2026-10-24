'use strict';
// ПЪЛЕН ПЪТ (административен): работата с един документ от качването до разписката.
//
//   S01 старт        S07 подписан линк (валиден / подправен / защитен файл)
//   S02 портал       S08 разписка HMAC (издаване / проверка / подправка)
//   S03 версии       S09 бележки и прикачени файлове
//   S04 метаданни    S10 известия (401 / 503 / линк към портала)
//   S05 хешове       S11 контакти (201 / дубликат 409 / връзка с портала)
//   S06 преглед      S12 одитната верига е валидна
//
// Всяка стъпка проверява точния резултат (код, байтове, отпечатък), не само че „не гърми“.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

let current = 'S00';
const stage = async (name, fn) => {
  current = name;
  await fn();
  console.log('  ✔ ' + name);
};

const V1 = 'първоначална версия на документа';
const V2 = 'втора версия — поправена';

(async () => {
  const server = await startServer();
  const { api, authFetch, base } = server;
  const auth = { Authorization: 'Bearer ' + server.token };

  try {
    let portalId = '';
    let slug = 'office';
    let fileId = '';

    await stage('S01 старт · /health 200', async () => {
      assert.equal((await fetch(base + '/health')).status, 200);
    });

    await stage('S02 портал · създаване · качване на документ', async () => {
      const created = await api('/admin/api/portals', 'POST', { slug, title: 'Административен път' });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      portalId = created.data.id;
      assert.equal((await api(`/admin/api/portals/${portalId}`, 'PATCH', { visibility: 'public' })).status, 200);

      const up = await authFetch(`${base}/admin/api/portals/${portalId}/files`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-File-Name': encodeURIComponent('dokument.txt'), 'X-File-Encrypt': '0' }, body: V1,
      });
      assert.equal(up.status, 201);
      const file = await up.json();
      fileId = file.id;
      assert.equal(file.sha256, sha256(V1));
    });

    await stage('S03 версии · качване v2 · стария v1 · връщане към v1', async () => {
      const put = await authFetch(`${base}/admin/api/portals/${portalId}/files/${fileId}/versions`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Version-Note': 'popravka' }, body: V2,
      });
      assert.equal(put.status, 201);
      const putBody = await put.json();
      assert.equal(putBody.version, 2, 'новата версия е 2');

      const list = await api(`/admin/api/portals/${portalId}/files/${fileId}/versions`);
      assert.equal(list.status, 200);
      assert.equal(list.data.current.version, 2);
      assert.equal(list.data.current.sha256, sha256(V2));
      assert.equal(list.data.total, 2, 'текуща + една архивна');

      const old = await fetch(`${base}/admin/api/portals/${portalId}/files/${fileId}/versions/1/download`, { headers: auth });
      assert.equal(old.status, 200);
      assert.equal(await old.text(), V1, 'архивът пази точно първата версия');

      const restore = await api(`/admin/api/portals/${portalId}/files/${fileId}/versions/1/restore`, 'POST', {});
      assert.equal(restore.status, 200, JSON.stringify(restore.data));
      assert.equal(restore.data.restoredFrom, 1);
      assert.equal(restore.data.version, 3, 'връщането е нова версия, не презапис');
      const live = await fetch(`${base}/api/v1/p/${slug}/files/${fileId}/download`);
      assert.equal(live.status, 200);
      assert.equal(await live.text(), V1, 'публично се вижда върнатото съдържание');
    });

    await stage('S04 метаданни · тема/категория/етикети · преименуване · скриване', async () => {
      const meta = await api(`/admin/api/portals/${portalId}/files/${fileId}/metadata`, 'PATCH', { topic: 'Договори', category: 'Право', tags: ['важно', '2026'] });
      assert.equal(meta.status, 200, JSON.stringify(meta.data));
      assert.equal(meta.data.topic, 'Договори');
      assert.deepEqual(meta.data.tags, ['важно', '2026']);

      const tax = await api(`/admin/api/portals/${portalId}/taxonomy`);
      assert.deepEqual(tax.data.topics, ['Договори']);
      assert.deepEqual(tax.data.tags, ['2026', 'важно']);

      const renamed = await api(`/admin/api/portals/${portalId}/files/${fileId}`, 'PATCH', { name: 'dogovor-2026.txt' });
      assert.equal(renamed.data.name, 'dogovor-2026.txt');

      assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/metadata`, 'PATCH', { listed: false })).status, 200);
      assert.equal((await fetch(`${base}/api/v1/p/${slug}/files/${fileId}/download`)).status, 404, 'скрит файл не се изтегля по пряк адрес');
      assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/metadata`, 'PATCH', { listed: true })).status, 200);
      assert.equal((await fetch(`${base}/api/v1/p/${slug}/files/${fileId}/download`)).status, 200);
    });

    await stage('S05 хешове · пълният набор · съвпада с регистрирания', async () => {
      const h = await api(`/admin/api/portals/${portalId}/files/${fileId}/hashes`);
      assert.equal(h.status, 200);
      assert.equal(h.data.match, true, 'съдържанието не е променяно извън приложението');
      assert.equal(h.data.sha256, sha256(V1));
      assert.ok(h.data.algorithms.includes('sha256'));
      assert.equal(h.data.hashes.sha256, sha256(V1));
    });

    await stage('S06 преглед · 200 с тип съдържание', async () => {
      const pv = await fetch(`${base}/admin/api/portals/${portalId}/files/${fileId}/preview`, { headers: auth });
      assert.equal(pv.status, 200);
      assert.ok(pv.headers.get('content-type'), 'има тип на съдържанието');
      assert.equal(pv.headers.get('x-content-type-options'), 'nosniff', 'прегледът не се снапшотва като активен код');
    });

    await stage('S07 подписан линк · отваря скрит портал · подправен 403/404 · защитен файл 403', async () => {
      // Смисълът на подписания линк е да отвори файл на СКРИТ портал без токен.
      assert.equal((await api(`/admin/api/portals/${portalId}`, 'PATCH', { visibility: 'private' })).status, 200);
      assert.equal((await fetch(`${base}/api/v1/p/${slug}/files/${fileId}/download`)).status, 404, 'без подпис скритият портал не дава файла');

      const signed = await api(`/admin/api/portals/${portalId}/files/${fileId}/signed-url`, 'POST', { ttlSeconds: 60 });
      assert.equal(signed.status, 201, JSON.stringify(signed.data));
      const ok = await fetch(base + signed.data.path);
      assert.equal(ok.status, 200, 'подписаният линк отваря файла');
      assert.equal(await ok.text(), V1);

      const tampered = await fetch(base + signed.data.path.replace(/sig=[a-f0-9]+/, 'sig=' + 'f'.repeat(64)));
      assert.equal(tampered.status, 404, 'подправеният подпис не отваря нищо');

      const noSig = await fetch(base + signed.data.path.replace(/&?sig=[a-f0-9]+/, ''));
      assert.equal(noSig.status, 404, 'без подпис няма достъп');

      assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/signed-url`, 'POST', { ttlSeconds: 90000 })).status, 400, 'над 24 часа е невалидно');

      assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode: 'KEY_REQUIRED', reason: 'тест: ключ' })).status, 200);
      assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/signed-url`, 'POST', { ttlSeconds: 60 })).status, 403, 'защитен файл не получава подписан линк');
      assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode: 'FREE' })).status, 200);
      assert.equal((await api(`/admin/api/portals/${portalId}`, 'PATCH', { visibility: 'public' })).status, 200);
    });

    await stage('S08 разписка · издаване · проверка · подправка', async () => {
      const signed = await api(`/admin/api/portals/${portalId}/files/${fileId}/sign`, 'POST', {});
      assert.equal(signed.status, 201, JSON.stringify(signed.data));
      const receipt = signed.data.receipt;
      assert.equal(receipt.algorithm, 'HMAC-SHA256');

      const good = await api(`/admin/api/portals/${portalId}/files/${fileId}/verify-signature`, 'POST', { receipt });
      assert.equal(good.status, 200);
      assert.equal(good.data.valid, true, JSON.stringify(good.data));

      const bad = await api(`/admin/api/portals/${portalId}/files/${fileId}/verify-signature`, 'POST', {
        receipt: { ...receipt, signature: (receipt.signature[0] === 'a' ? 'b' : 'a') + receipt.signature.slice(1) },
      });
      assert.equal(bad.data.valid, false, 'подправената разписка не минава');
    });

    await stage('S09 бележки и прикачени · създаване · изтегляне · изтриване', async () => {
      const note = await api(`/admin/api/portals/${portalId}/notes`, 'POST', { title: 'Вътрешна бележка', content: 'Не излиза публично.' });
      assert.equal(note.status, 201, JSON.stringify(note.data));
      const notes = await api(`/admin/api/portals/${portalId}/notes`);
      assert.equal(notes.data.notes.length, 1);

      const att = await authFetch(`${base}/admin/api/portals/${portalId}/attachments`, {
        method: 'POST', headers: { 'X-File-Name': 'vaprosi.txt', 'Content-Type': 'text/plain' }, body: 'въпроси от клиента',
      });
      assert.equal(att.status, 201);
      const attFile = await att.json();
      assert.equal(attFile.sha256, sha256('въпроси от клиента'));

      const dl = await fetch(`${base}/admin/api/portals/${portalId}/attachments/${attFile.id}/download`, { headers: auth });
      assert.equal(dl.status, 200);
      assert.equal(await dl.text(), 'въпроси от клиента');
      const publicFiles = await (await fetch(`${base}/api/v1/p/${slug}/files`)).json();
      assert.equal(publicFiles.total, 1, 'прикаченото не влиза в публичния списък — там е само един документ');

      assert.equal((await api(`/admin/api/portals/${portalId}/attachments/${attFile.id}`, 'DELETE')).status, 200);
      assert.equal((await fetch(`${base}/admin/api/portals/${portalId}/attachments/${attFile.id}/download`, { headers: auth })).status, 404, 'след изтриване няма файл');
    });

    await stage('S10 известия · 401 без токен · 503 без Supervisor', async () => {
      assert.equal((await fetch(`${base}/admin/api/notify/dispatch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portalId }),
      })).status, 401, 'без токен не се изпраща нищо');

      const noSupervisor = await fetch(`${base}/admin/api/notify/dispatch`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ portalId, title: 'Линк' }),
      });
      assert.equal(noSupervisor.status, 503, 'без SUPERVISOR_TOKEN каналът е изключен, а не „праща“ мълчаливо');
    });

    await stage('S11 контакти · създаване · дубликат 409 · връзка с портала', async () => {
      const contact = await api('/admin/api/directory/contacts', 'POST', { email: 'ivan@example.test' });
      assert.equal(contact.status, 201, JSON.stringify(contact.data));
      assert.equal(contact.data.email, 'ivan@example.test');
      assert.equal((await api('/admin/api/directory/contacts', 'POST', { email: 'IVAN@example.test' })).status, 409, 'дубликат се отказва');

      assert.equal((await api(`/admin/api/portals/${portalId}`, 'PATCH', { contactId: contact.data.id })).status, 200);
      const view = await api(`/admin/api/portals/${portalId}`);
      assert.equal(view.status, 200);
      assert.equal(JSON.stringify(view.data).includes(contact.data.id), true, 'порталът помни контакта');
    });

    await stage('S12 одит · веригата е валидна и съдържа следа от всяка стъпка', async () => {
      const verify = await api('/admin/api/audit/verify');
      assert.equal(verify.status, 200);
      assert.equal(verify.data.valid, true);
      assert.ok(verify.data.count >= 12, 'записи: ' + verify.data.count);
      const events = await api('/admin/api/audit?limit=500');
      assert.equal(events.status, 200);
      const kinds = events.data.events.map((e) => e.event);
      for (const needle of ['file.version.upload', 'file.version.restore', 'url.sign', 'note.create', 'attachment.create', 'file.rename', 'file.metadata']) {
        assert.ok(kinds.includes(needle), 'липсва одитно събитие ' + needle);
      }
    });

    console.log('PASS full-journey-office: S01…S12 — версии, подписи, бележки, известия и контакти');
  } catch (e) {
    console.error(`\n✘ ПРОВАЛ в ${current}: ${e && e.message ? e.message : e}\n`);
    throw e;
  } finally {
    await server.stop({ keep: true }).catch(() => { });
    try { fs.rmSync(server.dir, { recursive: true, force: true }); } catch { /* Windows може да държи файла */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
