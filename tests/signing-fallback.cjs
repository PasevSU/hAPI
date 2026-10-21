'use strict';
// Сценарий: подписването не блокира пакета, когато конфигурираният ключ липсва.
//
//   1. Пакет с изрично зададен (съществуващ) ключ → подписан, без fallback.
//   2. Зададен е ключ, който вече не съществува → пакетът пак се подписва с наличния
//      ключ, а метаданните носят `signingFallback` (не мълчим за смяната).
//   3. Няма никакъв ключ със секретна част → ясна 400 грешка, без счупен артефакт.
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const pgp = require('../hapi_enterprise/pgp.js');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-sign-fallback-'));
  const port = 37100 + Math.floor(Math.random() * 500);
  const token = 'signing-fallback-admin-token-0123456789';
  const base = `http://127.0.0.1:${port}`;

  const call = async (route, { method = 'GET', body } = {}) => {
    const res = await fetch(base + route, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let value = null;
    try {
      value = await res.json();
    } catch {
      value = null;
    }
    return { status: res.status, value };
  };

  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      OPTIONS_PATH: path.join(dir, 'missing-options.json'),
      PORT: String(port),
      ADMIN_TOKEN: token,
    },
    cwd: os.tmpdir(),
    stdio: 'ignore',
  });

  try {
    let ready = false;
    for (let i = 0; i < 140; i++) {
      try {
        if ((await fetch(base + '/health')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, 'сървърът стартира');

    const portal = await call('/admin/api/portals', { method: 'POST', body: { slug: 'signed', title: 'Signed' } });
    assert.equal(portal.status, 201, JSON.stringify(portal.value));
    const portalId = portal.value.id;
    const upload = await fetch(`${base}/admin/api/portals/${portalId}/files`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'X-File-Name': 'doc.txt' },
      body: 'съдържание за подпис',
    });
    assert.equal(upload.status, 201);

    // 1. Ключ със секретна част → подписване без fallback.
    const key = pgp.generate({ algorithm: 'ed25519', userId: 'Fallback тест <fallback@example.test>' });
    const attached = await call('/admin/api/pgp/keys', {
      method: 'POST',
      body: { label: 'Ключ за fallback', secretArmored: key.secretArmored },
    });
    assert.equal(attached.status, 201, JSON.stringify(attached.value));
    const keyId = attached.value.id;

    const direct = await call('/admin/api/packages', {
      method: 'POST',
      body: { portalId, sign: true, keyId },
    });
    assert.equal(direct.status, 201, JSON.stringify(direct.value));
    assert.equal(direct.value.hasSignature, true);
    assert.equal(direct.value.signature.keyId, key.keyId);
    assert.equal(direct.value.signingFallback, undefined, 'без fallback няма поле');

    // 2. Зададен е несъществуващ ключ → fallback към наличния, с изрично означение.
    const fallback = await call('/admin/api/packages', {
      method: 'POST',
      body: { portalId, sign: true, keyId: 'изтрит-ключ-000000' },
    });
    assert.equal(fallback.status, 201, JSON.stringify(fallback.value));
    assert.equal(fallback.value.hasSignature, true, 'пакетът е подписан въпреки липсващия ключ');
    assert.equal(fallback.value.signature.keyId, key.keyId, 'използван е наличният ключ');
    assert.ok(fallback.value.signingFallback, 'fallback-ът е видим в метаданните');
    assert.equal(fallback.value.signingFallback.requested, 'изтрит-ключ-000000');
    assert.equal(fallback.value.signingFallback.used, key.keyId);
    assert.match(fallback.value.signingFallback.reason, /not found/i);

    // Одитът пази събитието, за да не е скрита смяна на ключ.
    const audit = await call('/admin/api/audit?limit=100');
    const kinds = audit.value.events.map((e) => String(e.event || ''));
    assert.ok(
      kinds.some((k) => k === 'package.signing.fallback'),
      `очаквам одит за fallback: ${kinds.filter((k) => k.startsWith('package')).join(',')}`,
    );
    const build = audit.value.events.find((e) => e.event === 'package.build' && e.signingFallback);
    assert.equal(build.signingFallback, key.keyId, 'package.build носи кой ключ е ползван');

    // 3. Без никакъв ключ → ясна грешка (не счупен пакет, не мълчание).
    const removed = await fetch(`${base}/admin/api/pgp/keys/${keyId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token },
    });
    assert.equal(removed.ok, true);
    const empty = await call('/admin/api/packages', { method: 'POST', body: { portalId, sign: true } });
    assert.equal(empty.status, 400, JSON.stringify(empty.value));
    assert.match(String(empty.value.error), /PGP ключ|ключ/i);

    console.log('PASS signing fallback: изричен ключ, fallback с означение в одита, ясна грешка без ключ');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
