'use strict';
// Проверка дали един публичен адрес НАИСТИНА се отваря — компонент на HTTP слоя.
//
//   POST /admin/api/links/check   { url } → { ok, status, code, reason, host, address, path, latencyMs }
//
// Защо съществува: подписаният адрес може да е изчислен правилно и пак да не се отвори —
// заради DNS, изтекъл сертификат, затворен порт или защото адресът е вътрешният (Ingress),
// който иска вход в Home Assistant. Дотогава панелът показваше такава връзка без обяснение
// и човек разбираше за проблема чак при получателя. Тук адресът се проверява наистина и
// причината се казва с думи.
//
// Договор: `handle()` връща `true`, когато заявката е за този компонент (и е приключена),
// и `false`, когато трябва да я поеме следващият компонент.
function create(deps) {
  const { json, fail, parse, audit, adminGate, baseUrl, publicBaseUrl } = deps;
  const dns = require('node:dns');
  const TIMEOUT_MS = 5000;
  const MAX_URL = 2048;

  function notMatching(url, method) {
    return url.pathname !== '/admin/api/links/check' || method !== 'POST';
  }

  function hostOf(value) {
    try {
      return new URL(String(value)).host.toLowerCase();
    } catch {
      return '';
    }
  }

  /**
   * Причината с думи. Именно това вижда човекът вместо мъртва връзка, затова
   * текстът казва и какво да се направи, не само кода на грешката.
   */
  function explain(code, status) {
    if (status >= 300 && status < 400) return `пренасочва (${status}) — ползвай крайния адрес`;
    if (status === 401 || status === 403) return 'иска вход или ключ — това не е публичен адрес';
    if (status === 404) return 'страницата не съществува на този адрес';
    if (status === 429) return 'твърде много заявки от този адрес';
    if (status >= 500) return `сървърът отговаря с грешка ${status}`;
    switch (String(code || '')) {
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return 'името не се резолвира (няма такова име в DNS)';
      case 'ECONNREFUSED':
        return 'портът е затворен на този адрес';
      case 'EHOSTUNREACH':
      case 'ENETUNREACH':
        return 'няма път до адреса (мрежа или рутер)';
      case 'ECONNRESET':
        return 'връзката беше прекъсната от сървъра';
      case 'ETIMEDOUT':
      case 'UND_ERR_CONNECT_TIMEOUT':
      case 'TimeoutError':
        return `няма отговор за ${TIMEOUT_MS / 1000} секунди`;
      case 'CERT_HAS_EXPIRED':
        return 'сертификатът е изтекъл';
      case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      case 'SELF_SIGNED_CERT_IN_CHAIN':
        return 'сертификатът е самоподписан — браузърът ще предупреди';
      case 'ERR_TLS_CERT_ALTNAME_INVALID':
        return 'сертификатът не покрива това име';
      case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
        return 'веригата на сертификата не се проверява (липсва междинен сертификат)';
      case '':
        return 'проверката не мина';
      default:
        return `грешка при свързване (${code})`;
    }
  }

  /** Проверката: първо DNS (за да е ясна причината), после истинска HTTP заявка. */
  async function probe(target, u) {
    const started = Date.now();
    const latency = () => Date.now() - started;
    const base = { host: u.host, path: u.pathname, checkedAt: new Date().toISOString() };
    let address = '';
    try {
      const found = await dns.promises.lookup(u.hostname);
      address = found.address || '';
    } catch (e) {
      const code = (e && e.code) || 'ENOTFOUND';
      return { ok: false, status: 0, code, reason: explain(code, 0), ...base, address, latencyMs: latency() };
    }
    try {
      // `Range: 0-0` взима един байт: проверява се достъпът, без да се тегли целият файл.
      const res = await fetch(target, {
        method: 'GET',
        headers: { Range: 'bytes=0-0', 'user-agent': 'hAPI link check' },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const status = res.status;
      if (res.body && typeof res.body.cancel === 'function') await res.body.cancel().catch(() => { });
      const ok = status >= 200 && status < 400;
      return {
        ok,
        status,
        code: ok ? '' : `HTTP_${status}`,
        reason: ok ? (status >= 300 ? explain('', status) : '') : explain('', status),
        ...base,
        address,
        latencyMs: latency(),
      };
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code) || e.name)) || 'ERROR';
      return { ok: false, status: 0, code, reason: explain(code, 0), ...base, address, latencyMs: latency() };
    }
  }

  async function handle({ req, res, url, method }) {
    if (notMatching(url, method)) return false;
    if (!adminGate(req, res, 'portals', method)) return true;
    const b = await parse(req);
    const raw = String((b && b.url) || '').trim();
    if (!raw || raw.length > MAX_URL) {
      fail(res, 400, 'Invalid url');
      return true;
    }
    let u;
    try {
      u = new URL(raw);
    } catch {
      fail(res, 400, 'Invalid url');
      return true;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      fail(res, 400, 'Invalid url');
      return true;
    }
    // Само собствени адреси: проверката не бива да се превръща в начин сървърът да
    // отправя заявки към произволен хост.
    const own = [String(publicBaseUrl() || ''), String(baseUrl(req) || '')]
      .map(hostOf)
      .filter(Boolean);
    if (!own.includes(u.host.toLowerCase())) {
      fail(res, 400, 'Host not allowed');
      return true;
    }
    const out = await probe(raw, u);
    void audit('link.check', { host: out.host, status: out.status, code: out.code });
    return json(res, 200, out);
  }

  return { handle };
}

module.exports = { create };
