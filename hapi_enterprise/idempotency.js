'use strict';
// IDEMPOTENCY-KEY — повторена заявка не изпълнява действието втори път (docs/plan/17, F4-5).
//
// ЗАЩО СЪЩЕСТВУВА
// Всички променящи маршрути на admin API-то (качване на файл, преместване между портали,
// изграждане на пакет, подписване) не бяха безопасни за повторение. Ако отговорът се загуби
// — мрежата падне, проксито върне 502, браузърът бъде затворен — клиентът нямаше как да
// попита „мина ли?“ и повторението създаваше ВТОРИ файл, втори пакет, втори запис в одита.
// Заглавката `Idempotency-Key` (IETF draft, използвана от Stripe/Adyen) решава точно това:
// ключът се закача за първия отговор и повторението получава СЪЩИЯ отговор, без работа.
//
// КАКВО ПРАВИ И КАКВО НЕ ПРАВИ
//   • Само при поискване: без заглавката поведението е точно както преди — нула промяна.
//   • Само за `POST/PUT/PATCH/DELETE` под `/admin/api/`. Публичните маршрути не се кешират.
//   • Отпечатъкът включва метода, пътя, заявката И хеша на тялото. Същият ключ с друго тяло
//     е грешка на клиента (422), а не „връщаме стария отговор“ — иначе клиентът щеше да
//     получи потвърждение за действие, което не е извършено.
//   • Ключът се пази ЗАЕДНО СЪС САМОЛИЧНОСТТА на викащия (`sha256` на токена или на
//     Ingress потребителя). Затова чужд ключ не може нито да прочете запазен отговор,
//     нито да заеме ключа и да блокира истинския клиент.
//   • Пази се само JSON отговор до 512 KB. Двоичен или по-голям отговор НЕ се запазва:
//     повторението тогава ще свърши работата отново. Това е записано и в документацията,
//     вместо да се обещава гаранция, която кодът не покрива.
//   • Отговор с код 5xx не се запазва — сървърна грешка не е резултат, а повод за повторение.
//
// Договорът на компонента е същият като на `routes/*.js`: `handle()` връща `true`, когато
// заявката е приключена оттук, и `false`, когато трябва да продължи по нормалния път.
const crypto = require('node:crypto');

