'use strict';
// Генериране на тайни връзки в БРАУЗЪРА — моделът на scrt.link v2 (MIT), собствен код.
//
// Целият линк живее СЛЕД „#“: `/secret#<id><ключ>`. Фрагментът не се изпраща по мрежата,
// затова сървърът никога не вижда нито идентификатора, нито ключа — получава само
// `sha256(id)` (64 hex знака), по който намира записа, и непрозрачен плик с шифротекст.
// Затова: няма идентификатор в пътя (не влиза в логове/Referer/одит), няма възстановяване
// на линка от сървъра и няма начин тайната да бъде прочетена без фрагмента.
//
// Плик (`envelope`), непрозрачен за сървъра:
//   { v:2, iv:<b64u 12B>, ct:<b64u>, pwd?:{ alg:'PBKDF2-SHA256', iterations, salt, check } }
// Без парола: един слой AES-GCM с ключа от линка.
// С парола: `ct` е шифрован ДВА пъти — отвън с ключ от паролата (PBKDF2-SHA256, 600 000
// итерации, 16 B сол), отвътре с ключа от линка. `check = sha256(ключ от паролата)` остава
// на сървъра, за да не изгаря преглед при сгрешена парола; към получателя не се връща.
//
// Модулът работи в браузъра (`window.HapiSecretShare`) и в Node (за тестовете), стига да
// има WebCrypto и `fetch`.
(function () {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const ID_LENGTH = 22;
  const KEY_BYTES = 32;
  const KEY_LENGTH = 43;
  const IV_BYTES = 12;
  const SALT_BYTES = 16;
  const PBKDF2_ITERATIONS = 600000;
  const FRAGMENT_LENGTH = ID_LENGTH + KEY_LENGTH;
  const PROTOCOL = {
    idLength: ID_LENGTH,
    keyLength: KEY_LENGTH,
    fragmentLength: FRAGMENT_LENGTH,
    alphabet: ALPHABET,
    ivBytes: IV_BYTES,
    saltBytes: SALT_BYTES,
    iterations: PBKDF2_ITERATIONS,
    cipher: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA256',
    envelopeVersion: 2,
  };

  const webcrypto = () => (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  const encoder = () => new TextEncoder();

  function bytesToB64u(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64uToBytes(value) {
    const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }

  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const random = (length) => webcrypto().getRandomValues(new Uint8Array(length));

  /** Идентификатор: 22 знака от Crockford base32 (без I/L/O/U) ≈ 110 бита. */
  function newId(bytes) {
    const source = bytes || random(ID_LENGTH);
    let out = '';
    for (let i = 0; i < ID_LENGTH; i += 1) out += ALPHABET[source[i] % ALPHABET.length];
    return out;
  }

  const sha256Hex = async (text) => hex(new Uint8Array(await webcrypto().subtle.digest('SHA-256', encoder().encode(text))));

  const isValidId = (id) => typeof id === 'string' && /^[0-9A-HJKMNP-TV-Z]{22}$/.test(id);
  const isValidKey = (key) => typeof key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key);
  const isValidFragment = (fragment) =>
    typeof fragment === 'string' && fragment.length === FRAGMENT_LENGTH && isValidId(fragment.slice(0, ID_LENGTH)) && isValidKey(fragment.slice(ID_LENGTH));

  /** Плик с един слой (само ключът от линка). */
  async function sealWithLinkKey(text, keyBytes) {
    const key = await webcrypto().subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = random(IV_BYTES);
    const ct = await webcrypto().subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder().encode(text));
    return { v: PROTOCOL.envelopeVersion, iv: bytesToB64u(iv), ct: bytesToB64u(new Uint8Array(ct)) };
  }

  /** Външен слой: паролата шифрова целия вътрешен плик. */
  async function sealWithPassword(envelope, password) {
    const salt = random(SALT_BYTES);
    const material = await webcrypto().subtle.importKey('raw', encoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(
      await webcrypto().subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        material,
        256,
      ),
    );
    const pwdKey = await webcrypto().subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = random(IV_BYTES);
    const ct = await webcrypto().subtle.encrypt({ name: 'AES-GCM', iv }, pwdKey, encoder().encode(JSON.stringify(envelope)));
    return {
      v: PROTOCOL.envelopeVersion,
      iv: bytesToB64u(iv),
      ct: bytesToB64u(new Uint8Array(ct)),
      // Остава на сървъра: по него се разпознава сгрешена парола, без да гори преглед.
      pwd: { alg: PROTOCOL.kdf, iterations: PBKDF2_ITERATIONS, salt: bytesToB64u(salt), check: hex(bits) },
    };
  }

  /** Отваря плика с ключа от фрагмента (и паролата, ако има втори слой). */
  async function open({ envelope, fragment, password }) {
    if (!envelope) throw new Error('липсва плик');
    if (!isValidFragment(fragment)) throw new Error('фрагментът не е валиден');
    let current = envelope;
    if (envelope.pwd) {
      if (!password) throw new Error('нужна е парола');
      const salt = b64uToBytes(envelope.pwd.salt);
      const material = await webcrypto().subtle.importKey('raw', encoder().encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = new Uint8Array(
        await webcrypto().subtle.deriveBits(
          { name: 'PBKDF2', salt, iterations: Number(envelope.pwd.iterations) || PBKDF2_ITERATIONS, hash: 'SHA-256' },
          material,
          256,
        ),
      );
      const pwdKey = await webcrypto().subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['decrypt']);
      const plain = await webcrypto().subtle.decrypt(
        { name: 'AES-GCM', iv: b64uToBytes(envelope.iv) },
        pwdKey,
        b64uToBytes(envelope.ct),
      );
      current = JSON.parse(new TextDecoder().decode(plain));
    }
    const keyBytes = b64uToBytes(fragment.slice(ID_LENGTH));
    const key = await webcrypto().subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const text = await webcrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: b64uToBytes(current.iv) },
      key,
      b64uToBytes(current.ct),
    );
    return new TextDecoder().decode(text);
  }

  /** Адресът, под който живее публичната страница (същият префикс като панела). */
  function publicBase(explicit, loc) {
    if (explicit) return String(explicit).replace(/\/+$/, '');
    const where = loc || globalThis.location;
    if (!where || typeof where !== 'object') return '';
    if (where.protocol === 'file:') return '';
    // Панелът живее на `/ui/index.html`, `/ui/` или `/admin`; публичната страница е на
    // корена на СЪЩИЯ префикс (под HA Ingress префиксът е част от пътя).
    const path = String(where.pathname || '');
    const base = path
      .replace(/\/ui(\/index\.html)?\/?$/, '')
      .replace(/\/admin(\/.*)?$/, '')
      .replace(/\/+$/, '');
    return String(where.origin || '') + base;
  }

  /**
   * Създава тайна връзка.
   * @param {object} options
   * @param {string} options.text текстът (или адресът), който се споделя
   * @param {string} [options.hint] открита подсказка (единственото, което сървърът вижда)
   * @param {number} [options.ttlSeconds] срок на живота
   * @param {number} [options.maxViews] брой прегледи
   * @param {string} [options.password] втора парола (втори слой шифроване)
   * @param {string} [options.base] базов адрес (по подразбиране — този на панела)
   * @param {string} [options.path] път на публичната страница (по подразбиране `/secret`)
   * @param {Function} [options.fetch] HTTP клиент (за тестове)
   * @param {object} [options.headers] допълнителни заглавки (напр. Authorization)
   */
  async function create(options) {
    const opts = options || {};
    const text = String(opts.text == null ? '' : opts.text);
    if (!text.trim()) throw new Error('няма какво да се сподели');
    if (!webcrypto() || !webcrypto().subtle) throw new Error('средата няма WebCrypto');

    const keyBytes = random(KEY_BYTES);
    let envelope = await sealWithLinkKey(text, keyBytes);
    if (opts.password) envelope = await sealWithPassword(envelope, String(opts.password));

    // Идентификаторът се ражда тук; сървърът получава само неговия SHA-256.
    const secretId = newId();
    const idHash = await sha256Hex(secretId);

    const doFetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) throw new Error('средата няма fetch');
    const response = await doFetch('/admin/api/v2/secrets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
      body: JSON.stringify({
        envelope,
        idHash,
        hint: String(opts.hint || '').slice(0, 200),
        expires_in: Number(opts.ttlSeconds || 86400),
        max_views: Number(opts.maxViews || 1),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);

    const path = opts.path || data.path || '/secret';
    const base = publicBase(opts.base, opts.location);
    const fragment = secretId + bytesToB64u(keyBytes);
    return {
      link: base + path + '#' + fragment,
      fragment,
      path,
      id: secretId,
      idHash,
      receipt: data.receipt || '',
      expiresAt: data.expiresAt || null,
      maxViews: data.maxViews != null ? data.maxViews : Number(opts.maxViews || 1),
      requiresPassword: Boolean(data.requiresPassword || opts.password),
      envelopeBytes: JSON.stringify(envelope).length,
    };
  }

  /** Същият метод, но товарът е адрес към панела (или към портал) вместо текст. */
  async function createFromUrl(url, options) {
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target) && !/^\//.test(target)) throw new Error('нужен е http(s) адрес или път');
    return create({ ...(options || {}), text: target });
  }

  const API = {
    create,
    createFromUrl,
    open,
    publicBase,
    newId,
    sha256Hex,
    bytesToB64u,
    b64uToBytes,
    isValidId,
    isValidKey,
    isValidFragment,
    PROTOCOL,
  };
  if (typeof window !== 'undefined') window.HapiSecretShare = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
