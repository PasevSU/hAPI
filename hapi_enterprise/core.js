'use strict';
// ГЛОБАЛНИТЕ ФУНКЦИИ НА СЪРВЪРА — ВСИЧКИ ФАЙЛОВЕ ОТ `core_module/` БЕЗ ТВЪРДО ВПИСАН СПИСЪК.
//
// Заявката на собственика: „изгради и глобални функции на същия принцип като server.js, но с
// името `core.js`, и там са всички кодове, които се използват многократно — като този за
// създаване на QR, API…“.
//
// Защо отделен слой, а не още `require`-и в `server.js`:
//   • една и съща функция се вика от сървъра, от маршрут и от друг компонент — дотук всяко
//     място пищеше `require('../qr-svg')` и адресът се сглобяваше по свой начин;
//   • `server.js` има твърд таван на редовете (`tests/server-structure.cjs`), а общите неща
//     не му принадлежат;
//   • твърдо вписаният списък се разминава тихо — точно затова `server_module/` мина на
//     зареждане по име (DEF-64) и тук правилото е СЪЩОТО, за да не се учи второ.
//
// Договорът на един глобален модул (`core_module/<име>.js`):
//
//     module.exports.create = (deps, api) => ({ name?, fn })
//
//   • `create(deps, api)` се вика ВЕДНЪЖ при старт: `deps` е това, което `server.js` реши да
//     даде на глобалните функции (напр. `links`), а `api` е ЖИВИЯТ обект на слоя — така един
//     модул може да ползва друг (`api.qr.svg(...)`), без да знае кой го е заредил пръв.
//     Функциите на `api` се викат по-късно, след като всички модули са заредени, затова
//     редът на файловете не създава зависимост. След зареждането обектът се ЗАМРАЗЯВА.
//   • `fn` е обект от функции (`{ svg(text) }`) или една функция (тогава се вика `run`) и
//     трябва да има поне една — модул без нито една функция не е глобална функция.
//   • `core.api.<име>.<функция>` е замразен — глобалният слой не се украсява по време на
//     изпълнение, защото второ място, което го промени, чупи всички останали.
//
// Зареждането е СТРОГО: файл без `create`, `create` без `fn`, стойност в `fn`, която не е
// функция, и две еднакви имена са грешка при СТАРТ — не „тихо пропусната функция“. Същото
// правило като при `server_module/` (DEF-72): файл, който се вижда в папката, но не се
// зарежда, изглежда работещ и дава разминаване, което никой не свързва с папката.
const path = require('node:path');
const { scan, ELIGIBLE } = require('./module-folder');

/**
 * Зарежда глобалните функции от папката.
 * @param {{dir: string, deps?: object}} opts
 * @returns {{names: string[], has: (name: string) => boolean, get: (name: string) => object, api: object}}
 */
function load({ dir, deps = {} } = {}) {
  // Кои файлове се зареждат и какво става с невалидните имена — едно правило за двете
  // папки (`module-folder.js`, 0.69.224). Тук остава само договорът „fn от функции“.
  const seen = scan(dir, 'core');

  const api = {};
  for (const file of seen) {
    const mod = require(path.join(dir, file));
    if (!mod || typeof mod.create !== 'function') {
      throw new Error('core_module/' + file + ': липсва create(deps) — функциите не се зареждат');
    }
    const made = mod.create(deps, api);
    if (!made || made.fn == null || (typeof made.fn !== 'function' && typeof made.fn !== 'object')) {
      throw new Error('core_module/' + file + ': create(deps) трябва да върне { fn } (обект от функции или една функция)');
    }
    const name = typeof made.name === 'string' && made.name ? made.name : file.replace(/\.js$/, '');
    if (Object.hasOwn(api, name)) throw new Error('core: две глобални функции с едно и също име „' + name + '“');
    const fn = typeof made.fn === 'function' ? { run: made.fn } : made.fn;
    const keys = Object.keys(fn);
    if (!keys.length) {
      throw new Error('core_module/' + file + ': „' + name + '“ не дава нито една функция — не е глобална функция');
    }
    for (const [key, value] of Object.entries(fn)) {
      if (typeof value !== 'function') {
        throw new Error('core_module/' + file + ': „' + name + '.' + key + '“ не е функция — глобалният слой държи само извикваем код');
      }
    }
    api[name] = Object.freeze({ ...fn });
  }
  const frozen = Object.freeze(api);
  const names = Object.keys(frozen).sort();
  return {
    names,
    has: (name) => Object.hasOwn(frozen, name),
    get(name) {
      if (!Object.hasOwn(frozen, name)) {
        throw new Error('core: няма глобална функция „' + name + '“ (има: ' + names.join(', ') + ')');
      }
      return frozen[name];
    },
    api: frozen,
  };
}

module.exports = { load, ELIGIBLE };
