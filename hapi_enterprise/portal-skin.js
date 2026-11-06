'use strict';
// КОЖА НА ПУБЛИЧНАТА СТРАНИЦА НА ПОРТАЛА (`portal_skin`, env `PORTAL_SKIN`) — отделен модул,
// защото `server.js` има таван на редовете (`tests/server-structure.cjs`): маршрутът е един
// ред, а четенето и залепването на стиловете живеят тук.
//
// Защо залепване, а не втори `<link>`: страницата има ЕДИН DOM и един договор
// (`tests/portal-page-contract.cjs`). Класическият стил носи базата, а `modern` се добавя
// СЛЕД него на СЪЩИЯ адрес `/portal.css`. Така новата кожа важи и за страниците, които
// линкват този стил без да знаят за нея (410 „закрит“, токен-страницата, файловете), и не
// се пипа Content-Security-Policy.
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'portal');
const SKINS = ['classic', 'modern'];

/** Кой стил се сервира: `classic` (по подразбиране) или `modern`. Непознато → класика. */
function skin(env) {
  const value = String((env || process.env).PORTAL_SKIN || '').trim().toLowerCase();
  return SKINS.includes(value) ? value : 'classic';
}

/**
 * Съдържанието на `/portal.css`. Файловете се четат при всяка заявка (12–20 KB, `no-store`
 * вече е зададен), за да не остане процесът с кеширан стар стил след смяна на опцията.
 */
function stylesheet(env) {
  const classic = fs.readFileSync(path.join(DIR, 'portal.css'));
  if (skin(env) !== 'modern') return classic;
  return Buffer.concat([classic, Buffer.from('\n'), fs.readFileSync(path.join(DIR, 'portal-modern.css'))]);
}

/**
 * Включено криптиране без зареден ключ НЕ спира старта (жива инсталация не бива да падне
 * при обновяване), но не бива и да мълчи: иначе човек вижда две отметки „криптирано“ и
 * разбира, че данните са открити, чак когато първият запис се провали с
 * `PGP_SECRET_KEY_REQUIRED`. Затова тук се казва в лога — с причината от ключохранилището,
 * без път и без парола (INV-P7).
 */
function warnEncryptionWithoutKey(keyring, log) {
  const state = keyring.status();
  if (!(state.encryptPaths || state.encryptWorkdir) || state.available) return false;
  if (log) {
    log.warn('pgp.encryption.without-key', {
      ns: 'pgp',
      reason: state.reason || 'NO_KEY',
      encryptPaths: state.encryptPaths === true,
      encryptWorkdir: state.encryptWorkdir === true,
      hint: 'включено е криптиране, но ключът не е зареден — данните остават открити до поправяне на pgp_path_*',
    });
  }
  return true;
}

module.exports = { skin, stylesheet, warnEncryptionWithoutKey, SKINS, create };

/**
 * Инстанция за `server.js`: връща същите функции и ВЕДНАГА казва в лога, ако криптирането е
 * включено без зареден ключ. Така `server.js` печели редове (има таван), а предупреждението
 * не може да бъде забравено при бъдеща промяна на реда на инициализацията.
 */
function create(deps) {
  const { keyring, log } = deps || {};
  if (keyring) warnEncryptionWithoutKey(keyring, log);
  return { skin, stylesheet, warnEncryptionWithoutKey };
}
