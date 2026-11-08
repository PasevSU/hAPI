'use strict';
// SSE поток — административен компонент на HTTP слоя (F4-7, живата половина).
//
//   GET  /admin/api/events/stream[?lastEventId=N | ?ticket=<билет>]   → text/event-stream
//   GET  /admin/api/events                                             → { clients, remembered, lastId }
//   POST /admin/api/events/ticket                                      → { ticket, expiresIn }
//
// Защо съществува: виж `event-stream.js`. Тук е само договорът — кой има право и какво
// връща. Правото е `metrics` (само за четене): потокът НЕ позволява нищо, само показва.
//
// Защо има билет (0.69.206): `EventSource` не може да слага заглавка `Authorization`, а
// `?token=` слагаше ДЪЛГОТРАЙНИЯ администраторски ключ в историята на браузъра, в
// `Referer`, в логовете на проксито и в одита. Затова адресът носи само ЕДНОКРАТЕН билет:
// случаен низ, който важи `SSE_TICKET_TTL_MS` (30 s) и се изразходва при първото отваряне.
// Билетът не дава нищо друго — само едно отваряне на потока.
//
// Договор: `handle()` връща `true`, когато заявката е за този компонент (и е приключена),
// и `false`, когато трябва да я поеме следващият компонент.
const crypto = require('node:crypto');

function create(deps) {
  const { json, fail, adminGate, stream } = deps;

  // Срокът може да се скъси само за тестове (`SSE_TICKET_TTL_MS`); подразбирането е 30 s.
  const ttlMs = Math.max(20, Number(process.env.SSE_TICKET_TTL_MS) || 30000);
  const MAX_PENDING = 64;
  const tickets = new Map();

  const prune = (now) => {
    for (const [key, expiresAt] of tickets) if (expiresAt <= now) tickets.delete(key);
  };
  function issue() {
    const now = Date.now();
    prune(now);
    // Таван на чакащите билети: иначе отворена сесия може да трупа безкрайно.
    while (tickets.size >= MAX_PENDING) tickets.delete(tickets.keys().next().value);
    const ticket = crypto.randomBytes(24).toString('hex');
    tickets.set(ticket, now + ttlMs);
    return ticket;
  }
  function consume(ticket) {
    const expiresAt = tickets.get(ticket);
    tickets.delete(ticket);
    return Boolean(expiresAt) && expiresAt > Date.now();
  }

  async function handle({ req, res, url, parts, method }) {
    if (!(parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'events')) return false;

    // POST /admin/api/events/ticket — билет за едно отваряне на потока.
    if (parts.length === 4 && parts[3] === 'ticket') {
      if (method !== 'POST') return fail(res, 404, 'Not found'), true;
      if (!adminGate(req, res, 'metrics', method)) return true;
      json(res, 200, { ok: true, ticket: issue(), expiresIn: Math.ceil(ttlMs / 1000), expiresInMs: ttlMs });
      return true;
    }

    // Потокът приема ИЛИ заглавка `Authorization`, ИЛИ еднократен `?ticket=`. Токен в
    // адреса не се приема — нито тук, нито другаде (вж. `tests/sse-ticket.cjs`).
    if (parts.length === 4 && parts[3] === 'stream' && method === 'GET') {
      const ticket = url.searchParams.get('ticket');
      if (ticket && !consume(ticket)) return fail(res, 401, 'Invalid ticket'), true;
      if (!ticket && !adminGate(req, res, 'metrics', method)) return true;
      // `Last-Event-ID` е заглавката на `EventSource`; `?lastEventId=` е за ръчна проверка
      // с `curl`, където заглавка не се слага лесно.
      const lastEventId = req.headers['last-event-id'] || url.searchParams.get('lastEventId') || '';
      stream.open(req, res, lastEventId);
      return true;
    }

    if (!adminGate(req, res, 'metrics', method)) return true;

    // GET /admin/api/events — състоянието на потока (за диагностика, без да се отваря).
    if (parts.length === 3 && method === 'GET') {
      json(res, 200, { ok: true, ...stream.stats() });
      return true;
    }

    return fail(res, 404, 'Not found'), true;
  }

  return { handle };
}

module.exports = { create };
