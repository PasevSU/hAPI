'use strict';
// ГЛОБАЛНА ФУНКЦИЯ „hash“ — едно място за хеш, парче по парче.
//
// Защо е глобална: в `hapi_enterprise/` има 38 извиквания на `createHash` в 12 файла — всяко
// със свой начин за парчета, кодиране и име на полето. Редът на плана за `configuration.yaml`
// (`docs/plan/25-global-functions-catalogue.md`) е именно този: `files[].sha256`, проверката на
// папката, пакетите и QR печатите трябва да смятат по ЕДИН договор.
//
// Договорът е взет от `PasevSU/HASH_REPORT_ENTERPRICE` (js/lib/util.mjs, generate.mjs), но кодът
// е наш — двете правила, които няма да се разхлабят:
//   • файл НИКОГА не се чете цял в паметта (парче по подразбиране 1 MiB);
//   • `basis()` пази РЕДА на записите: разменени два записа дават различен хеш, иначе
//     „същият набор“ щеше да изглежда като „същият отчет“.
const crypto = require('node:crypto');
const fs = require('node:fs');

const DEFAULT_ALGO = 'sha256';
// Само силните: md5/sha1 остават извън договора, дори когато някой ги поиска „за съвместимост“.
const ALGOS = new Set(['sha256', 'sha512']);
const DEFAULT_CHUNK = 1024 * 1024;
const MIN_CHUNK = 4096;
const MAX_CHUNK = 8 * 1024 * 1024;
const HEX = /^[0-9a-f]{64}$/;

function algoOf(options) {
  const algo = String((options && options.algo) || DEFAULT_ALGO).toLowerCase();
  if (!ALGOS.has(algo)) {
    // Съобщението е цяло изречение, а не лепено от части: каталогът на грешките
    // (`documentation/04_FUNCTION_SPECIFICATIONS/ERROR_CODES.md`) чете обяснението от
    // него, а списъкът с позволените алгоритми идва като поле. Тестът пази двете да
    // не се разминат (`tests/core-hash.cjs`).
    const err = new Error('HASH_UNKNOWN_ALGO: позволени са само sha256 и sha512');
    err.code = 'HASH_UNKNOWN_ALGO';
    err.algo = algo;
    err.allowed = [...ALGOS];
    throw err;
  }
  return algo;
}

function chunkOf(options) {
  const value = Number((options && options.chunk) || DEFAULT_CHUNK);
  if (!Number.isFinite(value) || value < MIN_CHUNK || value > MAX_CHUNK) {
    const err = new Error('HASH_BAD_CHUNK: размерът на парчето е извън позволените граници');
    err.code = 'HASH_BAD_CHUNK';
    err.chunk = value;
    err.min = MIN_CHUNK;
    err.max = MAX_CHUNK;
    throw err;
  }
  return Math.floor(value);
}

/** Хеш на стойност в паметта (низ или Buffer). */
function digest(input, options) {
  const algo = algoOf(options);
  return crypto.createHash(algo).update(input).digest('hex');
}

/**
 * Хеш на файл, парче по парче — файлът не влиза целия в паметта.
 * @returns {Promise<{algo: string, hex: string, bytes: number}>}
 */
async function file(absPath, options) {
  const algo = algoOf(options);
  const chunk = chunkOf(options);
  const hash = crypto.createHash(algo);
  let bytes = 0;
  for await (const piece of fs.createReadStream(absPath, { highWaterMark: chunk })) {
    hash.update(piece);
    bytes += piece.length;
  }
  return { algo, hex: hash.digest('hex'), bytes };
}

/**
 * Сверка на файл с очакван хеш. Връща И двете страни — одитът записва какво е намерено,
 * а не само „не съвпада“.
 * @returns {Promise<{ok: boolean, algo: string, actual: string, expected: string, bytes: number}>}
 */
async function verify(absPath, expected, options) {
  const want = String(expected == null ? '' : expected).trim().toLowerCase();
  if (!HEX.test(want)) {
    const err = new Error('HASH_BAD_EXPECTED: очакваният хеш не е 64 шестнайсетични знака');
    err.code = 'HASH_BAD_EXPECTED';
    throw err;
  }
  const got = await file(absPath, Object.assign({ algo: DEFAULT_ALGO }, options));
  return { ok: got.hex === want, algo: got.algo, actual: got.hex, expected: want, bytes: got.bytes };
}

/**
 * „Digest basis“ на подреден списък: за всеки запис — неговият hex хеш и относителното име,
 * UTF-8, после хеш на целия поток. Разменен ред = различен резултат.
 * @param {Array<{sha256: string, name: string}>} entries
 * @returns {string} hex на sha256
 */
function basis(entries) {
  if (!Array.isArray(entries)) {
    const err = new Error('HASH_BAD_ENTRIES: очаква се списък от записи');
    err.code = 'HASH_BAD_ENTRIES';
    throw err;
  }
  const hash = crypto.createHash(DEFAULT_ALGO);
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || !entry.name) {
      const err = new Error('HASH_BAD_ENTRY: всеки запис иска непразно име');
      err.code = 'HASH_BAD_ENTRY';
      err.entry = entry && entry.name;
      throw err;
    }
    const hex = String(entry.sha256 == null ? '' : entry.sha256).trim().toLowerCase();
    if (!HEX.test(hex)) {
      const err = new Error('HASH_BAD_ENTRY: записът няма валиден sha256');
      err.code = 'HASH_BAD_ENTRY';
      err.entry = entry.name;
      throw err;
    }
    hash.update(hex);
    hash.update(entry.name);
  }
  return hash.digest('hex');
}

module.exports.create = () => ({
  name: 'hash',
  fn: { digest, file, verify, basis },
});
