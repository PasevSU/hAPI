'use strict';
// PDF/A-3 структура + detached CMS/PKCS#7 подпис (RS-06).
//
// Какво се твърди и какво НЕ:
//   • PDF-ът носи XMP с `pdfaid:part=3` / `conformance=B`, `/Lang`, `/Metadata` и вграден
//     файл (`/EmbeddedFiles` + `/AFRelationship /Data`) — това е СТРУКТУРАТА на A-3.
//     Съответствие се удостоверява само от валидатор (veraPDF), затова тук не се казва
//     „PDF/A-3 сертифициран“.
//   • Подписът е истински detached CMS (SHA-256/RSA) върху байтовете на PDF-а. Тестът го
//     проверява независимо: със собствен TLV-четец изважда подписа и `crypto.verify` го
//     проверява с публичния ключ от сертификата, който е В подписа.
//   • Без ключ сървърът ОТКАЗВА (400) — няма „подпис по подразбиране“.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { stopChild, freePort } = require('./helpers.cjs');

const root = path.join(__dirname, '..');
const x509 = require('../hapi_enterprise/x509.js');
const cms = require('../hapi_enterprise/cms-sign.js');
const pdf = require('../hapi_enterprise/pdf-writer.js');
const reportRender = require('../hapi_enterprise/report-render.js');

// ── 1. PDF/A-3 структура ────────────────────────────────────────────────────────
const pdfBytes = pdf.render([{ type: 'h1', text: 'Отчет' }, { type: 'p', text: 'тяло' }], {
  title: 'Отчет & тест <2026>',
  lang: 'bg',
  attachments: [{ name: 'manifest.json', description: 'Манифест', mime: 'application/json', data: Buffer.from('{"profile":"x"}') }],
});
const pdfText = pdfBytes.toString('latin1');
assert.match(pdfText, /\/Type \/Metadata \/Subtype \/XML/, 'PDF-ът има XMP метаданни');
assert.match(pdfText, /\/Lang \(bg\)/, 'езикът е зададен');
assert.match(pdfText, /\/EmbeddedFiles/, 'има вградени файлове (това отличава A-3 от A-2)');
assert.match(pdfText, /\/AFRelationship \/Data/, 'вграденият файл е асоцииран като данни');
assert.match(pdfText, /\/Type \/EmbeddedFile/, 'вграденият файл е EmbeddedFile');

// Вграденият манифест се връща обратно от PDF-а (разархивиране на потока).
function inflateStreams(buf) {
  const parts = [];
  const S = Buffer.from('stream'), E = Buffer.from('endstream');
  let i = 0;
  while ((i = buf.indexOf(S, i)) !== -1) {
    let start = i + S.length;
    if (buf[start] === 0x0d) start += 1;
    if (buf[start] === 0x0a) start += 1;
    const end = buf.indexOf(E, start);
    if (end === -1) break;
    try {
      parts.push(zlib.inflateSync(buf.subarray(start, end)));
    } catch {
      parts.push(buf.subarray(start, end));
    }
    i = end + E.length;
  }
  return parts;
}
const streams = inflateStreams(pdfBytes);
// XMP е в компресиран поток — там се гледат и A-3 идентификацията, и екранирането.
const xmpBuffer = streams.find((s) => s.toString('utf8').includes('x:xmpmeta'));
assert.ok(xmpBuffer, 'XMP потокът е в PDF-а');
const xmp = xmpBuffer.toString('utf8');
assert.match(xmp, /pdfaid:part>3<\/pdfaid:part>/, 'XMP се идентифицира като PDF/A-3');
assert.match(xmp, /pdfaid:conformance>B</, 'ниво B (basic)');
assert.match(xmp, /Отчет &amp; тест &lt;2026/, 'заглавието в XMP е екранирано (& и <)');
assert.equal(/Отчет & тест <2026>/.test(xmp), false, 'неекранирано заглавие не минава в XML');
const embedded = streams.find((s) => s.toString('utf8').includes('"profile"'));
assert.ok(embedded, 'вграденият манифест се намира в PDF-а');
assert.equal(embedded.toString('utf8'), '{"profile":"x"}', 'съдържанието на вградения файл съвпада');

// Истински отчет: манифестът се прикачва сам.
const renderedReport = reportRender.renderPdf({ profile: 'forensic-full', blocks: [{ id: 's', type: 'rfc3161-start', label: 'START', locked: true }, { id: 't', type: 'title', value: 'Заглавие' }, { id: 'e', type: 'rfc3161-stop', label: 'STOP', locked: true }] });
assert.match(renderedReport.toString('latin1'), /report-manifest\.json/, 'отчетът носи манифеста си като вграден файл');

