'use strict';
// Преглед на тайна връзка — страната на БРАУЗЪРА (модел като scrt.link v2).
//
// Целият линк е във фрагмента: `/secret#<id><ключ>` (22 + 43 знака). Оттук:
//   • `sha256(id)` е единственото, което стига до сървъра — той не знае нито кой запис
//     отваряш, нито ключа;
//   • ключът (32 байта, base64url) остава в този браузър;
//   • ако тайната е с парола, пликът е шифрован ДВА пъти: отвън с ключ от паролата
//     (PBKDF2-SHA256, 600 000 итерации), отвътре с ключа от линка. Сървърът сравнява
//     само `sha256(ключ от паролата)` (`pwd.check`), за да не изразходва преглед при
//     сгрешена парола — и никога не вижда самата парола.
//
// Фрагментът се маха от адресната лента веднага след прочитане, за да не остане в
// историята на браузъра като работещ ключ.
(function () {
  const ID_LENGTH = 22;
  const KEY_LENGTH = 43;
  const FRAGMENT_LENGTH = ID_LENGTH + KEY_LENGTH;
  const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{22}$/;
  const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  const CIPHERTEXT_PATTERN = /^[A-Za-z0-9_-]+$/;
  const SALT_PATTERN = /^[A-Za-z0-9_-]{22}$/;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const $ = (id) => document.getElementById(id);

  const b64uToBytes = (value) => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
    const raw = atob(padded);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };

  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  async function sha256Hex(bytes) {
    return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  }

  const importLinkKey = (bytes) => crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['decrypt']);

  /** Ключът от паролата: PBKDF2-SHA256 → 32 байта, които служат и за proof, и за AES. */
  async function derivePasswordKey(password, saltB64u, iterations) {
    const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: b64uToBytes(saltB64u), iterations, hash: 'SHA-256' },
      material,
      256,
    );
    const bytes = new Uint8Array(bits);
    return { bytes, key: await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['decrypt']) };
  }

  async function decryptAes(key, ivB64u, ctB64u) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uToBytes(ivB64u) }, key, b64uToBytes(ctB64u));
    return decoder.decode(plain);
  }

  function show(message, kind) {
    const box = $('status');
    box.textContent = message;
    box.className = 'status ' + (kind || '');
    box.hidden = false;
  }

  function renderText(text) {
    const wrap = $('result');
    const pre = document.createElement('pre');
    pre.textContent = text;
    const row = document.createElement('div');
    row.className = 'row';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Копирай';
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = 'Копирано';
      } catch {
        copy.textContent = 'Неуспешно копиране';
      }
    };
    row.append(copy);
    wrap.replaceChildren(pre, row);
    wrap.hidden = false;
  }

  const goneMessage = 'Тази тайна вече не съществува — прегледана е, изтекла е или е отменена.';

  /** Връща `null` при мрежова грешка, иначе `{ ok, status, body }`. */
  async function callApi(path, options) {
    try {
      const res = await fetch(path, Object.assign({ cache: 'no-store', headers: { accept: 'application/json' } }, options || {}));
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body };
    } catch {
      return null;
    }
  }

  /** Разкрива тайната и я декриптира. `passwordKey` е `null`, когато няма парола. */
  async function openSecret(idHash, linkKeyB64u, passwordKey) {
    const options = { method: 'POST' };
    if (passwordKey) {
      options.headers = { accept: 'application/json', 'content-type': 'application/json' };
      options.body = JSON.stringify({ proof: await sha256Hex(passwordKey.bytes) });
    }
    const result = await callApi('/api/v2/secrets/' + idHash + '/reveal', options);
    if (!result) return show('Няма връзка със сървъра.', 'error');
    if (result.status === 403) {
      // Сгрешена парола: прегледът НЕ е изразходван, затова питаме пак.
      show('Паролата не е вярна. Прегледът не е изразходван — опитай отново.', 'error');
      $('unlock').hidden = false;
      return;
    }
    if (!result.ok) return show(result.status === 404 || result.status === 410 ? goneMessage : 'Тайната не може да бъде отворена (' + result.status + ').', 'error');

    const envelope = result.body.envelope || {};
    let inner = envelope;
    try {
      if (envelope.pwd) {
        if (!passwordKey) return show('Тази тайна иска парола.', 'error');
        inner = JSON.parse(await decryptAes(passwordKey.key, envelope.iv, envelope.ct));
      } else {
        inner = { iv: envelope.iv, ct: envelope.ct };
      }
      if (!inner || !CIPHERTEXT_PATTERN.test(String(inner.ct || '')) || typeof inner.iv !== 'string') {
        return show('Сървърът върна невалиден шифротекст.', 'error');
      }
      const text = await decryptAes(await importLinkKey(b64uToBytes(linkKeyB64u)), inner.iv, inner.ct);
      if (result.body.hint) show('Подсказка от подателя: ' + result.body.hint, 'hint');
      else if (result.body.viewsLeft === 0) show('Това беше последният преглед — тайната е изтрита от сървъра.', 'hint');
      else if (result.body.viewsLeft > 0) show('Остават още ' + result.body.viewsLeft + ' прегледа.', 'hint');
      renderText(text);
    } catch {
      // Грешка при декриптиране значи грешен ключ (или подменен плик).
      show('Ключът не отговаря на тази тайна (грешен или подменен линк).', 'error');
    }
  }

  async function main() {
    const raw = String(location.hash || '').replace(/^#/, '');
    // Фрагментът се маха от адреса веднага — дори когато е невалиден.
    if (raw) history.replaceState(null, '', location.pathname + location.search);
    if (!raw) {
      show('Липсва ключ в адреса. Отвори целия линк, копиран от подателя — частта след „#“ е ключът.', 'error');
      return;
    }
    if (raw.length !== FRAGMENT_LENGTH) {
      show('Линкът е непълен или повреден (очаквам ' + FRAGMENT_LENGTH + ' знака след „#“).', 'error');
      return;
    }
    const id = raw.slice(0, ID_LENGTH);
    const linkKeyB64u = raw.slice(ID_LENGTH);
    if (!ID_PATTERN.test(id) || !KEY_PATTERN.test(linkKeyB64u)) {
      show('Линкът е повреден — идентификаторът или ключът не са в очаквания формат.', 'error');
      return;
    }

    const idHash = await sha256Hex(encoder.encode(id));
    const probe = await callApi('/api/v2/secrets/' + idHash);
    if (!probe) return show('Няма връзка със сървъра.', 'error');
    if (!probe.ok) return show(probe.status === 404 || probe.status === 410 ? goneMessage : 'Тайната не може да бъде отворена (' + probe.status + ').', 'error');

    const hint = String(probe.body.hint || '');
    const left = Number(probe.body.remainingViews);
    const intro = hint ? 'Подсказка от подателя: ' + hint : '';

    if (probe.body.requiresPassword) {
      show((intro ? intro + ' · ' : '') + 'Тази тайна иска и парола.' + (Number.isFinite(left) ? ' Остават ' + left + ' прегледа.' : ''), 'wait');
      $('unlock').hidden = false;
      $('password').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') $('open').click();
      });
      $('open').onclick = () => unlock(idHash, linkKeyB64u, probe.body);
      $('password').focus();
      return;
    }

    if (intro) show(intro, 'hint');
    await openSecret(idHash, linkKeyB64u, null);
  }

  async function unlock(idHash, linkKeyB64u, probeBody) {
    const password = String($('password').value || '');
    if (!password) return show('Въведи паролата, която подателят ти е дал отделно от линка.', 'error');
    const pwd = probeBody && probeBody.pwd ? probeBody.pwd : null;
    if (!pwd || !SALT_PATTERN.test(String(pwd.salt || '')) || !Number.isSafeInteger(Number(pwd.iterations))) {
      return show('Сървърът не даде параметрите на паролата (сол/итерации).', 'error');
    }
    show('Проверявам паролата…', 'wait');
    try {
      const derived = await derivePasswordKey(password, pwd.salt, Number(pwd.iterations));
      await openSecret(idHash, linkKeyB64u, derived);
    } catch {
      show('Паролата не можа да бъде проверена в този браузър.', 'error');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
