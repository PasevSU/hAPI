'use strict';
// ТЯЛОТО НА ЗАЯВКАТА — четене, което не оставя връзката отровена и не губи преиграни байтове.
//
// Защо е отделен модул: `server.js` има твърд таван на редовете (`tests/server-structure.cjs`),
// а тук има две правила, които се дърпат в различни посоки:
//
//   1. `for await (const chunk of req)` прекратява итератора с `stream.destroy()`, щом цикълът
//      излезе с `break`/`throw`. Заявка над лимита получава 413, но сокетът вече е унищожен:
//      при keep-alive СЛЕДВАЩАТА заявка по същата връзка виси вечно, без отговор и без грешка
//      (DEF-92, измерено: 0 на 5 опита).
//
//   2. `idempotency.js` връща тялото на маршрута, като предефинира `req[Symbol.asyncIterator]`
//      върху самия обект на заявката (L73). Там слушатели за `data` НЕ виждат преиграните
//      байтове — потокът вече е свършил, `end` не се излъчва втори път, обещанието никога не
//      се решава и заявката увисва. Затова преиграната заявка се чете през ИТЕРАТОРА.
//
// Остатъкът от непречено тяло се източва в `respond.js` при самия отговор, не тук: всеки
// отговор минава оттам, включително 401/404, при които тялото още не е прочетено.
// Дали някой е подменил итератора: питаме ЗА СОБСТВЕНО свойство, защото обикновеният
// поток също има такъв метод, наследен от прототипа на `Readable`.
function isReplayed(req) {
  return Object.prototype.hasOwnProperty.call(req, Symbol.asyncIterator);
}

const tooLarge = () => Object.assign(new Error('Payload too large'), { status: 413 });

// Преиграното тяло живее в паметта на `idempotency.js`: лимитът тук е проверка за
// последователност, а не защита срещу безкраен поток.
async function readReplayed(req, limit) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw tooLarge();
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

function readStream(req, limit) {
  // Вече изчерпан или мъртъв поток: `end` НЕ се излъчва повторно, затова обещание върху
  // слушатели би чакало вечно. Празното тяло е истината — байтовете са прочетени другаде.
  if (req.readableEnded || req.destroyed) return Promise.resolve(Buffer.alloc(0));
  return new Promise((ok, no) => {
    const parts = [];
    let size = 0;
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      req.off('data', on); req.off('end', end); req.off('error', done);
      // Слушателят се маха, но връзката остава жива: остатъкът се източва при отговора
      // (`respond.js`), вместо да се унищожи сокетът.
      if (err) no(err);
      else ok(value);
    };
    const on = (chunk) => {
      size += chunk.length;
      if (size > limit) done(tooLarge());
      else parts.push(chunk);
    };
    const end = () => done(null, Buffer.concat(parts));
    req.on('data', on); req.on('end', end); req.on('error', done);
  });
}

/** Тялото като Buffer. Хвърля `{ status: 413 }` над лимита и `{ status: 400 }` при отказ. */
function read(req, limit = 65536) {
  return isReplayed(req) ? readReplayed(req, limit) : readStream(req, limit);
}

module.exports = { read, isReplayed };
