'use strict';
// PGP ИНСТРУМЕНТИТЕ НЕ ИСКАТ КЛЮЧ, КОГАТО ТОЙ ВЕЧЕ Е ЗАДАДЕН В ОПЦИИТЕ.
//
// Договорът, който този тест пази:
//   • `pgp_path_public`/`pgp_path_secret` → ключът се ползва АВТОМАТИЧНО за подпис и за
//     проверка; прикачване в конзолата НЕ е нужно;
//   • ключът от опциите се вижда в списъка като `source: 'options'` и е само за четене
//     (`removable: false`) — той е файл, който човекът сменя в опциите, не в панела;
//   • прикаченият ключ има предимство пред този от опциите;
//   • ключът за ПРОВЕРКА е по избор: подаден изрично (`publicArmored`) проверява подпис,
//     направен със СТАР ключ, дори когато той вече не е прикачен;
//   • в отговорите няма частен ключ (INV-P7).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { freePort, stopChild } = require('./helpers.cjs');
const pgp = require('../hapi_enterprise/pgp.js');

const FIX = path.join(__dirname, 'fixtures/pgp');
const PUBLIC = path.join(FIX, 'public.asc');
const SECRET = path.join(FIX, 'secret.asc');
const PASS = 'fx-pass-2026';
const TOKEN = 'pgp-tools-token-0123456789abcdef';
const cases = [];
const ok = (label) => cases.push(label);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-pgp-tools-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    // `cwd` е системният диск, за да сочи „/share“ към <root>/share, а не към UNC път.
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      DATA_DIR: dir,
      PORT: String(port),
      ADMIN_PORT: '0',
      PUBLIC_GATEWAY_PORT: '0',
      ADMIN_TOKEN: TOKEN,
      PGP_PATH_PUBLIC: PUBLIC,
      PGP_PATH_SECRET: SECRET,
      PGP_KEY_PASS: PASS,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c.toString() });
  const call = async (p, method = 'GET', data, auth = true, headers = {}) => {
    const r = await fetch('http://127.0.0.1:' + port + p, {
      method,
      headers: { ...(auth ? { Authorization: 'Bearer ' + TOKEN } : {}), ...headers },
      body: data,
    });
    const type = r.headers.get('content-type') || '';
    const value = type.includes('application/json') ? await r.json() : await r.text();
    return { status: r.status, value, headers: r.headers };
  };

  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      try {
        if ((await call('/health')).status === 200) { ready = true; break }
      } catch {
        /* още не слуша */
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.ok(ready, 'сървърът стартира' + (stderr ? ' · ' + stderr : ''));

    // ── 1. Ключът от опциите се вижда и е само за четене ─────────────────────
    const keyring = (await call('/admin/api/pgp/keyring')).value.keyring;
    assert.equal(keyring.available, true, 'ключовете от опциите са заредени: ' + JSON.stringify(keyring.reason || ''));
    const list = (await call('/admin/api/pgp/keys')).value;
    const fromOptions = list.keys.filter((k) => k.source === 'options');
    assert.equal(fromOptions.length, 1, 'ключът от опциите е в списъка: ' + JSON.stringify(list.keys));
    assert.equal(fromOptions[0].canSign, true, 'ключът от опциите може да подписва');
    assert.equal(fromOptions[0].removable, false, 'ключът от опциите не се трие от панела');
    assert.equal(fromOptions[0].keyId, keyring.storageKeyId, 'това е същият ключ, който ключохранилището дава');
    assert.equal(JSON.stringify(list).includes('BEGIN PGP PRIVATE KEY'), false, 'в списъка няма частен ключ (INV-P7)');
    ok('ключът от опциите е в списъка, подписва и е само за четене');

    // ── 2. Автоподписване работи БЕЗ прикачен ключ ───────────────────────────
    const auto = await call('/admin/api/packages/settings', 'PATCH', JSON.stringify({ autoSign: true }), true, { 'Content-Type': 'application/json' });
    assert.equal(auto.status, 200, 'автоподписването се включва с ключа от опциите: ' + JSON.stringify(auto.value));
    assert.equal(auto.value.autoSign, true);

    const portal = (await call('/admin/api/portals', 'POST', JSON.stringify({ slug: 'pgp-tools', title: 'PGP инструменти', category: 'Правни дела' }), true, { 'Content-Type': 'application/json' })).value;
    assert.ok(portal && portal.id, 'порталът е създаден: ' + JSON.stringify(portal));
    await call(`/admin/api/portals/${portal.id}/files`, 'POST', 'съдържание за подпис', true, { 'X-File-Name': 'dogovor.txt' });

    const built = await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id }), true, { 'Content-Type': 'application/json' });
    assert.equal(built.status, 201, 'пакетът се създава със знак по подразбиране (autoSign): ' + JSON.stringify(built.value));
    assert.equal(built.value.hasSignature, true, 'пакетът е ПОДПИСАН без нищо прикачено');
    assert.equal(built.value.signature.keyId, fromOptions[0].keyId, 'подписаният ключ е този от опциите');
    ok('autoSign + подпис работят без прикачен ключ (ключ от опциите)');

    // ── 3. Проверката ползва ключа от опциите ────────────────────────────────
    const verified = await call(`/admin/api/packages/${built.value.id}/verify`, 'POST', '{}', true, { 'Content-Type': 'application/json' });
    assert.equal(verified.status, 200, JSON.stringify(verified.value));
    assert.equal(verified.value.valid, true, 'подписът се проверява с публичния ключ от опциите: ' + JSON.stringify(verified.value));
    ok('проверката работи с публичния ключ от опциите');

    // ── 4. Ключът за проверка е ПО ИЗБОР — стар ключ, вече неприкачен ────────
    // Стар ключ: прикача се, подписва се пакет с него, после се ПРЕМАХВА. Проверката на
    // онзи подпис остава възможна само ако човекът подаде стария ПУБЛИЧЕН ключ.
    const old = pgp.generate({ algorithm: 'ed25519', userId: 'Стар ключ <old@example.test>' });
    const attached = (await call('/admin/api/pgp/keys', 'POST', JSON.stringify({ label: 'Стар ключ', secretArmored: old.secretArmored }), true, { 'Content-Type': 'application/json' })).value;
    assert.ok(attached && attached.id, 'старият ключ е прикачен: ' + JSON.stringify(attached));
    const listBoth = (await call('/admin/api/pgp/keys')).value.keys;
    assert.equal(listBoth.length, 2, 'виждат се и прикаченият, и този от опциите: ' + JSON.stringify(listBoth));
    // Изрично избраният ключ от опциите подписва, макар да има прикачен (иначе „Ключ за
    // подписване“ в панела би бил меню, което лъже).
    const signedOptions = await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id, sign: true, keyId: fromOptions[0].id }), true, { 'Content-Type': 'application/json' });
    assert.equal(signedOptions.status, 201, JSON.stringify(signedOptions.value));
    assert.equal(signedOptions.value.signature.keyId, fromOptions[0].keyId, 'изрично избраният ключ от опциите подписва');
    const signedOld = await call('/admin/api/packages', 'POST', JSON.stringify({ portalId: portal.id, sign: true, keyId: attached.keyId }), true, { 'Content-Type': 'application/json' });
    assert.equal(signedOld.status, 201, JSON.stringify(signedOld.value));
    assert.equal(signedOld.value.signature.keyId, attached.keyId, 'подписът е с ПРИКАЧЕНИЯ (той има предимство)');
    const removed = await call(`/admin/api/pgp/keys/${attached.id}`, 'DELETE');
    assert.equal(removed.status, 200, 'старият ключ се премахва: ' + JSON.stringify(removed.value));

    const withoutOld = await call(`/admin/api/packages/${signedOld.value.id}/verify`, 'POST', '{}', true, { 'Content-Type': 'application/json' });
    assert.equal(withoutOld.status, 200, JSON.stringify(withoutOld.value));
    assert.equal(withoutOld.value.valid, false, 'без стария ключ подписът НЕ се потвърждава (ключът от опциите е друг)');

    const withOld = await call(`/admin/api/packages/${signedOld.value.id}/verify`, 'POST', JSON.stringify({ publicArmored: old.publicArmored }), true, { 'Content-Type': 'application/json' });
    assert.equal(withOld.status, 200, JSON.stringify(withOld.value));
    assert.equal(withOld.value.valid, true, 'подаденият СТАР публичен ключ проверява стария подпис');
    ok('проверката приема стар ключ по избор (publicArmored) и не иска прикачване');

    // ── 5. Публичната част на ключа от опциите се дава, секретната — не ──────
    const publicView = await call(`/admin/api/pgp/keys/${encodeURIComponent(fromOptions[0].id)}/public`);
    assert.equal(publicView.status, 200, JSON.stringify(publicView.value));
    assert.match(String(publicView.value.publicArmored), /^-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'връща се ПУБЛИЧНИЯТ ключ');
    assert.equal(JSON.stringify(publicView.value).includes('PRIVATE KEY'), false, 'секретната част не се връща');
    ok('публичната част на ключа от опциите е достъпна, секретната — не');

    console.log('PASS pgp-tools: ' + cases.length + ' проверки · ' + cases.join(' · '));
  } finally {
    await stopChild(child);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
