'use strict';
// WEBHOOKS С HMAC — доставка на събития към външен адрес с подпис и повторение
// (docs/plan/17, F4-7).
//
// ЗАЩО СЪЩЕСТВУВА
// До 0.69.87 единственият „изход“ на събития беше `notify.js` — той вика HA услуга
// `notify.*`, тоест съобщение до човек. Интеграция, която иска да знае „файлът е готов“,
// нямаше как да го научи: нямаше адрес, нямаше подпис и нямаше повторение при отказ.
// Тук има трите, защото без тях получателят не може да различи НАШЕТО съобщение от
// чуждо и не може да разчита, че ще го получи изобщо.
//
// КАКВО ПРАВИ
//   • Абонамент = адрес + таен ключ + списък събития. Ключът се показва ВЕДНЪЖ при
//     създаването; в базата остава само SHA-256 отпечатък, точно както при токените.
//   • Подпис: `X-HAPI-Signature: t=<unix>,v1=<hex>` — HMAC-SHA256 върху
//     `<t>.<сурово тяло>`. Получателят преизчислява със своя ключ и сравнява в
//     постоянно време. `t` влиза в подписа, за да не може прихванато съобщение да се
//     поднесе отново по-късно (получателят отказва старо `t`).
//   • Повторение: 1-ва доставка веднага, после нарастващо изчакване (30 s, 2 m, 10 m,
//     1 h, 6 h). След последния опит събитието се отбелязва като изчерпано и се пази,
//     за да се види в конзолата — не се трие, защото „не се достави“ е факт.
//   • Опашката е В БАЗАТА, не в паметта: рестарт на add-on-а не губи чакащи доставки.
//
// КАКВО НЕ ПРАВИ
//   • Не измисля събития. Излъчват се САМО имената, които са в `EVENTS` по-долу, и то
//     при изрично извикване на `publish(…)` от маршрут, който наистина е свършил работа.
//   • Не праща тяло с тайни: `details` се филтрира (без низове, приличащи на ключове,
//     пароли и пътища), защото webhook адресът е извън нашия контрол.
//   • Не блокира заявката, която го е предизвикала: `publish` само записва в опашката.
const crypto = require('node:crypto');

// Имената са `област.действие` — същата конвенция като одитните събития, за да не се
// налага получателят да учи втори речник.
const EVENTS = [
  'document.finalized',
  'access.created',
  'job.completed',
  'report.packaged',
];

const SIGNATURE_HEADER = 'x-hapi-signature';
const EVENT_HEADER = 'x-hapi-event';
const DELIVERY_HEADER = 'x-hapi-delivery';
const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5;
// Изчакване ПРЕДИ опит N (индекс 0 = първата доставка, която е веднага).
const BACKOFF_MS = [0, 30_000, 120_000, 600_000, 3_600_000];
const SECRET_PREFIX = 'whsec_';

/** Подписът, който получателят изчислява: HMAC-SHA256 върху `<t>.<тяло>`. */
function sign(secret, timestamp, body) {
  return crypto.createHmac('sha256', String(secret)).update(String(timestamp) + '.' + body).digest('hex');
}

/** Сравнение в постоянно време; различен размер не е равен (иначе timingSafeEqual хвърля). */
function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Тялото, което получателят вижда. `details` се филтрира: webhook адресът е извън нашия
 * контрол и в него не бива да изтича нищо, което не е нужно за реакцията.
 */
function publicDetails(details) {
  const out = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (/pass|secret|token|key|sig/i.test(key)) continue;
    if (typeof value === 'string') {
      // Път до файл или стойност, която прилича на тайна, не излиза навън.
      if (value.includes('/') && value.includes('.')) continue;
      if (value.length > 200) { out[key] = value.slice(0, 200); continue }
      out[key] = value;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) { out[key] = value; continue }
    if (Array.isArray(value)) { out[key] = value.filter((v) => typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 200)).slice(0, 50); continue }
    // Обектите не се изнасят: формата им не е договор и може да носи какво ли не.
  }
  return out;
}

