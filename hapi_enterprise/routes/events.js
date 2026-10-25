'use strict';
// SSE поток — административен компонент на HTTP слоя (F4-7, живата половина).
//
//   GET /admin/api/events/stream[?lastEventId=N]   → text/event-stream
//   GET /admin/api/events                          → { clients, remembered, lastId }
//
// Защо съществува: виж `event-stream.js`. Тук е само договорът — кой има право и какво
// връща. Правото е `metrics` (само за четене): потокът НЕ позволява нищо, само показва.
//
// Договор: `handle()` връща `true`, когато заявката е за този компонент (и е приключена),
// и `false`, когато трябва да я поеме следващият компонент.
function create(deps) {
  const { json, fail, adminGate, stream } = deps;

  async function handle({ req, res, url, parts, method }) {
    if (!(parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'events')) return false;
    // `EventSource` в браузъра не може да слага `Authorization`. Затова САМО за потока
    // токенът може да дойде като `?token=` и се прехвърля в заглавката, преди да мине
    // `adminGate` — така проверката е ЕДНА, а не втора, по-слаба.
    if (parts.length === 4 && parts[3] === 'stream' && !req.headers.authorization) {
      const given = url.searchParams.get('token');
      if (given) req.headers.authorization = 'Bearer ' + given;
    }
    if (!adminGate(req, res, 'metrics', method)) return true;

    // GET /admin/api/events — състоянието на потока (за диагностика, без да се отваря).
    if (parts.length === 3 && method === 'GET') {
      json(res, 200, { ok: true, ...stream.stats() });
      return true;
    }

    if (parts.length === 4 && parts[3] === 'stream' && method === 'GET') {
      // `Last-Event-ID` е заглавката на `EventSource`; `?lastEventId=` е за ръчна проверка
      // с `curl`, където заглавка не се слага лесно.
      const lastEventId = req.headers['last-event-id'] || url.searchParams.get('lastEventId') || '';
      stream.open(req, res, lastEventId);
      return true;
    }

    return fail(res, 404, 'Not found'), true;
  }

  return { handle };
}

module.exports = { create };
