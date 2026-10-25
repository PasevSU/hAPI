'use strict';
// Webhooks с HMAC — административен компонент на HTTP слоя (F4-7).
//
//   GET    /admin/api/webhooks                 → { ok, enabled, events, subscriptions, pending }
//   POST   /admin/api/webhooks                 { url, events[], label } → 201 + КЛЮЧА (само тук)
//   DELETE /admin/api/webhooks/{id}            → 200 { deleted: true }
//   POST   /admin/api/webhooks/{id}/test       → 200 { delivered, status } — пробна доставка
//   POST   /admin/api/webhooks/{id}/disable    → 200 { disabled: true }
//   POST   /admin/api/webhooks/{id}/enable     → 200 { disabled: false }
//
// Защо съществува: виж `webhooks.js`. Тук е само договорът — кой има право, какво се
// връща и какво НЕ се връща (ключът излиза един път, после само последните 4 знака).
//
// Договор: `handle()` връща `true`, когато заявката е за този компонент (и е приключена),
// и `false`, когато трябва да я поеме следващият компонент.
function create(deps) {
  const { json, fail, parse, audit, adminGate, webhooks } = deps;

  async function handle({ req, res, parts, method }) {
    if (!(parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'webhooks')) return false;
    // Правото е `settings`: абонаментът променя какво излиза от инсталацията, тоест
    // същото ниво като смяна на настройки, не като преглед на портал.
    if (!adminGate(req, res, 'settings', method)) return true;

    // GET /admin/api/webhooks
    if (parts.length === 3 && method === 'GET') {
      json(res, 200, { ok: true, ...webhooks.status() });
      return true;
    }

    // POST /admin/api/webhooks
    if (parts.length === 3 && method === 'POST') {
      if (!webhooks.enabled()) return fail(res, 503, 'Webhooks unavailable (metadata store not open)'), true;
      const body = await parse(req);
      let created;
      try {
        created = webhooks.subscribe({ url: body && body.url, events: body && body.events, label: body && body.label });
      } catch (e) {
        return fail(res, e.status || 400, e.message), true;
      }
      // Ключът се помни в паметта на процеса, за да може веднага да се подписва с него.
      webhooks.remember(created.id, created.secret);
      void audit('webhook.created', { id: created.id, events: created.events.length, host: hostOf(created.url) });
      json(res, 201, {
        ok: true,
        id: created.id,
        url: created.url,
        events: created.events,
        label: created.label,
        createdAt: created.createdAt,
        // ЕДИНСТВЕНОТО място, където ключът се вижда. Записва се от човека/клиента.
        secret: created.secret,
        signatureHeader: webhooks.SIGNATURE_HEADER,
        hint: 'Подписът е HMAC-SHA256 върху "<t>.<тяло>", праща се в X-HAPI-Signature като t=<t>,v1=<hex>.',
      });
      return true;
    }

    if (parts.length < 4) return false;
    const id = parts[3];
    if (!/^wh_[a-f0-9]{18}$/.test(id)) return fail(res, 400, 'Invalid webhook id'), true;

    // DELETE /admin/api/webhooks/{id}
    if (parts.length === 4 && method === 'DELETE') {
      const removed = webhooks.remove(id);
      if (!removed) return fail(res, 404, 'Webhook not found'), true;
      void audit('webhook.deleted', { id });
      json(res, 200, { ok: true, deleted: true });
      return true;
    }

    // POST /admin/api/webhooks/{id}/test
    if (parts.length === 5 && parts[4] === 'test' && method === 'POST') {
      const result = await webhooks.test(id);
      if (result.missing) return fail(res, 404, 'Webhook not found'), true;
      if (result.error) return fail(res, result.status >= 400 ? 502 : 409, 'Test delivery failed: ' + result.error), true;
      json(res, 200, { ok: true, delivered: true, status: result.status });
      return true;
    }

    // POST /admin/api/webhooks/{id}/disable | enable
    if (parts.length === 5 && (parts[4] === 'disable' || parts[4] === 'enable') && method === 'POST') {
      const disabled = parts[4] === 'disable';
      const changed = webhooks.setDisabled(id, disabled);
      if (!changed) return fail(res, 404, 'Webhook not found'), true;
      void audit(disabled ? 'webhook.disabled' : 'webhook.enabled', { id });
      json(res, 200, { ok: true, disabled });
      return true;
    }

    // Път под `/admin/api/webhooks/…`, който не е нито един от горните: не е 404 от
    // общия обработчик, а ясно „този маршрут не съществува“.
    return fail(res, 404, 'Not found'), true;
  }

  /** В лога и одита влиза само хостът: пълният адрес може да носи ключ в пътя. */
  function hostOf(value) {
    try { return new URL(String(value)).host } catch { return '' }
  }

  return { handle };
}

module.exports = { create };
