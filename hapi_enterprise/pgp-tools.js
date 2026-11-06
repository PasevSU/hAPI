'use strict';
// PGP ИНСТРУМЕНТИ — един списък с ключове и трите действия: подпис, проверка, публична част.
//
// Защо отделен модул: ключовете идват от ДВА източника.
//   1. Прикачени в конзолата (`db.pgpKeys`), криптирани с админ токена — `source: 'console'`.
//   2. Зададени в опциите на add-on-а (`pgp_path_public` / `pgp_path_secret`), заредени от
//      ключохранилището (`path-crypto.js`) — `source: 'options'`.
//
// Дотук инструментите гледаха САМО първия източник и затова искаха „прикачи ключ“, дори когато
// ключът вече е зададен в опциите. Тук двете страни се събират в един списък:
//   • зададеният в опциите ключ се ползва АВТОМАТИЧНО за подпис и за проверка;
//   • прикачването остава ПО ИЗБОР — за проверка на подпис, направен със СТАР ключ, или когато
//     в опциите има само публична част;
//   • прикаченият ключ има предимство пред този от опциите (той е изричен избор в конзолата).
const OPTIONS_PREFIX = 'options:';
const OPTIONS_LABEL = 'Ключ от опциите (pgp_path_secret)';

function create(deps) {
  const { keyring, listKeys, decryptSecret, pgp } = deps;
  const consoleKeys = () => listKeys() || [];

  /** Изгледът на прикачен ключ — същата форма като този от опциите, за да е един списъкът. */
  function view(k) {
    return {
      id: k.id,
      label: k.label,
      userId: k.userId,
      algorithm: k.algorithm,
      bits: k.bits,
      version: Number(k.version) || 4,
      keyId: k.keyId,
      fingerprint: k.fingerprint,
      createdAt: k.createdAt,
      addedAt: k.addedAt,
      hasSecret: Boolean(k.secretEnc),
      canSign: Boolean(k.secretEnc),
      source: k.source || 'console',
      roles: Array.isArray(k.roles) ? k.roles : [],
      // Ключ от опциите не се трие оттук: той е файл, който човекът пази сам.
      removable: true,
    };
  }

  /**
   * Ключът от опциите, ако има зареден такъв. `canSign` е истина само когато има СЕКРЕТНА
   * част и подключ с флаг за подпис — публичният ключ стига за проверка, не за подпис.
   */
  function optionsKey() {
    const state = keyring.status();
    if (!state.available) return null;
    const sign = typeof keyring.signing === 'function' ? keyring.signing() : null;
    const keys = Array.isArray(state.keys) ? state.keys : [];
    const primary = (sign && keys.find((k) => k.keyId === sign.keyId)) || keys.find((k) => k.keyId === state.primaryKeyId) || keys[0] || {};
    const keyId = (sign && sign.keyId) || primary.keyId || state.primaryKeyId || '';
    if (!keyId) return null;
    return {
      id: OPTIONS_PREFIX + keyId,
      label: OPTIONS_LABEL,
      userId: '',
      algorithm: (sign && sign.algorithm) || primary.algorithm || '',
      bits: primary.bits,
      version: (sign && Number(sign.version)) || Number(primary.version) || 4,
      keyId,
      fingerprint: (sign && sign.fingerprint) || primary.fingerprint || '',
      createdAt: primary.created || '',
      hasSecret: Boolean(sign),
      canSign: Boolean(sign),
      source: 'options',
      roles: Array.isArray(primary.roles) ? primary.roles : [],
      removable: false,
    };
  }

  /** Всички ключове за панела: прикачените първи, после този от опциите (без дубликат по keyId). */
  function keys() {
    const list = consoleKeys().map(view);
    const opt = optionsKey();
    if (opt && !list.some((k) => k.keyId === opt.keyId)) list.push(opt);
    return list;
  }

  /** Търсене по id, keyId или fingerprint — прикачените първи, после този от опциите. */
  function find(ref) {
    // id-то на ключа от опциите съдържа двоеточие (`options:<keyId>`), а в адрес то идва
    // като `%3A` — затова се разкодира тук, а не във всеки маршрут поотделно.
    let wanted = String(ref || '').trim();
    if (!wanted) return null;
    try {
      if (wanted.includes('%')) wanted = decodeURIComponent(wanted);
    } catch {
      /* невалидно кодиране: остава както е */
    }
    const lc = wanted.toLowerCase();
    const record = consoleKeys().find(
      (k) => k.id === wanted || k.keyId === wanted || String(k.fingerprint || '').toLowerCase() === lc,
    );
    if (record) return { ...view(record), record };
    const opt = optionsKey();
    if (!opt) return null;
    if (wanted.startsWith(OPTIONS_PREFIX)) return opt.keyId === wanted.slice(OPTIONS_PREFIX.length) ? opt : null;
    return opt.keyId === wanted || String(opt.fingerprint || '').toLowerCase() === lc ? opt : null;
  }

  /** Подпис с ключа от опциите — или `null`, когато той няма секретна част. */
  function optionsSigner() {
    const opt = optionsKey();
    if (!opt || !opt.canSign) return null;
    return { keyId: opt.keyId, label: opt.label, source: 'options', sign: (data) => keyring.signDetached(data) };
  }

  /**
   * С какво да се подпише. Редът: поисканият ключ (ако има секрет) → първият прикачен със
   * секрет → ключът от опциите. Връща `null`, когато няма с какво — викащият казва защо.
   */
  function signer(ref) {
    const found = find(ref);
    // Изрично избран ключ от опциите подписва той — иначе прикачен ключ би го изпреварил,
    // а човекът точно него е избрал в „Ключ за подписване“.
    if (found && !found.record) return optionsSigner();
    const candidates = [];
    if (found && found.record) candidates.push(found.record);
    candidates.push(...consoleKeys().filter((k) => k.secretEnc && (!found || !found.record || k.id !== found.record.id)));
    for (const key of candidates) {
      const secret = decryptSecret(key);
      if (!secret) continue;
      return {
        keyId: key.keyId,
        label: key.label || '',
        source: 'console',
        sign: (data) => pgp.signDetached(data, secret),
      };
    }
    return optionsSigner();
  }

  /** Има ли с какво да се подпише (за да не се предлага невъзможна настройка). */
  function canSign() {
    if (consoleKeys().some((k) => k.secretEnc)) return true;
    const opt = optionsKey();
    return Boolean(opt && opt.canSign);
  }

  /**
   * Публичният ключ за проверка: подаден изрично (стар ключ) → прикачен със същия keyId →
   * ключът от опциите. Празен низ значи „няма с какво да се провери“.
   */
  function publicKeyFor(keyId, supplied) {
    const given = String(supplied || '').trim();
    if (given) return given;
    const wanted = String(keyId || '').trim().toLowerCase();
    if (wanted) {
      const consoleKey = consoleKeys().find(
        (k) => String(k.keyId || '').toLowerCase() === wanted || String(k.fingerprint || '').toLowerCase() === wanted,
      );
      if (consoleKey && consoleKey.publicArmored) return consoleKey.publicArmored;
    }
    return keyring.publicText() || '';
  }

  /** Проверка на деташиран подпис с възможно най-подходящия публичен ключ. */
  function verify(data, signature, keyId, supplied) {
    const publicArmored = publicKeyFor(keyId, supplied);
    if (!publicArmored) return { valid: false, reason: 'NO_PUBLIC_KEY' };
    return pgp.verifyDetached(data, signature, publicArmored);
  }

  return { view, keys, find, signer, canSign, publicKeyFor, verify, optionsKey, OPTIONS_PREFIX, OPTIONS_LABEL };
}

module.exports = { create, OPTIONS_PREFIX, OPTIONS_LABEL };
