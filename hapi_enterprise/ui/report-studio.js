'use strict';
// Report Studio (Фаза 11 / RS-02): библиотека → документ → свойства → A4 preview.
//
// Ползва същия валидатор като backend-а (hapi_enterprise/report-manifest.js).
// Preview е САМО оформление: не показва издадени RFC 3161 токени, сертификати
// или подписи — те се появяват единствено при реално изпълнение (RS-03/RS-05).
(function () {
  const M = globalThis.HapiReportManifest;
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (msg, kind) => window.HapiUI && window.HapiUI.toast(msg, kind);

  const OBJ = globalThis.HapiReportObjects;
  const TYPE_LABEL = OBJ ? Object.fromEntries(OBJ.OBJECTS.map((o) => [o.type, o.label])) : {};
  TYPE_LABEL[M.START] = TYPE_LABEL[M.START] || 'RFC 3161 START';
  TYPE_LABEL[M.STOP] = TYPE_LABEL[M.STOP] || 'RFC 3161 STOP';

  let host = null;
  let els = null;
  const state = {
    manifest: null,
    selectedId: null,
    dragId: null,
    lastHash: '',
    loadedExample: false,
    filter: 'all',
    tsaEnabled: false,
    history: [],
    future: [],
  };
  let typingBase = null;
  let typingTimer = null;

  function pushSnapshot(json) {
    state.history.push(json);
    if (state.history.length > 60) state.history.shift();
    state.future.length = 0;
  }

  function pushHistory() {
    pushSnapshot(JSON.stringify(state.manifest));
  }

  function resetHistory() {
    state.history.length = 0;
    state.future.length = 0;
    typingBase = null;
    clearTimeout(typingTimer);
  }

  // Писането в поле се обединява в един стъпка от историята (700 ms пауза).
  function markTyping() {
    if (typingBase === null) typingBase = JSON.stringify(state.manifest);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (typingBase !== null) {
        pushSnapshot(typingBase);
        typingBase = null;
      }
      updateHistoryButtons();
    }, 700);
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(JSON.stringify(state.manifest));
    state.manifest = JSON.parse(state.history.pop());
    if (!state.manifest.blocks.some((b) => b.id === state.selectedId)) state.selectedId = null;
    refresh();
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(JSON.stringify(state.manifest));
    state.manifest = JSON.parse(state.future.pop());
    if (!state.manifest.blocks.some((b) => b.id === state.selectedId)) state.selectedId = null;
    refresh();
  }

  function updateHistoryButtons() {
    if (!els) return;
    if (els.undo) els.undo.disabled = state.history.length === 0;
    if (els.redo) els.redo.disabled = state.future.length === 0;
  }

  function newBlock(type) {
    const def = OBJ && OBJ.get(type);
    const id = `${type.replace(/-/g, '')}${Math.random().toString(36).slice(2, 6)}`;
    const block = { id, type, label: (def && def.label) || TYPE_LABEL[type] || type };
    if (def && def.defaults) Object.assign(block, JSON.parse(JSON.stringify(def.defaults)));
    return block;
  }

  function insertBlock(type) {
    const blocks = state.manifest.blocks;
    const selected = blocks.findIndex((b) => b.id === state.selectedId);
    // След избрания блок; ако няма избор или е граничен — преди RFC 3161 STOP.
    const at = selected > 0 && selected < blocks.length - 1 ? selected + 1 : Math.max(blocks.length - 1, 1);
    pushHistory();
    const block = newBlock(type);
    blocks.splice(at, 0, block);
    state.selectedId = block.id;
    refresh();
  }

  function select(id) {
    state.selectedId = id;
    renderDoc();
    renderProps();
    renderPreview();
  }

  function move(id, delta) {
    const blocks = state.manifest.blocks;
    const index = blocks.findIndex((b) => b.id === id);
    const target = index + delta;
    if (index < 0 || target <= 0 || target >= blocks.length - 1) return;
    pushHistory();
    const [block] = blocks.splice(index, 1);
    blocks.splice(target, 0, block);
    refresh();
  }

  function removeBlock(id) {
    const blocks = state.manifest.blocks;
    const index = blocks.findIndex((b) => b.id === id);
    if (index <= 0 || index >= blocks.length - 1) return;
    pushHistory();
    blocks.splice(index, 1);
    state.selectedId = null;
    refresh();
  }

  function reorder(fromId, toId) {
    if (!fromId || fromId === toId) return;
    const blocks = state.manifest.blocks;
    const from = blocks.findIndex((b) => b.id === fromId);
    const to = blocks.findIndex((b) => b.id === toId);
    if (from <= 0 || from >= blocks.length - 1) return;
    if (to <= 0 || to >= blocks.length - 1) return;
    pushHistory();
    const [block] = blocks.splice(from, 1);
    blocks.splice(to, 0, block);
    refresh();
  }

  function shell() {
    host.innerHTML = `
      <div class="page-title">
        <h1>Report Studio</h1>
        <p>Manifest-driven отчет · RFC 3161 START → STOP</p>
        <span class="badge demo">Прототип</span>
      </div>

      <div class="rs-toolbar">
        <button type="button" class="btn" id="rs-new">＋ Нов</button>
        <button type="button" class="btn" id="rs-open">⤒ Отвори</button>
        <button type="button" class="btn" id="rs-save">⤓ Запази</button>
        <button type="button" class="btn" id="rs-validate">✓ Валидирай</button>
        <button type="button" class="btn" id="rs-undo" disabled title="Отмени последната промяна">↶</button>
        <button type="button" class="btn" id="rs-redo" disabled title="Повтори отменената промяна">↷</button>
        <input type="file" id="rs-file" accept="application/json,.json" hidden />
        <span class="badge" id="rs-state">—</span>
        <span class="hash-line" id="rs-hash" title="SHA-256 на нормализирания манифест"></span>
      </div>

      <div class="rs-grid">
        <section class="panel rs-lib-col">
          <div class="tabs" id="rs-tabs">
            <button type="button" class="active" data-filter="all">Всички</button>
            ${(OBJ ? OBJ.CATEGORIES : [])
              .map((c) => `<button type="button" data-filter="${c.id}" title="${esc(c.label)}">${c.icon}</button>`)
              .join('')}
          </div>
          <div class="lib-list" id="rs-lib"></div>
        </section>

        <section class="panel rs-doc-col">
          <div class="panel-head">
            <h2>Документ структура</h2>
            <span class="badge" id="rs-count">0</span>
          </div>
          <div class="doc-list" id="rs-doc"></div>
        </section>

        <section class="panel rs-props-col">
          <div class="panel-head"><h2>Свойства</h2><span class="badge" id="rs-sel">Общи</span></div>
          <div class="prop-body" id="rs-props"></div>
          <ul class="errors" id="rs-errors" hidden></ul>
        </section>

        <section class="panel rs-preview-col">
          <div class="panel-head">
            <h2>Live preview (A4)</h2>
            <span class="badge">не е сертификат</span>
          </div>
          <div class="a4-wrap"><div class="a4" id="rs-a4"></div></div>
          <div class="panel-body">
            <div class="u-grid u-grid-actions">
              <label>Формат
                <select id="rs-format">${M.PAGE_FORMATS.map((f) => `<option>${f}</option>`).join('')}</select>
              </label>
              <label><input type="checkbox" id="rs-sign" /> Дигитален подпис (SHA-256)</label>
              <label><input type="checkbox" id="rs-qr" /> QR код</label>
              <button type="button" class="btn btn-primary" id="rs-generate">Генерирай отчет</button>
            </div>
            <p class="hint">
              PDF се рендира от същия манифест през <code>POST /admin/api/v2/reports/render</code>
              (A4, portrait). Дигитален подпис и RFC 3161 са RS-05 — без тях PDF-ът е без печат,
              и това е записано в него.
            </p>
          </div>
        </section>
      </div>

      <section class="panel rs-tsa-col">
        <div class="panel-head">
          <h2>RFC 3161 TSA</h2>
          <span class="badge" id="rs-tsa-state">—</span>
        </div>
        <div class="panel-body">
          <p class="hint">
            BRIDGE режим: <strong>DFN START</strong> подпечатва манифеста, <strong>DigiCert STOP</strong> —
            затварящия хеш (START digest + START токен). TSQ/TSR се пазят като <code>.tsr</code> доказателство.
            При отказ на TSA няма запис и няма фалшив токен.
          </p>
          <div class="u-grid">
            <label>START TSA URL<input id="rs-tsa-start-url" value="https://zeitstempel.dfn.de/" readonly /></label>
            <label>STOP TSA URL<input id="rs-tsa-stop-url" value="http://timestamp.digicert.com" readonly /></label>
          </div>
          <div class="u-row">
            <button type="button" class="btn btn-primary" id="rs-tsa-start">Създай START TSA</button>
            <button type="button" class="btn" id="rs-tsa-stop">Създай STOP TSA</button>
          </div>
          <pre class="log-preview" id="rs-tsa-result">Изчаква.</pre>
        </div>
      </section>`;

    els = {
      lib: host.querySelector('#rs-lib'),
      doc: host.querySelector('#rs-doc'),
      props: host.querySelector('#rs-props'),
      a4: host.querySelector('#rs-a4'),
      errors: host.querySelector('#rs-errors'),
      state: host.querySelector('#rs-state'),
      hash: host.querySelector('#rs-hash'),
      count: host.querySelector('#rs-count'),
      sel: host.querySelector('#rs-sel'),
      file: host.querySelector('#rs-file'),
      undo: host.querySelector('#rs-undo'),
      redo: host.querySelector('#rs-redo'),
      tsaState: host.querySelector('#rs-tsa-state'),
      tsaResult: host.querySelector('#rs-tsa-result'),
      tsaStartUrl: host.querySelector('#rs-tsa-start-url'),
      tsaStopUrl: host.querySelector('#rs-tsa-stop-url'),
    };

    host.querySelector('#rs-new').addEventListener('click', () => {
      state.manifest = M.normalize(M.template('default'));
      state.selectedId = null;
      resetHistory();
      refresh();
      toast('Нов манифест', 'ok');
    });
    host.querySelector('#rs-open').addEventListener('click', () => els.file.click());
    els.file.addEventListener('change', openFile);
    host.querySelector('#rs-save').addEventListener('click', () => downloadManifest(false));
    els.undo.addEventListener('click', undo);
    els.redo.addEventListener('click', redo);
    host.querySelector('#rs-validate').addEventListener('click', () => {
      const result = M.check(state.manifest);
      toast(
        result.ok ? 'Манифестът е валиден' : `Невалиден манифест: ${result.errors[0].code}`,
        result.ok ? 'ok' : 'err',
      );
      renderErrors(result);
    });
    host.querySelector('#rs-generate').addEventListener('click', generate);
    host.querySelector('#rs-tsa-start').addEventListener('click', () => runTsa('start'));
    host.querySelector('#rs-tsa-stop').addEventListener('click', () => runTsa('stop'));
    void loadTsaStatus();

    const formatSelect = host.querySelector('#rs-format');
    formatSelect.value = state.manifest.page.format;
    formatSelect.addEventListener('change', () => {
      state.manifest.page.format = formatSelect.value;
      refresh({ keepProps: true });
    });
    host.querySelectorAll('#rs-tabs button').forEach((button) => {
      button.classList.toggle('active', button.dataset.filter === state.filter);
      button.addEventListener('click', () => {
        state.filter = button.dataset.filter;
        host.querySelectorAll('#rs-tabs button').forEach((b) => b.classList.toggle('active', b === button));
        renderLibrary();
      });
    });
  }

  function openFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        state.manifest = M.normalize(parsed);
        state.selectedId = null;
        resetHistory();
        refresh();
        const result = M.check(parsed);
        toast(result.ok ? 'Манифестът е зареден' : `Зареден, но невалиден: ${result.errors[0].code}`, result.ok ? 'ok' : 'err');
      } catch (e) {
        toast(`Невалиден JSON: ${e.message}`, 'err');
      }
      event.target.value = '';
    };
    reader.readAsText(file);
  }

  function downloadManifest(silent) {
    const result = M.check(state.manifest);
    if (!result.ok) {
      toast(`Поправи ${result.errors.length} грешк(и) преди експорт`, 'err');
      renderErrors(result);
      return false;
    }
    const blob = new Blob([JSON.stringify(result.manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `report-manifest-${result.manifest.profile || 'default'}.json`;
    link.click();
    URL.revokeObjectURL(url);
    if (!silent) toast('Манифестът е изтеглен (валидиран)', 'ok');
    return true;
  }

  async function generate() {
    const result = M.check(state.manifest);
    if (!result.ok) {
      toast(`Манифестът е невалиден: ${result.errors[0].code}`, 'err');
      renderErrors(result);
      return;
    }
    const wantsSignature = host.querySelector('#rs-sign').checked;
    const wantsQr = host.querySelector('#rs-qr').checked;
    const button = host.querySelector('#rs-generate');
    button.disabled = true;
    try {
      const { size, hash } = await requestPdf(result.manifest);
      const kb = Math.max(1, Math.round(size / 1024));
      const notes = [];
      if (wantsSignature) notes.push('без дигитален подпис (RS-05)');
      if (wantsQr) notes.push('QR е текст, не изображение (RS-06)');
      toast(
        `PDF: ${kb} KB · манифест ${hash ? hash.slice(0, 12) + '…' : 'без хеш'}${notes.length ? ' · ' + notes.join(', ') : ''}`,
        'ok',
      );
    } catch (e) {
      if (e.fallback) {
        downloadManifest(true);
        toast(`${e.message}. PDF рендерът изисква add-on (RS-03) — експортиран е манифестът.`, 'err');
      } else {
        toast(`Рендерът се провали: ${e.message}`, 'err');
      }
    } finally {
      button.disabled = false;
    }
  }

  // RFC 3161 START / STOP (порт от HASH_REPORT): токенът се създава от TSA,
  // никога от интерфейса. При отказ на TSA резултатът показва грешката.
  async function adminFetch(path, options) {
    if (location.protocol === 'file:') throw new Error('backend недостъпен (file://)');
    const init = options || {};
    const send = (token) =>
      fetch(path, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(init.headers || {}),
        },
      });
    let response = await send(sessionStorage.getItem('hapiAdminToken') || '');
    if (response.status === 401) {
      const entered = window.prompt('Админ токен за RFC 3161 (само за тази сесия):') || '';
      if (!entered.trim()) throw new Error('без админ токен');
      sessionStorage.setItem('hapiAdminToken', entered.trim());
      response = await send(entered.trim());
      if (response.status === 401) {
        sessionStorage.removeItem('hapiAdminToken');
        throw new Error('невалиден админ токен');
      }
    }
    return response;
  }

  async function loadTsaStatus() {
    if (!els || !els.tsaState || location.protocol === 'file:') return;
    try {
      const response = await adminFetch('/admin/api/v2/rfc3161', { method: 'GET' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (data.tsa && data.tsa.start) els.tsaStartUrl.value = data.tsa.start;
      if (data.tsa && data.tsa.stop) els.tsaStopUrl.value = data.tsa.stop;
      const records = Array.isArray(data.records) ? data.records : [];
      state.tsaEnabled = data.enabled !== false;
      const startBtn = host.querySelector('#rs-tsa-start');
      const stopBtn = host.querySelector('#rs-tsa-stop');
      if (startBtn) startBtn.disabled = !state.tsaEnabled;
      if (stopBtn) stopBtn.disabled = !state.tsaEnabled;
      els.tsaState.textContent = state.tsaEnabled
        ? records.length
          ? `${records.length} токена`
          : 'няма токени'
        : 'изключено (tsa_enabled)';
      els.tsaState.title = records
        .slice(0, 5)
        .map((r) => `${r.phase} · ${(r.token && r.token.genTime) || r.at}`)
        .join('\n');
    } catch {
      els.tsaState.textContent = 'недостъпен';
    }
  }

  async function runTsa(phase) {
    if (!els || !M) return;
    const result = M.check(state.manifest);
    if (!result.ok) {
      toast(`Манифестът е невалиден: ${result.errors[0].code}`, 'err');
      renderErrors(result);
      return;
    }
    const button = host.querySelector(phase === 'start' ? '#rs-tsa-start' : '#rs-tsa-stop');
    button.disabled = true;
    els.tsaResult.textContent = `Изпращам TSQ към ${phase.toUpperCase()} TSA…`;
    try {
      const url = (phase === 'start' ? els.tsaStartUrl.value : els.tsaStopUrl.value).trim();
      const response = await adminFetch('/admin/api/v2/rfc3161', {
        method: 'POST',
        body: JSON.stringify({ phase, manifest: result.manifest, url }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      els.tsaResult.textContent = JSON.stringify(
        { phase: data.phase, at: data.at, url: data.url, digest: data.digest, status: data.statusText, token: data.token },
        null,
        2,
      );
      els.tsaState.textContent = 'готово';
      toast(`${phase.toUpperCase()} TSA: ${data.statusText} · ${String((data.token && data.token.sha256) || '').slice(0, 12)}…`, 'ok');
      void loadTsaStatus();
    } catch (e) {
      els.tsaResult.textContent = 'Грешка: ' + e.message;
      els.tsaState.textContent = 'грешка';
      toast(`TSA ${phase.toUpperCase()}: ${e.message}`, 'err');
    } finally {
      button.disabled = !state.tsaEnabled;
    }
  }

  async function requestPdf(manifest) {
    // През file:// (GUI за тестове без сървър) няма backend — не пробваме мрежа.
    if (location.protocol === 'file:') {
      const e = new Error('backend недостъпен (file://)');
      e.fallback = true;
      throw e;
    }
    const send = (token) =>
      fetch('/admin/api/v2/reports/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ manifest }),
      });
    let response;
    try {
      response = await send(sessionStorage.getItem('hapiAdminToken') || '');
    } catch {
      const e = new Error('backend недостъпен');
      e.fallback = true;
      throw e;
    }
    if (response.status === 401) {
      const entered = window.prompt('Админ токен за PDF рендер (само за тази сесия):') || '';
      if (!entered.trim()) {
        const e = new Error('без админ токен');
        e.fallback = true;
        throw e;
      }
      sessionStorage.setItem('hapiAdminToken', entered.trim());
      response = await send(entered.trim());
      if (response.status === 401) {
        sessionStorage.removeItem('hapiAdminToken');
        throw new Error('невалиден админ токен');
      }
    }
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        message = (await response.json()).error || message;
      } catch {
        /* не-JSON отговор */
      }
      const e = new Error(message);
      if (response.status === 404) e.fallback = true;
      throw e;
    }
    const blob = await response.blob();
    const hash = response.headers.get('x-manifest-sha256') || '';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `report-${String(manifest.profile || 'default').replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
    return { size: blob.size, hash };
  }

  function refresh(options) {
    const keepProps = Boolean(options && options.keepProps);
    const result = M.check(state.manifest);
    renderLibrary();
    renderDoc();
    if (!keepProps) renderProps();
    renderPreview();
    renderErrors(result);
    const formatSelect = host.querySelector('#rs-format');
    if (formatSelect) formatSelect.value = state.manifest.page.format;
    updateHistoryButtons();
    els.count.textContent = `${state.manifest.blocks.length} блока`;
    els.state.className = `badge ${result.ok ? 'ok' : 'err'}`;
    els.state.textContent = result.ok
      ? 'валиден'
      : `${result.errors.length} ${result.errors.length === 1 ? 'грешка' : 'грешки'}`;
    M.digestAsync(state.manifest)
      .then((hex) => {
        state.lastHash = hex || '';
        els.hash.textContent = hex ? `sha256: ${hex.slice(0, 24)}…` : '';
        els.hash.title = hex ? `SHA-256: ${hex}` : '';
      })
      .catch(() => {
        els.hash.textContent = '';
      });
  }

  function renderLibrary() {
    els.lib.innerHTML = '';
    if (!OBJ) return;
    const visible = OBJ.byCategory(state.filter).filter((item) => item.status !== 'system');
    for (const item of visible) {
      const planned = item.status === 'planned';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `lib-item${planned ? ' planned' : ''}`;
      button.disabled = planned;
      button.draggable = !planned;
      button.dataset.type = item.type;
      button.title = planned ? `${item.label} — планирано (v2), още не се поддържа` : item.label;
      button.innerHTML = `<span class="sym" aria-hidden="true">${item.icon}</span><span>${esc(item.label)}</span>${planned ? '<small>v2</small>' : ''}`;
      if (!planned) {
        button.addEventListener('click', () => insertBlock(item.type));
        button.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', `new:${item.type}`);
        });
      }
      els.lib.appendChild(button);
    }
  }

  function renderDoc() {
    const blocks = state.manifest.blocks;
    els.doc.innerHTML = '';
    blocks.forEach((block, index) => {
      const isStart = index === 0;
      const isStop = index === blocks.length - 1;
      const row = document.createElement('div');
      row.className = [
        'doc-item',
        isStart ? 'start' : '',
        isStop ? 'stop' : '',
        isStart || isStop ? 'system' : '',
        block.id === state.selectedId ? 'selected' : '',
      ]
        .filter(Boolean)
        .join(' ');
      row.draggable = !isStart && !isStop;
      row.dataset.id = block.id;
      row.innerHTML = `
        <span class="idx">${index + 1}</span>
        <span class="label">${esc(block.label || TYPE_LABEL[block.type] || block.type)}</span>
        <span class="type">${esc(block.type)}</span>
        ${isStart || isStop ? '<span class="lock" title="Заключен">🔒</span>' : ''}
        <span class="row-actions">
          ${isStart || isStop ? '' : '<button type="button" data-act="up" title="Нагоре">↑</button><button type="button" data-act="down" title="Надолу">↓</button><button type="button" data-act="del" title="Изтрий">✕</button>'}
        </span>`;
      row.addEventListener('click', (e) => {
        const action = e.target.closest('button')?.dataset.act;
        if (action === 'up') return move(block.id, -1);
        if (action === 'down') return move(block.id, 1);
        if (action === 'del') return removeBlock(block.id);
        select(block.id);
      });
      row.addEventListener('dragstart', (e) => {
        if (isStart || isStop) return e.preventDefault();
        state.dragId = block.id;
        row.classList.add('dragging');
        e.dataTransfer.setData('text/plain', `move:${block.id}`);
      });
      row.addEventListener('dragend', () => {
        state.dragId = null;
        row.classList.remove('dragging');
      });
      row.addEventListener('dragover', (e) => {
        if (!isStart && !isStop) e.preventDefault();
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const payload = e.dataTransfer.getData('text/plain') || '';
        if (payload.startsWith('new:')) {
          const type = payload.slice(4);
          const blockNew = newBlock(type);
          const at = isStop ? blocks.length - 1 : blocks.findIndex((b) => b.id === block.id);
          blocks.splice(at < 1 ? 1 : at, 0, blockNew);
          state.selectedId = blockNew.id;
          refresh();
          return;
        }
        if (payload.startsWith('move:')) reorder(payload.slice(5), block.id);
      });
      els.doc.appendChild(row);
    });
  }

  function field(label, inputHtml) {
    return `<div class="field"><label>${esc(label)}</label>${inputHtml}</div>`;
  }

  function onChange(id, value) {
    const block = state.manifest.blocks.find((b) => b.id === id);
    if (!block) return;
    markTyping();
    Object.assign(block, value);
    // Панелът със свойства не се пре-рендира, за да не се губи фокусът при писане.
    refresh({ keepProps: true });
  }

  function renderProps() {
    const block = state.manifest.blocks.find((b) => b.id === state.selectedId);
    if (!block) {
      els.sel.textContent = 'Общи';
      els.props.innerHTML = `
        <h4>Документ</h4>
        ${field('Профил', `<input id="p-profile" value="${esc(state.manifest.profile)}" />`)}
        ${field('Формат', `<select id="p-format">${M.PAGE_FORMATS.map((f) => `<option ${f === state.manifest.page.format ? 'selected' : ''}>${f}</option>`).join('')}</select>`)}
        ${field('Ориентация', `<select id="p-orient">${M.ORIENTATIONS.map((o) => `<option ${o === state.manifest.page.orientation ? 'selected' : ''}>${o}</option>`).join('')}</select>`)}
        ${field('Полета (мм, 4 стойности)', `<input id="p-margins" value="${esc(state.manifest.page.marginsMm.join(','))}" />`)}
        ${field('Организация', `<input id="p-org" value="${esc(state.manifest.branding.organization)}" />`)}
        ${field('Долен колонтитул', `<input id="p-footer" value="${esc(state.manifest.print.footerNote)}" />`)}
        <p class="hint">Избери блок от „Документ структура“, за да редактираш съдържанието му.</p>`;
      wireCommon();
      return;
    }
    els.sel.textContent = TYPE_LABEL[block.type] || block.type;
    const locked = block.type === M.START || block.type === M.STOP;
    let html = `<h4>${esc(TYPE_LABEL[block.type] || block.type)}</h4>
      ${field('id', `<input value="${esc(block.id)}" readonly />`)}
      ${field('Етикет', `<input id="p-label" value="${esc(block.label || '')}" ${locked ? 'readonly' : ''} />`)}`;
    if (block.type === 'title') {
      html += field('Заглавие', `<input id="p-value" value="${esc(block.value || '')}" />`);
      html += field('Подзаглавие', `<input id="p-subtitle" value="${esc(block.subtitle || '')}" />`);
    } else if (block.type === 'text') {
      html += field('Текст', `<textarea id="p-value" rows="4">${esc(block.value || '')}</textarea>`);
    } else if (block.type === 'qr') {
      html += field('Стойност (URL)', `<input id="p-value" value="${esc(block.value || '')}" />`);
    } else if (block.type === 'table') {
      const columns = block.columns || [];
      html += field('Източник', `<input id="p-source" value="${esc(block.source || '')}" placeholder="records:1000" />`);
      html += `<h4 class="u-mt">Колони</h4>
        <ul class="col-list">${columns
          .map((c, i) => `<li><span>${esc(c)}</span>
            <button type="button" data-col="up" data-i="${i}" title="Нагоре" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" data-col="down" data-i="${i}" title="Надолу" ${i === columns.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" data-col="del" data-i="${i}" title="Изтрий">✕</button></li>`)
          .join('')}</ul>
        <div class="u-row u-row-2">
          <input id="p-newcol" placeholder="нова колона" />
          <button type="button" class="btn btn-sm" id="p-addcol">Добави</button>
        </div>
        <p class="hint">Ширини и повторение на заглавен ред — v2 (F8).</p>`;
    } else if (block.type === 'hash-table') {
      html += `<h4 class="u-mt">Алгоритми</h4>`;
      for (const alg of M.HASH_ALGORITHMS) {
        const checked = (block.algorithms || []).includes(alg) ? 'checked' : '';
        html += `<label class="hint row-check"><input type="checkbox" data-alg="${alg}" ${checked}/> ${alg}</label>`;
      }
    } else if (block.type === 'metadata') {
      html += field('Двойки (ключ=стойност, по един ред)', `<textarea id="p-items" rows="4">${esc((block.items || []).map((i) => `${i.key}=${i.value}`).join('\n'))}</textarea>`);
    } else if (block.type === 'signature') {
      html += `<p class="hint">Подписът се издава само при реално генериране (RS-05). В preview се показва „не е издаден“.</p>`;
    } else if (block.type === 'separator') {
      html += `<p class="hint">Хоризонтален разделител.</p>`;
    } else if (locked) {
      html += `<p class="hint">Системен блок: винаги първи/последен и заключен (ADR-0025).</p>`;
    }
    els.props.innerHTML = html;
    const labelInput = els.props.querySelector('#p-label');
    if (labelInput) labelInput.addEventListener('input', () => onChange(block.id, { label: labelInput.value }));
    const valueInput = els.props.querySelector('#p-value');
    if (valueInput) valueInput.addEventListener('input', () => onChange(block.id, { value: valueInput.value }));
    const subInput = els.props.querySelector('#p-subtitle');
    if (subInput) subInput.addEventListener('input', () => onChange(block.id, { subtitle: subInput.value }));
    const sourceInput = els.props.querySelector('#p-source');
    if (sourceInput) sourceInput.addEventListener('input', () => onChange(block.id, { source: sourceInput.value.trim() }));
    els.props.querySelectorAll('[data-col]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.i);
        const cols = (block.columns || []).slice();
        const act = btn.dataset.col;
        if (act === 'del') cols.splice(i, 1);
        if (act === 'up' && i > 0) [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]];
        if (act === 'down' && i < cols.length - 1) [cols[i + 1], cols[i]] = [cols[i], cols[i + 1]];
        pushHistory();
        block.columns = cols;
        refresh();
      });
    });
    const addCol = els.props.querySelector('#p-addcol');
    if (addCol) {
      addCol.addEventListener('click', () => {
        const input = els.props.querySelector('#p-newcol');
        const value = (input.value || '').trim();
        if (!value) return;
        pushHistory();
        block.columns = [...(block.columns || []), value];
        refresh();
      });
    }
    const itemsInput = els.props.querySelector('#p-items');
    if (itemsInput) {
      itemsInput.addEventListener('input', () =>
        onChange(block.id, {
          items: itemsInput.value
            .split('\n')
            .map((line) => line.split('='))
            .filter((parts) => parts[0] && parts[0].trim())
            .map((parts) => ({ key: parts[0].trim(), value: (parts[1] || '').trim() })),
        }),
      );
    }
    els.props.querySelectorAll('[data-alg]').forEach((box) => {
      box.addEventListener('change', () => {
        const algs = new Set(block.algorithms || []);
        if (box.checked) algs.add(box.dataset.alg);
        else algs.delete(box.dataset.alg);
        onChange(block.id, { algorithms: [...algs] });
      });
    });
  }

  function wireCommon() {
    const set = (id, apply) => {
      const node = host.querySelector(id);
      if (node) node.addEventListener('input', apply);
    };
    set('#p-profile', (e) => {
      state.manifest.profile = e.target.value.trim();
      refresh({ keepProps: true });
    });
    const fmt = host.querySelector('#p-format');
    if (fmt) fmt.addEventListener('change', (e) => { state.manifest.page.format = e.target.value; refresh({ keepProps: true }); });
    const orient = host.querySelector('#p-orient');
    if (orient) orient.addEventListener('change', (e) => { state.manifest.page.orientation = e.target.value; refresh({ keepProps: true }); });
    set('#p-margins', (e) => {
      state.manifest.page.marginsMm = e.target.value.split(',').map((n) => Number(n.trim()));
      refresh({ keepProps: true });
    });
    set('#p-org', (e) => { state.manifest.branding.organization = e.target.value; refresh({ keepProps: true }); });
    set('#p-footer', (e) => { state.manifest.print.footerNote = e.target.value; refresh({ keepProps: true }); });
  }

  function renderErrors(result) {
    if (result.ok) {
      els.errors.hidden = true;
      els.errors.innerHTML = '';
      return;
    }
    els.errors.hidden = false;
    els.errors.innerHTML = result.errors
      .slice(0, 8)
      .map((e) => `<li><code>${esc(e.code)}</code> — ${esc(e.message)}</li>`)
      .join('');
  }

  function previewSection(title, body) {
    return `<div class="pv-sec"><h5>${esc(title)}</h5>${body}</div>`;
  }

  function renderPreview() {
    const m = state.manifest;
    const rows = ['—', '—', '—'];
    const body = m.blocks
      .map((block) => {
        if (block.type === M.START) {
          return `<div class="pv-marker start"><span>RFC 3161 START</span><span>обхватът започва</span></div>`;
        }
        if (block.type === M.STOP) {
          return `<div class="pv-marker stop"><span>RFC 3161 STOP</span><span>обхватът завършва</span></div>`;
        }
        if (block.type === 'title') {
          return `<div class="pv-title">${esc(block.value || 'Заглавие')}</div>${
            block.subtitle ? `<div class="pv-sub">${esc(block.subtitle)}</div>` : ''
          }`;
        }
        if (block.type === 'text') {
          return previewSection(block.label || 'Текст', `<div>${esc(block.value || '')}</div>`);
        }
        if (block.type === 'metadata') {
          const items = block.items || [];
          return previewSection(
            block.label || 'Метаданни',
            `<table><tbody>${items
              .map((i) => `<tr><th class="w45">${esc(i.key)}</th><td>${esc(i.value)}</td></tr>`)
              .join('')}</tbody></table>`,
          );
        }
        if (block.type === 'table') {
          const cols = block.columns || [];
          return previewSection(
            block.label || 'Таблица',
            `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows
              .map((r) => `<tr>${cols.map(() => `<td>${r}</td>`).join('')}</tr>`)
              .join('')}</tbody></table>
             <div class="pv-note">източник: ${esc(block.source || '—')}</div>`,
          );
        }
        if (block.type === 'hash-table') {
          const algs = block.algorithms || [];
          return previewSection(
            block.label || 'Hash таблица',
            `<table><thead><tr><th>Алгоритъм</th><th>Стойност</th></tr></thead><tbody>${algs
              .map((a) => `<tr><td>${esc(a)}</td><td>…</td></tr>`)
              .join('')}</tbody></table>`,
          );
        }
        if (block.type === 'image') {
          return previewSection(block.label || 'Изображение', `<div class="pv-img"></div>`);
        }
        if (block.type === 'qr') {
          return `<div class="pv-qr" title="QR placeholder"></div>`;
        }
        if (block.type === 'separator') {
          return `<hr class="pv-hr" />`;
        }
        if (block.type === 'signature') {
          return `<div class="pv-sign">${esc(block.label || 'Подпис')}: <b>не е издаден</b> (SHA-256, RS-05)</div>`;
        }
        return '';
      })
      .join('');
    els.a4.innerHTML = `
      <div class="pv-head">
        <div class="pv-brand">${esc(m.branding.organization || 'hAPI ENTERPRISE')}<small>Enterprise Control Center</small></div>
        <div class="pv-meta">${esc(m.profile)}<br/>${new Date().toISOString().slice(0, 10)}</div>
      </div>
      ${body}
      <div class="pv-foot"><span>${esc(m.print.footerNote || '')}</span><span>1 / 1</span></div>`;
  }

  function mount(container) {
    host = container;
    // Състоянието живее извън DOM-а: навигацията към друг панел и обратно
    // не трябва да губи редакцията.
    if (!state.manifest) state.manifest = M.normalize(M.template('forensic-full'));
    shell();
    refresh();
    if (state.loadedExample) return;
    state.loadedExample = true;
    // Примерът идва от ui/data.js — така GUI-ят работи и през file:// (без fetch).
    const example = typeof window !== 'undefined' && window.HAPI_DATA && window.HAPI_DATA.manifest;
    if (example && state.manifest.blocks.length === 2) {
      state.manifest = M.normalize(example);
      state.selectedId = null;
      resetHistory();
      refresh();
    }
  }

  window.ReportStudio = { mount, state, refresh };
})();