// ── 2. Сертификат и подпис ──────────────────────────────────────────────────────
const identity = x509.selfSigned({ commonName: 'hAPI Report Signer', organization: 'hAPI Enterprise' });
const parsed = new crypto.X509Certificate(identity.certDer);
assert.equal(parsed.verify(parsed.publicKey), true, 'сертификатът се подписва сам (валиден X.509)');
assert.match(parsed.subject, /CN=hAPI Report Signer/, 'субектът е зададеният');

const signed = cms.signDetached({ data: pdfBytes, certDer: identity.certDer, keyPem: identity.keyPem });
assert.ok(Buffer.isBuffer(signed.cms) && signed.cms.length > 500, 'CMS подписът е DER буфер');
assert.equal(signed.digest, crypto.createHash('sha256').update(pdfBytes).digest('hex'), 'digest-ът е SHA-256 на PDF-а');

// ── 3. Независима проверка: собствен TLV-четец + crypto.verify ──────────────────
function readTlv(buf, offset) {
  const tag = buf[offset];
  let p = offset + 1;
  let length = buf[p];
  p += 1;
  if (length & 0x80) {
    const n = length & 0x7f;
    length = 0;
    for (let i = 0; i < n; i += 1) length = (length << 8) | buf[p + i];
    p += n;
  }
  return { tag, content: buf.subarray(p, p + length), end: p + length };
}
const walk = (node) => {
  const out = [];
  let offset = 0;
  while (offset < node.content.length) {
    const child = readTlv(node.content, offset);
    out.push(child);
    offset = child.end;
  }
  return out;
};
const contentInfo = readTlv(signed.cms, 0);
const [, explicit] = walk(contentInfo);
const signedData = walk(explicit)[0];
const parts = walk(signedData);
const certNode = parts.find((p) => p.tag === 0xa0);
const signerInfo = walk(parts[parts.length - 1])[0];
const fields = walk(signerInfo);
const signedAttrs = fields[3];
const signature = fields[5];
const independentCert = new crypto.X509Certificate(certNode.content);
const signingBytes = Buffer.concat([
  Buffer.from([0xa0]),
  x509.len(signedAttrs.content.length),
  signedAttrs.content,
]);
assert.equal(
  crypto.verify('sha256', signingBytes, independentCert.publicKey, signature.content),
  true,
  'подписът се проверява независимо с публичния ключ от сертификата',
);

// ── 4. Проверката на модула: валиден, подправен PDF, липсващ ключ ───────────────
assert.equal(cms.verifyDetached({ data: pdfBytes, cms: signed.cms }).ok, true, 'verifyDetached приема валиден подпис');
const tampered = Buffer.from(pdfBytes);
tampered[tampered.length - 20] ^= 0xff;
const tamperedVerdict = cms.verifyDetached({ data: tampered, cms: signed.cms });
assert.equal(tamperedVerdict.ok, false, 'подправен PDF не минава');
assert.match(tamperedVerdict.reason, /messageDigest/, 'причината е ясна');
assert.throws(() => cms.signDetached({ data: pdfBytes, certDer: identity.certDer }), /частен ключ/, 'без ключ не се подписва');
assert.throws(() => cms.signDetached({ data: pdfBytes, keyPem: identity.keyPem }), /сертификат/, 'без сертификат не се подписва');

