'use strict';
// Панел „Портали & API“ (Фаза 8 / API-01…03): генериране на публично API,
// описание на хранилището и препратки към него — изцяло в JS, без сървър.
//
// Клиентското генериране е ДЕМО (не пише на диск). Реалното хранилище се създава
// от add-on-а: POST /admin/api/v2/portals/{slug}/api (api-registry.js).
(function () {
  const spec = () => globalThis.HapiApiSpec;
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, k) => window.HapiUI && window.HapiUI.toast(m, k);
  const storeKey = (slug) => `hapi.api.${slug}`;

  let host = null;
  let state = { slug: '', baseUrl: '', record: null, openapi: null };

  function data() {
    return window.HAPI_DATA || { portals: [], defaultBaseUrl: '' };
  }

  function baseUrl() {
    const saved = localStorage.getItem('hapi.apiBase');
    if (saved) return saved;
    if (location.protocol !== 'file:') {
      // През Ingress add-on-ът е на `/api/hassio_ingress/<token>` (старите форми: /app, /hapi).
      if (typeof window.hapiApiBase === 'function') return window.hapiApiBase();
      const m = String(location.pathname || '').match(/^\/(?:api\/hassio_ingress|hassio\/ingress|app|hapi)\/[^/]+/);
      return location.origin + (m ? m[0] : '');
    }
    return data().defaultBaseUrl || 'http://homeassistant.local:8099';
  }

  function loadGenerated(slug) {
    try {
      return JSON.parse(localStorage.getItem(storeKey(slug)) || 'null');
    } catch {
      return null;
    }
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'application/json; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  function shell() {
    const portals = data().portals || [];
    host.innerHTML = `
      <div class="page-title">
        <h1>Портали &amp; API</h1>
        <p>Публично API · хранилище · препратки</p>
        <span class="badge">JS · без сървър</span>
      </div>

      <div class="two-col">
        <section class="panel">
          <div class="panel-head"><h2>Портал</h2></div>
          <div class="panel-body">
            <div class="field">
              <label>Избери портал</label>
              <select id="pa-portal">
                ${portals.map((p) => `<option value="${esc(p.slug)}">${esc(p.title)} (${esc(p.slug)})</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>Base URL на add-on-а</label>
              <input id="pa-base" value="${esc(baseUrl())}" />
            </div>
            <div class="u-row u-row-2">
              <button type="button" class="btn btn-primary" id="pa-generate">Генерирай API</button>
              <button type="button" class="btn" id="pa-edit">Отвори в Report Studio</button>
            </div>
            <p class="hint">
              Генерирането тук е клиентско (демо) и не пише на диск. Реалното хранилище
              се създава от add-on-а чрез <code>POST /admin/api/v2/portals/{slug}/api</code>.
            </p>
            <div class="u-row u-row-2 u-mt">
              <button type="button" class="btn" id="pa-send" ${location.protocol === 'file:' ? 'disabled' : ''}>Изпрати към add-on</button>
              <span class="hint u-ellipsis">${location.protocol === 'file:' ? 'изисква HTTP (add-on)' : 'работи на същия origin'}</span>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>Хранилище и препратки</h2><span class="badge" id="pa-state">—</span></div>
          <div class="panel-body" id="pa-out"></div>
        </section>
      </div>

      <section class="panel u-mt">
        <div class="panel-head"><h2>OpenAPI 3.1 (договор)</h2><span class="badge" id="pa-ops">—</span></div>
        <div class="panel-body">
          <div class="u-row u-row-3">
            <button type="button" class="btn" id="pa-dl-api" disabled>⬇️ api.json</button>
            <button type="button" class="btn" id="pa-dl-openapi" disabled>⬇️ openapi.json</button>
            <button type="button" class="btn" id="pa-copy" disabled>📋 Копирай препратките</button>
          </div>
          <pre class="json-view" id="pa-json">Избери портал и натисни „Генерирай API“.</pre>
        </div>
      </section>`;

    const portalSelect = host.querySelector('#pa-portal');
    if (portals.length) {
      state.slug = portals[0].slug;
      portalSelect.value = state.slug;
    } else {
      portalSelect.innerHTML = '<option value="">няма портали</option>';
    }

    host.querySelector('#pa-base').addEventListener('change', (e) => {
      localStorage.setItem('hapi.apiBase', e.target.value.trim());
      state.record = null;
      state.openapi = null;
      render();
    });
    portalSelect.addEventListener('change', (e) => {
      state.slug = e.target.value;
      state.record = null;
      state.openapi = null;
      render();
    });
    host.querySelector('#pa-generate').addEventListener('click', generate);
    host.querySelector('#pa-dl-api').addEventListener('click', () => {
      if (state.record) download(`api-${state.record.slug}.json`, JSON.stringify(state.record, null, 2));
    });
    host.querySelector('#pa-dl-openapi').addEventListener('click', () => {
      if (state.openapi) download(`openapi-${state.record.slug}.json`, JSON.stringify(state.openapi, null, 2));
    });
    host.querySelector('#pa-copy').addEventListener('click', async () => {
      if (!state.record) return;
      try {
        await navigator.clipboard.writeText(JSON.stringify(state.record.links, null, 2));
        toast('Препратките са копирани', 'ok');
      } catch {
        toast('Копирането не е разрешено от браузъра', 'err');
      }
    });
    host.querySelector('#pa-edit').addEventListener('click', () => {
      location.hash = '#report';
      // app.js слуша hash само при зареждане; затова презареждаме изгледа ръчно.
      const nav = document.querySelector('#nav .nav-item[data-panel="report"]');
      if (nav) nav.click();
    });
    host.querySelector('#pa-send').addEventListener('click', sendToAddon);

    render();
  }

  function generate() {
    const api = spec();
    if (!api) {
      toast('Липсва api-spec.js (зареден ли е?)', 'err');
      return;
    }
    if (!state.slug) {
      toast('Няма избран портал', 'err');
      return;
    }
    const base = host.querySelector('#pa-base').value.trim();
    try {
      const portal = (data().portals || []).find((p) => p.slug === state.slug) || { slug: state.slug };
      state.record = api.buildApiRecord(portal, { baseUrl: base });
      state.openapi = api.buildOpenApi(portal, { baseUrl: base });
      localStorage.setItem(
        storeKey(state.slug),
        JSON.stringify({ record: state.record, openapi: state.openapi, generatedAt: new Date().toISOString() }),
      );
      render();
      toast('API е генерирано (демо, в браузъра)', 'ok');
    } catch (e) {
      toast(`${e.code || 'ГРЕШКА'}: ${e.message}`, 'err');
    }
  }

  async function sendToAddon() {
    if (!state.slug) return;
    const url = `/admin/api/v2/portals/${encodeURIComponent(state.slug)}/api`;
    const send = (token) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: '{}',
      });
    try {
      let response = await send(sessionStorage.getItem('hapiAdminToken') || '');
      if (response.status === 401) {
        const entered = window.prompt('Админ токен (само за тази сесия):') || '';
        if (!entered.trim()) return;
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
          /* not JSON */
        }
        throw new Error(message);
      }
      const out = await response.json();
      state.record = out.record;
      state.openapi = spec().buildOpenApi({ slug: state.slug, title: out.record.title }, { baseUrl: out.references.base });
      const disk = (out.disk && out.disk.dir) || '';
      render(disk ? `Записано на диск: ${disk}` : '');
      toast(disk ? `Хранилището е създадено: ${disk}` : 'API-то е генерирано', 'ok');
    } catch (e) {
      toast(`Add-on: ${e.message}`, 'err');
    }
  }

  function render(note) {
    const generated = loadGenerated(state.slug);
    if (!state.record && generated) {
      state.record = generated.record;
      state.openapi = generated.openapi;
    }
    const out = host.querySelector('#pa-out');
    const badge = host.querySelector('#pa-state');
    const json = host.querySelector('#pa-json');
    const ops = host.querySelector('#pa-ops');
    const dlApi = host.querySelector('#pa-dl-api');
    const dlOpenapi = host.querySelector('#pa-dl-openapi');
    const copy = host.querySelector('#pa-copy');

    if (!state.record) {
      badge.className = 'badge';
      badge.textContent = 'не е генерирано';
      out.innerHTML = `<p class="hint">За портал <b>${esc(state.slug || '—')}</b> още няма API. Натисни „Генерирай API“.</p>`;
      json.textContent = 'Избери портал и натисни „Генерирай API“.';
      ops.textContent = '—';
      [dlApi, dlOpenapi, copy].forEach((b) => (b.disabled = true));
      return;
    }

    const refs = state.record.links || spec().buildReferences('', state.slug);
    badge.className = 'badge ok';
    badge.textContent = 'генерирано';
    const storage = state.record.storage || {};
    const portal = (data().portals || []).find((p) => p.slug === state.slug) || { slug: state.slug, files: [] };
    const vs = window.HapiVirtualStorage;
    const virtualTree = vs
      ? vs.buildTree(portal.files || [])
      : { folderCount: 0, fileCount: 0, tree: { type: 'folder', name: '/', path: '/', folders: [], files: [] } };
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const nodeHtml = (node) => `
      <li class="vs-folder">📁 ${esc(node.name)}
        <small>${plural(node.files.length, 'файл', 'файла')}${node.folders.length ? `, ${plural(node.folders.length, 'папка', 'папки')}` : ''}</small>
        <ul>${node.folders.map(nodeHtml).join('')}${node.files
        .map((f) => `<li class="vs-file">📄 ${esc(f.name)} <code>${esc(f.path)}</code></li>`)
        .join('')}</ul>
      </li>`;
    out.innerHTML = `
      <table class="grid">
        <thead><tr><th>Препратка</th><th>URL</th></tr></thead>
        <tbody>
          <tr><td>API</td><td class="mono">${esc(refs.apiUrl)}</td></tr>
          <tr><td>Манифест</td><td class="mono">${esc(refs.manifestUrl)}</td></tr>
          <tr><td>Файлове</td><td class="mono">${esc(refs.filesUrl)}</td></tr>
          <tr><td>Хранилище</td><td class="mono">${esc(storage.url || refs.storageUrl || '')}</td></tr>
          <tr><td>OpenAPI</td><td class="mono">${esc(refs.openapiUrl)}</td></tr>
        </tbody>
      </table>
      <h4 class="u-mt">Виртуално хранилище</h4>
      <p class="hint">${esc(storage.scheme || '/<topic>/<category>/<group>/<name>')} · ${plural(storage.folderCount ?? virtualTree.folderCount, 'папка', 'папки')} · ${plural(storage.fileCount ?? virtualTree.fileCount, 'файл', 'файла')}</p>
      <ul class="vs-tree">${nodeHtml(virtualTree.tree)}</ul>
      <p class="hint">Физически (само при add-on): <span class="mono">api/${esc(state.record.slug)}/</span> · api.json · openapi.json · qr.svg</p>
      ${note ? `<p class="hint">${esc(note)}</p>` : ''}`;
    json.textContent = JSON.stringify(state.openapi || {}, null, 2);
    ops.textContent = `${Object.keys((state.openapi && state.openapi.paths) || {}).length} пътя`;
    [dlApi, dlOpenapi, copy].forEach((b) => (b.disabled = false));
  }

  window.PortalsPanel = { mount(container) { host = container; state = { slug: '', baseUrl: '', record: null, openapi: null }; shell(); } };
})();
