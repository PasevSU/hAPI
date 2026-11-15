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
  // Целият текст минава през речника (BG/EN/DE); липсващ ключ се вижда като ключа, не като български.
  const T = (key, vars) =>
    typeof window !== 'undefined' && window.HapiI18n ? window.HapiI18n.t(key, vars) : String(key);
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
      // Едно правило за всички адреси: `api-base.js` (зарежда се преди този файл) знае
      // Ingress префикса; `links.js` е резервата. Ръчно изчисление от origin-а на браузъра
      // тук би дало адреса на Home Assistant, а не на add-on-а.
      if (typeof window.hapiApiBase === 'function') return window.hapiApiBase();
      if (window.HapiLinks) return window.HapiLinks.baseFromLocation(location);
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
        <h1>${esc(T('pa.title'))}</h1>
        <p>${esc(T('pa.subtitle'))}</p>
        <span class="badge">${esc(T('pa.badge'))}</span>
      </div>

      <div class="two-col">
        <section class="panel">
          <div class="panel-head"><h2>${esc(T('pa.portal'))}</h2></div>
          <div class="panel-body">
            <div class="field">
              <label>${esc(T('pa.pick'))}</label>
              <select id="pa-portal">
                ${portals.map((p) => `<option value="${esc(p.slug)}">${esc(p.title)} (${esc(p.slug)})</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>${esc(T('pa.base'))}</label>
              <input id="pa-base" value="${esc(baseUrl())}" />
            </div>
            <div class="u-row u-row-2">
              <button type="button" class="btn btn-primary" id="pa-generate">${esc(T('pa.generate'))}</button>
              <button type="button" class="btn" id="pa-edit">${esc(T('pa.openReport'))}</button>
            </div>
            <p class="hint">
              ${esc(T('pa.demoHint'))} <code>POST /admin/api/v2/portals/{slug}/api</code>.
            </p>
            <div class="u-row u-row-2 u-mt">
              <button type="button" class="btn" id="pa-send" ${location.protocol === 'file:' ? 'disabled' : ''}>${esc(T('pa.send'))}</button>
              <span class="hint u-ellipsis">${esc(location.protocol === 'file:' ? T('pa.needHttp') : T('pa.sameOrigin'))}</span>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>${esc(T('pa.storageRefs'))}</h2><span class="badge" id="pa-state">—</span></div>
          <div class="panel-body" id="pa-out"></div>
        </section>
      </div>

      <section class="panel u-mt">
        <div class="panel-head"><h2>${esc(T('pa.openapiContract'))}</h2><span class="badge" id="pa-ops">—</span></div>
        <div class="panel-body">
          <div class="u-row u-row-3">
            <button type="button" class="btn" id="pa-dl-api" disabled>⬇️ api.json</button>
            <button type="button" class="btn" id="pa-dl-openapi" disabled>⬇️ openapi.json</button>
            <button type="button" class="btn" id="pa-copy" disabled>📋 ${esc(T('pa.copyRefs'))}</button>
          </div>
          <pre class="json-view" id="pa-json">${esc(T('pa.jsonHint'))}</pre>
        </div>
      </section>`;

    const portalSelect = host.querySelector('#pa-portal');
    if (portals.length) {
      state.slug = portals[0].slug;
      portalSelect.value = state.slug;
    } else {
      portalSelect.innerHTML = `<option value="">${esc(T('pa.noPortals'))}</option>`;
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
        toast(T('pa.toast.copied'), 'ok');
      } catch {
        toast(T('pa.toast.copyBlocked'), 'err');
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
      toast(T('pa.err.noSpec'), 'err');
      return;
    }
    if (!state.slug) {
      toast(T('pa.err.noPortal'), 'err');
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
      toast(T('pa.toast.generated'), 'ok');
    } catch (e) {
      toast(`${e.code || T('pa.err.generic')}: ${e.message}`, 'err');
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
        const entered = window.prompt(T('pa.prompt.token')) || '';
        if (!entered.trim()) return;
        sessionStorage.setItem('hapiAdminToken', entered.trim());
        response = await send(entered.trim());
        if (response.status === 401) {
          sessionStorage.removeItem('hapiAdminToken');
          throw new Error(T('pa.err.token'));
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
      render(disk ? T('pa.note.disk', { dir: disk }) : '');
      toast(disk ? T('pa.toast.created', { dir: disk }) : T('pa.toast.apiOk'), 'ok');
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
      badge.textContent = T('pa.state.none');
      out.innerHTML = `<p class="hint">${esc(T('pa.empty', { slug: state.slug || '—' }))}</p>`;
      json.textContent = T('pa.jsonHint');
      ops.textContent = '—';
      [dlApi, dlOpenapi, copy].forEach((b) => (b.disabled = true));
      return;
    }

    const refs = state.record.links || spec().buildReferences('', state.slug);
    badge.className = 'badge ok';
    badge.textContent = T('pa.state.ok');
    const storage = state.record.storage || {};
    const portal = (data().portals || []).find((p) => p.slug === state.slug) || { slug: state.slug, files: [] };
    const vs = window.HapiVirtualStorage;
    const virtualTree = vs
      ? vs.buildTree(portal.files || [])
      : { folderCount: 0, fileCount: 0, tree: { type: 'folder', name: '/', path: '/', folders: [], files: [] } };
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const filesOf = (n) => plural(n, T('noun.file.one'), T('noun.file.many'));
    const foldersOf = (n) => plural(n, T('noun.folder.one'), T('noun.folder.many'));
    const nodeHtml = (node) => `
      <li class="vs-folder">📁 ${esc(node.name)}
        <small>${filesOf(node.files.length)}${node.folders.length ? `, ${foldersOf(node.folders.length)}` : ''}</small>
        <ul>${node.folders.map(nodeHtml).join('')}${node.files
        .map((f) => `<li class="vs-file">📄 ${esc(f.name)} <code>${esc(f.path)}</code></li>`)
        .join('')}</ul>
      </li>`;
    out.innerHTML = `
      <table class="grid">
        <thead><tr><th>${esc(T('pa.th.ref'))}</th><th>URL</th></tr></thead>
        <tbody>
          <tr><td>API</td><td class="mono">${esc(refs.apiUrl)}</td></tr>
          <tr><td>${esc(T('pa.ref.manifest'))}</td><td class="mono">${esc(refs.manifestUrl)}</td></tr>
          <tr><td>${esc(T('pa.ref.files'))}</td><td class="mono">${esc(refs.filesUrl)}</td></tr>
          <tr><td>${esc(T('pa.ref.storage'))}</td><td class="mono">${esc(storage.url || refs.storageUrl || '')}</td></tr>
          <tr><td>OpenAPI</td><td class="mono">${esc(refs.openapiUrl)}</td></tr>
        </tbody>
      </table>
      <h4 class="u-mt">${esc(T('pa.virtual'))}</h4>
      <p class="hint">${esc(storage.scheme || '/<topic>/<category>/<group>/<name>')} · ${foldersOf(storage.folderCount ?? virtualTree.folderCount)} · ${filesOf(storage.fileCount ?? virtualTree.fileCount)}</p>
      <ul class="vs-tree">${nodeHtml(virtualTree.tree)}</ul>
      <p class="hint">${esc(T('pa.physical'))} <span class="mono">api/${esc(state.record.slug)}/</span> · api.json · openapi.json · qr.svg</p>
      ${note ? `<p class="hint">${esc(note)}</p>` : ''}`;
    json.textContent = JSON.stringify(state.openapi || {}, null, 2);
    ops.textContent = T('pa.ops.paths', { n: Object.keys((state.openapi && state.openapi.paths) || {}).length });
    [dlApi, dlOpenapi, copy].forEach((b) => (b.disabled = false));
  }

  window.PortalsPanel = { mount(container) { host = container; state = { slug: '', baseUrl: '', record: null, openapi: null }; shell(); } };
})();
