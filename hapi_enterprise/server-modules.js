'use strict';
// ВСИЧКИ ФАЙЛОВЕ ОТ `server_module/` СА КОМПОНЕНТИ — БЕЗ ТВЪРДО ВПИСАН СПИСЪК (0.69.220).
//
// Заявката на собственика: „server.js трябва да обединява множество компоненти (отделни js),
// за да може да се фокусира към стабилни и добре изградени сегменти; server.js зарежда всички
// js файлове от папка `server_module/`, без твърдо вписани файлове — просто всички на принципа
// `*.js`“.
//
// Защо отделен зареждащ модул, а не `require` на всеки файл в `server.js`:
//   • `server.js` има твърд таван на редовете (`tests/server-structure.cjs`); всеки нов
//     компонент би искал поне един ред в него и таванът щеше да се вдига с всяка функция;
//   • твърдо вписаният списък се разминава тихо: файл, добавен в папката, просто не се
//     зарежда, а файл, изтрит от папката, остава в списъка и чупи старта;
//   • редът на зареждане става ПРЕДВИДИМ (по име), вместо да зависи от това кой ред е пипнат.
//
// Договорът на един компонент (`server_module/<име>.js`):
//
//     module.exports.create = (host) => ({ name?, handle({req,res,url,parts,method}) })
//
//   • `create(host)` се вика ВЕДНЪЖ при старт и получава `host` — това, което `server.js`
//     решава да даде на компонентите (адресни функции, политика, достъп до състоянието);
//   • `handle(ctx)` връща `true`, когато заявката е за него и е приключена, иначе `false`.
//     Същият договор като в `routes/`, за да не се учи второ правило.
//
// Зареждането е СТРОГО: файл без `create`, `create`, който не върне `handle`, и две еднакви
// имена са грешка при старт — не „тихо пропуснат компонент“. Иначе точно такъв файл би бил
// причина за 404, който никой не свързва с папката.
const path = require('node:path');
const { scan, ELIGIBLE } = require('./module-folder');

/**
 * Зарежда компонентите от папката.
 * @param {{dir: string, host: object}} opts
 * @returns {{handle: (ctx: object) => Promise<boolean>, components: Array<{file: string, name: string}>, order: string[]}}
 */
function load({ dir, host } = {}) {
  // Кои файлове се зареждат и какво става с невалидните имена — едно правило за двете
  // папки (`module-folder.js`, 0.69.224). Тук остава само договорът „handle(ctx)“.
  const seen = scan(dir, 'server_module');

  const names = new Set();
  const components = seen.map((file) => {
    const mod = require(path.join(dir, file));
    if (!mod || typeof mod.create !== 'function') {
      throw new Error('server_module/' + file + ': липсва create(host) — компонентът не се зарежда');
    }
    const made = mod.create(host);
    if (!made || typeof made.handle !== 'function') {
      throw new Error('server_module/' + file + ': create(host) трябва да върне { handle(ctx) }');
    }
    const name = typeof made.name === 'string' && made.name ? made.name : file.replace(/\.js$/, '');
    if (names.has(name)) throw new Error('server_module: две компоненти с едно и също име „' + name + '“');
    names.add(name);
    return { file, name, handle: made.handle, order: Number.isFinite(made.order) ? made.order : 100 };
  });

  components.sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));

  return {
    components: components.map(({ file, name }) => ({ file, name })),
    order: components.map((c) => c.file),
    async handle(ctx) {
      for (const component of components) {
        if (await component.handle(ctx)) return true;
      }
      return false;
    },
  };
}

module.exports = { load, ELIGIBLE };
