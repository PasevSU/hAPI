'use strict';
// Преглед на тайна връзка — страната на БРАУЗЪРА.
//
// Ключът идва само във фрагмента на адреса (`/secret/<id>#<key>`), а фрагментът не се
// изпраща към сървъра. Затова сървърът вижда само шифротекста: `POST …/reveal` връща
// `{ ciphertext, iv }`, а AES-GCM се отваря тук, в WebCrypto.
//
// Фрагментът се маха от адресната лента веднага след прочитане, за да не остане в
// историята на браузъра като работещ ключ.
(function () {
  const $ = (id) => document.getElementById(id);
  const b64uToBytes = (value) => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
    const raw = atob(padded);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };

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

  async function main() {
    const id = $('secret').dataset.id;
    const raw = String(location.hash || '').replace(/^#/, '');
    // Ключът се маха от адреса веднага — дори когато е невалиден.
    if (raw) history.replaceState(null, '', location.pathname + location.search);
    if (!raw) {
      show('Липсва ключ в адреса. Отвори целия линк, копиран от подателя — частта след „#“ е ключът.', 'error');
      return;
    }
    let keyBytes;
    try {
      keyBytes = b64uToBytes(raw);
      if (keyBytes.length !== 32) throw new Error('length');
    } catch {
      show('Ключът в адреса е повреден (очаквам 32 байта след „#“).', 'error');
      return;
    }

    let payload;
    try {
      const res = await fetch('/api/v2/secrets/' + encodeURIComponent(id) + '/reveal', {
        method: 'POST',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 404 = вече я няма (прегледана или изтрита), 410 = още е на сървъра, но е мъртва
        // (изтекла или отменена). За получателя двете значат едно и също.
        show(
          res.status === 404 || res.status === 410
            ? 'Тази тайна вече не съществува — прегледана е, изтекла е или е отменена.'
            : 'Тайната не може да бъде отворена (' + res.status + ').',
          'error',
        );
        return;
      }
    } catch {
      show('Няма връзка със сървъра.', 'error');
      return;
    }

    let text = '';
    try {
      const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64uToBytes(payload.iv) },
        key,
        b64uToBytes(payload.ciphertext),
      );
      text = new TextDecoder().decode(plain);
    } catch {
      // Грешка при декриптиране значи грешен ключ — това е единственият честен отговор.
      show('Ключът не отговаря на тази тайна (грешен или подменен линк).', 'error');
      return;
    }

    if (payload.hint) show(payload.hint, 'hint');
    else if (payload.viewsLeft === 0) show('Това беше последният преглед — тайната е изтрита от сървъра.', 'hint');
    else if (payload.viewsLeft > 0) show('Остават още ' + payload.viewsLeft + ' прегледа.', 'hint');
    renderText(text);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
