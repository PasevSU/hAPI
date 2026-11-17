'use strict';
// ДЪРВО-ПАНЕЛ НА ПОРТАЛА (ADR-0028, §7.1): цялото дърво на едно място, с маркиране.
//
// Защо съществува: дотук файловете се виждаха само по папки (един блок = една папка), а
// „направи отчет/архив от ТЕЗИ файлове“ нямаше откъде да се изрази. Тук дървото се показва
// плоско (пътят е името), маркирането отива в ГЛОБАЛНИЯ обект `HapiSelection` (D8), а
// действията ползват ВЕЧЕ съществуващите маршрути: отчет (`reports/oneclick`), ZIP
// (`reports/archive`), нова папка (`tree/folder`). Нищо сървърно не се дублира.
//
// Правилата, които панелът налага:
//   • блокът е АКОРДЕОН като другите и носи `aria-controls` САМО в разгънато състояние;
//   • низаци няма: всяко заглавие идва от `T()` (BG/EN/DE), а имената на файловете — от диска;
//   • грешка в едно действие не блокира останалите: тя се показва в реда за състояние;
//   • таймерите се освобождават през `revokeLater` (иначе процесът на тестовете не излиза).
(function () {
  const T = (key, vars) => (typeof window !== 'undefined' && window.HapiI18n ? window.HapiI18n.t(key, vars) : String(key));
  const esc = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const ico = (name) => (typeof window !== 'undefined' && window.HapiIcons ? window.HapiIcons.ico(name) : '');
  const sel = () => (typeof window !== 'undefined' ? window.HapiSelection : null);

  // Състоянието е на МОДУЛА, не в `files-manager`: презареждането на панела не бива да губи
  // вече изтегленото дърво (иначе всяко действие тегли отново целия списък).
  const state = { portalId: '', loading: false, error: '', data: null, note: '', noteKind: '', newFolder: false, bound: false };

  const fmtSize = (bytes) => {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  };

  /** Плоският списък на файловете: пътят е името, за да се маркира през папки. */
  function flatten(tree) {
    const out = [];
    const walk = (node) => {
      for (const file of node.files || []) {
        out.push({ path: String(file.path || file.name), name: String(file.name || ''), size: Number(file.size) || 0 });
      }
      for (const folder of node.folders || []) walk(folder);
    };
    if (tree) walk(tree);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Регистрираните файлове на портала по път в хранилището (`/<rel>`) — за прехвърляне. */
  function registeredByPath(portal) {
    const map = new Map();
    for (const file of (portal && portal.files) || []) {
      const key = String(file.storagePath || '').replace(/^\/+/, '');
      if (key) map.set(key, file.id);
    }
    return map;
  }

  function bodyHtml(ctx) {
    const connected = ctx.connected();
    if (!connected) return `<p class="hint">${esc(T('pt.demo'))}</p>`;
    if (state.loading && !state.data) return `<p class="hint">${esc(T('pt.loading'))}</p>`;
    if (state.error) return `<p class="hint u-err">${esc(state.error)}</p>`;
    if (!state.data) return `<p class="hint">${esc(T('pt.notLoaded'))}</p>`;
    const files = flatten(state.data.tree);
    if (!files.length) return `<p class="hint">${esc(T('pt.empty'))}</p>`;
    const selection = sel();
    const picked = selection ? selection.count() : 0;
    const rows = files
      .map((file) => {
        const checked = selection && selection.has(file.path);
        return `<li class="pt-row">
            <label class="pt-file">
              <input type="checkbox" data-pt-file="${esc(file.path)}" data-pt-name="${esc(file.name)}" ${checked ? 'checked' : ''} aria-label="${esc(T('pt.mark', { name: file.path }))}" />
              <span class="pt-path">${esc(file.path)}</span>
              <span class="pt-size">${esc(fmtSize(file.size))}</span>
            </label>
          </li>`;
      })
      .join('');
    const warn = state.data.truncated ? `<p class="hint">${esc(T('pt.truncated'))}</p>` : '';
    return `
      <p class="hint">${esc(T('pt.selected', { n: picked, total: files.length }))}</p>
      <div class="u-row u-row-2 u-mb">
        <button type="button" class="btn btn-sm" data-pt-all>${esc(T('pt.all'))}</button>
        <button type="button" class="btn btn-sm" data-pt-clear>${esc(T('pt.clear'))}</button>
      </div>
      <ul class="pt-list">${rows}</ul>
      ${warn}
      <div class="u-row u-row-2 u-mb">
        <button type="button" class="btn btn-sm btn-primary" data-pt-report>${esc(T('pt.report'))}</button>
        <button type="button" class="btn btn-sm" data-pt-zip>${esc(T('pt.zip'))}</button>
      </div>
      ${state.newFolder
        ? `<form class="pf-form u-mb" id="pt-folder-form">
             <div class="field"><input id="pt-folder-name" maxlength="100" autocomplete="off" placeholder="${esc(T('pt.folderName'))}" /></div>
             <div class="u-row u-row-2">
               <button type="submit" class="btn btn-sm btn-primary">${esc(T('pt.create'))}</button>
               <button type="button" class="btn btn-sm" data-pt-folder-cancel>${esc(T('pt.cancel'))}</button>
             </div>
           </form>`
        : ''}
      ${state.note ? `<p class="hint" data-pt-kind="${esc(state.noteKind)}">${state.note}</p>` : ''}`;
  }

  function paint() {
    if (typeof document === 'undefined') return;
    const body = document.getElementById('pf-tree-body');
    if (body && ctxRef) body.innerHTML = bodyHtml(ctxRef);
  }

  let ctxRef = null;

  async function load() {
    if (!ctxRef) return;
    const p = ctxRef.p;
    state.loading = true;
    state.error = '';
    paint();
    const res = await ctxRef.request(`/admin/api/portals/${encodeURIComponent(p.id)}/tree`);
    state.loading = false;
    if (!res.ok) {
      state.error = res.error || 'HTTP ' + res.status;
      state.data = null;
      paint();
      return;
    }
    state.data = res.data;
    paint();
  }

  const pickedPaths = () => {
    const selection = sel();
    return selection ? selection.keys() : [];
  };

  function setNote(text, kind) {
    state.note = text;
    state.noteKind = kind || '';
    paint();
  }

  async function runReport() {
    const paths = pickedPaths();
    if (!paths.length) return setNote(esc(T('pt.needSelection')), 'err');
    const res = await ctxRef.request('/admin/api/v2/reports/oneclick', {
      method: 'POST',
      json: { portal: ctxRef.p.id, type: 'selection', paths },
    });
    if (!res.ok) return setNote(esc(res.error || 'HTTP ' + res.status), 'err');
    const url = String((res.data && res.data.url) || '');
    // Линкът е готов за копиране: той е смисълът на отчета (изпраща се на проверяващ).
    setNote(`${esc(T('pt.reportDone'))} <a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(url)}</a>`, 'ok');
  }

  async function runZip() {
    const paths = pickedPaths();
    if (!paths.length) return setNote(esc(T('pt.needSelection')), 'err');
    const res = await ctxRef.request('/admin/api/v2/reports/archive', {
      method: 'POST',
      json: { portal: ctxRef.p.id, paths },
      raw: true,
    });
    if (!res.ok || !res.blob) return setNote(esc(res.error || 'HTTP ' + res.status), 'err');
    const url = URL.createObjectURL(res.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'report-selection.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Таймерът не бива да държи процеса: `revokeLater` прави `unref()` (иначе тестовете
    // чакат минута след последното твърдение).
    if (ctxRef.revokeLater) ctxRef.revokeLater(url, 60000);
    else setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote(esc(T('pt.zipDone', { n: paths.length })), 'ok');
  }

  async function createFolder(name) {
    const value = String(name || '').trim();
    if (!value) return;
    const res = await ctxRef.request(`/admin/api/portals/${encodeURIComponent(ctxRef.p.id)}/tree/folder`, {
      method: 'POST',
      json: { parent: '', name: value },
    });
    if (!res.ok) return setNote(esc(res.error || 'HTTP ' + res.status), 'err');
    state.newFolder = false;
    await load();
    setNote(esc(T('pt.folderDone', { name: value })), 'ok');
  }

  function bindOnce() {
    if (typeof document === 'undefined' || state.bound) return;
    state.bound = true;
    document.addEventListener('click', (event) => {
      const target = event.target && event.target.closest ? event.target : null;
      if (!target) return;
      if (target.closest('[data-pt-refresh]')) return void load();
      if (target.closest('[data-pt-all]')) {
        const files = flatten(state.data && state.data.tree);
        const selection = sel();
        const registered = registeredByPath(ctxRef && ctxRef.p);
        if (selection) {
          selection.replace(
            files.map((file) => ({ key: file.path, path: file.path, name: file.name, fileId: registered.get(file.path) || '' })),
          );
        }
        return paint();
      }
      if (target.closest('[data-pt-clear]')) {
        const selection = sel();
        if (selection) selection.clear();
        return paint();
      }
      if (target.closest('[data-pt-report]')) return void runReport();
      if (target.closest('[data-pt-zip]')) return void runZip();
      if (target.closest('[data-pt-newfolder]')) {
        state.newFolder = true;
        return paint();
      }
      if (target.closest('[data-pt-folder-cancel]')) {
        state.newFolder = false;
        return paint();
      }
    });
    document.addEventListener('change', (event) => {
      const box = event.target && event.target.closest ? event.target.closest('[data-pt-file]') : null;
      if (!box) return;
      const selection = sel();
      if (!selection) return;
      const registered = registeredByPath(ctxRef && ctxRef.p);
      selection.toggle(box.dataset.ptFile, {
        path: box.dataset.ptFile,
        name: box.dataset.ptName || '',
        fileId: registered.get(box.dataset.ptFile) || '',
      });
      paint();
    });
    document.addEventListener('submit', (event) => {
      const form = event.target && event.target.id === 'pt-folder-form' ? event.target : null;
      if (!form) return;
      event.preventDefault();
      const input = form.querySelector('#pt-folder-name');
      void createFolder(input ? input.value : '');
    });
  }

  /** Един блок за контейнера (договорът на `files-manager.js#panel`). */
  function render(ctx) {
    bindOnce();
    ctxRef = ctx;
    const p = ctx.p;
    if (state.portalId !== p.id) {
      // Смяна на портала: маркирането НЕ бива да остане от предишния (иначе отчетът би
      // описал файлове на друг портал).
      state.portalId = p.id;
      state.data = null;
      state.error = '';
      state.loading = false;
      state.note = '';
      state.newFolder = false;
      const selection = sel();
      if (selection) selection.clear();
    }
    const open = ctx.state.treeBlockOpen === true;
    if (open && !state.data && !state.loading && ctx.connected()) void load();
    return `
      <section class="pf-block ${open ? '' : 'pf-collapsed'}" data-block="tree">
        <div class="pf-block-head">
          <h5><button type="button" class="link-btn pf-block-tog" data-pf-tree-tog aria-expanded="${open}" ${open ? 'aria-controls="pf-tree-body"' : ''} title="${esc(
      open ? T('pt.toggle.collapse') : T('pt.toggle.expand'),
    )}">${ico(open ? 'chevronDown' : 'chevronRight')} ${ico('folder')} ${esc(T('pt.title'))}</button></h5>
          ${open ? `<span class="fm-ico-actions">
            <button type="button" class="fm-ico-btn" data-pt-newfolder title="${esc(T('pt.folder'))}">${ico('plus')}</button>
            <button type="button" class="fm-ico-btn" data-pt-refresh title="${esc(T('pt.refresh'))}">${ico('refresh')}</button>
          </span>` : ''}
        </div>
        ${open ? `<div class="pf-block-body" id="pf-tree-body">
          <p class="hint">${esc(T('pt.hint'))}</p>
          ${bodyHtml(ctx)}
        </div>` : ''}
      </section>`;
  }

  window.HapiPortalTree = { render, state, flatten };
})();
