'use strict';
// Секцията „Подпис на отчети“ — от панела до файл .p7s и обратно.
//
// Какво се проверява (и защо точно това):
//   1. панелът наистина има секция `cms` и два бутона, а не само текст в документация;
//   2. клиентът, който панелът ползва (`ui/report-sign.js`), стига до ЖИВ сървър и
//      подписва реално рендиран отчет — не преписан протокол в теста;
//   3. отказва файл, който не е PDF, още преди заявка (иначе сървърът харчи CPU за нищо);
//   4. проверката казва „пасва“ за същия файл и „НЕ пасва“ за подправен байт;
//   5. без токен не се подписва (401), а отговорът не обещава „удостоверен документ“.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { stopChild, freePort } = require('./helpers.cjs');

const sign = require('../hapi_enterprise/ui/report-sign.js');
const x509 = require('../hapi_enterprise/x509.js');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ── 1. Панелът: секция + действия + регистрация на модула ────────────────────────
const panel = read('hapi_enterprise/ui/settings-panel.js');
assert.match(panel, /\{ id: 'cms', label: 'section\.cms' \}/, 'секцията „Подпис на отчети“ е в SECTIONS');
assert.ok(panel.includes('data-action="cmsSign"'), 'има бутон за подпис');
assert.ok(panel.includes('data-action="cmsVerify"'), 'има бутон за проверка');
assert.ok(panel.includes('mod.sign('), 'панелът вика подписа от модула, а не собствен протокол');
assert.ok(panel.includes('mod.verify('), 'панелът вика проверката от модула');
assert.equal(sign.SIGN_PATH, '/admin/api/v2/reports/sign', 'пътят за подпис е един');
assert.equal(sign.VERIFY_PATH, '/admin/api/v2/cms/verify', 'пътят за проверка е един');
const indexHtml = read('hapi_enterprise/ui/index.html');
assert.ok(indexHtml.includes('report-sign.js'), 'index.html зарежда модула');
assert.ok(read('hapi_enterprise/server.js').includes("'report-sign.js'"), 'сървърът сервира /ui/report-sign.js');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-cms-panel-'));
  const port = await freePort();
  const token = 'cms-panel-admin-token-123456789';
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

    const headers = { Authorization: `Bearer ${token}` };
    // fetch с токен: приема ПЪЛЕН адрес, защото модулът сам слага `base` отпред.
    const authFetch = (url, init) => fetch(url, { ...init, headers: { ...((init && init.headers) || {}), ...headers } });
    const adminFetch = (p, init) => authFetch(base + p, init);

    // ── 2. Живият договор: издаден отчет → подпис → проверка ─────────────────────
    const renderRes = await adminFetch('/admin/api/v2/reports/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tsa: false,
        manifest: {
          profile: 'forensic-full',
          blocks: [
            { id: 's', type: 'rfc3161-start', label: 'START', locked: true },
            { id: 't', type: 'title', value: 'Договор 2026' },
            { id: 'e', type: 'rfc3161-stop', label: 'STOP', locked: true },
          ],
        },
      }),
    });
    assert.equal(renderRes.status, 201, 'отчетът се рендира');
    const pdfBytes = new Uint8Array(await renderRes.arrayBuffer());

    const identity = x509.selfSigned({ commonName: 'hAPI Panel Signer', organization: 'hAPI Enterprise', country: 'BG', days: 30 });
    const signed = await sign.sign({ pdfBytes, certPem: identity.certPem, keyPem: identity.keyPem, base, fetch: authFetch, fileName: 'договор.pdf' });
    assert.equal(signed.ok, true, 'подписът минава през клиента на панела: ' + (signed.error || ''));
    assert.equal(signed.detached, true, 'подписът е отделен от PDF-а');
    assert.equal(signed.fileName, 'договор.p7s', 'името на файла следва PDF-а');
    assert.equal(
      signed.pdfSha256,
      crypto.createHash('sha256').update(Buffer.from(pdfBytes)).digest('hex'),
      'отпечатъкът е на ИЗПРАТЕНИТЕ байтове',
    );
    assert.ok(signed.cmsBytes > 100, 'CMS има съдържание');
    assert.match(signed.note, /Доверието зависи/, 'клиентът не обещава „удостоверен документ“');
    assert.ok(signed.cmsBase64.startsWith('MII'), 'CMS е DER последователност');

    const verified = await sign.verify({ dataBytes: pdfBytes, cmsBase64: signed.cmsBase64, base, fetch: authFetch });
    assert.equal(verified.ok, true, 'проверката потвърждава подписа: ' + verified.reason);
    assert.match(verified.subject, /hAPI Panel Signer/, 'проверката връща издателя');
    assert.equal(verified.digest, signed.pdfSha256, 'digest-ът е същият');

    // ── 3. Подправен байт в PDF-а: 409, а не „мина“ ───────────────────────────────
    // Байтът се сменя в СЕРЕДАТА на файла: текстът в отчета е в компресиран поток, така
    // че търсене на дума в суровите байтове не е надеждно.
    const tampered = Uint8Array.from(pdfBytes);
    const at = Math.floor(tampered.length / 2);
    tampered[at] = tampered[at] ^ 0x01;
    const broken = await sign.verify({ dataBytes: tampered, cmsBase64: signed.cmsBase64, base, fetch: authFetch });
    assert.equal(broken.ok, false, 'подправеният файл НЕ минава');
    assert.equal(broken.mismatch, true, 'отказът е „данните не съвпадат“, а не „счупен CMS“');

    // ── 4. Входът се валидира преди заявката ─────────────────────────────────────
    const notPdf = await sign.sign({ pdfBytes: Buffer.from('това не е PDF'), certPem: identity.certPem, keyPem: identity.keyPem, base, fetch: authFetch });
    assert.equal(notPdf.ok, false, 'файл, който не е PDF, не се подписва');
    assert.equal(notPdf.reason, 'not-pdf', 'причината е „не е PDF“');
    const noKey = await sign.sign({ pdfBytes, certPem: identity.certPem, keyPem: '', base, fetch: authFetch });
    assert.equal(noKey.reason, 'bad-key', 'без ключ не се тръгва към сървъра');
    const noCert = await sign.sign({ pdfBytes, certPem: 'не е сертификат', keyPem: identity.keyPem, base, fetch: authFetch });
    assert.equal(noCert.reason, 'bad-certificate', 'без сертификат не се тръгва към сървъра');
    const emptySig = await sign.verify({ dataBytes: pdfBytes, cmsBase64: '', base, fetch: authFetch });
    assert.equal(emptySig.reason, 'no-signature', 'празен подпис се отказва локално');

    // ── 5. Без токен няма подпис ─────────────────────────────────────────────────
    const anonymous = await sign.sign({ pdfBytes, certPem: identity.certPem, keyPem: identity.keyPem, base, fetch: (url, init) => fetch(url, init) });
    assert.equal(anonymous.ok, false, 'анонимна заявка за подпис не минава');
    assert.equal(anonymous.status, 401, 'сървърът иска токен');

    console.log('PASS cms-panel: секция „Подпис на отчети“ · клиентът подписва жив отчет · проверка пасва/не пасва · входът се валидира преди заявка');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
