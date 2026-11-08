'use strict';
// ЛОГИЧЕСКИТЕ КОРЕНИ НА ХРАНИЛИЩЕТО — ЕДНО МЯСТО ЗА ЦЕЛИЯ ПРОЕКТ.
//
// Защо съществува (0.69.208): `/share` е път на Home Assistant (Linux). Извън контейнера
// `path.resolve` върху този низ НЕ дава „папка до проекта“, а „папка в КОРЕНА НА ДИСКА“ — на
// Windows това е `D:\share`. Така тестовете и локалният GUI създаваха `D:\share` с портали от
// всяко пускане (измерено: 211 папки) и го правеха дори когато никой не е искал хранилище там.
// Излишната папка после бавеше дървото на порталите, докато „флейк“ в `gui-journeys` изтече.
//
// Договорът, който този файл налага:
//   1. логическите корени се пишат ТУК, не по модулите (`/share`, `/media`, `/config`, `/data`);
//   2. реалният път на корен се взима само през `resolveRoot()` — тоест през ЕДНА функция,
//      която знае и за `STORAGE_ROOT_OVERRIDE`, и за разликата „контейнер ↔ машина за тестове“;
//   3. ако логическата папка не съществува на тази машина, резултатът е подпапка на
//      временната папка (`<temp>/hapi-storage/<корен>`), НЕ „<диск>:\share“.
// Проверява се от `tests/storage-roots.cjs`.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Логическите корени на Home Assistant. Това са низове в конфигурацията, не host пътища. */
const LOGICAL_ROOTS = Object.freeze({
  share: '/share',
  media: '/media',
  config: '/config',
  data: '/data',
});

/** Имената на променливите, с които средата сменя корените. Едни и същи за всички. */
const ENV = Object.freeze({
  /** Корен, под който се разполагат логическите (тестове, CI, локален GUI). */
  STORAGE_ROOT_OVERRIDE: 'STORAGE_ROOT_OVERRIDE',
  /** Служебната директория на add-on-а (база, настройки). */
  DATA_DIR: 'DATA_DIR',
  /** Кой логически корен се ползва (`share` по подразбиране). */
  STORAGE_LOCATION: 'STORAGE_LOCATION',
  /** Подпапка под корена (`hapi/data` по подразбиране). */
  STORAGE_SUBDIRECTORY: 'STORAGE_SUBDIRECTORY',
});

/** Подпапката на временната папка, в която падат корените извън контейнера. */
const TEMP_BASE = 'hapi-storage';

/**
 * Корените, в които може да живее КОНФИГУРАЦИЯТА на Home Assistant (не хранилището).
 * В add-on `/config` е собствената папка на add-on-а (`app_config`), а HA конфигурацията е
 * монтирана на `/homeassistant`; при standalone/Docker е обратното. Затова са списък, а
 * решението кой е истински се взима по `configuration.yaml` (вж. `evidence-portal.js`).
 */
const CONFIG_ROOTS = Object.freeze(['/config', '/homeassistant']);

/**
 * Истина, ако стойността сочи САМО логическия корен (`/share`, `/media`, …) — тоест общата
 * папка, в която портал НЕ бива да пише свои файлове. Празна/липсваща стойност значи
 * „коренът по подразбиране“ (`/share`), затова също е общ корен.
 */
function isLogicalRoot(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return true;
  const s = raw.replace(/\/+$/, '') || '/';
  return Object.values(LOGICAL_ROOTS).includes(s);
}

/** Логическият корен за име (`share` → `/share`); непознато име е грешка, не мълчание. */
function logicalRoot(name) {
  const key = String(name || '').trim();
  if (!Object.hasOwn(LOGICAL_ROOTS, key)) throw new Error('Unknown storage location: ' + key);
  return LOGICAL_ROOTS[key];
}

/**
 * Реалният път на логически корен в ТАЗИ инсталация.
 *
 * Ред на решаване:
 *   1. `STORAGE_ROOT_OVERRIDE` — тогава `<override>/<корен>` (така работят тестовете и CI);
 *   2. логическата папка, ако СЪЩЕСТВУВА на тази машина (контейнерът на Home Assistant);
 *   3. `<temp>/hapi-storage/<корен>` — за да не се създава папка в корена на диска.
 *
 * @param {string} name име на логическия корен (`share`, `media`, `config`, `data`)
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} абсолютен път на host
 */
function resolveRoot(name, env = process.env) {
  const logical = logicalRoot(name);
  const override = String(env[ENV.STORAGE_ROOT_OVERRIDE] || '').trim();
  if (override) return path.resolve(override, name);
  const real = path.resolve(logical);
  if (fs.existsSync(real)) return real;
  return path.join(os.tmpdir(), TEMP_BASE, name);
}

/**
 * Реалният път на папка в хранилището (`storage_root` на портал + `slug`).
 *
 * `storageRoot` е ЛОГИЧЕСКИ низ (`/share`, `/share/USB`), както се пази в портала. Функцията
 * го превежда до host път: първият сегмент е логическият корен, останалото е подпапка под него.
 *
 * @param {string} storageRoot логическият корен на портала
 * @param {string} [slug] име на папката (slug на портала)
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} абсолютен път на host
 */
function resolveStoragePath(storageRoot, slug = '', env = process.env) {
  const raw = String(storageRoot == null ? '' : storageRoot).trim() || LOGICAL_ROOTS.share;
  const parts = raw.split('/').filter(Boolean);
  const name = parts.shift() || 'share';
  const base = resolveRoot(name, env);
  return path.join(base, ...parts, String(slug || ''));
}

/**
 * Реалният път на логически корен, САМО ако той наистина съществува на тази машина.
 *
 * За разлика от `resolveRoot()` не подменя с временна папка: когато `/share` липсва, това е
 * отговорът „тук няма Home Assistant-ско хранилище“ (празен низ), а не нов път за писане.
 * @param {string} name име на логическия корен
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} абсолютен път или `''`
 */
function existingRoot(name, env = process.env) {
  const logical = logicalRoot(name);
  const override = String(env[ENV.STORAGE_ROOT_OVERRIDE] || '').trim();
  // С override се гледа САМО неговата папка — тестът не бива да пропада до истинския /share.
  if (override) {
    const base = path.resolve(override, name);
    return fs.existsSync(base) ? base : '';
  }
  // Home Assistant живее само на POSIX: `/share` е папка в корена на файловата система. На
  // Windows същият низ е `D:\share` — папка в корена на ДИСКА, която никой не е поискал.
  // Затова там „съществуващ корен“ има само при изрично зададен override (или env на
  // викащия); иначе отговорът е „тук няма такова хранилище“.
  if (process.platform === 'win32') return '';
  const base = path.resolve(logical);
  return fs.existsSync(base) ? base : '';
}

module.exports = {
  LOGICAL_ROOTS,
  CONFIG_ROOTS,
  ENV,
  TEMP_BASE,
  isLogicalRoot,
  logicalRoot,
  existingRoot,
  resolveRoot,
  resolveStoragePath,
};
