'use strict';
// Тайни връзки към панела — ПЪЛНА интеграция, не само форма.
//
// Проверява се моделът на scrt.link v2 (MIT), приложен в собствения ни код:
//   • целият линк е във фрагмента `/secret#<id><ключ>` (65 знака), в пътя НЯМА id;
//   • идентификаторът и ключът се раждат в браузъра, сървърът получава само sha256(id);
//   • пликът е шифрован с ключа от линка; с втора парола — още един слой отвън;
//   • сгрешена парола НЕ изразходва преглед, верният — да;
//   • след последния преглед файлът се трие и тайната не може да се прочете отново.
//
// Тестът ползва ИСТИНСКИЯ клиентски модул (`ui/secret-share.js`) срещу ЖИВ сървър, т.е.
// проверява договора между панела и backend-а, а не преписан протокол в теста.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { stopChild, freePort } = require('./helpers.cjs');

const share = require('../hapi_enterprise/ui/secret-share.js');
const root = path.join(__dirname, '..');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-secret-panel-'));
  const port = await freePort();
  const token = 'secret-panel-admin-token-123456789';
  const child = spawn(process.execPath, [path.join(root, 'hapi_enterprise', 'server.js')], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      PORT: String(port),
      PUBLIC_GATEWAY_PORT: '0',
      ADMIN_TOKEN: token,
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/health`)).ok) {
          ready = true;
          break;
        }
      } catch {
        /* сървърът още стартира */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert(ready, 'сървърът не стартира');

    const authFetch = (p, init) =>
      fetch(base + p, { ...init, headers: { ...((init && init.headers) || {}), Authorization: `Bearer ${token}` } });

    // ── 1. Създаване: линкът е изцяло във фрагмента ────────────────────────────
    const secretText = 'IBAN BG00 TEST 1234 · парола за портала: Zh8#kq2';
    const created = await share.create({
      text: secretText,
      hint: 'банкови данни',
      ttlSeconds: 3600,
      maxViews: 1,
      password: 'втора-парола-42',
      base,
      fetch: authFetch,
    });

    assert.match(created.link, /^http:\/\/127\.0\.0\.1:\d+\/secret#/, 'линкът сочи публичната страница');
    const fragment = created.link.split('#')[1];
    assert.equal(fragment.length, share.PROTOCOL.fragmentLength, 'фрагментът е 22 + 43 знака');
    assert.equal(share.isValidFragment(fragment), true, 'фрагментът е валиден');
    assert.equal(fragment.slice(0, 22), created.id, 'първите 22 знака са идентификаторът');
    assert.equal(share.isValidKey(fragment.slice(22)), true, 'ключът е 43 знака base64url');
    // Идентификаторът НЕ влиза в пътя (иначе влиза в логове, Referer и одит).
    assert.equal(new URL(created.link).pathname, '/secret', 'в пътя няма идентификатор');
    assert.equal(created.link.includes(created.idHash), false, 'хешът също не е в линка');
    assert.equal(created.requiresPassword, true, 'линкът изисква втора парола');
    assert.ok(created.receipt && created.receipt.length >= 6, 'има чек за подателя');

    // ── 2. Сървърът не вижда нито текста, нито ключа ───────────────────────────
    const storedPath = path.join(dir, 'secrets', created.idHash + '.json');
    assert.ok(fs.existsSync(storedPath), 'пликът е записан на диска по sha256(id)');
    const stored = fs.readFileSync(storedPath, 'utf8');
    assert.equal(stored.includes(secretText), false, 'на диска НЯМА открит текст');
    assert.equal(stored.includes(fragment.slice(22)), false, 'на диска НЯМА ключа от линка');
    const record = JSON.parse(stored);
    assert.equal(record.envelope.v, 2, 'пликът е версия 2');
    assert.ok(record.envelope.pwd && record.envelope.pwd.check, 'паролата оставя само отпечатък');
    assert.equal(record.hint, 'банкови данни', 'подсказката е единственото четливо поле');

    // ── 3. Проба: казва какво чака получателя, без да гори преглед ─────────────
    const probe = await fetch(`${base}/api/v2/secrets/${created.idHash}`);
    assert.equal(probe.status, 200, 'пробата работи');
    const probeData = await probe.json();
    assert.equal(probeData.requiresPassword, true, 'пробата казва, че трябва парола');
    assert.equal(probeData.remainingViews, 1, 'остава един преглед');
    assert.equal(probeData.pwd && probeData.pwd.check, undefined, 'отпечатъкът НЕ излиза към получателя');
    assert.equal(probeData.hint, 'банкови данни');

    // ── 4. Сгрешена парола: 403 и НЕ гори прегледа ────────────────────────────
    const wrong = await fetch(`${base}/api/v2/secrets/${created.idHash}/reveal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proof: '00'.repeat(32) }),
    });
    assert.equal(wrong.status, 403, 'сгрешена парола се отказва');
    assert.equal((await (await fetch(`${base}/api/v2/secrets/${created.idHash}`)).json()).remainingViews, 1, 'прегледът е запазен');

    // ── 5. Вярна парола: пликът се отваря в браузъра и текстът съвпада ────────
    const pwdBits = await (async () => {
      const salt = share.b64uToBytes(record.envelope.pwd.salt);
      const material = await crypto.subtle.importKey('raw', new TextEncoder().encode('втора-парола-42'), 'PBKDF2', false, ['deriveBits']);
      return new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: 'PBKDF2', salt, iterations: record.envelope.pwd.iterations, hash: 'SHA-256' },
          material,
          256,
        ),
      );
    })();
    const proof = Array.from(pwdBits, (b) => b.toString(16).padStart(2, '0')).join('');
    const revealed = await fetch(`${base}/api/v2/secrets/${created.idHash}/reveal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proof }),
    });
    assert.equal(revealed.status, 200, 'вярната парола отваря плика');
    const revealedData = await revealed.json();
    assert.equal(revealedData.viewsLeft, 0, 'това е последният преглед');
    assert.equal(revealedData.envelope.pwd.check, undefined, 'отпечатъкът не се връща');
    const opened = await share.open({
      envelope: revealedData.envelope,
      fragment,
      password: 'втора-парола-42',
    });
    assert.equal(opened, secretText, 'разшифрованият текст съвпада с подадения');

    // ── 6. След последния преглед тайната я няма ──────────────────────────────
    assert.equal(fs.existsSync(storedPath), false, 'файлът е изтрит след последния преглед');
    const again = await fetch(`${base}/api/v2/secrets/${created.idHash}/reveal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proof }),
    });
    assert.ok([404, 410].includes(again.status), 'вторият опит за преглед е отказан');

    // ── 7. Същият метод за връзка към панела (без втора парола) ───────────────
    const panelUrl = `${base}/ui/index.html#portals`;
    const linkSecret = await share.createFromUrl(panelUrl, { ttlSeconds: 3600, maxViews: 2, base, fetch: authFetch });
    assert.equal(linkSecret.requiresPassword, false, 'връзката е без втора парола');
    const linkReveal = await fetch(`${base}/api/v2/secrets/${linkSecret.idHash}/reveal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(linkReveal.status, 200, 'връзката се отваря без парола');
    const linkPayload = await share.open({ envelope: (await linkReveal.json()).envelope, fragment: linkSecret.link.split('#')[1] });
    assert.equal(linkPayload, panelUrl, 'товарът е точно адресът към панела');

    // ── 8. QR кодът на линка работи в браузър (иначе е „декоративен“) ────────
    const qrSource = fs.readFileSync(path.join(root, 'hapi_enterprise', 'qrcode.js'), 'utf8');
    assert.match(qrSource, /window\.qrcode = factory\(\)/, 'qrcode.js се показва и на window за браузъра');
    const qrSandbox = { window: {}, console };
    vm.runInNewContext(qrSource, qrSandbox, { filename: 'qrcode.js' });
    assert.equal(typeof qrSandbox.window.qrcode, 'function', 'в браузъра window.qrcode е функция');
    const qr = qrSandbox.window.qrcode(0, 'M');
    qr.addData(created.link);
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
    assert.match(svg, /^<svg/, 'SVG-то на QR кода е валидно');
    assert.ok(svg.length > 400, 'QR кодът има реално съдържание');

    // ── 9. Панелът наистина ползва този модул ─────────────────────────────────
    const panelSource = fs.readFileSync(path.join(root, 'hapi_enterprise', 'ui', 'settings-panel.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(root, 'hapi_enterprise', 'ui', 'index.html'), 'utf8');
    const serverSource = fs.readFileSync(path.join(root, 'hapi_enterprise', 'server.js'), 'utf8');
    assert.ok(indexHtml.includes('secret-share.js'), 'index.html зарежда модула');
    assert.match(panelSource, /data-action="secretCreate"/, 'секция „Данни“ има бутон за създаване');
    assert.match(panelSource, /window\.HapiSecretShare/, 'панелът взима модула за тайни връзки');
    assert.match(panelSource, /share\.create\(\{/, 'панелът създава линка през този модул');
    assert.ok(serverSource.includes("'secret-share.js'"), 'сървърът сервира модула на /ui/secret-share.js');

    // ── 10. Линкът сочи навън и под HA Ingress префикс ─────────────────────────
    const cases = [
      ['https://ha.local/api/hassio_ingress/TOKEN/ui/index.html', 'https://ha.local/api/hassio_ingress/TOKEN'],
      ['https://ha.local/api/hassio_ingress/TOKEN/ui/', 'https://ha.local/api/hassio_ingress/TOKEN'],
      ['https://ha.local/api/hassio_ingress/TOKEN/admin', 'https://ha.local/api/hassio_ingress/TOKEN'],
      ['https://ha.local/api/hassio_ingress/TOKEN/admin/panel', 'https://ha.local/api/hassio_ingress/TOKEN'],
      ['http://homeassistant.local:8098/ui/index.html', 'http://homeassistant.local:8098'],
    ];
    for (const [pathname, expected] of cases) {
      const origin = new URL(pathname).origin;
      const got = share.publicBase(null, { protocol: 'https:', host: new URL(pathname).host, origin, pathname: new URL(pathname).pathname });
      assert.equal(got, expected, `публичният адрес за ${pathname}`);
    }
    assert.equal(share.publicBase(null, { protocol: 'file:', pathname: '/x/ui/index.html' }), '', 'през file:// няма публичен адрес');
    assert.equal(share.publicBase('https://ha.local/'), 'https://ha.local', 'явният адрес се нормализира');

    console.log('PASS secret-panel: линк във фрагмента · sha256(id) · два слоя · прегледи и срок · QR · връзка към панела');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
