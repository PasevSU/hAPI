'use strict';
// Тайни връзки (zero-knowledge, модел като scrt.link v2): сървърът пази само непрозрачен
// плик с ciphertext и НЕ знае нито идентификатора, нито ключа.
//
// Проверява се:
//   • unit: фрагментът `<id><ключ>` и `sha256(id)`; пликът (v2, iv, ct, pwd.check);
//   • unit: записът НЕ съдържа нито идентификатора, нито ключа — файлът се проверява дословно;
//   • unit: лимитите за срок/прегледи и решението кога тайната е „изчезнала“;
//   • краен-до-край: AES-GCM в Node (същият WebCrypto API като браузъра) шифрова тайна,
//     `POST /admin/api/v2/secrets` я приема, `GET /api/v2/secrets/<sha256(id)>` казва колко
//     прегледа остават БЕЗ да ги харчи, `POST …/reveal` я дава веднъж, вторият опит е 404;
//   • краен-до-край: втора парола (PBKDF2 → външен слой), сгрешена парола е 403 и НЕ харчи
//     преглед; изтекъл срок и отмяна дават 410/404;
//   • страницата `/secret` се сервира с `script-src 'self'` и без ключ в HTML-а.
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
const subtle = crypto.webcrypto.subtle;
const encoder = new TextEncoder();
const hex = (bytes) => Buffer.from(bytes).toString('hex');

