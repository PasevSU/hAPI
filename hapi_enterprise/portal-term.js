'use strict';
// СРОК И ДОСТЪП НА ПОРТАЛА — задължителни при създаването (0.69.210).
//
// Защо отделен модул: и двете решения се взимат веднъж, в момента на създаването, и после
// СЕ ПРИЛАГАТ — срокът от политиката на портала, достъпът от маршрута за отключване. Ако
// живееха в `server.js`, проверката щеше да е на три места (форма, API, политика) и
// поне едното щеше да забрави.
//
// Правилата, които този модул пази:
//   • срок: `limited` изисква `termDays` (1…3650) и се превръща в `expiresAt`; `unlimited`
//     НЕ носи `expiresAt` — „безсрочно“ значи точно това, а не „много дни“;
//   • достъп: `free` не носи парола; `locked` изисква парола (8…200 знака);
//   • паролата НЕ се пази в чист вид: `scrypt$<salt>$<hash>` с `timingSafeEqual` при сверка;
//   • старите портали (преди 0.69.210) нямат нито едно от двете полета — четат се като
//     „безсрочен“ и „свободен“, за да не спре нито един работещ портал след обновяването.
const crypto = require('node:crypto');

const TERMS = Object.freeze(['limited', 'unlimited']);
const ACCESS = Object.freeze(['free', 'locked']);
const MAX_DAYS = 3650; // 10 години: повече не е срок, а начин да се заобиколи изборът
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

const text = (value) => String(value == null ? '' : value).trim();

/** `scrypt$<salt>$<hash>` — сол на всеки портал, за да не е един хеш за два еднакви парола. */
function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(text(password), salt, KEY_BYTES, SCRYPT);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

/** Сверка на парола срещу записания хеш. Грешен формат (стар запис) значи „не съвпада“. */
function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  let actual;
  try {
    actual = crypto.scryptSync(text(password), salt, expected.length, SCRYPT);
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Дали порталът е в срока си. Липсващ или невалиден `expiresAt` значи „безсрочен“. */
function active(portal, now = Date.now()) {
  if (!portal || !portal.expiresAt) return true;
  const until = Date.parse(portal.expiresAt);
  if (!Number.isFinite(until)) return true;
  return now < until;
}

/**
 * Проверява и смята двете решения от тялото на заявката за създаване.
 * Връща `{ ok: true, term, expiresAt, access, passwordHash }` или `{ ok: false, message }`
 * с четимо обяснение — викащият го превръща в 400, без да си измисля причина.
 */
function normalize(input, { now = () => Date.now() } = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const hasTerm = Object.hasOwn(body, 'term') && text(body.term) !== '';
  const hasAccess = Object.hasOwn(body, 'access') && text(body.access) !== '';
  // СЪВМЕСТИМОСТ: заявка без нито едно от двете решения (скриптове, интеграция, стари
  // клиенти) създава портал както преди — безсрочен и свободен. Панелът НЕ праща такава:
  // там двете са задължителни полета (`portal.create.*` в `ui/i18n.js`).
  if (!hasTerm && !hasAccess) {
    return { ok: true, legacy: true, term: 'unlimited', expiresAt: null, access: 'free', passwordHash: null };
  }
  const term = text(body.term);
  if (!TERMS.includes(term)) return { ok: false, message: 'term must be "limited" or "unlimited"' };
  let expiresAt = null;
  if (term === 'limited') {
    const raw = text(body.termDays);
    if (!/^\d{1,4}$/.test(raw)) return { ok: false, message: 'termDays must be a whole number of days' };
    const days = Number(raw);
    if (days < 1 || days > MAX_DAYS) return { ok: false, message: `termDays must be between 1 and ${MAX_DAYS}` };
    expiresAt = new Date(now() + days * 24 * 60 * 60 * 1000).toISOString();
  }
  const access = text(body.access);
  if (!ACCESS.includes(access)) return { ok: false, message: 'access must be "free" or "locked"' };
  let passwordHash = null;
  if (access === 'locked') {
    const password = String(body.password == null ? '' : body.password);
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return { ok: false, message: `password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters` };
    }
    passwordHash = hashPassword(password);
  }
  return { ok: true, term, expiresAt, access, passwordHash };
}

module.exports = { TERMS, ACCESS, MAX_DAYS, MIN_PASSWORD, MAX_PASSWORD, hashPassword, verifyPassword, active, normalize };
