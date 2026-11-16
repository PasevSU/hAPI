'use strict';
// ETag И 304 ЗА СТАТИКАТА (DEF-88, 0.69.227).
//
// Защо съществува: след DEF-87 файловете с версия в адреса се кешират за година, но този,
// който НЕ носи версия (HTML страницата, стар таб, ръчна заявка, вграден преглед) получава
// `no-cache` — тоест браузърът пита пак и без ETag взима ЦЯЛОТО тяло. Измерено: `ui/index.html`
// е 40 KB, а 34-те ресурса се четат от диска при ВСЯКА заявка (`fs.readFileSync` в диспечера).
//
// Днес: тялото се чете веднъж и остава в паметта (общо ~1 MB за панела), а ETag е sha256 от
// СЪДЪРЖАНИЕТО — при `If-None-Match` отговорът е `304` без тяло. Версията в адреса пак остава
// основният механизъм; ETag е за адресите без версия, за да не се плаща два пъти за тях.
const crypto = require('node:crypto');
const fs = require('node:fs');

/** Етикет от съдържанието: 27 знака base64url са ~162 бита — достатъчно за сверка, не за подпис. */
const tagOf = (body) => '"' + crypto.createHash('sha256').update(body).digest('base64url').slice(0, 27) + '"';

// Ключът е пътят на файла (или собствено име за тяло в паметта), а стойността пази тялото и
// етикета. Пази се ЗА ЦЕЛИЯ живот на процеса: файловете са част от изданието и се сменят само
// с обновяване, при което процесът стартира наново.
const entries = new Map();

/**
 * Тяло и ETag за файл. `transform` се прилага ВЕДНЪЖ (така HTML-ът получава версия в адреса
 * на ресурсите си) и влиза в етикета — тоест етикетът описва ТОВА, което се сервира.
 */
function load(file, transform = null) {
  if (!entries.has(file)) {
    const raw = fs.readFileSync(file);
    const body = transform ? Buffer.from(transform(raw.toString('utf8')), 'utf8') : raw;
    entries.set(file, { body, etag: tagOf(body) });
  }
  return entries.get(file);
}

/** `If-None-Match` може да носи списък или `*`; сравнява се точно, не „съдържа“. */
function matches(req, etag) {
  const header = String((req && req.headers && req.headers['if-none-match']) || '').trim();
  if (!header) return false;
  if (header === '*') return true;
  return header.split(',').some((value) => value.trim() === etag);
}

module.exports = { load, matches, tagOf };
