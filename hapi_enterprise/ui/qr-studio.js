'use strict';
// QR СТУДИО — ЕДНО ГЛОБАЛНО МЯСТО ЗА ВСЯКА QR ОПЕРАЦИЯ (0.69.229).
//
// Защо: QR кодът дотук живееше на три места и по три различни начина — поповер до брошката на
// портала, мрежа „QR за всяко ниво“ в блока с папките и отделен панел за токени. Едно и също
// нещо се виждаше различно, а „само за четене“ и „временен“ нямаше къде да се поискат.
//
// Договорът тук е един и глобален (`window.HapiQrStudio`), за да го ползва ВСЕКИ панел:
//   • `open(spec)`  — изскачащ прозорец с ЧЕТИРИ раздела: обикновен · само за четене ·
//                     временен (срок/парола/само за четене) · папки и файлове;
//   • `figure(url, label)` — рамка с QR код и ЛИНКА, изписана в долния ръб (еднакъв вид навсякъде);
//   • `copy(text, label)`  — копиране с потвърждение;
//   • `close()`.
//
// Панелът подава АДРЕСИТЕ и една функция за издаване на временна връзка — модулът не знае нищо
// за токени, ingress или портали. Така същият прозорец работи за портал, за папка, за файл и за
// каквото дойде след тях, без да се преписва.
(function () {
  const T = (key, fallback) => {
    try {
      const api = window.HapiI18n;
      if (api && typeof api.t === 'function') {
        const out = api.t(key);
        if (out && out !== key) return out;
      }
    } catch {
      /* липсващ речник: ползва се резервният текст */
    }
    return fallback == null ? key : fallback;
  };

  const esc = (v) =>
    String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** Активното състояние на прозореца. Едно на страница — както подсказва „глобално“. */
  const state = {
    spec: null,
    index: 0,
    tab: 'plain',
    temp: { readOnly: false, password: false, ttl: 3600, passwordValue: '' },
    result: null,
    busy: false,
    error: '',
    modal: null,
    returnFocus: null,
  };

  const TABS = [
    ['plain', 'qr.tab.plain', 'Обикновен'],
    ['readonly', 'qr.tab.readonly', 'Само за четене'],
    ['temp', 'qr.tab.temp', 'Временен'],
    ['levels', 'qr.tab.levels', 'Папки и файлове'],
  ];

  const TTL_CHOICES = [
    [3600, 'qr.ttl.1h', '1 час'],
    [21600, 'qr.ttl.6h', '6 часа'],
    [86400, 'qr.ttl.24h', '24 часа'],
  ];

  const level = () => {
    const levels = (state.spec && state.spec.levels) || [];
    return levels[state.index] || levels[0] || null;
  };

  // ── Рамка с код и линк ───────────────────────────────────────────────────
  /**
   * Еднакъв вид навсякъде: изпъкнала рамка с ъгълчета, код в средата и ЛИНКЪТ, изписан в
   * долния ръб — така разпечатан или сниман, кодът носи и адреса си, а не само картинка.
   */
  function figure(url, label, opts) {
    const o = opts || {};
    const svg = o.svg || render(url);
    const text = String(url || '');
    const shown = o.short || text;
    if (!svg) {
      return `<figure class="qs-figure qs-empty"><div class="qs-frame"><p class="hint">${esc(T('qr.missing', 'Кодът не може да бъде построен'))}</p></div></figure>`;
    }
    return `<figure class="qs-figure">
        <div class="qs-frame">
          <span class="qs-corner qs-corner-tl" aria-hidden="true"></span><span class="qs-corner qs-tr" aria-hidden="true"></span>
          <span class="qs-corner qs-bl" aria-hidden="true"></span><span class="qs-corner qs-br" aria-hidden="true"></span>
          <div class="qs-code" role="img" aria-label="${esc(o.alt || T('qr.alt', 'QR код към {url}', { url: shown }))}">${svg}</div>
        </div>
        <figcaption class="qs-caption">
          ${label ? `<span class="qs-caption-label">${esc(label)}</span>` : ''}
          <span class="qs-caption-url" title="${esc(text)}">${esc(shown)}</span>
        </figcaption>
      </figure>`;
  }

  /** Клиентският построител идва от панела (`qrcode.js`); без него няма какво да се покаже. */
  function render(text) {
    try {
      const fn = state.spec && state.spec.qrSvg;
      return typeof fn === 'function' ? String(fn(text) || '') : '';
    } catch {
      return '';
    }
  }

  // ── Действия ─────────────────────────────────────────────────────────────
  async function copy(text, label) {
    const value = String(text || '');
    if (!value) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(value);
      else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.className = 'qs-clip';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      notify(T('qr.copied', 'Адресът е копиран') + (label ? ': ' + label : ''));
      return true;
    } catch {
      notify(T('qr.copyFailed', 'Копирането не е разрешено от браузъра'), true);
      return false;
    }
  }

  /** Изтегляне на кода като SVG файл — същият код, който е на екрана. */
  function downloadSvg(url, label) {
    const svg = render(url);
    if (!svg) {
      notify(T('qr.missing', 'Кодът не може да бъде построен'), true);
      return;
    }
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = safeName(label || 'qr') + '.svg';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Таймер не се оставя: `revokeObjectURL` веднага след клика е достатъчно, а дългият
    // таймер държи процеса жив в тестовете (вж. `revokeLater` в `files-manager.js`).
    setTimeout(() => URL.revokeObjectURL(href), 0);
  }

  const safeName = (v) =>
    String(v || 'qr')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'qr';

  function notify(message, isError) {
    const el = state.modal && state.modal.querySelector('#qs-note');
    if (el) {
      el.textContent = message;
      el.classList.toggle('qs-note-err', Boolean(isError));
      el.hidden = false;
    }
  }

  // ── Раздели ──────────────────────────────────────────────────────────────
  function linkRow(label, url, kind) {
    if (!url) return '';
    return `<div class="qs-link-row">
        <span class="qs-link-label">${esc(label)}</span>
        <code class="qs-link-value" title="${esc(url)}">${esc(url)}</code>
        <button type="button" class="btn btn-sm qs-copy" data-qs-copy="${esc(url)}" data-qs-copy-label="${esc(label)}">${esc(
          T('qr.copy', 'Копирай'),
        )}</button>
        ${kind === 'download'
        ? `<button type="button" class="btn btn-sm qs-open" data-qs-download="${esc(url)}" data-qs-download-label="${esc(label)}">${esc(
          T('qr.download', 'Изтегли'),
        )}</button>`
        : `<a class="btn btn-sm qs-open" href="${esc(url)}" rel="noopener">${esc(T('qr.open', 'Отвори'))}</a>`}
      </div>`;
  }

  function toolbar(lv, target) {
    if (!target) return '';
    const lvLabel = lv ? lv.label : '';
    return `<div class="qs-actions">
        <a class="btn btn-sm btn-primary" href="${esc(target)}" rel="noopener">${esc(T('qr.toPortal', 'Към публичния портал'))}</a>
        <button type="button" class="btn btn-sm" data-qs-download="${esc(target)}" data-qs-download-label="${esc(
          lvLabel,
        )}">${esc(T('qr.download', 'Изтегли'))}</button>
        <button type="button" class="btn btn-sm qs-copy" data-qs-copy="${esc(target)}" data-qs-copy-label="${esc(
          lvLabel,
        )}">${esc(T('qr.copy', 'Копирай'))}</button>
      </div>`;
  }

  function tabPlain(lv) {
    if (!lv || !lv.page) return emptyTab();
    return `<div class="qs-panel">
        ${figure(lv.page, lv.label)}
        ${toolbar(lv, lv.page)}
        <div class="qs-links">
          ${linkRow(T('qr.link.page', 'Публичен портал'), lv.page)}
          ${linkRow(T('qr.link.download', 'Изтегляне'), lv.download || lv.page, 'download')}
          ${lv.api ? linkRow(T('qr.link.api', 'API на портала'), lv.api) : ''}
          ${lv.readOnly ? linkRow(T('qr.link.readOnly', 'Само за преглед'), lv.readOnly) : ''}
        </div>
        <p class="hint">${esc(T('qr.plainHint', 'Сканирането отваря публичната страница на това ниво.'))}</p>
      </div>`;
  }

  function tabReadonly(lv) {
    if (!lv || !lv.readOnly) {
      return `<div class="qs-panel"><p class="hint">${esc(
        T('qr.noReadOnly', 'Това ниво няма спътник „само за преглед“ — включи преглед при създаването на портала.'),
      )}</p></div>`;
    }
    return `<div class="qs-panel">
        ${figure(lv.readOnly, lv.label + ' · ' + T('qr.readOnlyShort', 'само за преглед'))}
        ${toolbar(lv, lv.readOnly)}
        <div class="qs-links">
          ${linkRow(T('qr.link.readOnly', 'Само за преглед'), lv.readOnly)}
        </div>
        <p class="hint">${esc(T('qr.readOnlyHint', 'Този код води до портала без изтегляне на файлове.'))}</p>
      </div>`;
  }

  function tabTemp(lv) {
    if (!lv) return emptyTab();
    const t = state.temp;
    const result = state.result;
    return `<div class="qs-panel">
        <form class="qs-temp" data-qs-temp>
          <label class="qs-check"><input type="checkbox" data-qs-opt="readOnly" ${t.readOnly ? 'checked' : ''} ${
      lv.readOnly ? '' : 'disabled'
    } /> <span>${esc(T('qr.temp.readOnly', 'Само за четене'))}</span>${
      lv.readOnly ? '' : ` <span class="hint">${esc(T('qr.temp.noCompanion', '(няма спътник за преглед)'))}</span>`
    }</label>
          <label class="qs-check"><input type="checkbox" data-qs-opt="password" ${t.password ? 'checked' : ''} /> <span>${esc(
      T('qr.temp.password', 'С парола'),
    )}</span></label>
          ${
      t.password
        ? `<div class="field qs-pw"><label for="qs-password">${esc(T('qr.temp.passwordLabel', 'Парола (4…64 знака)'))}</label>
             <input id="qs-password" type="password" autocomplete="new-password" maxlength="64" value="${esc(t.passwordValue)}" /></div>`
        : ''
    }
          <label class="qs-check"><input type="checkbox" data-qs-opt="ttl" ${t.ttl ? 'checked' : ''} /> <span>${esc(
      T('qr.temp.validity', 'С валидност'),
    )}</span></label>
          ${
      t.ttl
        ? `<div class="field qs-ttl"><label for="qs-ttl">${esc(T('qr.temp.ttl', 'Валиден до'))}</label>
             <select id="qs-ttl">${TTL_CHOICES.map(
    ([sec, key, fallback]) =>
      `<option value="${sec}" ${Number(t.ttl) === sec ? 'selected' : ''}>${esc(T(key, fallback))}</option>`,
  ).join('')}</select></div>`
        : ''
    }
          <button type="submit" class="btn btn-sm btn-primary" ${state.busy ? 'disabled' : ''}>${esc(
      T('qr.temp.generate', 'Генерирай връзка'),
    )}</button>
        </form>
        ${state.error ? `<p class="qs-note qs-note-err" role="alert">${esc(state.error)}</p>` : ''}
        ${
      result
        ? `<div class="qs-result">
             ${figure(result.url, T('qr.temp.result', 'Временна връзка'))}
             ${toolbar(lv, result.url)}
             <div class="qs-links">
               ${linkRow(T('qr.temp.link', 'Временна връзка'), result.url)}
             </div>
             <p class="hint">${esc(
      T('qr.temp.until', 'Валидна до {at}', { at: (result.expiresAt || '').replace('T', ' ').slice(0, 16) }),
    )}${result.readOnly ? ' · ' + esc(T('qr.readOnlyShort', 'само за преглед')) : ''}${
      result.hasPassword ? ' · ' + esc(T('qr.temp.withPassword', 'с парола')) : ''
    }</p>
           </div>`
        : ''
    }
      </div>`;
  }

  function tabLevels() {
    const levels = (state.spec && state.spec.levels) || [];
    if (!levels.length) return emptyTab();
    return `<div class="qs-panel">
        <p class="hint">${esc(
      T('qr.levelsHint', 'Същите четири раздела важат за всяко ниво — избери го тук.'),
    )}</p>
        <div class="qs-levels-grid">
          ${levels
      .slice(0, 200)
      .map(
        (lv, i) => `<button type="button" class="qs-level ${i === state.index ? 'qs-level-on' : ''}" data-qs-level="${i}" ${
          i === state.index ? 'aria-current="true"' : ''
        }>
                    ${figure(lv.page, lv.label)}
                  </button>`,
      )
      .join('')}
        </div>
      </div>`;
  }

  function emptyTab() {
    return `<div class="qs-panel"><p class="hint">${esc(T('qr.noLevels', 'Няма избрано ниво.'))}</p></div>`;
  }

  // ── Прозорецът ───────────────────────────────────────────────────────────
  function ensureModal() {
    if (state.modal && state.modal.isConnected) return state.modal;
    const box = document.createElement('div');
    box.className = 'qs-backdrop';
    box.id = 'qs-modal';
    box.hidden = true;
    box.innerHTML = `<div class="qs-window" role="dialog" aria-modal="true" aria-labelledby="qs-title">
        <div class="qs-head">
          <h3 class="qs-title" id="qs-title"></h3>
          <div class="qs-head-right">
            <label class="qs-level-pick"><span>${esc(T('qr.levelPick', 'Ниво'))}</span>
              <select id="qs-level-select"></select>
            </label>
            <button type="button" class="fm-ico-btn qs-close" id="qs-close" title="${esc(T('qr.close', 'Затвори'))}" aria-label="${esc(
      T('qr.close', 'Затвори'),
    )}">✕</button>
          </div>
        </div>
        <div class="qs-tabs" role="tablist">
          ${TABS.map(
      ([id, key, fallback]) =>
        `<button type="button" class="qs-tab" role="tab" id="qs-tab-${id}" data-qs-tab="${id}" aria-controls="qs-body">${esc(
          T(key, fallback),
        )}</button>`,
    ).join('')}
        </div>
        <div class="qs-body" id="qs-body" role="tabpanel">
          <div class="qs-note-placeholder"><output class="qs-note" id="qs-note" hidden aria-live="polite"></output></div>
          <div id="qs-content"></div>
        </div>
      </div>`;
    document.body.appendChild(box);
    box.addEventListener('click', (e) => {
      if (e.target === box) close();
    });
    box.querySelector('#qs-close').addEventListener('click', () => close());
    box.querySelector('.qs-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-qs-tab]');
      if (!btn) return;
      state.tab = btn.dataset.qsTab;
      state.result = null;
      state.error = '';
      paint();
    });
    box.querySelector('#qs-level-select').addEventListener('change', (e) => {
      state.index = Number(e.target.value) || 0;
      state.result = null;
      state.error = '';
      paint();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    state.modal = box;
    return box;
  }

  function paint() {
    const box = state.modal;
    const spec = state.spec;
    if (!box || !spec) return;
    const lv = level();
    box.querySelector('#qs-title').textContent = T('qr.title', 'QR студио') + (spec.title ? ' · ' + spec.title : '');
    const select = box.querySelector('#qs-level-select');
    const levels = spec.levels || [];
    select.innerHTML = levels
      .map((l, i) => `<option value="${i}" ${i === state.index ? 'selected' : ''}>${esc(l.label)}</option>`)
      .join('');
    select.hidden = levels.length < 2;
    for (const [id] of TABS) {
      const btn = box.querySelector('#qs-tab-' + id);
      if (!btn) continue;
      const on = state.tab === id;
      btn.classList.toggle('qs-tab-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    const body =
      state.tab === 'plain'
        ? tabPlain(lv)
        : state.tab === 'readonly'
          ? tabReadonly(lv)
          : state.tab === 'temp'
            ? tabTemp(lv)
            : tabLevels();
    box.querySelector('#qs-content').innerHTML = body;
    wireContent();
  }

  /** Обработчиците на съдържанието се закачат наново при всяко рисуване (то е нов HTML). */
  function wireContent() {
    const box = state.modal;
    if (!box) return;
    for (const btn of box.querySelectorAll('.qs-copy')) {
      btn.addEventListener('click', () => copy(btn.dataset.qsCopy, btn.dataset.qsCopyLabel));
    }
    for (const btn of box.querySelectorAll('[data-qs-download]')) {
      btn.addEventListener('click', () => downloadSvg(btn.dataset.qsDownload, btn.dataset.qsDownloadLabel));
    }
    for (const btn of box.querySelectorAll('[data-qs-level]')) {
      btn.addEventListener('click', () => {
        state.index = Number(btn.dataset.qsLevel) || 0;
        state.result = null;
        state.error = '';
        state.tab = 'plain';
        paint();
      });
    }
    const form = box.querySelector('[data-qs-temp]');
    if (form) {
      form.addEventListener('submit', submitTemp);
      for (const input of form.querySelectorAll('[data-qs-opt]')) {
        input.addEventListener('change', () => {
          state.temp[input.dataset.qsOpt] = input.checked;
          if (input.dataset.qsOpt === 'ttl' && !input.checked) state.temp.ttl = 0;
          if (input.dataset.qsOpt === 'ttl' && input.checked) state.temp.ttl = state.temp.ttl || 3600;
          paint();
        });
      }
      const pw = form.querySelector('#qs-password');
      if (pw) pw.addEventListener('input', () => (state.temp.passwordValue = pw.value));
      const ttl = form.querySelector('#qs-ttl');
      if (ttl) ttl.addEventListener('change', () => (state.temp.ttl = Number(ttl.value) || 3600));
    }
  }

  async function submitTemp(e) {
    e.preventDefault();
    const lv = level();
    const spec = state.spec;
    if (!lv || !spec || typeof spec.createLink !== 'function' || state.busy) return;
    if (state.temp.password && String(state.temp.passwordValue || '').length < 4) {
      state.error = T('qr.temp.passwordShort', 'Паролата трябва да е поне 4 знака');
      paint();
      return;
    }
    state.busy = true;
    state.error = '';
    paint();
    try {
      const out = await spec.createLink(lv, {
        readOnly: Boolean(state.temp.readOnly && lv.readOnly),
        password: state.temp.password ? String(state.temp.passwordValue || '') : '',
        ttlSeconds: state.temp.ttl ? Number(state.temp.ttl) : 0,
      });
      state.result = out || null;
      if (!out || !out.url) state.error = T('qr.temp.failed', 'Връзката не беше създадена');
    } catch (err) {
      state.error = (err && err.message) || T('qr.temp.failed', 'Връзката не беше създадена');
    } finally {
      state.busy = false;
      paint();
    }
  }

  function open(spec) {
    if (!spec || !Array.isArray(spec.levels) || !spec.levels.length) return false;
    state.spec = spec;
    state.index = Math.min(Math.max(Number(spec.index) || 0, 0), spec.levels.length - 1);
    state.tab = spec.tab && TABS.some(([id]) => id === spec.tab) ? spec.tab : 'plain';
    state.temp = { readOnly: false, password: false, ttl: 3600, passwordValue: '' };
    state.result = null;
    state.error = '';
    state.busy = false;
    const box = ensureModal();
    state.returnFocus = document.activeElement;
    box.hidden = false;
    paint();
    const first = box.querySelector('.qs-tab-on') || box.querySelector('#qs-close');
    if (first && first.focus) first.focus();
    return true;
  }

  function close() {
    const box = state.modal;
    if (!box) return;
    box.hidden = true;
    const back = state.returnFocus;
    state.returnFocus = null;
    state.spec = null;
    if (back && back.isConnected && back.focus) back.focus();
  }

  const API = { open, close, figure, copy, downloadSvg, isOpen: () => Boolean(state.modal && !state.modal.hidden), TABS };
  if (typeof window !== 'undefined') window.HapiQrStudio = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
