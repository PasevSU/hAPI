'use strict';
// ПАНЕЛ „ОТЧЕТИ“ — листът с твърдогенерираните линкове (ADR-0028, §6.1).
//
// Защо съществува: всеки отчет с едно натискане получава адрес `/statik/<id>/<име>` и запис в
// `statik/index.json`. Линкът е смисълът на отчета — той се изпраща на проверяващ — затова
// човекът трябва да вижда КОГА, ЗА КАКВО и КЪДЕ сочи всеки линк, без да рови в диска.
//
// Тук НЯМА студио: отчетите се строят от мястото на бутона (портал · папка · файл · избрани),
// а този панел само чете листа (`GET /admin/api/v2/reports/links`) и позволява копиране и
// изтриване. Текстовете идват от речника (BG/EN/DE), линковете се рисуват като `href`, а
// имената — като текст (`textContent`), никога като разметка.
(function () {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (key, vars) =>
    typeof window !== 'undefined' && window.HapiI18n ? window.HapiI18n.t(key, vars) : String(key);
  const base = () => (typeof window.hapiApiBase === 'function' ? window.hapiApiBase() : '').replace(/\/$/, '');
  const token = () => sessionStorage.getItem('hapiAdminToken') || '';

  async function api(path, method = 'GET') {
    const url = base();
    if (!url) return { ok: false, offline: true };
    try {
      const res = await fetch(url + path, { method, headers: token() ? { Authorization: 'Bearer ' + token() } : {} });
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data, error: data && data.error ? data.error : '' };
    } catch (e) {
      return { ok: false, status: 0, error: e.message };
    }
  }

  const fmtTime = (iso) => {
    if (!iso) return '—';
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(iso);
  };
  const fmtBytes = (n) => {
    const value = Number(n) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1048576) return (value / 1024).toFixed(1) + ' KB';
    return (value / 1048576).toFixed(1) + ' MB';
  };

  async function copyLink(view, url) {
    const clip = window.navigator && window.navigator.clipboard;
    if (!clip || typeof clip.writeText !== 'function') {
      toast(view, T('rp.copyManual'), '');
      return;
    }
    try {
      await clip.writeText(url);
      toast(view, T('rp.copied'), 'ok');
    } catch {
      toast(view, T('rp.copyManual'), '');
    }
  }

  function toast(view, message, kind) {
    if (window.HapiUI && typeof window.HapiUI.toast === 'function') return window.HapiUI.toast(message, kind);
    const node = view.ownerDocument.createElement('div');
    node.className = 'toast ' + (kind || '');
    node.setAttribute('role', 'status');
    node.textContent = message;
    view.ownerDocument.body.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  function rowsOf(view, links) {
    const doc = view.ownerDocument;
    const body = view.querySelector('#rp-rows');
    // Панелът може да е вече демонтиран (навигация по средата на заявката) — тогава няма
    // къде да се рисува и това НЕ е грешка: следващото монтиране ще прочете листа наново.
    if (!body) return;
    body.textContent = '';
    for (const link of links) {
      const tr = doc.createElement('tr');
      const cell = (text, className) => {
        const td = doc.createElement('td');
        if (className) td.className = className;
        td.textContent = String(text == null ? '' : text);
        return td;
      };
      tr.appendChild(cell(fmtTime(link.createdAt)));
      // „Какво“ описва обхвата: типът и пътят в портала (за портала пътят е празен).
      tr.appendChild(cell([link.type, link.path || ''].filter(Boolean).join(' · ') || '—'));
      tr.appendChild(cell([link.files, T('rp.files')].join(' '), 'hint'));
      const linkCell = doc.createElement('td');
      const anchor = doc.createElement('a');
      anchor.href = String(link.url || '');
      anchor.target = '_blank';
      anchor.rel = 'noreferrer';
      anchor.textContent = String(link.name || link.url || '');
      linkCell.appendChild(anchor);
      // vCard-ът на отчета: размерът и отпечатъкът стоят до линка, за да се свери файлът.
      const meta = doc.createElement('div');
      meta.className = 'hint';
      meta.textContent = fmtBytes(link.bytes) + ' · ' + String(link.sha256 || '').slice(0, 12);
      linkCell.appendChild(meta);
      tr.appendChild(linkCell);
      tr.appendChild(cell(link.hits || 0));
      const actions = doc.createElement('td');
      const copy = doc.createElement('button');
      copy.type = 'button';
      copy.className = 'btn btn-sm';
      copy.textContent = T('rp.copy');
      copy.addEventListener('click', () => void copyLink(view, String(link.url || '')));
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-sm';
      remove.textContent = T('rp.remove');
      remove.addEventListener('click', () => void removeLink(view, link));
      actions.appendChild(copy);
      actions.appendChild(remove);
      tr.appendChild(actions);
      body.appendChild(tr);
    }
    const empty = view.querySelector('#rp-empty');
    if (empty) empty.hidden = links.length > 0;
    const table = view.querySelector('#rp-table');
    if (table) table.hidden = links.length === 0;
  }

  async function removeLink(view, link) {
    if (view.ownerDocument.defaultView && view.ownerDocument.defaultView.confirm) {
      if (!view.ownerDocument.defaultView.confirm(T('rp.removeConfirm', { name: link.name || link.url }))) return;
    }
    const r = await api('/admin/api/v2/reports/links/' + encodeURIComponent(link.id), 'DELETE');
    if (!r.ok) return toast(view, r.error || 'HTTP ' + r.status, 'err');
    toast(view, T('rp.removed'), 'ok');
    await load(view);
  }

  async function load(view) {
    const badge = view.querySelector('#rp-badge');
    if (badge) badge.textContent = T('rp.loading');
    const r = await api('/admin/api/v2/reports/links');
    if (r.offline) {
      if (badge) badge.textContent = T('rp.offline');
      return;
    }
    if (!r.ok) {
      if (badge) badge.textContent = r.error || 'HTTP ' + r.status;
      return;
    }
    const links = (r.data && Array.isArray(r.data.links) ? r.data.links : []).slice();
    if (badge) badge.textContent = T('rp.count', { n: links.length });
    rowsOf(view, links);
  }

  async function mount(view) {
    view.innerHTML = `
      <div class="page-title">
        <h1>${esc(T('rp.title'))}</h1>
        <span class="badge demo" id="rp-badge">${esc(T('rp.loading'))}</span>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>${esc(T('rp.section.links'))}</h2></div>
        <div class="panel-body">
          <p class="hint">${esc(T('rp.hint'))}</p>
          <div class="row-actions">
            <button type="button" class="btn" id="rp-refresh">${esc(T('rp.refresh'))}</button>
          </div>
          <table class="table" id="rp-table" hidden>
            <thead><tr>
              <th>${esc(T('rp.th.time'))}</th><th>${esc(T('rp.th.what'))}</th><th>${esc(T('rp.th.files'))}</th>
              <th>${esc(T('rp.th.link'))}</th><th>${esc(T('rp.th.hits'))}</th><th></th>
            </tr></thead>
            <tbody id="rp-rows"></tbody>
          </table>
          <p class="hint" id="rp-empty" hidden>${esc(T('rp.empty'))}</p>
        </div>
      </section>`;
    const refresh = view.querySelector('#rp-refresh');
    if (refresh) refresh.addEventListener('click', () => void load(view));
    await load(view);
  }

  window.HapiReportsPanel = { mount };
})();
