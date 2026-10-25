'use strict';
// SSE ПОТОК ЗА ЖИВИ СЪБИТИЯ — `GET /admin/api/events/stream` (F4-7, втората половина).
//
// ЗАЩО СЪЩЕСТВУВА
// Webhook-ът (виж `webhooks.js`) е за ИНТЕГРАЦИЯ: тя получава събитието на свой адрес,
// подписано, и може да го обработи, когато не е на линия. Конзолата има друг проблем: тя
// седи отворена пред човека и иска да види „стана нещо“ ВЕДНАГА, без да пита на всеки
// 5 секунди. Затова тук има втори транспорт към СЪЩИТЕ събития — не втори източник на
// истината. Излъчването пак минава през `webhooks.publish(…)`, а потокът само слуша.
//
// КАКВО ПРАВИ
//   • Държи отворен отговор `text/event-stream` и пише `event:`/`data:` редове.
//   • Праща `retry: 5000` и коментар-сърцебиене на 20 s — проксито пред add-on-а (Ingress)
//     затваря тихи връзки, а мълчалив поток изглежда като счупен.
//   • `Last-Event-ID` се уважава: при прекъсване на връзката клиентът получава събитията,
//     които е пропуснал, от пръстена в паметта (последните 200).
//   • Затваря се сам след 30 минути, за да не държи сокет завинаги; клиентът се свързва
//     отново (`EventSource` прави това сам).
//
// КАКВО НЕ ПРАВИ
//   • Не измисля събития и не ги пази на диск: това е ЖИВ поток, не архив. Историята за
//     възстановяване е ограничена до пръстена в паметта и се губи при рестарт — затова
//     `Last-Event-ID` по-стар от пръстена получава `resync`, а не тихо „нищо не е станало“.
//   • Не е публичен: иска администраторски токен/роля, както останалите `/admin/api/…`.
const HEARTBEAT_MS = 20_000;
const MAX_LIFETIME_MS = 30 * 60_000;
const RING_SIZE = 200;

function create(deps = {}) {
  const log = deps.log || { warn() { } };
  // Пръстенът е общ за всички клиенти: едно събитие се помни веднъж, не веднъж на клиент.
  const ring = [];
  const clients = new Set();
  let sequence = 0;

  /** Ново събитие: праща се на всички свързани и се помни за `Last-Event-ID`. */
  function broadcast(event, details = {}) {
    const id = String(++sequence);
    const record = { id, event, at: new Date().toISOString(), details };
    ring.push(record);
    if (ring.length > RING_SIZE) ring.shift();
    const payload = 'id: ' + id + '\nevent: ' + event + '\ndata: ' + JSON.stringify(record) + '\n\n';
    for (const client of clients) {
      try { client.res.write(payload) } catch (e) { log.warn('sse.write.failed', { ns: 'sse', err: e.message }); drop(client) }
    }
    return record;
  }

  function drop(client) {
    if (!clients.delete(client)) return;
    clearInterval(client.beat);
    clearTimeout(client.life);
    try { client.res.end() } catch { /* връзката може вече да е затворена от клиента — това не е грешка */ }
  }

  /**
   * Отваря поток. `lastEventId` идва от заглавката или от `?lastEventId=`; ако е по-стар от
   * пръстена, клиентът получава `resync` и трябва да прочете състоянието наново — по-добре
   * изречено, отколкото пропуснато събитие да мине за „нищо не е станало“.
   */
  function open(req, res, lastEventId) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      // Без това nginx (който Home Assistant слага отпред) буферира потока и той „замръзва“.
      'x-accel-buffering': 'no',
    });
    res.write('retry: 5000\n\n');

    const client = { res, beat: null, life: null };
    clients.add(client);

    const wanted = Number(String(lastEventId || '').trim());
    if (Number.isSafeInteger(wanted) && wanted > 0) {
      const oldest = ring.length ? Number(ring[0].id) : sequence + 1;
      if (wanted < oldest - 1) {
        // Пропуснатото вече не се помни: казваме го, вместо да се правим, че няма нищо.
        res.write('event: resync\ndata: ' + JSON.stringify({ from: wanted, oldest: oldest - 1, at: new Date().toISOString() }) + '\n\n');
      } else {
        for (const record of ring) {
          if (Number(record.id) > wanted) res.write('id: ' + record.id + '\nevent: ' + record.event + '\ndata: ' + JSON.stringify(record) + '\n\n');
        }
      }
    }

    // Сърцебиене: коментар-ред. Клиентът го игнорира, проксито вижда трафик.
    client.beat = setInterval(() => {
      try { res.write(': ping ' + Date.now() + '\n\n') } catch (e) { log.warn('sse.ping.failed', { ns: 'sse', err: e.message }); drop(client) }
    }, HEARTBEAT_MS);
    if (typeof client.beat.unref === 'function') client.beat.unref();

    // Таван на живота: иначе една забравена отметка държи сокет до рестарт.
    client.life = setTimeout(() => {
      try { res.write('event: bye\ndata: {"reason":"lifetime"}\n\n') } catch { /* потокът вече е затворен */ }
      drop(client);
    }, MAX_LIFETIME_MS);
    if (typeof client.life.unref === 'function') client.life.unref();

    req.on('close', () => drop(client));
    return client;
  }

  function stats() {
    return { clients: clients.size, remembered: ring.length, lastId: sequence };
  }

  function closeAll() { for (const client of [...clients]) drop(client) }

  return { broadcast, open, stats, closeAll };
}

module.exports = { create, HEARTBEAT_MS, MAX_LIFETIME_MS, RING_SIZE };
