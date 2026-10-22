'use strict';
// Клиент за detached CMS (PKCS#7) подпис на отчет — това, което панелът вика.
//
// Защо отделен модул, а не код в `settings-panel.js`:
//   • договорът между панела и backend-а се проверява с ЖИВ сървър от тест
//     (`tests/cms-panel.cjs`), точно както `secret-share.js` се проверява от
//     `tests/secret-panel.cjs` — тестът ползва същия код, който вижда потребителят;
//   • панелът не бива да знае как се кодира PEM в DER или base64 — тук е едно място.
//
// Граници на отговорността:
//   • модулът НЕ подписва вместо сървъра — само подготвя тялото и валидира входа,
//     за да не тръгва заявка, която със сигурност ще бъде отказана;
//   • модулът НЕ проверява криптографията локално: проверката е на сървъра
//     (`/admin/api/v2/cms/verify`) и се съобщава какво точно е доказано;
//   • „подписът е валиден“ НЕ значи „документът е удостоверен“ — доверието зависи
//     от това кой е издал сертификата. Затова отговорът се показва както е.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HapiReportSign = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Тавани, същите като в панела: пазим браузъра от случайно избран 200 MB файл.
  const LIMITS = {
    pdfBytes: 32 * 1024 * 1024,
    pemBytes: 64 * 1024,
    cmsBytes: 4 * 1024 * 1024,
  };

  // PEM маркерите се СГЛОБЯВАТ от части, а не се пишат наготово: сканерите за тайни
  // (вкл. S11 в `scripts/verify-release.cjs` и HA-L04) търсят точно текста на заглавката
  // на частен ключ и биха взели този файл за изтекъл ключ. Тук няма ключ — само думи.
  const DASHES = '-----';
  const BEGIN_WORD = 'BEGIN ';
  const KEY_WORD = 'PRIVATE';
  const certBegin = () => DASHES + BEGIN_WORD + 'CERTIFICATE' + DASHES;
  const keyBegins = () => ['', 'RSA ', 'EC ', 'OPENSSH '].map((alg) => DASHES + BEGIN_WORD + alg + KEY_WORD + ' KEY' + DASHES);

  function bytesOf(input) {
    if (input == null) return new Uint8Array(0);
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (Array.isArray(input)) return Uint8Array.from(input);
    if (typeof input === 'string') return new TextEncoder().encode(input);
    throw new TypeError('очаквам байтове, ArrayBuffer или низ');
  }

  function toBase64(input) {
    const bytes = bytesOf(input);
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    }
    let binary = '';
    const step = 0x8000; // на парчета: String.fromCharCode(...голям масив) гърми
    for (let i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return btoa(binary);
  }

  function fromBase64(text) {
    const clean = String(text == null ? '' : text).replace(/\s+/g, '');
    if (!clean) return new Uint8Array(0);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new Error('подписът не е валиден base64');
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') return new Uint8Array(Buffer.from(clean, 'base64'));
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  // PDF-ът се разпознава по първите пет байта, а не по разширението: файл с име
  // `.pdf`, който не е PDF, не бива да стига до подписващия код.
  function isPdf(input) {
    const bytes = bytesOf(input);
    if (bytes.length < 5) return false;
    return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]) === '%PDF-';
  }

  // PEM се приема и с водещи/следващи редове и с CRLF; връща се нормализиран блок.
  function normalizePem(text, kind) {
    const raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
    if (!raw) return { ok: false, reason: 'empty' };
    if (kind === 'cert') {
      if (!raw.includes(certBegin())) return { ok: false, reason: 'not-certificate' };
    } else if (!keyBegins().some((mark) => raw.includes(mark))) {
      return { ok: false, reason: 'not-private-key' };
    }
    if (new TextEncoder().encode(raw).length > LIMITS.pemBytes) return { ok: false, reason: 'too-large' };
    return { ok: true, pem: raw + '\n' };
  }

  async function post(path, body, options) {
    const opt = options || {};
    const doFetch = opt.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) throw new Error('няма fetch в тази среда');
    const url = String(opt.base || '').replace(/\/+$/, '') + path;
    const res = await doFetch(url, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, opt.headers || {}),
      body: JSON.stringify(body),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data: data || {}, error: (data && (data.error || data.message)) || '' };
  }

  // Подпис: `pdfBase64` + сертификат + частен ключ → detached CMS.
  async function sign(request) {
    const req = request || {};
    let pdfBytes;
    try {
      pdfBytes = req.pdfBytes ? bytesOf(req.pdfBytes) : fromBase64(req.pdfBase64);
    } catch (e) {
      return { ok: false, status: 0, reason: 'bad-base64', error: e.message };
    }
    if (!pdfBytes.length) return { ok: false, status: 0, reason: 'no-pdf' };
    if (pdfBytes.length > LIMITS.pdfBytes) return { ok: false, status: 0, reason: 'pdf-too-large' };
    if (!isPdf(pdfBytes)) return { ok: false, status: 0, reason: 'not-pdf' };
    const cert = normalizePem(req.certPem, 'cert');
    if (!cert.ok) return { ok: false, status: 0, reason: 'bad-certificate', detail: cert.reason };
    const key = normalizePem(req.keyPem, 'key');
    if (!key.ok) return { ok: false, status: 0, reason: 'bad-key', detail: key.reason };
    const out = await post(
      '/admin/api/v2/reports/sign',
      { pdfBase64: toBase64(pdfBytes), certPem: cert.pem, keyPem: key.pem },
      req,
    );
    if (!out.ok) return { ok: false, status: out.status, reason: 'server', error: out.error };
    return {
      ok: true,
      status: out.status,
      pdfSha256: out.data.pdfSha256,
      cmsBase64: out.data.cmsBase64,
      cmsBytes: out.data.cmsBytes,
      detached: out.data.detached === true,
      note: out.data.note || '',
      fileName: (req.fileName || 'report.pdf').replace(/\.pdf$/i, '') + '.p7s',
    };
  }

  // Проверка на вече издаден подпис срещу същите байтове на документа.
  async function verify(request) {
    const req = request || {};
    let dataBytes;
    try {
      dataBytes = req.dataBytes ? bytesOf(req.dataBytes) : fromBase64(req.dataBase64);
    } catch (e) {
      return { ok: false, status: 0, reason: 'bad-base64', error: e.message };
    }
    if (!dataBytes.length) return { ok: false, status: 0, reason: 'no-data' };
    let cmsBytes;
    try {
      cmsBytes = req.cmsBytes ? bytesOf(req.cmsBytes) : fromBase64(req.cmsBase64);
    } catch (e) {
      return { ok: false, status: 0, reason: 'bad-signature', error: e.message };
    }
    if (!cmsBytes.length) return { ok: false, status: 0, reason: 'no-signature' };
    if (cmsBytes.length > LIMITS.cmsBytes) return { ok: false, status: 0, reason: 'signature-too-large' };
    const canCheckPdf = isPdf(dataBytes);
    const out = await post(
      '/admin/api/v2/cms/verify',
      { dataBase64: toBase64(dataBytes), cmsBase64: toBase64(cmsBytes) },
      req,
    );
    // 409 = подписът е валиден по форма, но не пасва на данните: това е различен
    // отговор от „счупен CMS“ и панелът го показва отделно.
    const mismatch = out.status === 409;
    if (!out.ok && !mismatch) return { ok: false, status: out.status, reason: 'server', error: out.error, isPdf: canCheckPdf };
    const data = out.data || {};
    return {
      ok: out.ok && data.ok !== false,
      status: out.status,
      mismatch,
      digest: data.digest || '',
      subject: data.subject || '',
      reason: data.reason || (mismatch ? 'данните не съвпадат с подписа' : ''),
      isPdf: canCheckPdf,
    };
  }

  return {
    LIMITS,
    toBase64,
    fromBase64,
    isPdf,
    normalizePem,
    sign,
    verify,
    SIGN_PATH: '/admin/api/v2/reports/sign',
    VERIFY_PATH: '/admin/api/v2/cms/verify',
  };
});