(async () => {
  // ── 1. Фрагмент, идентификатор и плик ─────────────────────────────────────
  const link = secretLinks.newFragment();
  assert.equal(link.fragment.length, secretLinks.FRAGMENT_LENGTH, 'фрагментът е id + ключ');
  assert.equal(link.fragment.slice(0, secretLinks.ID_LENGTH), link.id);
  assert.equal(link.fragment.slice(secretLinks.ID_LENGTH), link.key);
  assert.equal(link.idHash, secretLinks.idHashOf(link.id), 'сървърът вижда само sha256(id)');
  assert.ok(secretLinks.isValidHash(link.idHash));
  assert.equal(secretLinks.parseFragment('#' + link.fragment).idHash, link.idHash, 'разчита се и с водещ #');
  assert.equal(secretLinks.parseFragment(link.fragment.slice(0, -1)), null, 'подрязан линк не минава');
  assert.equal(secretLinks.parseFragment(link.fragment + 'A'), null, 'удължен линк не минава');
  assert.equal(secretLinks.parseFragment('невалиден'), null);
  assert.equal(secretLinks.parseFragment(''), null);

  const iv = b64u(crypto.randomBytes(12));
  const salt = b64u(crypto.randomBytes(16));
  const check = crypto.createHash('sha256').update('x').digest('hex');
  assert.equal(secretLinks.normalizeEnvelope({ v: 2, iv, ct: '' }).error, 'ciphertext е задължителен (base64url)');
  assert.match(secretLinks.normalizeEnvelope({ v: 2, iv, ct: 'не-е-base64url' }).error, /base64url/);
  assert.match(secretLinks.normalizeEnvelope({ v: 1, iv, ct: 'AAAA' }).error, /версия 2/);
  assert.match(secretLinks.normalizeEnvelope({ v: 2, iv: 'къс', ct: 'AAAA' }).error, /iv/);
  const tooBig = b64u(crypto.randomBytes(secretLinks.MAX_CIPHERTEXT_BYTES + 10));
  assert.match(secretLinks.normalizeEnvelope({ v: 2, iv, ct: tooBig }).error, /над/);
  assert.match(secretLinks.normalizeEnvelope({ v: 2, iv, ct: 'AAAA', pwd: { alg: 'scrypt', iterations: 600000, salt, check } }).error, /PBKDF2-SHA256/);
  assert.match(secretLinks.normalizeEnvelope({ v: 2, iv, ct: 'AAAA', pwd: { alg: 'PBKDF2-SHA256', iterations: 5, salt, check } }).error, /iterations/);
  assert.match(secretLinks.normalizeEnvelope({ v: 2, iv, ct: 'AAAA', pwd: { alg: 'PBKDF2-SHA256', iterations: 600000, salt, check: 'къс' } }).error, /check/);
  const withPwd = secretLinks.normalizeEnvelope({ v: 2, iv, ct: 'AAAA', pwd: { alg: 'PBKDF2-SHA256', iterations: 600000, salt, check } });
  assert.equal(withPwd.requiresPassword, true, 'паролата се разпознава по плика, не по флаг от клиента');

  const ok = secretLinks.createRecord({ envelope: { v: 2, iv, ct: 'AAAA' }, idHash: link.idHash, hint: '  парола\nза ZIP  ' });
  assert.ok(ok.record, 'валиден запис');
  assert.equal(ok.record.hint, 'парола за ZIP', 'управляващите знаци се махат от подсказката');
  assert.equal(ok.record.maxViews, 1, 'по подразбиране е еднократна');
  assert.equal(ok.record.views, 0);
  assert.equal(ok.record.receipt.length, secretLinks.RECEIPT_LENGTH, 'чекът за подателя е 8 знака');
  assert.equal(secretLinks.createRecord({ envelope: { v: 2, iv, ct: 'AAAA' }, idHash: link.idHash, maxViews: 999 }).record.maxViews, secretLinks.MAX_VIEWS);
  assert.match(secretLinks.createRecord({ envelope: { v: 2, iv, ct: 'AAAA' }, idHash: 'къс' }).error, /idHash/);
  const longLived = secretLinks.createRecord({ envelope: { v: 2, iv, ct: 'AAAA' }, idHash: link.idHash, expiresIn: 10 ** 9 }).record;
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

    // Шифроване като в браузъра: ключ 32 байта (част от линка), AES-GCM, iv 12 байта.
    const linkKeyBytes = crypto.randomBytes(32);
    const linkKey = await subtle.importKey('raw', linkKeyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const ivBytes = crypto.randomBytes(12);
    const plaintext = 'IBAN BG00 TEST 1234 · ПИН 9876';
    const ciphertext = b64u(await subtle.encrypt({ name: 'AES-GCM', iv: ivBytes }, linkKey, encoder.encode(plaintext)));
    const envelope = { v: 2, iv: b64u(ivBytes), ct: ciphertext };

    // Идентификаторът се ражда при подателя (браузъра) — сървърът получава само sha256(id).
    const prepared = secretLinks.newFragment();
    assert.equal(prepared.key.length, secretLinks.KEY_LENGTH);

    let r = await call('/admin/api/v2/secrets', 'POST', {
      envelope,
      idHash: prepared.idHash,
      hint: 'IBAN за превод',
      expires_in: 3600,
      max_views: 1,
    });
    assert.equal(r.status, 201, 'тайната е приета: ' + (await r.clone().text()));
    const created = await r.json();
    assert.equal(created.idHash, prepared.idHash);
    assert.equal(created.path, '/secret', 'пътят НЕ съдържа идентификатор');
    assert.equal(created.viewsLeft, 1);
    assert.equal(created.envelope, undefined, 'админският изглед не връща плика');
    assert.ok(!JSON.stringify(created).includes(prepared.id), 'отговорът не съдържа идентификатора');
    assert.ok(created.sha256, 'връща отпечатък, за да се види, че записът не е подменен');

    // Файлът на диска НЕ съдържа нито идентификатора, нито ключа.
    const storedRaw = fs.readFileSync(path.join(dir, 'secrets', prepared.idHash + '.json'), 'utf8');
    const stored = JSON.parse(storedRaw);
    assert.equal(stored.envelope.ct, ciphertext);
    assert.ok(!storedRaw.includes(prepared.id), 'записът не съдържа идентификатора');
    assert.ok(!storedRaw.includes(prepared.key), 'записът не съдържа ключа');
    assert.ok(!storedRaw.includes(plaintext), 'записът не съдържа открития текст');
    assert.ok(!('key' in stored) && !('plaintext' in stored), 'записът не носи ключ');
    assert.equal(stored.hint, 'IBAN за превод', 'подсказката е открит текст по избор на подателя');

    // Страницата е публична черупка: без ключ в HTML-а, със строг CSP, без id в пътя.
    r = await fetch(base + '/secret');
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.ok(!html.includes(b64u(linkKeyBytes)), 'ключът не е в HTML-а');
    assert.ok(!html.includes(prepared.id), 'идентификаторът не е в HTML-а');
    assert.ok(html.includes('/secret-view.js'), 'страницата зарежда скрипта за декриптиране');
    assert.equal((await fetch(base + '/secret/' + prepared.id)).status, 200, 'стар/подрязан линк не дава 404');

    // Скриптът за декриптиране е публичен асет в КОРЕНА (страницата се отваря на public
    // listener-а, а `/hapi_enterprise/` е само за административния).
    r = await fetch(base + '/secret-view.js');
    assert.equal(r.status, 200, 'скриптът се сервира');
    assert.match(String(r.headers.get('content-type')), /javascript/);
    assert.match(await r.text(), /AES-GCM/, 'скриптът декриптира с AES-GCM');

    // Пробата казва какво следва, БЕЗ да харчи преглед.
    r = await fetch(base + '/api/v2/secrets/' + prepared.idHash);
    assert.equal(r.status, 200);
    const probe = await r.json();
    assert.equal(probe.remainingViews, 1, 'пробата не изразходва преглед');
    assert.equal(probe.requiresPassword, false);
    assert.equal(probe.hint, 'IBAN за превод');
    assert.equal((await fetch(base + '/api/v2/secrets/' + prepared.idHash)).status, 200, 'втора проба също не харчи');

    // Първи преглед: пликът излиза, декриптира се, броячът се изчерпва.
    r = await fetch(base + '/api/v2/secrets/' + prepared.idHash + '/reveal', { method: 'POST' });
    assert.equal(r.status, 200);
    const revealed = await r.json();
    assert.equal(revealed.viewsLeft, 0, 'това беше последният преглед');
    assert.equal(revealed.hint, 'IBAN за превод');
    const opened = new TextDecoder().decode(await subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(revealed.envelope.iv, 'base64url') },
      linkKey,
      Buffer.from(revealed.envelope.ct, 'base64url'),
    ));
    assert.equal(opened, plaintext, 'шифротекстът се декриптира с ключа от линка');

    // Вторият преглед е 404 (файлът вече е изтрит), а на диска го няма.
    // 410 е запазено за записи, които ОЩЕ са на диска, но са мъртви (изтекли/отменени).
    r = await fetch(base + '/api/v2/secrets/' + prepared.idHash + '/reveal', { method: 'POST' });
    assert.equal(r.status, 404, 'прегледаната тайна вече не съществува');
    assert.equal(fs.existsSync(path.join(dir, 'secrets', prepared.idHash + '.json')), false, 'файлът е изтрит от диска');

    // ── Втора парола: външен слой над ключа от линка ─────────────────────────
    const password = 'моята-парола-123';
    const pwdSalt = crypto.randomBytes(16);
    const pwdBits = new Uint8Array(
      await subtle.deriveBits({ name: 'PBKDF2', salt: pwdSalt, iterations: 600000, hash: 'SHA-256' }, await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']), 256),
    );
    const pwdKey = await subtle.importKey('raw', pwdBits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const outerIv = crypto.randomBytes(12);
    const outerCt = b64u(await subtle.encrypt({ name: 'AES-GCM', iv: outerIv }, pwdKey, encoder.encode(JSON.stringify(envelope))));
    const pwdEnvelope = {
      v: 2,
      iv: b64u(outerIv),
      ct: outerCt,
      pwd: { alg: 'PBKDF2-SHA256', iterations: 600000, salt: b64u(pwdSalt), check: hex(await subtle.digest('SHA-256', pwdBits)) },
    };
    const protectedLink = secretLinks.newFragment();
    r = await call('/admin/api/v2/secrets', 'POST', { envelope: pwdEnvelope, idHash: protectedLink.idHash, max_views: 1 });
    assert.equal(r.status, 201);
    const protectedRecord = await r.json();
    assert.equal(protectedRecord.requiresPassword, true, 'паролата се вижда в админския изглед');

    // Пробата дава солта и итерацииите, но НЕ и `check` (той е за сравнение при reveal).
    r = await fetch(base + '/api/v2/secrets/' + protectedLink.idHash);
    const pwdProbe = await r.json();
    assert.equal(pwdProbe.requiresPassword, true);
    assert.equal(pwdProbe.pwd.iterations, 600000);
    assert.equal(pwdProbe.pwd.salt, b64u(pwdSalt));
    assert.equal(pwdProbe.pwd.check, undefined, 'пробата не издава проверката на паролата');
    assert.ok(!JSON.stringify(pwdProbe).includes(String(pwdEnvelope.pwd.check)), 'check не изтича');

    // Сгрешена парола: 403 и прегледът НЕ е изразходван.
    const proofOf = async (pwd) => {
      const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', salt: Buffer.from(pwdProbe.pwd.salt, 'base64url'), iterations: pwdProbe.pwd.iterations, hash: 'SHA-256' }, await subtle.importKey('raw', encoder.encode(pwd), 'PBKDF2', false, ['deriveBits']), 256));
      return hex(await subtle.digest('SHA-256', bits));
    };
    r = await fetch(base + '/api/v2/secrets/' + protectedLink.idHash + '/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proof: await proofOf('грешна') }) });
    assert.equal(r.status, 403, 'сгрешената парола не отваря тайната');
    assert.equal((await (await fetch(base + '/api/v2/secrets/' + protectedLink.idHash)).json()).remainingViews, 1, 'сгрешената парола не харчи преглед');

    // Вярна парола: пликът излиза, външният слой се отваря с ключа от паролата, вътрешният — с ключа от линка.
    r = await fetch(base + '/api/v2/secrets/' + protectedLink.idHash + '/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proof: await proofOf(password) }) });
    assert.equal(r.status, 200);
    const pwdRevealed = await r.json();
    assert.equal(pwdRevealed.envelope.pwd.check, undefined, 'reveal не връща проверката на паролата');
    const innerEnvelope = JSON.parse(new TextDecoder().decode(await subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(pwdRevealed.envelope.iv, 'base64url') },
      pwdKey,
      Buffer.from(pwdRevealed.envelope.ct, 'base64url'),
    )));
    assert.equal(innerEnvelope.v, 2, 'вътрешният плик е същият формат');
    const pwdOpened = new TextDecoder().decode(await subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(innerEnvelope.iv, 'base64url') },
      linkKey,
      Buffer.from(innerEnvelope.ct, 'base64url'),
    ));
    assert.equal(pwdOpened, plaintext, 'двата слоя се отварят с паролата и с ключа от линка');

    // Няколко прегледа: 2 от 2, после изчезва.
    const twiceLink = secretLinks.newFragment();
    r = await call('/admin/api/v2/secrets', 'POST', { envelope, idHash: twiceLink.idHash, max_views: 2 });
    assert.equal(r.status, 201);
    for (let i = 0; i < 2; i++) {
      const hit = await fetch(base + '/api/v2/secrets/' + twiceLink.idHash + '/reveal', { method: 'POST' });
      assert.equal(hit.status, 200, 'преглед ' + (i + 1));
    }
    assert.equal((await fetch(base + '/api/v2/secrets/' + twiceLink.idHash + '/reveal', { method: 'POST' })).status, 404, 'след лимита файлът го няма');

    // Изтекъл срок: създаваме запис на диска с минал expiresAt (иначе TTL мести и двата края).
    const expiredLink = secretLinks.newFragment();
    const expired = secretLinks.createRecord({ envelope, idHash: expiredLink.idHash }).record;
    expired.expiresAt = new Date(Date.now() - 60_000).toISOString();
    await secretLinks.save(dir, expired);
    assert.equal((await fetch(base + '/api/v2/secrets/' + expiredLink.idHash + '/reveal', { method: 'POST' })).status, 410, 'изтеклото е 410');
    assert.equal(fs.existsSync(path.join(dir, 'secrets', expiredLink.idHash + '.json')), false, 'изтеклият файл се маха');

    // Отмяна от администратора.
    const revokedLink = secretLinks.newFragment();
    r = await call('/admin/api/v2/secrets', 'POST', { envelope, idHash: revokedLink.idHash });
    assert.equal(r.status, 201);
    r = await call('/admin/api/v2/secrets/' + revokedLink.idHash, 'DELETE');
    assert.equal(r.status, 200);
    assert.equal((await fetch(base + '/api/v2/secrets/' + revokedLink.idHash + '/reveal', { method: 'POST' })).status, 404, 'отмененото не съществува');

    // Списъкът е админски и не носи плика, нито идентификатора.
    const listedLink = secretLinks.newFragment();
    r = await call('/admin/api/v2/secrets', 'POST', { envelope, idHash: listedLink.idHash, hint: 'за списъка' });
    assert.equal(r.status, 201);
    r = await call('/admin/api/v2/secrets');
    const list = await r.json();
    assert.ok(list.secrets.some((s) => s.idHash === listedLink.idHash && s.hint === 'за списъка' && s.receipt));
    const listText = JSON.stringify(list);
    assert.ok(!listText.includes(ciphertext), 'списъкът не връща шифротекста');
    assert.ok(!listText.includes(listedLink.id), 'списъкът не връща идентификатора');
    assert.equal((await fetch(base + '/admin/api/v2/secrets')).status, 401, 'списъкът иска токен');

    console.log('PASS secret links: фрагмент = id+ключ, сървърът вижда само sha256(id), проба без разход, един преглед, 404/410, парола като втори слой (403 без разход), CSP и публичен скрипт');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
