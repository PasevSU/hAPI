'use strict';
// DOCFLOW Phase 4.4 — QR/линк dispatch чрез Home Assistant notify.* услуги.
// Изпраща съобщение (обикновено QR линк) през Supervisor core API. Изключено е,
// освен ако има SUPERVISOR_TOKEN (реален add-on runtime) или HAPI_NOTIFY_ENDPOINT
// override (тестове). Услугата се валидира срещу allowlist-формат domain.service,
// за да не може да се извика произволен HA service.
const DEFAULT_ENDPOINT = 'http://supervisor/core/api/services';
const SERVICE_RE = /^([a-z0-9_]+)\.([a-z0-9_]+)$/;

function create({ token = process.env.SUPERVISOR_TOKEN, endpoint = process.env.HAPI_NOTIFY_ENDPOINT || DEFAULT_ENDPOINT } = {}) {
  const enabled = () => !!(token && endpoint);
  return {
    enabled,
    async send(service, target, { title = '', message = '' } = {}) {
      if (!enabled()) throw Object.assign(new Error('Notify dispatch disabled'), { status: 503 });
      const m = SERVICE_RE.exec(String(service || '').trim().toLocaleLowerCase());
      if (!m) throw Object.assign(new Error('Invalid notify service'), { status: 400 });
      const payload = { message: String(message) };
      if (title) payload.title = String(title).slice(0, 200);
      if (target !== undefined && target !== null && target !== '') payload.target = target;
      let res;
      try {
        res = await fetch(endpoint.replace(/\/+$/, '') + '/' + m[1] + '/' + m[2], {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        throw Object.assign(new Error('Notify transport failed'), { status: 502, detail: e.message });
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw Object.assign(new Error('Notify failed'), { status: 502, detail: detail.slice(0, 200) });
      }
      return res.status;
    },
  };
}

module.exports = { create };