const CODE = 'IDEMPOTENCY_KEY';
const MIN_KEY = 8;
const MAX_KEY = 255;
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_STORED_BODY = 512 * 1024;
const METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Печатаеми ASCII знаци без интервал: ключът пътува в заглавка и се пази в базата.
const KEY_PATTERN = /^[\x21-\x7e]{8,255}$/;
const REPLAY_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function create(deps = {}) {
  const store = deps.store;
  const fail = deps.fail;
  const audit = deps.audit;
  const limit = typeof deps.limit === 'function' ? deps.limit : () => 8 * 1024 * 1024;

  const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const warn = (req, event, details) => { if (req && req.log) req.log.warn(event, details) };

  /** Кой пита: отпечатък на токена, иначе на Ingress самоличността, иначе на peer-а. */
  function caller(req) {
    const headers = req.headers || {};
    const token = String(headers.authorization || '').replace(/^Bearer /i, '').trim();
    if (token) return 't:' + sha256(token).slice(0, 16);
    const user = String(headers['x-remote-user-id'] || headers['x-remote-user-name'] || headers['x-remote-user'] || '').trim();
    if (user) return 'u:' + sha256(user).slice(0, 16);
    return 'anon:' + String((req.socket && req.socket.remoteAddress) || 'unknown');
  }

  /**
   * Тялото се прочита ВЕДНЪЖ (за да влезе в отпечатъка) и се връща обратно на четците
   * след нас. Замяната е на самия обект на заявката, защото `for await (const chunk of req)`
   * пита инстанцията, а не прототипа — така `body(req)` в server.js вижда същите байтове.
   */
  async function readBody(req, cap) {
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > cap) throw Object.assign(new Error('Payload too large'), { status: 413 });
      parts.push(chunk);
    }
    const buffer = Buffer.concat(parts);
    Object.defineProperty(req, Symbol.asyncIterator, {
      configurable: true,
      value: async function* replayBody() { if (buffer.length) yield buffer },
    });
    return buffer;
  }

  /**
   * Записва отговора, когато приключи. Заглавките се четат от самия `res` в края, а не от
   * аргументите на `writeHead` — част от маршрутите слагат `Cache-Control` с `setHeader`.
   */
  function capture(req, res, plan) {
    const parts = [];
    let size = 0;
    let tooBig = false;
    const collect = (chunk, encoding) => {
      if (chunk === undefined || chunk === null || tooBig) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8');
      size += buffer.length;
      // Прагът се проверява ПРЕДИ да се пази: иначе пазим отговор, който после не връщаме.
      if (size > MAX_STORED_BODY) { tooBig = true; parts.length = 0; return }
      parts.push(buffer);
    };
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    res.write = function (chunk, encoding, callback) { collect(chunk, encoding); return originalWrite(chunk, encoding, callback) };
    res.end = function (chunk, encoding, callback) {
      if (typeof chunk === 'function') return originalEnd(chunk);
      collect(chunk, encoding);
      return originalEnd(chunk, encoding, callback);
    };
    const settle = () => {
      res.write = originalWrite;
      res.end = originalEnd;
      const status = Number(res.statusCode) || 500;
      const contentType = String(res.getHeader('content-type') || '').toLowerCase();
      // 408/409/429 не са резултат, а „опитай пак“ — запазването им би заключило клиента.
      const retryable = status === 408 || status === 409 || status === 429;
      try {
        if (status >= 500 || retryable || tooBig || !contentType.startsWith('application/json')) {
          // Не може да се върне байт-в-байт → ключът се освобождава, за да не блокира клиента.
          store.forgetIdempotency(plan.key);
          if (req && req.log) req.log.debug('idempotency.not-stored', { status, contentType, tooBig });
          return;
        }
        store.completeIdempotency(plan.key, plan.fingerprint, { status, contentType, body: Buffer.concat(parts) });
      } catch (e) {
        warn(req, 'idempotency.store.failed', { err: e.message });
      }
    };
    res.on('finish', settle);
    // Връзката може да умре преди `finish`: тогава ключът НЕ бива да остава зает 24 часа.
    res.on('close', () => {
      if (res.writableFinished) return;
      try {
        store.forgetIdempotency(plan.key);
      } catch (e) {
        warn(req, 'idempotency.release.failed', { err: e.message });
      }
    });
  }

  function replay(res, row) {
    res.writeHead(Number(row.status), {
      ...REPLAY_HEADERS,
      'Content-Type': row.contentType || 'application/json; charset=utf-8',
      'Idempotency-Replayed': 'true',
    });
    res.end(row.body || '');
  }

  async function handle({ req, res, url, method }) {
    if (!store || !METHODS.has(method)) return false;
    if (!url.pathname.startsWith('/admin/api/')) return false;
    const presented = req.headers['idempotency-key'];
    if (presented === undefined) return false;
    if (typeof presented !== 'string' || !KEY_PATTERN.test(presented)) {
      fail(res, 400, `Invalid Idempotency-Key: ${MIN_KEY}-${MAX_KEY} печатаеми ASCII знака без интервал`);
      return true;
    }
    // Тялото се чете само когато маршрутът и без това би го приел изцяло; иначе 413 идва от него.
    const cap = Math.max(1, Number(limit()) || 0);
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > cap) return false;
    let bytes;
    try {
      bytes = await readBody(req, cap);
    } catch (e) {
      fail(res, e.status || 400, e.message);
      return true;
    }
    const fingerprint = sha256(method + ' ' + url.pathname + url.search + '\n' + sha256(bytes));
    const key = caller(req) + ':' + presented;

    let existing;
    try {
      store.purgeIdempotency(new Date().toISOString());
      existing = store.getIdempotency(key);
    } catch (e) {
      // Базата не отговаря — заявката НЕ се блокира заради това; просто няма гаранция.
      warn(req, 'idempotency.read.failed', { err: e.message });
      return false;
    }

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        void audit('idempotency.conflict', { method, path: url.pathname, reason: 'fingerprint' });
        fail(res, 422, 'Idempotency-Key вече е използван за друга заявка (друг път или друго тяло)');
        return true;
      }
      if (existing.status === null) {
        res.setHeader('Retry-After', '1');
        void audit('idempotency.conflict', { method, path: url.pathname, reason: 'in-progress' });
        fail(res, 409, 'Заявка с този Idempotency-Key още се изпълнява — опитай пак след секунда');
        return true;
      }
      replay(res, existing);
      void audit('idempotency.replay', { method, path: url.pathname, status: existing.status });
      return true;
    }

    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
    let reserved;
    try {
      reserved = store.reserveIdempotency(key, fingerprint, expiresAt);
    } catch (e) {
      warn(req, 'idempotency.reserve.failed', { err: e.message });
      return false;
    }
    if (!reserved) {
      // Между четенето и заемането друг процес е успял — не изпълняваме действието втори път.
      res.setHeader('Retry-After', '1');
      fail(res, 409, 'Заявка с този Idempotency-Key още се изпълнява — опитай пак след секунда');
      return true;
    }
    capture(req, res, { key, fingerprint });
    return false;
  }

  return { handle };
}

module.exports = { create, CODE, MIN_KEY, MAX_KEY, TTL_MS, MAX_STORED_BODY, KEY_PATTERN };
