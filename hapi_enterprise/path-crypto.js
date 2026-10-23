'use strict';
// Ключохранилище на PGP (бач B2 от `PLAN-0.69.67-LINKS-AND-FILES.md`).
//
// Ключовете се зареждат САМО от изрични пътища — без търсене по „папка“ и без
// предположения къде е `/config` (в контейнера `/config` е папката на add-on-а, а
// конфигурацията на Home Assistant е `/homeassistant`):
//
//   PGP_PATH_PUBLIC  — публичен ключ
//   PGP_PATH_SECRET  — частен ключ (файлът може да е `secret.asc` или `private.asc`)
//   PGP_PATH_PASS    — файл с паролата (първият ред); по-добре от парола в опция
//   PGP_KEY_PASS     — самата парола като стойност (с предимство пред файла)
//
// PGP е ПО ИЗБОР: липсващи пътища не спират add-on-а — `status()` казва `available:false`
// и точна причина. Обратното важи за криптирането: ако `pgp_encrypt_paths` или
// `pgp_encrypt_workdir` е включено, а ключ няма, `requireEncryptionKey()` хвърля
// `PGP_SECRET_KEY_REQUIRED` — иначе би се лъгало, че данните са криптирани.
//
// В status НЯМА пътища и НЯМА парола (INV-P7): само идентичността на ключовете и причината.
const fs = require('node:fs');
const pgp = require('./pgp');

const ENV = {
  public: 'PGP_PATH_PUBLIC',
  secret: 'PGP_PATH_SECRET',
  pass: 'PGP_PATH_PASS',
  keyPass: 'PGP_KEY_PASS',
  encryptPaths: 'PGP_ENCRYPT_PATHS',
  encryptWorkdir: 'PGP_ENCRYPT_WORKDIR',
};

const TRUE = new Set(['1', 'true', 'yes', 'on']);
const isOn = (value) =>
  TRUE.has(
    String(value == null ? '' : value)
      .trim()
      .toLowerCase()
  );
const text = (value) => (value == null ? '' : String(value).trim());

/** Кодовете, които `pgp.js` дава при невалиден ключ, се пренасят както са (INV-P6). */
const KEY_ERRORS = new Set([
  'PASSPHRASE_REQUIRED',
  'PASSPHRASE_WRONG',
  'S2K_ARGON2_UNSUPPORTED',
  'S2K_UNSUPPORTED',
  'UNSUPPORTED_ALGORITHM',
  'UNSUPPORTED_CURVE',
  'BAD_KEY',
  'NO_KEY',
  'UNSUPPORTED_FORMAT',
]);

