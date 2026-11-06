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
const nodePath = require('node:path');
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
// Префиксът, който Supervisor отсича, за да вземе името на секрета. Едно разстояние —
// точно както е в `addons/options.py`; второ разстояние става част от името.
const SECRET_PREFIX = '!secret ';

/** Кодовете, които `pgp.js` дава при невалиден ключ, се пренасят както са (INV-P6). */
const KEY_ERRORS = new Set([
  'PASSPHRASE_REQUIRED',
  'PASSPHRASE_WRONG',
  'S2K_ARGON2_UNSUPPORTED',
  'S2K_AEAD_UNSUPPORTED',
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
  // Материалът за криптиране (armored текст + парола) стои САМО тук и никога не излиза
  // в `status()`: L1 (вътрешните пътища) се нуждае от него, а отговорът по HTTP — не.
  let material = null;

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
      // Ролите идват от Key Flags в обвързващия подпис, не от догадка по вида на ключа.
      keyFlags: typeof key.keyFlags === 'number' ? key.keyFlags : null,
      roles: Array.isArray(key.roles) ? key.roles : [],
      created: key.created ? new Date(key.created * 1000).toISOString() : null,
    }));
  }

  const empty = (reason, extra) => ({
    available: false,
    canDecrypt: false,
    reason,
    keys: [],
    storageKeyId: '',
    storageKeySource: '',
    primaryKeyId: '',
    ...extra,
  });

  /**
   * `!secret …` в опция значи, че Supervisor НЕ е заместил стойността: по-стар Supervisor,
   * грешно име или излишно разстояние след `!secret`. Без тази проверка човек вижда
   * „файлът не се чете“ и търси файл, който никога не е бил път.
   *
   * Отсича се ТОЧНО както го прави Supervisor: префиксът е `!secret ` (с ЕДНО разстояние),
   * а всичко след него е името — затова при две разстояния името започва с интервал.
   */
  function unexpandedSecret(value) {
    if (!value.startsWith(SECRET_PREFIX)) return null;
    return value.slice(SECRET_PREFIX.length);
  }

  /** Зарежда състоянието. Никога не хвърля — причината отива в `reason`. */
  function load() {
    material = null;
    const { encryptPaths, encryptWorkdir } = flags();
    const meta = { encryptPaths, encryptWorkdir, passphraseSource: resolvePassphrase().source };
    const publicPath = text(env[ENV.public]);
    const secretPath = text(env[ENV.secret]);
    const optionPass = text(env[ENV.keyPass]);
    const filePass = text(env[ENV.pass]);
    // Пътищата, които РЕАЛНО се ползват: `pgp_key_pass` има предимство и тогава файлът с
    // паролата не се пипа — иначе сгрешен, но неизползван път би съборил работещ ключ.
    const pathRefs = [
      ['pgp_path_public', publicPath],
      ['pgp_path_secret', secretPath],
    ];
    if (!optionPass) pathRefs.push(['pgp_path_pass', filePass]);
    const refs = optionPass ? [...pathRefs, ['pgp_key_pass', optionPass]] : pathRefs;
    for (const [option, value] of refs) {
      const name = value ? unexpandedSecret(value) : null;
      if (name === null) continue;
      // Водещият интервал в името е ТОЧНО причината записът в HA да се откаже с
      // `Unknown secret ' …'` — затова причината го казва, вместо да го остави за гадаене.
      // Двата кода се връщат ТУК, а не през променлива: така `scripts/error-codes.cjs` ги
      // вижда статично и каталогът на кодовете не може да ги изпусне.
      if (name === name.trim()) return empty('SECRET_NOT_EXPANDED', { ...meta, secretOption: option });
      return empty('SECRET_NAME_HAS_SPACE', { ...meta, secretOption: option });
    }
    // Относителен път не е път в контейнера: работната директория е `/app`, а HA
    // конфигурацията е `/homeassistant`. Затова `config/_openpgpV6/public.asc` се чете като
    // `/app/config/...` и дава „файлът не се чете“ без причина — тук причината се казва.
    for (const [option, value] of pathRefs) {
      if (!value || nodePath.isAbsolute(value)) continue;
      return empty('SECRET_PATH_RELATIVE', { ...meta, secretOption: option });
    }
    if (!publicPath && !secretPath) return empty('NO_PATHS', meta);

    let publicParsed = null;
    let publicText = '';
    if (publicPath) {
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
    let secretText = '';
    if (secretPath) {
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
    // Редът на избор (0x08 → 0x04 → по вид) и неговият източник идват от `storageKeyOf`,
    // за да не е мълчаливо кое правило е сработило.
    let storageKeyId = '';
    let storageKeySource = '';
    let reason = '';
    for (const parsed of [publicParsed, secretParsed]) {
      if (!parsed) continue;
      try {
        const choice = pgp.storageKeyOf(parsed);
        storageKeyId = choice.key.keyId;
        storageKeySource = choice.source;
        reason = '';
        break;
      } catch (err) {
        reason = err && err.code ? err.code : 'NO_ENCRYPTION_KEY';
      }
    }

    const shown = secretParsed || publicParsed;
    const primary = shown && shown.primary ? shown.primary : null;
    // Материалът за L1: armored текст (за `encryptToKey`/`decryptMessage`) и паролата.
    // Публичният текст се взима от публичния файл, а ако няма такъв — се извежда от частния,
    // за да може един-единствен файл да стига за криптиране и декриптиране.
    material = {
      publicText: publicParsed ? publicText : secretParsed ? pgp.publicKeyOf(secretText) : '',
      secretText: secretParsed ? secretText : '',
      passphrase: secretParsed ? resolvePassphrase().value : '',
      storageKeyId,
    };
    return {
      ...meta,
      available: true,
      canDecrypt: !!secretParsed,
      reason,
      keys: shown ? describeKeys(shown) : [],
      storageKeyId,
      storageKeySource,
      primaryKeyId: primary ? primary.keyId : '',
    };
  }

  function status() {
    if (!cache) cache = load();
    return cache;
  }

  function reload() {
    cache = null;
    material = null;
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

  /**
   * Обвива текст с PGP ключа (например DEK за L2). Без политика — политиката е на слоя
   * отгоре (`sealPath` за L1); L2 няма причина да зависи от `pgp_encrypt_paths`.
   */
  function wrapSecret(plain) {
    const value = text(plain);
    if (!value) return '';
    const state = status();
    if (!material || !material.publicText) {
      throw Object.assign(new Error('Няма ключ за криптиране'), {
        code: 'PGP_SECRET_KEY_REQUIRED',
        status: 503,
        detail: state.reason || 'NO_PATHS',
      });
    }
    return pgp.encryptToKey(Buffer.from(value, 'utf8'), material.publicText).armored;
  }

  /** Развива обвит с PGP текст; без частен ключ дава `PGP_KEY_LOCKED`, не празен низ. */
  function unwrapSecret(armored) {
    const value = text(armored);
    if (!value) return '';
    const state = status();
    if (!material || !material.secretText) {
      throw Object.assign(new Error('Няма частен ключ за развиване'), {
        code: 'PGP_KEY_LOCKED',
        status: 503,
        detail: state.reason || 'NO_PATHS',
      });
    }
    try {
      return pgp.decryptMessage(value, material.secretText, material.passphrase).toString('utf8');
    } catch (err) {
      throw Object.assign(new Error('Обвитото не може да се развие: ' + ((err && err.code) || 'unknown')), {
        code: 'PGP_KEY_LOCKED',
        status: 503,
        detail: (err && err.code) || '',
      });
    }
  }

  /**
   * L1: криптира вътрешен път (`storagePath` → `storagePathEnc`). Извиква се само когато
   * `pgp_encrypt_paths` е включено; иначе шифротекст без ключ само би объркал четенето.
   */
  function sealPath(plain) {
    const state = status();
    if (!text(plain)) return '';
    if (!state.encryptPaths) {
      throw Object.assign(new Error('L1 е изключено (`pgp_encrypt_paths`)'), { code: 'PGP_PATHS_DISABLED', status: 409 });
    }
    return wrapSecret(plain);
  }

  /** L1: връща открития път. Без ключ/парола дава точна грешка, не празен низ. */
  function openPath(armored) {
    if (!text(armored)) return '';
    try {
      return unwrapSecret(armored);
    } catch (err) {
      throw Object.assign(new Error('Пътят не може да се декриптира: ' + ((err && err.detail) || err.code)), {
        code: 'STORAGE_PATH_LOCKED',
        status: 503,
        detail: (err && err.detail) || '',
      });
    }
  }

  /**
   * L1 миграция: минава през всички портали и заменя откритите `storagePath` с
   * `storagePathEnc`. Идемпотентна е — втори пуск не намира какво да смени.
   * Не пипа диска и базата: викащият решава кога да запише (в транзакция).
   */
  function sealAll(portals) {
    if (!Array.isArray(portals)) throw Object.assign(new Error('Липсва списък с портали'), { status: 400 });
    let sealed = 0;
    let already = 0;
    let failed = 0;
    for (const portal of portals) {
      for (const file of (portal && portal.files) || []) {
        if (!file) continue;
        if (!file.storagePath) {
          if (file.storagePathEnc) already++;
          continue;
        }
        try {
          file.storagePathEnc = sealPath(file.storagePath);
          delete file.storagePath;
          sealed++;
        } catch {
          // Един нечетим запис не бива да спира миграцията на останалите; броят се връща,
          // за да се види, че има остатък (и повторният пуск ще опита пак).
          failed++;
        }
      }
    }
    return { sealed, already, failed };
  }

  /** L1: откритият вътрешен път на запис (записът минава през `pathField`). */
  function pathOf(file) {
    if (!file) return '';
    if (file.storagePath) return file.storagePath;
    return file.storagePathEnc ? openPath(file.storagePathEnc) : '';
  }

  /** L1: каквото влиза в записа — шифротекст при включено L1, иначе открит път. */
  function pathField(plain) {
    return status().encryptPaths ? { storagePathEnc: sealPath(plain) } : { storagePath: plain };
  }

  /**
   * Кой ключ от опциите може да ПОДПИСВА. Различно от „криптира“: подписът иска секретната
   * част и подключ с флаг за подпис, а криптирането — само публичната. Понеже ключът вече е
   * зареден от `pgp_path_secret`, PGP инструментите не бива да искат нищо от човека.
   * `null` значи „няма с какво да се подпише“ (само публичен ключ, грешна парола и т.н.).
   */
  function signing() {
    const state = status();
    if (!state.available || !material || !material.secretText) return null;
    try {
      const parsed = pgp.parseKeyBlock(material.secretText, { passphrase: material.passphrase || undefined });
      const key = pgp.signingKey(parsed);
      return {
        keyId: key.keyId,
        fingerprint: key.fingerprint,
        algorithm: key.algorithm,
        version: Number(key.version) || 4,
      };
    } catch {
      return null;
    }
  }

  /** Деташиран подпис с ключа от опциите; без частен ключ — точният код, не празен подпис. */
  function signDetached(data) {
    const identity = signing();
    if (!identity) {
      throw Object.assign(new Error('Няма зареден частен PGP ключ за подпис'), {
        code: 'PGP_SECRET_KEY_REQUIRED',
        status: 503,
        detail: status().reason || 'NO_SECRET_KEY',
      });
    }
    return pgp.signDetached(data, material.secretText, { passphrase: material.passphrase || '' });
  }

  /** Публичният текст на ключа от опциите — за ПРОВЕРКА на подпис; не е тайна. */
  function publicText() {
    const state = status();
    if (!state.available || !material) return '';
    return material.publicText || '';
  }

  return {
    status,
    reload,
    requireEncryptionKey,
    sealPath,
    openPath,
    wrapSecret,
    unwrapSecret,
    sealAll,
    pathOf,
    pathField,
    signing,
    signDetached,
    publicText,
    passphraseSource: () => resolvePassphrase().source,
  };
}

module.exports = { create, ENV, KEY_ERRORS };
