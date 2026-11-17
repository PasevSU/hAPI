'use strict';
// ОТГОВОРЪТ НА ЗАЯВКА — точно веднъж.
//
// Защо е отделен модул: `server.js` има твърд таван на редовете
// (`tests/server-structure.cjs`), а тези две функции са договор, който се ползва навсякъде
// и трябва да е тестваем без сървър.
//
// Тук са поправени два реални дефекта, намерени в error-log на жива инсталация:
//
//   1. `json()` слагаше заглавките ПРЕДИ да сериализира тялото. Ако `JSON.stringify` хвърли
//      (BigInt, циклична структура), заглавките вече са изпратени, тялото липсва и клиентът
//      вижда празен отговор с код 200. Сега тялото се строи първо — грешката при
//      сериализация става обикновено изключение ПРЕДИ писането и `fail()` може да върне 500.
//
//   2. `fail()` не проверяваше дали отговорът вече е започнал. Всяко хвърляне след успешен
//      отговор даваше `ERR_HTTP_HEADERS_SENT` — втора грешка, която ЗАМАЗВА първата, а в
//      error-log-а оставаха двойки еднакви редове вместо причината. Сега при изпратени
//      заглавки `fail()` само затваря връзката: първият отговор печели.
//
// Точно този модел се виждаше в `error-log.jsonl` на работещ add-on:
//   http/error    Cannot write headers after they are sent to the client
//   process/error Error [ERR_HTTP_HEADERS_SENT] … at json (server.js) at fail (server.js)
const CODE = 'SINGLE_RESPONSE';

/** Непрочетеният остатък от заявката се изхвърля, за да остане връзката използваема. */
function drain(res) {
  const req = res && res.req;
  if (!req || typeof req.resume !== 'function' || req.readableEnded || req.destroyed) return;
  try {
    req.resume();
  } catch {
    /* мъртва връзка: няма какво да се източи и това не е нова грешка */
  }
}

/**
 * Тялото се строи ПРЕДИ заглавките: сериализация, която се провали, не пипа отговора.
 *
 * Остатъкът от заявката се източва ТУК, на границата на отговора: отговор, изпратен преди
 * тялото да е прочетено (401, 404, 409, 413), оставя непрочетени байтове в keep-alive
 * връзката и следващата заявка по нея чака вечно. `resume()` ги изхвърля, без да унищожава
 * сокета — унищожаването е причината 413 да оставя отровена връзка (DEF-92).
 */
function json(res, status, obj, headers = {}) {
  drain(res);
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

/**
 * Грешка като документ (RFC 9457 чрез `problem.js`). Ако отговорът вече е започнал, втори
 * не се пише — връзката се затваря, за да не виси клиентът, а причината остава в лога на
 * извикващия.
 */
function fail(res, status, message) {
  if (res.headersSent) {
    // Отказът НЕ бива да е безмълвен: втори отговор е дефект в извикващия и трябва да се
    // види в лога на add-on-а. Кодът е стабилен, за да се търси с него.
    console.warn('RESPONSE_ALREADY_SENT: втори отговор е отказан (първият вече е изпратен), код ' + Number(status || 0));
    try {
      if (!res.writableEnded) res.end();
    } catch {
      /* връзката вече е мъртва — няма какво да се затвори и това не е нова грешка */
    }
    return;
  }
  json(res, status, require('./problem').body(status, message));
}

module.exports = { CODE, json, fail };