function create(options = {}) {
  const env = options.env || process.env;
  const readFile = options.readFile || ((file) => fs.readFileSync(file, 'utf8'));
  let cache = null;

  const flags = () => ({
    encryptPaths: isOn(env[ENV.encryptPaths]),
    encryptWorkdir: isOn(env[ENV.encryptWorkdir]),
  });

  /** Паролата: опция → файл → нищо. Източникът се казва, стойността — никога. */
  function resolvePassphrase() {
    const fromOption = text(env[ENV.keyPass]);
    if (fromOption) return { value: fromOption, source: 'option' };
    const file = text(env[ENV.pass]);
    if (!file) return { value: '', source: 'none' };
    try {
      const first = String(readFile(file)).split('\n')[0].replace(/\r$/, '').trim();
      return first ? { value: first, source: 'file' } : { value: '', source: 'empty-file' };
    } catch {
      return { value: '', source: 'unreadable-file' };
    }
  }

  /** Описание на ключовете без тайни: идентичност и предназначение. */
  function describeKeys(parsed) {
    return parsed.keys.map((key) => ({
      keyId: key.keyId,
      fingerprint: key.fingerprint,
      version: key.version,
      algorithm: key.algorithm,
      kind: key.kind,
      bits: key.kind === 'rsa' && key.n ? key.n.length * 8 : key.kind === 'ed448' ? 456 : 256,
      isSubkey: !!key.isSubkey,
      canSign: !!key.canSign,
      hasSecret: !!key.secret,
      created: key.created ? new Date(key.created * 1000).toISOString() : null,
    }));
  }

  const empty = (reason, extra) => ({
    available: false,
    canDecrypt: false,
    reason,
    keys: [],
    storageKeyId: '',
    primaryKeyId: '',
    ...extra,
  });

  /** Зарежда състоянието. Никога не хвърля — причината отива в `reason`. */
  function load() {
    const { encryptPaths, encryptWorkdir } = flags();
    const meta = { encryptPaths, encryptWorkdir, passphraseSource: resolvePassphrase().source };
    const publicPath = text(env[ENV.public]);
    const secretPath = text(env[ENV.secret]);
    if (!publicPath && !secretPath) return empty('NO_PATHS', meta);

    let publicParsed = null;
    if (publicPath) {
      let publicText;
      try {
        publicText = String(readFile(publicPath));
      } catch {
        return empty('PUBLIC_UNREADABLE', meta);
      }
      try {
        publicParsed = pgp.parseKeyBlock(publicText);
      } catch {
        return empty('PUBLIC_UNREADABLE', meta);
      }
    }

    let secretParsed = null;
    if (secretPath) {
      let secretText;
      try {
        secretText = String(readFile(secretPath));
      } catch {
        return empty('SECRET_UNREADABLE', { ...meta, keys: publicParsed ? describeKeys(publicParsed) : [] });
      }
      try {
        secretParsed = pgp.parseKeyBlock(secretText, { passphrase: resolvePassphrase().value });
      } catch (err) {
        const code = err && err.code && KEY_ERRORS.has(err.code) ? err.code : 'SECRET_UNREADABLE';
        return empty(code, { ...meta, keys: publicParsed ? describeKeys(publicParsed) : [] });
      }
    }

    // Кой ключ криптира: първо от публичния блок (той е този, който получателят вижда),
    // иначе от частния. ECDH с именувана крива дава UNSUPPORTED_CURVE, а не празно.
    let storageKeyId = '';
    let reason = '';
    for (const parsed of [publicParsed, secretParsed]) {
      if (!parsed) continue;
      try {
        storageKeyId = pgp.encryptionKeyOf(parsed).keyId;
        reason = '';
        break;
      } catch (err) {
        reason = err && err.code ? err.code : 'NO_ENCRYPTION_KEY';
      }
    }

    const shown = secretParsed || publicParsed;
    const primary = shown && shown.primary ? shown.primary : null;
    return {
      ...meta,
      available: true,
      canDecrypt: !!secretParsed,
      reason,
      keys: shown ? describeKeys(shown) : [],
      storageKeyId,
      primaryKeyId: primary ? primary.keyId : '',
    };
  }

  function status() {
    if (!cache) cache = load();
    return cache;
  }

  function reload() {
    cache = null;
    return status();
  }

  /**
   * Ключът за криптиране на вътрешните данни (B3/B4). Хвърля точния код, когато няма
   * какво да криптира — това е единственият начин да не се твърди „криптирано“ без ключ.
   */
  function requireEncryptionKey() {
    const state = status();
    if (state.storageKeyId) return state.storageKeyId;
    if (!state.encryptPaths && !state.encryptWorkdir) return '';
    const reason = state.reason || 'NO_PATHS';
    const which = state.encryptPaths ? 'pgp_encrypt_paths' : 'pgp_encrypt_workdir';
    const err = new Error(`Криптирането е включено (${which}), но няма ключ: ${reason}`);
    err.code = 'PGP_SECRET_KEY_REQUIRED';
    err.status = 503;
    err.detail = reason;
    throw err;
  }

  return { status, reload, requireEncryptionKey, passphraseSource: () => resolvePassphrase().source };
}

module.exports = { create, ENV, KEY_ERRORS };
