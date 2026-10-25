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

/** Тялото се строи ПРЕДИ заглавките: сериализация, която се провали, не пипа отговора. */
function json(res, status, obj, headers = {}) {
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