// ── 5. През HTTP: рендер → подпис → проверка ────────────────────────────────────
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-pdf-sign-'));
  const port = await freePort();
  const token = 'pdf-sign-admin-token-123456789';
  const child = spawn(process.execPath, [path.join(root, 'hapi_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), PUBLIC_GATEWAY_PORT: '0', ADMIN_TOKEN: token },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const admin = (p, body) =>
    fetch(base + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
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

    const manifest = {
      profile: 'forensic-full',
      blocks: [
        { id: 's', type: 'rfc3161-start', label: 'START', locked: true },
        { id: 't', type: 'title', value: 'Договор 2026' },
        { id: 'e', type: 'rfc3161-stop', label: 'STOP', locked: true },
      ],
    };
    const renderRes = await admin('/admin/api/v2/reports/render', { manifest, tsa: false });
    assert.equal(renderRes.status, 201, 'PDF-ът се рендира');
    const rendered = Buffer.from(await renderRes.arrayBuffer());
    assert.match(rendered.toString('latin1'), /\/EmbeddedFiles/, 'издаденият отчет носи вградения манифест');
    assert.ok(renderRes.headers.get('x-pdf-sha256'), 'сървърът връща отпечатък на PDF-а');

    const signRes = await admin('/admin/api/v2/reports/sign', {
      pdfBase64: rendered.toString('base64'),
      certPem: identity.certPem,
      keyPem: identity.keyPem,
    });
    assert.equal(signRes.status, 200, 'подписът през HTTP работи: ' + (await signRes.clone().text()).slice(0, 200));
    const signData = await signRes.json();
    assert.equal(signData.detached, true, 'подписът е detached');
    assert.equal(signData.pdfSha256, crypto.createHash('sha256').update(rendered).digest('hex'), 'digest-ът е на рендирания PDF');
    assert.match(signData.note, /Доверието зависи/, 'отговорът не обещава „удостоверен документ“');

    const verifyRes = await admin('/admin/api/v2/cms/verify', {
      dataBase64: rendered.toString('base64'),
      cmsBase64: signData.cmsBase64,
    });
    assert.equal(verifyRes.status, 200, 'проверката през HTTP приема подписа');
    const verdict = await verifyRes.json();
    assert.equal(verdict.ok, true);
    assert.match(verdict.subject, /CN=hAPI Report Signer/);

    const badRes = await admin('/admin/api/v2/cms/verify', {
      dataBase64: Buffer.concat([rendered, Buffer.from('x')]).toString('base64'),
      cmsBase64: signData.cmsBase64,
    });
    assert.equal(badRes.status, 409, 'подправени данни дават 409');

    // Без ключ сървърът отказва; без токен — 401.
    const noKey = await admin('/admin/api/v2/reports/sign', { pdfBase64: rendered.toString('base64'), certPem: identity.certPem });
    assert.equal(noKey.status, 400, 'без ключ няма подпис');
    assert.match(await noKey.text(), /частен ключ/i, 'съобщението казва какво липсва');
    const noToken = await fetch(`${base}/admin/api/v2/reports/sign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(noToken.status, 401, 'подписът иска токен');
    const notPdf = await admin('/admin/api/v2/reports/sign', { pdfBase64: Buffer.from('не е pdf').toString('base64'), certPem: identity.certPem, keyPem: identity.keyPem });
    assert.equal(notPdf.status, 400, 'не-PDF се отказва');

    // Подписът се проверява и от самия модул върху HTTP резултата.
    assert.equal(cms.verifyDetached({ data: rendered, cms: Buffer.from(signData.cmsBase64, 'base64') }).ok, true, 'модулът приема подписа от HTTP');

    // ── 6. Няма фалшиви твърдения в кода ────────────────────────────────────────
    // Целият HTTP слой: отчетите и CMS проверката вече живеят в components (routes/).
    const serverSrc = require('./lib/http-surface.cjs').source(root);
    assert.match(serverSrc, /parts\[3\] === 'reports' && parts\[4\] === 'sign'/, 'сървърът има маршрут за подпис');
    assert.match(serverSrc, /parts\[3\] === 'cms' && parts\[4\] === 'verify'/, 'сървърът има маршрут за проверка');
    verifyNoFakeClaims();

    console.log('PASS pdf-signature: PDF/A-3 структура + вграден манифест · detached CMS (независима проверка) · HTTP рендер→подпис→проверка · без ключ няма подпис');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

/** В издаваното не бива да има „удостоверен PDF“/фалшив сертификат — ADR-0025, т. 5. */
function verifyNoFakeClaims() {
  const files = ['server.js', 'report-render.js', 'pdf-writer.js', 'cms-sign.js', 'x509.js'];
  for (const file of files) {
    const src = fs.readFileSync(path.join(root, 'hapi_enterprise', file), 'utf8');
    assert.equal(/BEGIN CERTIFICATE/.test(src), false, `${file}: няма вграден сертификат в кода`);
    assert.equal(/удостоверен PDF|certified PDF/i.test(src), false, `${file}: няма твърдение „удостоверен PDF“`);
  }
  // PDF/A съответствие не се твърди без валидатор — само структурата.
  const writerSrc = fs.readFileSync(path.join(root, 'hapi_enterprise', 'pdf-writer.js'), 'utf8');
  assert.match(writerSrc, /НЕ се твърди съответствие/, 'кодът изрично казва, че A-3 не се сертифицира от нас');
  void vm;
}
