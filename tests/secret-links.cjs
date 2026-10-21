'use strict';
// Тайни връзки (zero-knowledge): сървърът пази само шифротекст.
//
// Проверява се:
//   • unit: валидация на шифротекста/iv, лимитите за срок и прегледи, решението кога
//     тайната е „изчезнала“ (изтекла/прегледана/отменена);
//   • unit: записът НЕ съдържа ключ — файлът се проверява дословно;
//   • краен-до-край: AES-GCM в Node (същият WebCrypto API като браузъра) шифрова тайна,
//     `POST /admin/api/v2/secrets` я приема, `POST /api/v2/secrets/<id>/reveal` я дава
//     веднъж, вторият опит е 410, а файлът вече го няма;
//   • край-до-край: изтекъл срок и отмяна от администратора също дават 410/404;
//   • страницата `/secret/<id>` се сервира с `script-src 'self'` и без ключ в HTML-а.
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const secretLinks = require('../hapi_enterprise/secret-links');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (buf) => Buffer.from(buf).toString('base64url');

(async () => {
  // ── 1. Валидация ──────────────────────────────────────────────────────────
  const iv = b64u(crypto.randomBytes(12));
  assert.equal(secretLinks.createRecord({ ciphertext: '', iv }).error, 'ciphertext е задължителен (base64url)');
  assert.match(secretLinks.createRecord({ ciphertext: 'не-е-base64url', iv }).error, /base64url/);
  assert.match(secretLinks.createRecord({ ciphertext: 'AAAA', iv: 'къс' }).error, /iv/);
  const tooBig = b64u(crypto.randomBytes(secretLinks.MAX_CIPHERTEXT_BYTES + 10));
  assert.match(secretLinks.createRecord({ ciphertext: tooBig, iv }).error, /над/);

  const ok = secretLinks.createRecord({ ciphertext: 'AAAA', iv, hint: '  парола\nза ZIP  ' });
  assert.ok(ok.record, 'валиден запис');
  assert.equal(ok.record.hint, 'парола за ZIP', 'управляващите знаци се махат от подсказката');
  assert.equal(ok.record.maxViews, 1, 'по подразбиране е еднократна');
  assert.equal(ok.record.views, 0);
  assert.equal(secretLinks.createRecord({ ciphertext: 'AAAA', iv, maxViews: 999 }).record.maxViews, secretLinks.MAX_VIEWS);
  const longLived = secretLinks.createRecord({ ciphertext: 'AAAA', iv, expiresIn: 10 ** 9 }).record;
  assert.equal(
    Date.parse(longLived.expiresAt) - Date.parse(longLived.createdAt),
    secretLinks.MAX_TTL_SECONDS * 1000,
    'срокът е ограничен до 30 дни',
  );

  // ── 2. Решението „още ли съществува“ ──────────────────────────────────────
  const now = Date.now();
  assert.equal(secretLinks.inspectRecord(null).reason, 'missing');
  assert.equal(secretLinks.inspectRecord({ maxViews: 1, views: 1 }).reason, 'used');
  assert.equal(secretLinks.inspectRecord({ disabled: true }).reason, 'revoked');
  assert.equal(secretLinks.inspectRecord({ expiresAt: new Date(now - 1000).toISOString() }).reason, 'expired');
  assert.equal(secretLinks.inspectRecord({ expiresAt: new Date(now + 60000).toISOString(), maxViews: 2, views: 1 }).ok, true);

  // ── 3. Краен-до-край през истинския сървър ────────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-secret-'));
  const token = 'secret-links-admin-token-0123456789';
  const port = 19800 + Math.floor(Math.random() * 300);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: { ...process.env, DATA_DIR: dir, ADMIN_TOKEN: token, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    let ready = false;
    for (let i = 0; i < 160; i++) {
      try {
        if ((await fetch(base + '/health')).ok) { ready = true; break }
      } catch { }
      await sleep(50);
    }
    assert.ok(ready, 'сървърът стартира');

    const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const call = (p, m = 'GET', b) => fetch(base + p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) });

    // Шифроване като в браузъра: ключ 32 байта, AES-GCM, iv 12 байта.
    const keyBytes = crypto.randomBytes(32);
    const key = await crypto.webcrypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const ivBytes = crypto.randomBytes(12);
    const plaintext = 'IBAN BG00 TEST 1234 · ПИН 9876';
    const ciphertext = b64u(await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes }, key, new TextEncoder().encode(plaintext)));

    let r = await call('/admin/api/v2/secrets', 'POST', {
      ciphertext,
      iv: b64u(ivBytes),
      hint: 'IBAN за превод',
      expires_in: 3600,
      max_views: 1,
    });
    assert.equal(r.status, 201, 'тайната е приета');
    const created = await r.json();
    assert.match(created.id, /^[0-9A-HJKMNP-TV-Z]{22}$/, 'id-то е от азбуката на модула');
    assert.equal(created.viewsLeft, 1);
    assert.equal(created.path, '/secret/' + created.id);
    assert.equal(created.ciphertext, undefined, 'админският изглед не връща шифротекста');
    assert.ok(created.sha256, 'връща отпечатък, за да се види, че записът не е подменен');

    // Файлът на диска НЕ съдържа ключ — само iv + шифротекст.
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'secrets', created.id + '.json'), 'utf8'));
    assert.equal(stored.ciphertext, ciphertext);
    assert.ok(!('key' in stored) && !('plaintext' in stored), 'записът не носи ключ');
    assert.equal(stored.hint, 'IBAN за превод', 'подсказката е открит текст по избор на подателя');

    // Страницата е публична черупка: без ключ в HTML-а, със строг CSP.
    r = await fetch(base + '/secret/' + created.id);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.ok(!html.includes(b64u(keyBytes)), 'ключът не е в HTML-а');
    assert.ok(html.includes('/secret-view.js'), 'страницата зарежда скрипта за декриптиране');
    assert.equal((await fetch(base + '/secret/невалиден-идентификатор')).status, 404, 'невалидно id не отваря страница');

    // Първи преглед: шифротекстът излиза, декриптира се, броячът се изчерпва.
    r = await fetch(base + '/api/v2/secrets/' + created.id + '/reveal', { method: 'POST', headers: { accept: 'application/json' } });
    assert.equal(r.status, 200);
    const revealed = await r.json();
    assert.equal(revealed.viewsLeft, 0, 'това беше последният преглед');
    assert.equal(revealed.hint, 'IBAN за превод');
    const opened = new TextDecoder().decode(await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(revealed.iv, 'base64url') }, key, Buffer.from(revealed.ciphertext, 'base64url')));
    assert.equal(opened, plaintext, 'шифротекстът се декриптира с ключа от линка');

    // Вторият преглед е 404 (файлът вече е изтрит), а на диска го няма.
    // 410 е запазено за записи, които ОЩЕ са на диска, но са мъртви (изтекли/отменени).
    r = await fetch(base + '/api/v2/secrets/' + created.id + '/reveal', { method: 'POST' });
    assert.equal(r.status, 404, 'прегледаната тайна вече не съществува');
    assert.equal(fs.existsSync(path.join(dir, 'secrets', created.id + '.json')), false, 'файлът е изтрит от диска');

    // Няколко прегледа: 2 от 3, после изчезва.
    r = await call('/admin/api/v2/secrets', 'POST', { ciphertext, iv: b64u(ivBytes), max_views: 2 });
    const twice = await r.json();
    for (let i = 0; i < 2; i++) {
      const hit = await fetch(base + '/api/v2/secrets/' + twice.id + '/reveal', { method: 'POST' });
      assert.equal(hit.status, 200, 'преглед ' + (i + 1));
    }
    assert.equal((await fetch(base + '/api/v2/secrets/' + twice.id + '/reveal', { method: 'POST' })).status, 404, 'след лимита файлът го няма');

    // Изтекъл срок: създаваме запис на диска с минал expiresAt (иначе TTL мести и двата края).
    const expired = secretLinks.createRecord({ ciphertext, iv: b64u(ivBytes) }).record;
    expired.expiresAt = new Date(Date.now() - 60_000).toISOString();
    await secretLinks.save(dir, expired);
    assert.equal((await fetch(base + '/api/v2/secrets/' + expired.id + '/reveal', { method: 'POST' })).status, 410, 'изтеклото е 410');
    assert.equal(fs.existsSync(path.join(dir, 'secrets', expired.id + '.json')), false, 'изтеклият файл се маха');

    // Отмяна от администратора.
    r = await call('/admin/api/v2/secrets', 'POST', { ciphertext, iv: b64u(ivBytes) });
    const revoked = await r.json();
    r = await call('/admin/api/v2/secrets/' + revoked.id, 'DELETE');
    assert.equal(r.status, 200);
    assert.equal((await fetch(base + '/api/v2/secrets/' + revoked.id + '/reveal', { method: 'POST' })).status, 404, 'отмененото не съществува');

    // Списъкът е админски и не носи шифротекст.
    r = await call('/admin/api/v2/secrets', 'POST', { ciphertext, iv: b64u(ivBytes), hint: 'за списъка' });
    const listed = await r.json();
    r = await call('/admin/api/v2/secrets');
    const list = await r.json();
    assert.ok(list.secrets.some((s) => s.id === listed.id && s.hint === 'за списъка'));
    assert.ok(!JSON.stringify(list).includes(ciphertext), 'списъкът не връща шифротекста');
    assert.equal((await fetch(base + '/admin/api/v2/secrets')).status, 401, 'списъкът иска токен');

    console.log('PASS secret links: шифротекст без ключ, един преглед, 410 след това, изтекло/отменено, CSP');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
