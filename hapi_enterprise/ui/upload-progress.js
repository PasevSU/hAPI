'use strict';
// Прозорец за качване с РЕАЛЕН напредък, сверка по хеш и възстановяване (0.69.214).
//
// Защо отделен модул: досега качването беше `for` цикъл от `fetch` заявки без никаква следа
// на екрана — човек виждаше „нищо“ до тоста накрая. Тук процесът е видим, защото сървърът
// ПОТВЪРЖДАВА всяко парче: процентът, който се показва, е пристигнал байт, а не „изпратен“.
//
// Правилата:
//   • Задният план се затъмнява (`up-backdrop`), а прозорецът е `role="dialog" aria-modal`:
//     екранният четец не чете панела под него, а `body` получава `up-locked` (без скрол).
//   • Всеки файл носи своя SHA-256, изчислен в браузъра; сървърът сверява парчетата, целия
//     файл и после чете записаното обратно. Разминаване = отказ, а не „готово“.
//   • Датите не се пипат: `mtime` (последна промяна) се връща на сървъра от `file.lastModified`,
//     а датата на създаване се пази в историята. `ctime` не се задава — това е записано.
//   • Прекъсване НЕ започва отначало: сесията живее на сървъра, а идентификаторът ѝ се пази в
//     `sessionStorage`, за да може „Продължи“ да довърши същия файл (дори след презареждане).
(function () {
  const BAR_HIGH = 100;
  // Ключовете на речника са изброени и буквално: `tests/ui-i18n.cjs` проверява статично дали
  // всеки ключ се ползва, а състоянието се строи динамично (`up.state.<status>`).
  const STATE_KEY = {
    queued: 'up.state.queued',
    hash: 'up.state.hash',
    upload: 'up.state.upload',
    paused: 'up.state.paused',
    done: 'up.state.done',
    failed: 'up.state.failed',
    cancelled: 'up.state.cancelled',
  };
  const ERROR_KEY = { unreadable: 'up.error.unreadable', nohost: 'up.error.nohost' };

  const fmt = (bytes) => {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  };

  // Същият SHA-256 като на сървъра, но тук: иначе „сверено“ значи „сървърът вярва на себе си“.
  async function sha256Hex(buf) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const bytesOf = async (item) => {
    if (item.data) return item.data instanceof Uint8Array ? item.data : new Uint8Array(item.data);
    if (typeof item.arrayBuffer === 'function') return new Uint8Array(await item.arrayBuffer());
    throw new Error('up.error.unreadable: ' + (item.name || '?'));
  };

  function create(ctx) {
    const api = ctx.api;
    const T = ctx.translate || ((key) => key);
    const esc = ctx.escape || ((s) => String(s));
    const store = ctx.storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    const STORE_KEY = (ctx.key || 'hapi.upload.sessions') + (ctx.portalId ? ':' + ctx.portalId() : '');

    const state = {
      open: false,
      running: false,
      paused: false,
      cancelled: false,
      options: null,
      items: [],
      host: null,
      finished: null,
    };

    const remembered = () => {
      try {
        return JSON.parse((store && store.getItem(STORE_KEY)) || '{}') || {};
      } catch {
        return {};
      }
    };
    const remember = (rel, value) => {
      if (!store) return;
      const all = remembered();
      if (value) all[rel] = value;
      else delete all[rel];
      try {
        store.setItem(STORE_KEY, JSON.stringify(all));
      } catch {
        /* прехранилището е пълно — това не е повод да се провали качването */
      }
    };

    /** Колко е пристигнало общо — това е числото, което потребителят вижда. */
    function totals() {
      const size = state.items.reduce((n, it) => n + (it.size || 0), 0);
      const sent = state.items.reduce((n, it) => n + (it.sent || 0), 0);
      const done = state.items.filter((it) => it.status === 'done').length;
      const failed = state.items.filter((it) => it.status === 'failed').length;
      return { size, sent, done, failed, percent: size ? Math.min(BAR_HIGH, Math.round((sent / size) * BAR_HIGH)) : 0 };
    }

    function shell() {
      const t = totals();
      // Лентата е `<progress>`, а НЕ span с вграден `width`: панелът се сервира с
      // `Content-Security-Policy: style-src 'self'` (server.js), тоест всеки вграден стил се
      // блокира и лентата остава празна — точно това видя потребителят в Home Assistant
      // (DEF-62). `<progress value>` носи напредъка в АТРИБУТ, не в стил, и работи при
      // всяко CSP; затова и `aria-valuenow` се обновява от същия атрибут.
      return `<div class="up-dialog" role="dialog" aria-modal="true" aria-labelledby="up-title" aria-describedby="up-summary">
        <h3 id="up-title">${esc(T('up.title'))}</h3>
        <p id="up-summary" class="up-summary">${esc(
          T('up.summary', { files: state.items.length, size: fmt(t.size), percent: String(t.percent) }),
        )}</p>
        <div class="up-bar"><progress class="up-bar-progress" role="progressbar" max="${BAR_HIGH}" value="${t.percent}" aria-valuemin="0" aria-valuemax="${BAR_HIGH}" aria-valuenow="${t.percent}" aria-label="${esc(T('up.progressLabel'))}">${t.percent}%</progress></div>
        <ul class="up-list">${state.items.map((it) => row(it)).join('')}</ul>
        <div class="up-actions">
          <button type="button" data-up="pause">${esc(T('up.pause'))}</button>
          <button type="button" data-up="resume">${esc(T('up.resume'))}</button>
          <button type="button" data-up="cancel">${esc(T('up.cancel'))}</button>
          <button type="button" data-up="close">${esc(T('up.close'))}</button>
        </div>
      </div>`;
    }

    function row(item) {
      const send = item.size ? Math.round((item.sent / item.size) * BAR_HIGH) : item.status === 'done' ? BAR_HIGH : 0;
      const label = T(STATE_KEY[item.status] || STATE_KEY.queued, { percent: String(send) });
      const hash = item.sha256 ? `<span class="up-hash" title="${esc(item.sha256)}">${esc(item.sha256.slice(0, 12))}…</span>` : '';
      const err = item.error ? `<div class="up-error">${esc(item.error)}</div>` : '';
      return `<li class="up-item" data-up-item="${esc(item.rel)}" data-state="${esc(item.status)}">
        <div class="up-name">${esc(item.rel)}</div>
        <div class="up-meta">${esc(fmt(item.sent || 0))} / ${esc(fmt(item.size || 0))} · ${esc(label)} ${hash}</div>
        ${err}
      </li>`;
    }

    function paint() {
      if (!state.host) return;
      const dialog = state.host.querySelector('.up-dialog');
      const wrapper = dialog ? dialog.parentNode : null;
      if (wrapper) wrapper.innerHTML = shell();
      bind();
    }

    function bind() {
      if (!state.host) return;
      for (const btn of state.host.querySelectorAll('[data-up]')) {
        btn.onclick = () => act(btn.getAttribute('data-up'));
      }
    }

    /** Адресът на сесиите за качване — един и същ за всички действия на прозореца. */
    function currentBase() {
      const opts = Object.assign({}, ctx.options || {}, state.options || {});
      return typeof opts.base === 'function' ? opts.base() : opts.base || (ctx.base ? ctx.base() : '');
    }

    /**
     * Отказ. Изтрива се САМО сесията на сървъра (парчетата), никога готов файл; редът
     * става „отказано“ и в историята не влиза нищо. Работи и когато опашката е спряна —
     * иначе „Отказ“ при прекъсване не правеше нищо и файлът оставаше недовършен.
     */
    async function abort() {
      const base = currentBase();
      for (const entry of state.items) {
        if (entry.status === 'done' || entry.status === 'failed' || entry.status === 'cancelled') continue;
        if (entry.sessionId) {
          await api(`${base}/uploads/${entry.sessionId}`, { method: 'DELETE' }).catch(() => null);
          entry.sessionId = '';
        }
        remember(entry.rel, null);
        entry.status = 'cancelled';
      }
      paint();
      if (!state.running && state.finished) state.finished();
    }

    function act(name) {
      if (name === 'pause') {
        state.paused = true;
        paint();
      } else if (name === 'resume') {
        state.paused = false;
        if (!state.running) void run();
        else paint();
      } else if (name === 'cancel') {
        state.cancelled = true;
        paint();
        void abort();
      } else if (name === 'close') {
        close();
      }
    }

    function close() {
      if (state.host && state.host.parentNode) state.host.parentNode.removeChild(state.host);
      if (typeof document !== 'undefined' && document.body && document.body.classList) document.body.classList.remove('up-locked');
      state.open = false;
      state.host = null;
      if (state.finished) state.finished();
    }

    function open(items, options) {
      const opts = options || {};
      state.items = (items || []).map((it) => ({
        item: it,
        rel: it.rel,
        size: Number(it.size) || 0,
        sent: 0,
        status: 'queued',
        sha256: '',
        sessionId: '',
        error: '',
        resumed: false,
      }));
      state.paused = false;
      state.cancelled = false;
      state.running = false;
      state.open = true;
      state.options = opts;
      const host = opts.host || (typeof document !== 'undefined' ? document.body : null);
      if (!host) throw new Error('up.error.nohost');
      const wrap = document.createElement('div');
      wrap.className = 'up-backdrop';
      wrap.setAttribute('data-up-backdrop', '1');
      wrap.setAttribute('role', 'presentation');
      wrap.innerHTML = shell();
      host.appendChild(wrap);
      state.host = wrap;
      if (document.body && document.body.classList) document.body.classList.add('up-locked');
      bind();
      const done = new Promise((resolve) => {
        state.finished = resolve;
      });
      void run();
      return done;
    }

    async function openSession(entry, opts) {
      let data;
      try {
        data = await bytesOf(entry.item);
      } catch {
        // Браузърът не можа да прочете файла (преместен, само в облака, няма права) —
        // това е ЧЕТИМА причина, а не `HTTP 0`.
        throw new Error('up.error.unreadable');
      }
      entry.status = 'hash';
      paint();
      entry.sha256 = await sha256Hex(data);
      const known = remembered()[entry.rel];
      const resume = known && known.sha256 === entry.sha256 && known.size === entry.size ? known.sessionId : '';
      const r = await api(`${opts.base}/uploads`, {
        method: 'POST',
        json: {
          path: entry.rel,
          size: entry.size,
          sha256: entry.sha256,
          mtime: Number(entry.item.lastModified) || 0,
          createdAt: entry.item.lastModified ? new Date(entry.item.lastModified).toISOString() : null,
          chunkSize: opts.chunkSize || 0,
          overwrite: Boolean(opts.overwrite),
          mkdir: Boolean(opts.mkdir),
        },
      });
      if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`);
      entry.sessionId = r.data.sessionId;
      entry.chunkSize = r.data.chunkSize;
      entry.totalChunks = r.data.totalChunks;
      entry.chunks = new Set(r.data.chunks || []);
      if (resume && resume !== entry.sessionId) {
        // Старата сесия е изтекла — това не е грешка, просто се качва наново.
        entry.resumed = false;
      }
      remember(entry.rel, { sha256: entry.sha256, size: entry.size, sessionId: entry.sessionId });
      entry.data = data;
    }

    async function sendChunks(entry, opts) {
      entry.status = 'upload';
      paint();
      for (let index = 0; index < entry.totalChunks; index++) {
        if (state.cancelled) return 'cancelled';
        while (state.paused) {
          entry.status = 'paused';
          paint();
          await new Promise((r) => setTimeout(r, 120));
          if (state.cancelled) return 'cancelled';
        }
        if (entry.chunks.has(index)) continue;
        const from = index * entry.chunkSize;
        const to = Math.min(entry.data.length, from + entry.chunkSize);
        const slice = entry.data.subarray(from, to);
        const chunkSha = await sha256Hex(slice);
        const r = await api(`${opts.base}/uploads/${entry.sessionId}/${index}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-Sha256': chunkSha },
          body: slice,
        });
        if (!r.ok) {
          entry.status = 'paused';
          entry.error = r.error || `HTTP ${r.status}`;
          paint();
          return 'paused';
        }
        entry.sent += slice.length;
        entry.chunks.add(index);
        paint();
      }
      return 'ok';
    }

    async function complete(entry, opts) {
      const r = await api(`${opts.base}/uploads/${entry.sessionId}/complete`, { method: 'POST' });
      if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`);
      remember(entry.rel, null);
      entry.status = 'done';
      entry.sent = entry.size;
      entry.verified = r.data.verified;
      entry.history = r.data.history && r.data.history.file;
      entry.mtime = r.data.mtime || '';
      paint();
      return r.data;
    }

    async function run() {
      if (state.running) return;
      state.running = true;
      const opts = Object.assign({ mkdir: false, overwrite: false }, ctx.options || {}, state.options || {});
      opts.base = currentBase();
      const results = [];
      for (const entry of state.items) {
        if (entry.status === 'done') continue;
        if (state.cancelled) break;
        try {
          if (!entry.sessionId) await openSession(entry, opts);
          const phase = await sendChunks(entry, opts);
          if (phase === 'cancelled') {
            if (entry.sessionId) await api(`${opts.base}/uploads/${entry.sessionId}`, { method: 'DELETE' }).catch(() => null);
            remember(entry.rel, null);
            entry.status = 'cancelled';
            paint();
            break;
          }
          if (phase === 'paused') break;
          const done = await complete(entry, opts);
          results.push(done);
        } catch (e) {
          entry.status = 'failed';
          entry.error = String(e && e.message ? e.message : e).replace(/^up\.error\.(\w+)/, (all, key) => T(ERROR_KEY[key] || all));
          paint();
        }
      }
      state.running = false;
      if (!state.cancelled && state.items.every((it) => it.status === 'done' || it.status === 'failed')) {
        paint();
        if (typeof ctx.onFinish === 'function') ctx.onFinish(results, state.items);
        // Обещанието се затваря и тук, не само при „Затвори“: иначе панелът чака тост и
        // обновяване на дървото, докато човекът гледа обобщението. Прозорецът остава, за
        // да се види какво е сверено — затваря се с бутона.
        if (state.finished) state.finished();
      }
      return results;
    }

    return {
      open,
      state,
      run,
      close,
      /** За тестовете: какво показва прозорецът в момента. */
      view() {
        const t = totals();
        return {
          percent: t.percent,
          done: t.done,
          failed: t.failed,
          items: state.items.map((it) => ({ rel: it.rel, status: it.status, sent: it.sent, sha256: it.sha256, error: it.error })),
        };
      },
    };
  }

  // ── ОБЩ ИНДИКАТОР ЗА РАБОТА ────────────────────────────────────────────────
  /**
   * Един индикатор за всички панели, върху класовете от `components.css`.
   *
   *   begin({ mode: 'determinate' | 'indeterminate' | 'thinking', label, max, host })
   *
   * `determinate` ползва НАТИВЕН `<progress>` (CSP забранява `style="width:…"`, а `<progress>`
   * е и по-точен за екранен четец); `indeterminate` — лентата `.bar`; `thinking` — точките
   * `.think`. Връща handle: `set(value, text)`, `text(msg)`, `done(msg)`, `fail(msg)`, `close()`.
   * Няма собствени текстове: надписът идва от викащия (затова модулът остава с 0 български
   * низове в ратчета на i18n).
   */
  function progress(opts) {
    const o = opts || {};
    const doc = o.document || (typeof document !== 'undefined' ? document : null);
    if (!doc) throw new Error('progress: document is required');
    const host = o.host || doc.body;
    const mode = o.mode === 'determinate' || o.mode === 'thinking' ? o.mode : 'indeterminate';
    const box = doc.createElement('div');
    box.className = 'pg';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.setAttribute('aria-busy', 'true');
    const text = doc.createElement('span');
    text.className = 'pg-text';
    if (o.label) text.textContent = String(o.label);
    if (o.label) box.appendChild(text);
    let meter = null;
    if (mode === 'determinate') {
      meter = doc.createElement('progress');
      meter.className = 'pg-meter';
      meter.max = Number(o.max) > 0 ? Number(o.max) : 100;
      meter.value = 0;
      box.appendChild(meter);
    } else if (mode === 'thinking') {
      const dots = doc.createElement('span');
      dots.className = 'think';
      for (let i = 0; i < 3; i += 1) dots.appendChild(doc.createElement('i'));
      box.appendChild(dots);
    } else {
      const bar = doc.createElement('div');
      bar.className = 'bar';
      bar.setAttribute('data-indeterminate', '');
      bar.appendChild(doc.createElement('i'));
      box.appendChild(bar);
    }
    host.appendChild(box);
    let closed = false;
    const say = (msg, cls) => {
      if (msg != null) text.textContent = String(msg);
      if (!text.parentNode) box.insertBefore(text, box.firstChild);
      if (cls) text.classList.add(cls);
    };
    return {
      el: box,
      /** Задава стойност (само при `determinate`) и надпис; извън диапазона се отрязва. */
      set(value, msg) {
        if (closed) return this;
        if (meter) {
          const max = Number(meter.max) || 100;
          meter.value = Math.max(0, Math.min(Number(value) || 0, max));
        }
        say(msg);
        return this;
      },
      text(msg) {
        if (!closed) say(msg);
        return this;
      },
      /** Готово: обявява края и маха индикатора (той не бива да остава на екрана). */
      done(msg) {
        if (closed) return this;
        if (msg != null) say(msg);
        box.setAttribute('aria-busy', 'false');
        this.close();
        return this;
      },
      /** Провал: индикаторът ОСТАВА с обяснение, докато някой не го затвори. */
      fail(msg) {
        if (closed) return this;
        say(msg == null ? '' : msg, 'pg-err');
        box.setAttribute('aria-busy', 'false');
        return this;
      },
      close() {
        if (closed) return;
        closed = true;
        if (box.parentNode) box.parentNode.removeChild(box);
      },
    };
  }

  /**
   * „Заето“ върху бутон без нов маркъп: `aria-busy` включва спинер (`components.css`).
   * Връща функция за отмяна, която връща предишното състояние.
   */
  function attachBusy(btn) {
    // Без бутон няма какво да се отмени, но извикващият вика `stop()` без проверка — затова
  // се връща функция, която НЕ прави нищо (израз, не празно тяло: празното тяло изглежда
  // като забравена реализация и `tests/no-stubs.cjs` го отказва).
  if (!btn || typeof btn.setAttribute !== 'function') return () => undefined;
    const wasDisabled = Boolean(btn.disabled);
    btn.setAttribute('aria-busy', 'true');
    if ('disabled' in btn) btn.disabled = true;
    return () => {
      btn.setAttribute('aria-busy', 'false');
      if ('disabled' in btn) btn.disabled = wasDisabled;
    };
  }

  const API = { create, sha256Hex, fmt, progress, attachBusy };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') {
    window.HAPIUploadProgress = API;
    // Общият индикатор е достъпен за ВСЕКИ панел: едни класове, един договор
    // (`tests/ui-motion.cjs` пази движението, `tests/ui-progress.cjs` — поведението).
    window.HapiProgress = { begin: progress, attachBusy };
  }
})();
