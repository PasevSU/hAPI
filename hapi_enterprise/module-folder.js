'use strict';
// ЕДНА ПАПКА КОМПОНЕНТИ — ЕДНО ПРАВИЛО ЗА ИМЕНА (0.69.224).
//
// Защо съществува: `server-modules.js` (HTTP сегменти) и `core.js` (глобални функции) имаха
// ДВЕ копия на едно и също правило — кой файл се зарежда (`ELIGIBLE`), какво се прави с файл,
// който се вижда, но не се зарежда (DEF-72: стартът спира и ги ИЗБРОЯВА), и какво става с
// празна папка. Двете копия се разминават тихо при първата промяна, внесена само в едното.
//
// Тук е САМО откриването на файловете. Договорът на компонента остава в двата зареждащи
// модула, защото е различен по същност: `server_module/` дава `handle(ctx)`, а `core_module/`
// дава `fn` от функции.
const fs = require('node:fs');

/** Само `*.js` на първо ниво: без подпапки, без шаблони, без точки и долни черти в името. */
const ELIGIBLE = /^[a-z0-9][a-z0-9-]*\.js$/;

/**
 * Файловете, които наистина се зареждат, в предвидим ред.
 * @param {string} dir папката с компонентите
 * @param {string} label името, с което се съобщава грешката (`server_module`, `core`)
 * @returns {string[]} имената на файловете, сортирани
 */
function scan(dir, label) {
  if (!dir || !fs.existsSync(dir)) throw new Error(label + ': липсва папката ' + dir);
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile());
  // DEF-72: файл, който СЕ ВИЖДА в папката, но не се зарежда, е по-лош от липсващ — той
  // изглежда като работещ компонент, а маршрутът му дава 404. Затова стартът СПИРА с името.
  const bogus = entries
    .map((entry) => entry.name)
    .filter((name) => /\.js$/i.test(name) && !ELIGIBLE.test(name));
  if (bogus.length) {
    throw new Error(
      label + ': тези файлове НЕ се зареждат (име с главна буква, долна черта или точка): ' +
        bogus.join(', ') +
        ' — преименувай ги на „малки-букви-с-тирета.js“',
    );
  }
  const seen = entries
    .map((entry) => entry.name)
    .filter((name) => ELIGIBLE.test(name))
    .sort();
  if (!seen.length) throw new Error(label + ': няма нито един *.js компонент в ' + dir);
  return seen;
}

module.exports = { scan, ELIGIBLE };
