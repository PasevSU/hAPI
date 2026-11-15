'use strict';
// Public Gateway & Access (PG-2) — два канала, портални политики и Public Access Test.
//
// Панелът е интерактивен модел: показва какво ще реши backend-ът чрез
// HapiPublicGateway + HapiDownloadAccess. Не отваря портове и не променя права.
(function () {
  const GW = () => globalThis.HapiPublicGateway;
  const ACC = () => globalThis.HapiDownloadAccess;
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Целият текст минава през речника (BG/EN/DE); липсващ ключ се вижда като ключа, не като български.
  const T = (key, vars) =>
    typeof window !== 'undefined' && window.HapiI18n ? window.HapiI18n.t(key, vars) : String(key);
  const toast = (m, k) => window.HapiUI && window.HapiUI.toast(m, k);
  const fmtSize = (n) => {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`;
    if (v < 1073741824) return `${(v / 1048576).toFixed(1)} MB`;
    return `${(v / 1073741824).toFixed(2)} GB`;
  };

  const DEMO_FILES = [
    { name: 'Public_Report.pdf', access: 'FREE', visibility: 'public', size: 1048576 },
    { name: 'Evidence_Package.zip', access: 'KEY_REQUIRED', visibility: 'public', size: 52428800 },
    { name: 'Internal_Audit.json', access: 'PRIVATE', visibility: 'hidden', roles: ['admin'], size: 4096 },
    { name: 'Revoked_File.pdf', access: 'DISABLED', visibility: 'public', size: 204800 },
  ];

  let host = null;
  const state = {
    gateway: {
      ingress: { port: 8099, stream: true, panel_admin: true, path: '/' },
      public: { port: 8088, published: false, require_https: true, domain: null, base_path: '/p/' },
      storage: { allowed_roots: ['/share', '/media'] },
    },
    portals: [],
    index: 0,
    files: {},
    perms: {
      anonymous: [],
      operator: ['files.read', 'files.download', 'reports.export', 'templates.export', 'bulk.export'],
      admin: [
        'files.read',
        'files.download',
        'reports.export',
        'evidence.export',
        'templates.export',
        'audit.export',
        'backups.create',
        'bulk.export',
      ],
    },
    ctx: { tokenString: '', user: 'anonymous', permission: 'files.download' },
    result: null,
  };

  function seed() {
    const data = (window.HAPI_DATA && window.HAPI_DATA.portals) || [];
    const list = data.length
      ? data.map((p, i) => ({
        id: String(p.slug || p.id || `portal-${i + 1}`),
        slug: String(p.slug || p.id || `portal-${i + 1}`),
        title: p.title || p.name || T('pgw.portalFallback', { n: i + 1 }),
        status: p.status || 'active',
        access: p.access || (p.mode && p.mode.toUpperCase()) || (p.visibility === 'public' ? 'FREE' : 'KEY_REQUIRED'),
        visibility: p.visibility === 'hidden' || p.visibility === 'private' ? 'hidden' : 'public',
        storage_root: p.storage_root || '/share',
        html: 'catalog',
      }))
      : [
        { id: 'public-notices', slug: 'public-notices', title: 'Public notices', status: 'active', access: 'FREE', visibility: 'public', storage_root: '/share', html: 'catalog' },
        { id: 'chronoseal-vault', slug: 'chronoseal-vault', title: 'ChronoSeal-Vault', status: 'active', access: 'KEY_REQUIRED', visibility: 'public', storage_root: '/share', html: 'catalog' },
        { id: 'forensic-2026-114', slug: 'forensic-2026-114', title: 'Forensic — 2026-114', status: 'paused', access: 'PRIVATE', visibility: 'hidden', storage_root: '/share', html: 'none' },
      ];
    state.portals = list.map((p) => GW().normalizePortal(p));
    list.forEach((p) => {
      state.files[p.slug] = DEMO_FILES.map((f) => Object.assign({}, f));
    });
  }

  function portal() {
    return state.portals[state.index] || state.portals[0];
  }

  function files() {
    return state.files[portal().slug] || [];
  }

  function userContext() {
    const perms = state.perms[state.ctx.user] || [];
    if (state.ctx.user === 'anonymous') return { id: '', roles: [], permissions: [] };
    return {
      id: `u-${state.ctx.user}`,
      roles: state.ctx.user === 'admin' ? ['admin', 'judge'] : ['operator'],
      permissions: perms,
    };
  }

  function tokenContext() {
    const raw = state.ctx.tokenString.trim();
    if (!raw) return null;
    return {
      id: 'tok-demo',
      uses: 0,
      max_uses: 10,
      revoked: false,
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      token: raw,
    };
  }

  function stateChip(file) {
    const p = portal();
    const merged = GW().resolvePolicy({ portal: p, file }).policy;
    const s = ACC().stateOf(merged, { token: tokenContext(), now: new Date() });
    const cls = s === 'public' ? 'ok' : s === 'disabled' || s === 'expired' || s === 'revoked' ? 'err' : 'warn';
    return `<span class="state-chip ${cls}">${esc(ACC().STATE_LABEL[s] || s)}</span>`;
  }

  function render() {
    const p = portal();
    const gw = state.gateway;
    const base = GW().normalizeGateway(gw);
    const summary = GW().summary(state.portals);

    host.innerHTML = `
      <div class="page-title">
        <h1>Public Gateway &amp; Access</h1>
        <p>${esc(T('pgw.subtitle'))}</p>
        <span class="badge demo">${esc(T('pgw.demo'))}</span>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>${esc(T('pgw.channels.title'))}</h2>
          <span class="badge">${esc(T('pgw.channels.summary', { active: summary.active, paused: summary.paused, disabled: summary.disabled }))}</span>
        </div>
        <div class="panel-body">
          <table class="grid">
            <thead><tr><th>${esc(T('pgw.th.component'))}</th>${GW().CHANNELS.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
            <tbody>
              ${['purpose', 'access', 'auth', 'users', 'download', 'api', 'logs']
        .map(
          (key) =>
            `<tr><td>${esc(
              {
                purpose: T('pgw.row.purpose'),
                access: T('pgw.row.access'),
                auth: T('pgw.row.auth'),
                users: T('pgw.row.users'),
                download: T('pgw.row.download'),
                api: 'API',
                logs: T('pgw.row.logs'),
              }[key],
            )}</td>${GW().CHANNELS.map((c) => `<td>${esc(c[key])}</td>`).join('')}</tr>`,
        )
        .join('')}
            </tbody>
          </table>
          <p class="hint">${esc(T('pgw.channels.hint', { ingress: base.ingress.port, public: base.public.port }))}</p>
        </div>
      </section>

      <div class="two-col u-mt">
        <section class="panel">
          <div class="panel-head"><h2>Gateway</h2><span class="badge ${gw.public.published ? 'ok' : 'err'}">${esc(gw.public.published ? T('pgw.published') : T('pgw.unpublished'))
      }</span></div>
          <div class="panel-body">
            <div class="two-col">
              <div class="field"><label>${esc(T('pgw.f.ingressPort'))}</label><input value="${esc(base.ingress.port)}" readonly /></div>
              <div class="field"><label>${esc(T('pgw.f.publicPort'))}</label><input id="pg-port" value="${esc(base.public.port)}" /></div>
            </div>
            <div class="field"><label>${esc(T('pgw.f.domain'))}</label>
              <input id="pg-domain" value="${esc(gw.public.domain || '')}" placeholder="portal.example.com" />
            </div>
            <div class="checks">
              <label><input type="checkbox" id="pg-published" ${gw.public.published ? 'checked' : ''}/> ${esc(T('pgw.publish'))}</label>
              <label><input type="checkbox" id="pg-https" ${gw.public.require_https ? 'checked' : ''}/> ${esc(T('pgw.https'))}</label>
              <label><input type="checkbox" id="pg-relative" ${gw.public.relative ? 'checked' : ''}/> ${esc(T('pgw.relative'))}</label>
            </div>
            <p class="hint">${esc(gw.public.relative ? T('pgw.hint.relativeOn') : T('pgw.hint.relativeOff'))}</p>
            <p class="hint">${esc(T('pgw.hint.roots', { roots: base.storage.allowed_roots.join(', ') }))}</p>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>${esc(T('pgw.portal.title'))}</h2><span class="badge">${esc(p.slug)}</span></div>
          <div class="panel-body">
            <div class="field"><label>${esc(T('pgw.f.pick'))}</label>
              <select id="pg-portal">
                ${state.portals.map((item, i) => `<option value="${i}" ${i === state.index ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}
              </select>
            </div>
            <div class="two-col">
              <div class="field"><label>${esc(T('pgw.f.status'))}</label>
                <select id="pg-status">
                  ${GW().PORTAL_STATUS.map((s) => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </div>
              <div class="field"><label>${esc(T('pgw.f.access'))}</label>
                <select id="pg-access">
                  ${ACC().MODES.map((m) => `<option value="${m.id}" ${m.id === p.access ? 'selected' : ''}>${esc(m.short)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="two-col">
              <div class="field"><label>${esc(T('pgw.f.visibility'))}</label>
                <select id="pg-visibility">
                  ${ACC().VISIBILITY.map((v) => `<option value="${v.id}" ${v.id === p.visibility ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
                </select>
              </div>
              <div class="field"><label>Storage root</label><input id="pg-root" value="${esc(p.storage_root)}" /></div>
            </div>
            <h4 class="u-mt">${esc(T('pgw.portal.full'))}</h4>
            <dl class="fm-meta">
              <dt>id</dt><dd><code>${esc(p.id)}</code></dd>
              <dt>slug</dt><dd><code>${esc(p.slug)}</code></dd>
              <dt>${esc(T('pgw.f.title'))}</dt><dd>${esc(p.title)}</dd>
              <dt>${esc(T('pgw.f.status'))}</dt><dd>${esc(p.status)}</dd>
              <dt>${esc(T('pgw.f.access'))}</dt><dd><code>${esc(p.access)}</code></dd>
              <dt>${esc(T('pgw.f.visibility'))}</dt><dd>${esc(p.visibility)}</dd>
              <dt>HTML</dt><dd>${esc(p.html)}</dd>
              <dt>API</dt><dd>${p.api ? esc(T('pgw.on')) : esc(T('pgw.off'))}</dd>
              <dt>QR</dt><dd>${p.qr ? esc(T('pgw.on')) : esc(T('pgw.off'))}</dd>
              <dt>${esc(T('pgw.f.inherit'))}</dt><dd>${p.inherit ? esc(T('pgw.yes')) : esc(T('pgw.no'))}</dd>
              <dt>${esc(T('pgw.f.storageRoot'))}</dt><dd><code>${esc(p.storage_root)}</code></dd>
              <dt>${esc(T('pgw.f.ttl'))}</dt><dd>${p.token_policy.ttl_hours == null ? esc(T('pgw.ttl.none')) : esc(T('pgw.ttl.hours', { n: p.token_policy.ttl_hours }))}</dd>
              <dt>${esc(T('pgw.f.maxUses'))}</dt><dd>${p.token_policy.max_uses == null ? esc(T('pgw.maxUses.none')) : esc(T('pgw.maxUses.count', { n: p.token_policy.max_uses }))}</dd>
              <dt>${esc(T('pgw.f.revoke'))}</dt><dd>${p.token_policy.revocable ? esc(T('pgw.allowed')) : esc(T('pgw.forbidden'))}</dd>
              <dt>Landing URL</dt><dd><code>${esc(GW().publicUrl(p, base))}</code></dd>
              <dt>Portal API</dt><dd><code>${esc(GW().apiUrls(p, base).portal)}</code></dd>
              <dt>${esc(T('pgw.f.filesApi'))}</dt><dd><code>${esc(GW().apiUrls(p, base).files)}</code></dd>
              <dt>QR URL</dt><dd><code>${esc(GW().apiUrls(p, base).qr)}</code></dd>
            </dl>
          </div>
        </section>
      </div>

      <section class="panel u-mt">
        <div class="panel-head"><h2>${esc(T('pgw.files.title'))}</h2><span class="badge demo">${esc(T('pgw.demoData'))}</span></div>
        <div class="panel-body">
          <table class="grid">
            <thead><tr><th>${esc(T('pgw.th.file'))}</th><th>id</th><th>${esc(T('pgw.th.size'))}</th><th>${esc(T('pgw.th.policy'))}</th><th>${esc(T('pgw.th.visibility'))}</th><th>${esc(T('pgw.th.roles'))}</th><th>${esc(T('pgw.th.max'))}</th><th>${esc(T('pgw.th.state'))}</th><th>${esc(T('pgw.th.behaviour'))}</th><th>${esc(T('pgw.th.url'))}</th></tr></thead>
            <tbody>
              ${files()
        .map(
          (f, i) => `<tr>
                    <td>${esc(f.name)}</td>
                    <td><code>${esc(f.id || '—')}</code></td>
                    <td>${fmtSize(f.size)}</td>
                    <td><select data-file-access="${i}">
                      ${ACC().MODES.map((m) => `<option value="${m.id}" ${m.id === f.access ? 'selected' : ''}>${esc(m.short)}</option>`).join('')}
                    </select></td>
                    <td><select data-file-visibility="${i}">
                      ${ACC().VISIBILITY.map((v) => `<option value="${v.id}" ${v.id === f.visibility ? 'selected' : ''}>${esc(v.id)}</option>`).join('')}
                    </select></td>
                    <td>${esc(f.roles && f.roles.length ? f.roles.join(', ') : '—')}</td>
                    <td>${f.max_downloads == null ? '—' : f.max_downloads}</td>
                    <td>${stateChip(f)}</td>
                    <td>${esc(GW().behaviourFor(p, f).label)}</td>
                    <td><code>${esc(GW().downloadUrl({ id: f.id }, base))}</code></td>
                  </tr>`,
        )
        .join('')}
            </tbody>
          </table>
          <p class="hint">${esc(T('pgw.files.hint'))}</p>
        </div>
      </section>

      <section class="panel u-mt">
        <div class="panel-head"><h2>Public Access Test</h2><span class="badge demo">${esc(T('pgw.test.badge'))}</span></div>
        <div class="panel-body">
          <div class="two-col">
            <div class="field"><label>${esc(T('pgw.th.file'))}</label>
              <select id="pg-file">
                ${files().map((f, i) => `<option value="${i}">${esc(f.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>${esc(T('pgw.test.user'))}</label>
              <select id="pg-user">
                <option value="anonymous" ${state.ctx.user === 'anonymous' ? 'selected' : ''}>${esc(T('pgw.test.anon'))}</option>
                <option value="operator" ${state.ctx.user === 'operator' ? 'selected' : ''}>${esc(T('pgw.test.operator'))}</option>
                <option value="admin" ${state.ctx.user === 'admin' ? 'selected' : ''}>${esc(T('pgw.test.admin'))}</option>
              </select>
            </div>
          </div>
          <div class="two-col">
            <div class="field"><label>${esc(T('pgw.test.permission'))}</label>
              <select id="pg-permission">
                ${ACC().PERMISSIONS.map((perm) => `<option value="${perm.id}" ${perm.id === state.ctx.permission ? 'selected' : ''}>${esc(perm.id)}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>${esc(T('pgw.test.token'))}</label>
              <input id="pg-token" value="${esc(state.ctx.tokenString)}" placeholder="${esc(T('pgw.test.tokenPh'))}" />
            </div>
          </div>
          <div class="u-row u-row-2">
            <button type="button" class="btn btn-primary" id="pg-test">${esc(T('pgw.test.run'))}</button>
            <button type="button" class="btn" id="pg-copy">${esc(T('pgw.test.copy'))}</button>
          </div>
          ${state.result ? renderResult() : `<p class="hint">${esc(T('pgw.test.hint'))}</p>`}
        </div>
      </section>

      <section class="panel u-mt">
        <div class="panel-head"><h2>${esc(T('pgw.isolation.title'))}</h2><span class="badge">${esc(T('pgw.isolation.badge'))}</span></div>
        <div class="panel-body">
          <table class="grid">
            <thead><tr><th>${esc(T('pgw.th.path'))}</th><th>${esc(T('pgw.th.result'))}</th></tr></thead>
            <tbody>
              ${['/config/secrets.yaml', '/admin/api/v2/portals', '/api/hassio/auth', '/p/../../etc/passwd', `/p/${esc(p.slug)}/`]
        .map((path) => {
          const r = GW().isolate(path, base);
          return `<tr><td>${esc(path)}</td><td>${r.ok ? `<span class="state-chip ok">${esc(T('pgw.isolation.ok'))}</span>` : `<span class="state-chip err">${esc(r.reason)}</span>`
            }</td></tr>`;
        })
        .join('')}
            </tbody>
          </table>
        </div>
      </section>`;

    wire();
  }

  function renderResult() {
    const r = state.result;
    return `<div class="u-mt">
      <p><span class="state-chip ${r.allowed ? 'ok' : 'err'}">${esc(r.allowed ? T('pgw.result.allowed') : T('pgw.result.denied'))}</span>
        ${r.allowed ? '' : `<b class="u-ml">${esc(r.reason)}</b> <span class="hint">${esc(r.detail)}</span>`}</p>
      <p class="hint">${esc(r.behaviour.label)} · ${esc(r.url)}</p>
      <table class="grid">
        <thead><tr><th>${esc(T('pgw.th.check'))}</th><th>${esc(T('pgw.th.result'))}</th><th>${esc(T('pgw.th.detail'))}</th></tr></thead>
        <tbody>${r.checks
        .map(
          (c) =>
            `<tr><td>${esc(c.id)}</td><td>${c.ok ? '<span class="state-chip ok">ok</span>' : '<span class="state-chip err">fail</span>'
            }</td><td>${esc(c.detail || '')}</td></tr>`,
        )
        .join('')}</tbody>
      </table>
    </div>`;
  }

  function wire() {
    const q = (sel) => host.querySelector(sel);
    q('#pg-portal').addEventListener('change', (e) => {
      state.index = Number(e.target.value);
      state.result = null;
      render();
    });
    q('#pg-status').addEventListener('change', (e) => {
      state.portals[state.index] = GW().normalizePortal(Object.assign({}, portal(), { status: e.target.value }));
      render();
    });
    q('#pg-access').addEventListener('change', (e) => {
      state.portals[state.index] = GW().normalizePortal(Object.assign({}, portal(), { access: e.target.value }));
      render();
    });
    q('#pg-visibility').addEventListener('change', (e) => {
      state.portals[state.index] = GW().normalizePortal(Object.assign({}, portal(), { visibility: e.target.value }));
      render();
    });
    q('#pg-root').addEventListener('change', (e) => {
      state.portals[state.index] = GW().normalizePortal(Object.assign({}, portal(), { storage_root: e.target.value.trim() }));
      render();
    });
    q('#pg-port').addEventListener('change', (e) => {
      state.gateway.public.port = Number(e.target.value) || 8088;
      render();
    });
    q('#pg-domain').addEventListener('change', (e) => {
      state.gateway.public.domain = e.target.value.trim() || null;
      state.result = null;
      render();
    });
    q('#pg-published').addEventListener('change', (e) => {
      state.gateway.public.published = e.target.checked;
      render();
    });
    q('#pg-https').addEventListener('change', (e) => {
      state.gateway.public.require_https = e.target.checked;
      render();
    });
    q('#pg-relative').addEventListener('change', (e) => {
      state.gateway.public.relative = e.target.checked;
      state.result = null;
      render();
    });
    host.querySelectorAll('[data-file-access]').forEach((el) => {
      el.addEventListener('change', () => {
        const f = files()[Number(el.dataset.fileAccess)];
        f.access = el.value;
        if (f.access === 'PRIVATE' && !f.roles) f.roles = ['admin'];
        state.result = null;
        render();
      });
    });
    host.querySelectorAll('[data-file-visibility]').forEach((el) => {
      el.addEventListener('change', () => {
        files()[Number(el.dataset.fileVisibility)].visibility = el.value;
        state.result = null;
        render();
      });
    });
    q('#pg-user').addEventListener('change', (e) => {
      state.ctx.user = e.target.value;
    });
    q('#pg-permission').addEventListener('change', (e) => {
      state.ctx.permission = e.target.value;
    });
    q('#pg-token').addEventListener('change', (e) => {
      state.ctx.tokenString = e.target.value.trim();
    });
    q('#pg-test').addEventListener('click', () => {
      const fileIndex = Number(q('#pg-file').value || 0);
      const file = files()[fileIndex] || files()[0];
      state.result = GW().publicAccessTest({
        gateway: state.gateway,
        portal: portal(),
        file,
        ctx: {
          tokenString: state.ctx.tokenString,
          token: tokenContext(),
          user: userContext(),
          permission: state.ctx.permission,
          now: new Date(),
        },
      });
      render();
      toast(state.result.allowed ? T('pgw.toast.allowed') : T('pgw.toast.denied', { reason: state.result.reason }), state.result.allowed ? 'ok' : 'err');
    });
    q('#pg-copy').addEventListener('click', () => {
      const payload = {
        gateway: GW().normalizeGateway(state.gateway),
        portals: state.portals,
        files: state.files,
      };
      const text = JSON.stringify(payload, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => toast(T('pgw.toast.copied'), 'ok'),
          () => toast(T('pgw.toast.copyUnsupported'), 'err'),
        );
      } else {
        toast(T('pgw.toast.copyUnsupportedEnv'), 'err');
      }
    });
  }

  function mount(node) {
    host = node;
    if (!state.portals.length) seed();
    render();
  }

  window.PublicGatewayPanel = { mount, state };
})();