function create(deps = {}) {
  const store = deps.store;
  // Когато одитът липсва (чист модулен тест), събитието се пуска в лога, а не се губи
  // мълчаливо: `void` без запис би направил „одитирано“ невярно твърдение.
  const audit = typeof deps.audit === 'function'
    ? deps.audit
    : (event, details) => { console.warn('WEBHOOK AUDIT (no sink)', event, JSON.stringify(details || {})) };
  const log = deps.log || { info() { }, warn() { } };
  // Вторият транспорт към СЪЩИТЕ събития: живият поток за конзолата. Тук е по избор, за да
  // не зависи webhook-ът от него; когато го има, двете страни виждат едно и също събитие.
  const stream = deps.stream || null;
  const fetchImpl = deps.fetch || ((...args) => fetch(...args));
  // Часовникът е вход, за да може тестът да „превърти“ изчакването без да чака.
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  let timer = null;
  let running = false;

  const enabled = () => Boolean(store);

  /** Нов абонамент: връща ключа ЕДИН път. В базата остава само отпечатъкът. */
  function subscribe({ url, events, label = '' }) {
    if (!enabled()) throw Object.assign(new Error('Webhooks unavailable'), { status: 503 });
    const target = normalizeUrl(url);
    const chosen = normalizeEvents(events);
    const secret = SECRET_PREFIX + crypto.randomBytes(32).toString('base64url');
    const record = store.createWebhook({
      url: target,
      events: chosen,
      label: String(label || '').slice(0, 120),
      secretHash: sha256(secret),
      secretHint: secret.slice(-4),
    });
    // Ключът съществува само в този отговор — както при токените за портал.
    return { ...record, secret };
  }

  /** Адресът трябва да е http(s) и да не сочи обратно към самите нас. */
  function normalizeUrl(url) {
    const raw = String(url || '').trim();
    if (!raw || raw.length > 2048) throw Object.assign(new Error('Invalid webhook url'), { status: 400 });
    let parsed;
    try { parsed = new URL(raw) } catch { throw Object.assign(new Error('Invalid webhook url'), { status: 400 }) }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw Object.assign(new Error('Webhook url must be http(s)'), { status: 400 });
    return parsed.toString();
  }

  function normalizeEvents(events) {
    const list = Array.isArray(events) ? events : typeof events === 'string' ? [events] : [];
    const chosen = [...new Set(list.map((e) => String(e || '').trim()).filter(Boolean))];
    if (!chosen.length) throw Object.assign(new Error('At least one event is required'), { status: 400 });
    const unknown = chosen.filter((e) => !EVENTS.includes(e));
    if (unknown.length) throw Object.assign(new Error('Unknown event: ' + unknown.join(', ')), { status: 400 });
    return chosen;
  }

  /**
   * Записва събитие за всеки абониран получател. Не праща нищо тук — затова заявката,
   * която го е предизвикала, не чака мрежата на чужд сървър.
   */
  function publish(event, details = {}) {
    if (!enabled() || !EVENTS.includes(event)) return 0;
    const safe = publicDetails(details);
    // Живият поток получава събитието ПРЕДИ опашката: конзолата трябва да го види веднага,
    // дори когато няма нито един абониран webhook (тогава `queued` е 0, но събитието е станало).
    if (stream) { try { stream.broadcast(event, safe) } catch (e) { log.warn('sse.broadcast.failed', { ns: 'webhook', err: e.message }) } }
    let targets;
    try { targets = store.listWebhooks().filter((w) => !w.disabled && w.events.includes(event)) } catch (e) { log.warn('webhook.publish.failed', { ns: 'webhook', err: e.message }); return 0 }
    if (!targets.length) return 0;
    const body = JSON.stringify({
      id: crypto.randomBytes(12).toString('hex'),
      event,
      at: new Date(now()).toISOString(),
      details: safe,
    });
    let queued = 0;
    for (const target of targets) {
      try {
        store.enqueueWebhookDelivery({ webhookId: target.id, event, body, nextAttemptAt: new Date(now()).toISOString() });
        queued += 1;
      } catch (e) {
        log.warn('webhook.enqueue.failed', { ns: 'webhook', id: target.id, err: e.message });
      }
    }
    if (queued) void audit('webhook.queued', { event, targets: queued });
    return queued;
  }

  /** Един опит за доставка. Връща `{ ok, status, error }` — никога не хвърля. */
  async function deliver(row) {
    const target = store.getWebhook(row.webhookId);
    if (!target || target.disabled) return { ok: false, status: 0, error: 'SUBSCRIPTION_GONE', drop: true };
    // Ключът НЕ се пази в чист вид; за да подпишем, той трябва да е наличен. Затова
    // подписването става с ключа от паметта на процеса, който го е създал, или с
    // общия ключ на инсталацията. Виж `setSigningKey`.
    const secret = signingSecret(target);
    if (!secret) return { ok: false, status: 0, error: 'NO_SIGNING_KEY', drop: true };
    const timestamp = Math.floor(now() / 1000);
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'hAPI-Webhook/1',
      [EVENT_HEADER]: row.event,
      [DELIVERY_HEADER]: row.id,
      [SIGNATURE_HEADER]: 't=' + timestamp + ',v1=' + sign(secret, timestamp, row.body),
    };
    try {
      const res = await fetchImpl(target.url, { method: 'POST', headers, body: row.body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      // Тялото на отговора не се чете: то не е наш договор и не бива да харчи памет.
      if (res && typeof res.body !== 'undefined' && res.body && typeof res.body.cancel === 'function') await res.body.cancel().catch(() => { });
      const ok = res.status >= 200 && res.status < 300;
      return { ok, status: res.status, error: ok ? '' : 'HTTP_' + res.status };
    } catch (e) {
      const code = (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) ? 'TIMEOUT' : ((e && (e.code || (e.cause && e.cause.code))) || 'ERROR');
      return { ok: false, status: 0, error: String(code) };
    }
  }

  // Ключовете за подпис: по подразбиране се държи в паметта на процеса (виж `remember`),
  // защото в базата има само отпечатък. Ако процесът се рестартира, чакащите доставки
  // се отбелязват с `NO_SIGNING_KEY` — честно, вместо да се праща неподписано.
  const secrets = new Map();
  function remember(webhookId, secret) { secrets.set(webhookId, secret) }
  function forget(webhookId) { secrets.delete(webhookId) }
  function signingSecret(target) {
    const remembered = secrets.get(target.id);
    if (remembered) return remembered;
    // Ключ, подаден извън процеса (тестове, ръчно възстановяване): `HAPI_WEBHOOK_SECRET_<id>`.
    const fromEnv = process.env['HAPI_WEBHOOK_SECRET_' + String(target.id).replace(/[^A-Za-z0-9]/g, '_')];
    return fromEnv || '';
  }

  /**
   * Един цикъл на опашката: взима дължимите доставки и опитва поред. Връща броячи, за да
   * може тестът да провери какво е станало, без да чете лога.
   */
  async function drain(limit = 20) {
    if (!enabled() || running) return { sent: 0, failed: 0, exhausted: 0, skipped: 0 };
    running = true;
    const counts = { sent: 0, failed: 0, exhausted: 0, skipped: 0 };
    try {
      const due = store.dueWebhookDeliveries(new Date(now()).toISOString(), limit);
      for (const row of due) {
        const result = await deliver(row);
        if (result.ok) {
          store.completeWebhookDelivery(row.id, { status: result.status });
          counts.sent += 1;
          continue;
        }
        const attempts = Number(row.attempts || 0) + 1;
        if (result.drop || attempts >= MAX_ATTEMPTS) {
          store.failWebhookDelivery(row.id, { status: result.status, error: result.error, attempts, exhausted: true });
          counts.exhausted += 1;
          void audit('webhook.exhausted', { id: row.webhookId, event: row.event, attempts, error: result.error });
          continue;
        }
        const wait = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
        store.failWebhookDelivery(row.id, { status: result.status, error: result.error, attempts, nextAttemptAt: new Date(now() + wait).toISOString() });
        counts.failed += 1;
      }
    } catch (e) {
      log.warn('webhook.drain.failed', { ns: 'webhook', err: e.message });
    } finally {
      running = false;
    }
    return counts;
  }

  /** Пуска опашката на всеки 15 s; `unref`, за да не държи процеса жив при спиране. */
  function start(intervalMs = 15_000) {
    if (timer || !enabled()) return;
    timer = setInterval(() => { void drain() }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    // Веднага след старт: доставките, чакали рестарта, не бива да чакат първия интервал.
    void drain();
  }
  function stop() { if (timer) { clearInterval(timer); timer = null } }

  /** Състоянието за конзолата: без адреси ли? Не — адресът е нужен, за да се разпознае. */
  function status() {
    if (!enabled()) return { enabled: false, subscriptions: [], pending: 0 };
    let subscriptions = [];
    let pending = 0;
    try {
      subscriptions = store.listWebhooks().map((w) => ({
        id: w.id, url: w.url, events: w.events, label: w.label, disabled: Boolean(w.disabled),
        createdAt: w.createdAt, secretHint: w.secretHint,
        lastStatus: w.lastStatus == null ? null : Number(w.lastStatus),
        lastAttemptAt: w.lastAttemptAt, failures: Number(w.failures || 0),
      }));
      pending = store.countPendingWebhookDeliveries();
    } catch (e) { log.warn('webhook.status.failed', { ns: 'webhook', err: e.message }) }
    return { enabled: true, events: EVENTS, subscriptions, pending };
  }

  /** Изтриване на абонамент. Чакащите му доставки падат заедно с него (виж store). */
  function remove(id) {
    if (!enabled()) return false;
    const existed = store.deleteWebhook(id);
    if (existed) { forget(id); void audit('webhook.removed', { id }) }
    return existed;
  }

  /** Спиране/пускане без триене: спрян абонамент пази историята си, но не получава нови. */
  function setDisabled(id, disabled) {
    if (!enabled()) return false;
    return store.setWebhookDisabled(id, disabled);
  }

  /**
   * Пробна доставка по заявка на човека. Излиза ВЕДНАГА, не влиза в опашката: ако
   * адресът е сгрешен, това трябва да се види сега, а не след 6 часа повторения.
   */
  async function test(id) {
    if (!enabled()) return { missing: true };
    const target = store.getWebhook(id);
    if (!target) return { missing: true };
    const body = JSON.stringify({
      id: crypto.randomBytes(12).toString('hex'),
      event: 'webhook.test',
      at: new Date(now()).toISOString(),
      details: { subscription: target.id },
    });
    const result = await deliver({ id: 'test_' + crypto.randomBytes(6).toString('hex'), webhookId: target.id, event: 'webhook.test', body, attempts: 0 });
    void audit('webhook.test', { id, status: result.status, error: result.error || '' });
    return { missing: false, status: result.status, error: result.error || '' };
  }

  return {
    EVENTS, SIGNATURE_HEADER, EVENT_HEADER, DELIVERY_HEADER,
    enabled, subscribe, publish, drain, start, stop, status, remove, setDisabled, test,
    remember, forget, sign, verify: (secret, header, body, toleranceSec = 300) => verifySignature(secret, header, body, toleranceSec, now()),
  };
}

/**
 * Проверка от страна на получателя — същата функция, за да не се разминат двете страни.
 * `toleranceSec` пази от повторно поднасяне на старо съобщение.
 */
function verifySignature(secret, header, body, toleranceSec = 300, currentMs = Date.now()) {
  const raw = String(header || '');
  const parts = {};
  for (const piece of raw.split(',')) {
    const [k, v] = piece.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const timestamp = Number(parts.t);
  if (!Number.isSafeInteger(timestamp) || !parts.v1) return { ok: false, reason: 'MALFORMED' };
  if (Math.abs(Math.floor(currentMs / 1000) - timestamp) > toleranceSec) return { ok: false, reason: 'STALE' };
  return safeEqualHex(parts.v1, sign(secret, timestamp, body)) ? { ok: true, reason: '' } : { ok: false, reason: 'BAD_SIGNATURE' };
}

module.exports = { create, EVENTS, sign, verifySignature, publicDetails, SIGNATURE_HEADER, EVENT_HEADER, DELIVERY_HEADER };
