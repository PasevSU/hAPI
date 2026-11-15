'use strict';
// Export & Download Center (FD-2).
//
// Правилата и preflight-ът идват от add-on-а (`GET /admin/api/v2/export/rules` и
// `POST /admin/api/v2/export/preflight`) и той е източникът на истина. Локалният
// преглед по HapiExportRules (същият споделен модул, който ползва backend-ът) се
// показва САМО когато няма връзка и е изрично надписан „офлайн преглед“ — не се
// представя за резултат от сървъра.
(function () {
  const R = () => globalThis.HapiExportRules;
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Целият текст минава през речника (BG/EN/DE); липсващ ключ се вижда като ключа, не като български.
  const T = (key, vars) =>
    typeof window !== 'undefined' && window.HapiI18n ? window.HapiI18n.t(key, vars) : String(key);
  const toast = (m, k) => window.HapiUI && window.HapiUI.toast(m, k);

  let host = null;
  const state = {
    mode: 'evidence',
    contents: null,
    format: null,
    location: 'folder',
    onConflict: 'unique',
    verifySha256: true,
    readOnly: false,
    caseId: 'CASE001',
    files: ['protokol-2026-114.pdf', 'tablica-hashes.xlsx'],
    // Отговорът от add-on-а: правила и последен preflight.
    srv: { rules: null, rulesError: '', preflight: null, preflightError: '', busy: false },
    // Реален експорт (свързан режим): портал и последен пакет.
    pkg: { portalId: '', last: null, error: '', loaded: false, compression: 'default', encryption: 'none', password: '', generatedPassword: '', split: 'none', rateKbps: 0, parallelChunks: 4 },
  };

  // Адресът идва само от api-base.js (той пази `hapi.apiBase` и Ingress префикса).
  const base = () => (typeof window.hapiApiBase === 'function' ? window.hapiApiBase() : '').replace(/\/$/, '');
  const token = () => sessionStorage.getItem('hapiAdminToken') || '';
  const connected = () => Boolean(base());
  async function api(path, opts) {
    const o = opts || {};
    const headers = Object.assign({}, o.headers || {});
    if (token()) headers.Authorization = `Bearer ${token()}`;
    if (o.json !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetch(base() + path, { method: o.method || 'GET', headers, body: o.json !== undefined ? JSON.stringify(o.json) : undefined });
      const type = res.headers.get('Content-Type') || '';
      const data = type.includes('application/json') ? await res.json() : null;
      return { ok: res.ok, status: res.status, error: res.ok ? '' : (data && data.error) || `HTTP ${res.status}`, data };
    } catch (e) {
      return { ok: false, status: 0, error: e.message, data: null };
    }
  }
  async function download(url, name) {
    try {
      const res = await fetch(url, { headers: token() ? { Authorization: `Bearer ${token()}` } : {} });
      if (!res.ok) return toast(`HTTP ${res.status}`, 'err');
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = name || 'download';
      a.rel = 'noopener';
      a.click();
      // Освобождаването не бива да държи процеса буден, когато панелът се пуска в тест
      // (в браузъра `setTimeout` връща число и `unref` няма — поведението е същото).
      const timer = setTimeout(() => URL.revokeObjectURL(u), 60000);
      if (timer && typeof timer.unref === 'function') timer.unref();
    } catch (e) {
      toast(T('ex.err.offline', { message: e.message }), 'err');
    }
  }

  function config() {
    const base = R().normalizeConfig({
      mode: state.mode,
      contents: state.contents || undefined,
      format: state.format || undefined,
      location: state.location,
      onConflict: state.onConflict,
      verifySha256: state.verifySha256,
      readOnly: state.readOnly,
      caseId: state.caseId,
      files: state.files,
    });
    return base;
  }

  function treeText(plan) {
    const entries = plan.entries.slice().sort((a, b) => a.path.localeCompare(b.path));
    const lines = [`${plan.packageId}/`];
    entries.forEach((e, i) => {
      const last = i === entries.length - 1;
      lines.push(`${last ? '└──' : '├──'} ${e.kind === 'folder' ? `${e.path}/` : e.path}`);
    });
    return lines.join('\n');
  }

  /** Панелът „Пакет и PGP подпис“ — отделна функция, за да остане разметката четима. */
  function packagePanelHtml() {
    const p = state.pkg;
    const dis = connected() ? '' : 'disabled';
    const off = connected() && p.encryption === 'password' ? '' : 'disabled';
    const portals = (p.portals || [])
      .map((x) => `<option value="${esc(x.id)}" ${p.portalId === x.id ? 'selected' : ''}>${esc(x.title)} (${esc(x.slug)})</option>`)
      .join('');
    const option = (value, current, label) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
    const stateLine = !connected()
      ? esc(T('ex.demo.build'))
      : p.error
        ? esc(p.error)
        : p.last
          ? lastPackageHtml(p)
          : esc(T('ex.pickPortal'));
    return `
      <section class="panel u-mt">
        <div class="panel-head"><h2>${esc(T('ex.pkg.title'))}</h2></div>
        <div class="panel-body">
          <p class="hint">${T('ex.pkg.hint')}</p>
          <div class="u-grid u-grid-fields">
            <div class="field"><label for="ec-pkg-portal">${esc(T('ex.f.portal'))}</label>
              <select id="ec-pkg-portal" ${dis}>${portals}</select>
            </div>
            <div class="field"><label for="ec-pkg-compression">${esc(T('ex.f.compression'))}</label>
              <select id="ec-pkg-compression" ${dis}>
                ${option('none', p.compression, esc(T('ex.opt.compNone')))}
                ${option('default', p.compression, esc(T('ex.opt.compDefault')))}
                ${option('max', p.compression, esc(T('ex.opt.compMax')))}
              </select>
            </div>
            <div class="field"><label for="ec-pkg-encryption">${esc(T('ex.f.encryption'))}</label>
              <select id="ec-pkg-encryption" ${dis}>
                ${option('none', p.encryption, esc(T('ex.opt.encNone')))}
                ${option('password', p.encryption, esc(T('ex.opt.encPassword')))}
              </select>
            </div>
            <div class="field"><label for="ec-pkg-password">${esc(T('ex.f.password'))}</label>
              <input type="password" id="ec-pkg-password" autocomplete="new-password" placeholder="${esc(T('ex.opt.passwordPh'))}"
                value="${esc(p.password)}" ${off} />
            </div>
            <div class="field"><label for="ec-pkg-split">${esc(T('ex.f.split'))}</label>
              <select id="ec-pkg-split" ${dis}>
                ${option('none', p.split, esc(T('ex.opt.splitNone')))}
                ${option('10', p.split, esc(T('ex.opt.split10')))}
                ${option('50', p.split, esc(T('ex.opt.split50')))}
                ${option('100', p.split, esc(T('ex.opt.split100')))}
              </select>
            </div>
            <div class="field"><label for="ec-pkg-rate">${esc(T('ex.f.rate'))}</label>
              <select id="ec-pkg-rate" ${dis}>
                ${option('0', String(p.rateKbps), esc(T('ex.opt.rateNone')))}
                ${option('128', String(p.rateKbps), '128 KB/s')}
                ${option('512', String(p.rateKbps), '512 KB/s')}
                ${option('2048', String(p.rateKbps), '2 MB/s')}
              </select>
            </div>
            <div class="field"><label for="ec-pkg-parallel">${esc(T('ex.f.parallel'))}</label>
              <select id="ec-pkg-parallel" ${dis}>
                ${option('1', String(p.parallelChunks), esc(T('ex.opt.par1')))}
                ${option('2', String(p.parallelChunks), esc(T('ex.opt.par2')))}
                ${option('4', String(p.parallelChunks), esc(T('ex.opt.par4')))}
                ${option('8', String(p.parallelChunks), esc(T('ex.opt.par8')))}
              </select>
            </div>
          </div>
          <div class="u-row u-row-4 u-mt">
            <button type="button" class="btn btn-primary" id="ec-pkg-build" ${dis}>${esc(T('ex.pkg.build'))}</button>
            <button type="button" class="btn" id="ec-pkg-zip" ${p.last ? '' : 'disabled'}>${esc(T('ex.pkg.zip'))}</button>
            <button type="button" class="btn" id="ec-pkg-asc" ${p.last && p.last.hasSignature ? '' : 'disabled'}>${esc(T('ex.pkg.asc'))}</button>
            <button type="button" class="btn" id="ec-pkg-verify" ${p.last && p.last.hasSignature ? '' : 'disabled'}>${esc(T('ex.pkg.verify'))}</button>
          </div>
          <p class="hint" id="ec-pkg-state">${stateLine}</p>
        </div>
      </section>`;
  }

  function lastPackageHtml(p) {
    const last = p.last;
    const sig = last.hasSignature ? T('ex.last.signed', { keyId: last.signature.keyId }) : T('ex.last.unsigned');
    const enc = last.hasEncryption ? T('ex.last.encrypted', { cipher: last.encryption.cipher }) : T('ex.last.plain');
    const split = last.hasSplit
      ? T('ex.last.parts', { n: last.split.count, mb: Math.round(last.split.partBytes / 1024 / 1024) })
      : T('ex.last.single');
    const pass = p.generatedPassword
      ? ` · <strong>${T('ex.last.generatedPassword', { password: esc(p.generatedPassword) })}</strong>`
      : '';
    const head = T('ex.last.head', { name: esc(last.fileName), n: last.files });
    const sum = `SHA-256 <code>${esc(String(last.sha256).slice(0, 8))}</code>`;
    return `${head} · ${sum} · ${sig} · ${enc} · ${split}${pass}`;
  }

  function render() {
    const cfg = config();
    const plan = R().planPaths(cfg, { date: new Date(), caseId: cfg.caseId });
    const check = R().validateConfig(cfg);
    const sum = R().summary(cfg);
    const locked = R().requiresVerification(cfg.mode);

    host.innerHTML = `
      <div class="page-title">
        <h1>Export &amp; Download Center</h1>
        <p>${esc(T('ex.subtitle'))}</p>
      </div>

      <div class="two-col">
        <section class="panel">
          <div class="panel-head"><h2>${esc(T('ex.mode.title'))}</h2><span class="badge">${esc(cfg.mode)}</span></div>
          <div class="panel-body">
            <div class="field">
              <label for="ec-mode">${esc(T('ex.f.mode'))}</label>
              <select id="ec-mode">
                ${R()
        .MODES.map((m) => `<option value="${m.id}" ${m.id === cfg.mode ? 'selected' : ''}>${esc(m.label)}</option>`)
        .join('')}
              </select>
            </div>
            <div class="field">
              <label>${esc(T('ex.f.contents'))}</label>
              <div class="checks">
                ${R()
        .CONTENT_IDS.map(
          (id) => `<label><input type="checkbox" data-content="${id}" ${cfg.contents.includes(id) ? 'checked' : ''
            }/> ${esc(R().contentLabel(id))}</label>`,
        )
        .join('')}
              </div>
            </div>
            <div class="two-col">
              <div class="field">
                <label for="ec-format">${esc(T('ex.f.format'))}</label>
                <select id="ec-format">
                  ${Object.entries(R().FORMATS)
        .map(([id, f]) => `<option value="${id}" ${id === cfg.format ? 'selected' : ''}>${esc(f.label)}</option>`)
        .join('')}
                </select>
              </div>
              <div class="field">
                <label for="ec-location">${esc(T('ex.f.location'))}</label>
                <select id="ec-location">
                  ${Object.entries(R().LOCATIONS)
        .map(([id, l]) => `<option value="${id}" ${id === cfg.location ? 'selected' : ''}>${esc(l.label)}</option>`)
        .join('')}
                </select>
              </div>
            </div>
            <div class="field">
              <label for="ec-case">${esc(T('ex.f.case'))}</label>
              <input id="ec-case" value="${esc(cfg.caseId)}" placeholder="CASE001" />
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>${esc(T('ex.policy.title'))}</h2></div>
          <div class="panel-body">
            <div class="field">
              <label>${esc(T('ex.f.conflict'))}</label>
              <div class="checks">
                ${Object.entries(R().ON_CONFLICT)
        .map(
          ([id, c]) =>
            `<label><input type="radio" name="ec-conflict" value="${id}" ${id === cfg.onConflict ? 'checked' : ''}/> ${esc(
              c.label,
            )}</label>`,
        )
        .join('')}
              </div>
            </div>
            <div class="checks u-mt">
              <label><input type="checkbox" id="ec-verify" ${cfg.verifySha256 ? 'checked' : ''} ${locked ? 'disabled' : ''
      }/> ${esc(T('ex.verify'))}</label>
              <label><input type="checkbox" id="ec-readonly" ${cfg.readOnly ? 'checked' : ''}/> ${esc(T('ex.readonly'))}</label>
            </div>
            ${locked
        ? `<p class="hint">${esc(T('ex.policy.locked'))}</p>`
        : ''
      }
            <p class="hint">${esc(T('ex.policy.overwrite'))}</p>
          </div>
        </section>
      </div>

      <section class="panel u-mt">
        <div class="panel-head">
          <h2>${esc(T('ex.panel.pkg'))}</h2>
          <span class="badge ${check.ok ? 'ok' : 'err'}">${check.ok ? esc(T('ex.valid')) : esc(T('ex.errors', { n: check.errors.length }))}</span>
        </div>
        <div class="panel-body">
          <p class="hint summary-line" id="ec-summary">${esc(sum.text)}</p>
          <pre class="tree" aria-label="${esc(T('ex.tree'))}">${esc(treeText(plan))}</pre>
          <h4 class="u-mt">${esc(T('ex.files', { n: plan.entries.length }))}</h4>
          <table class="grid">
            <thead><tr><th>#</th><th>${esc(T('ex.th.path'))}</th><th>${esc(T('ex.th.kind'))}</th><th>${esc(T('ex.th.category'))}</th></tr></thead>
            <tbody>${plan.entries
        .map(
          (e, i) => `<tr><td>${i + 1}</td><td><code>${esc(e.path)}${e.kind === 'folder' ? '/' : ''}</code></td><td>${esc(
            e.kind,
          )}</td><td>${esc(e.content === 'index' ? 'PACKAGE_INDEX.json' : R().contentLabel(e.content))}</td></tr>`,
        )
        .join('')}</tbody>
          </table>
          <p class="hint">${esc(T('ex.indexHint'))}</p>
          ${check.errors.length
        ? `<ul class="err-list">${check.errors.map((e) => `<li>${esc(e.message)}</li>`).join('')}</ul>`
        : ''
      }
          ${check.warnings.length
        ? `<ul class="hint">${check.warnings.map((w) => `<li>${esc(w.message)}</li>`).join('')}</ul>`
        : ''
      }
          <div class="u-row u-row-2 u-mt">
            <button type="button" class="btn btn-primary" id="ec-copy">${esc(T('ex.copy'))}</button>
            <button type="button" class="btn" id="ec-download">${esc(T('ex.downloadJson'))}</button>
          </div>
          <pre class="tree u-mt" id="ec-json">${esc(JSON.stringify({ config: cfg, package: plan.packageId, entries: plan.entries }, null, 2))}</pre>
        </div>
      </section>

      ${packagePanelHtml()}

      <section class="panel u-mt">
        <div class="panel-head">
          <h2>${esc(T('ex.rules.title'))}</h2>
          <span class="badge ${state.srv.rules ? 'ok' : 'demo'}">${state.srv.rules ? esc(T('ex.rules.schema', { v: state.srv.rules.schema_version })) : esc(T('ex.rules.offline'))}</span>
        </div>
        <div class="panel-body">
          <p class="hint">${T('ex.rules.hint')}</p>
          ${state.srv.rulesError ? `<ul class="err-list"><li>${esc(state.srv.rulesError)}</li></ul>` : ''}
          ${rulesSummaryHtml()}
          <div class="u-row u-row-2 u-mt">
            <button type="button" class="btn btn-primary" id="ec-preflight" ${connected() && !state.srv.busy ? '' : 'disabled'}>
              ${state.srv.busy ? esc(T('ex.preflight.busy')) : esc(T('ex.preflight.run'))}
            </button>
          </div>
          ${preflightHtml()}
        </div>
      </section>

      <section class="panel u-mt">
        <div class="panel-head"><h2>${esc(T('ex.caps.title'))}</h2><span class="badge ${state.srv.rules ? 'ok' : 'demo'}">${state.srv.rules ? esc(T('ex.caps.fromServer')) : esc(T('ex.caps.offline'))}</span></div>
        <div class="panel-body">
          <div class="grid-2">
            ${(state.srv.rules && Array.isArray(state.srv.rules.capabilities) ? state.srv.rules.capabilities : R().capabilities())
        .map(
          (c) =>
            `<div class="cap-row"><span>${esc(c.label)}</span><span class="state-chip ${c.implemented ? 'ok' : 'warn'}">${c.implemented ? esc(T('ex.caps.ready')) : esc(T('ex.caps.planned'))
            }</span></div>`,
        )
        .join('')}
          </div>
          <p class="hint">${esc(T('ex.caps.hint'))}</p>
        </div>
      </section>`;

    wire(plan, cfg);
  }

  /** Резюме на правилата, дошли от add-on-а (без измислени стойности). */
  function rulesSummaryHtml() {
    const rules = state.srv.rules;
    if (!rules) {
      return `<p class="hint">${esc(T('ex.rules.offlineBody'))}</p>`;
    }
    const profiles = rules.export_profiles && rules.export_profiles.profiles ? Object.keys(rules.export_profiles.profiles) : [];
    const impl = (rules.capabilities || []).filter((c) => c.implemented).length;
    const checks = rules.download_rules || {};
    return `
      <table class="grid">
        <thead><tr><th>${esc(T('ex.th.rule'))}</th><th>${esc(T('ex.th.value'))}</th></tr></thead>
        <tbody>
          <tr><td>${esc(T('ex.rules.schemaLabel'))}</td><td><code>${esc(rules.schema_version)}</code></td></tr>
          <tr><td>${esc(T('ex.rules.profiles'))}</td><td>${profiles.length ? profiles.map((p) => `<code>${esc(p)}</code>`).join(' · ') : esc(T('ex.none'))}</td></tr>
          <tr><td>${esc(T('ex.rules.verify'))}</td><td>${checks.verify_sha256 ? esc(T('ex.rules.verifyMandatory')) : esc(T('ex.rules.verifyOptional'))}</td></tr>
          <tr><td>${esc(T('ex.rules.conflict'))}</td><td><code>${esc(checks.on_conflict || '—')}</code></td></tr>
          <tr><td>${esc(T('ex.rules.roots'))}</td><td><code>${esc(((checks.storage || {}).allowed_roots || []).join(', ') || '—')}</code></td></tr>
          <tr><td>${esc(T('ex.rules.capsReady'))}</td><td>${esc(T('ex.rules.capsCount', { impl, total: (rules.capabilities || []).length }))}</td></tr>
        </tbody>
      </table>`;
  }

  /** Резултатът от preflight-а на add-on-а: истинският отговор, не пресметнат в браузъра. */
  function preflightHtml() {
    if (state.srv.preflightError) return `<ul class="err-list"><li>${esc(state.srv.preflightError)}</li></ul>`;
    const p = state.srv.preflight;
    if (!p) return `<p class="hint">${esc(T('ex.preflight.none'))}</p>`;
    const failed = (p.preflight && p.preflight.checks ? p.preflight.checks : []).filter((c) => !c.ok);
    return `
      <p class="hint summary-line">${esc(
        T('ex.preflight.head', { id: p.packageId || '—', n: p.entries ? p.entries.length : 0, state: p.ok ? T('ex.preflight.ready') : T('ex.preflight.blocked') }),
      )}</p>
      ${p.summary ? `<p class="hint">${esc(p.summary)}</p>` : ''}
      ${failed.length
        ? `<ul class="err-list">${failed.map((c) => `<li><strong>${esc(c.id || '')}</strong> ${esc(c.detail || c.reason || '')}</li>`).join('')}</ul>`
        : `<p class="hint">${esc(T('ex.preflight.allOk'))}</p>`
      }`;
  }

  /** Правила от add-on-а — източникът на истина, когато има връзка. */
  async function loadServerRules() {
    if (!connected()) return;
    const r = await api('/admin/api/v2/export/rules');
    if (!r.ok || !r.data) {
      state.srv.rulesError = r.error || `HTTP ${r.status}`;
      return render();
    }
    state.srv.rules = r.data;
    state.srv.rulesError = '';
    render();
  }

  /** Проверката минава през СЪРВЪРА: той вижда права, място и read-only корени. */
  async function runPreflight() {
    if (!connected()) return toast(T('ex.err.preflightOffline'), 'err');
    state.srv.busy = true;
    state.srv.preflightError = '';
    render();
    const r = await api('/admin/api/v2/export/preflight', { method: 'POST', json: { config: config(), meta: { date: new Date().toISOString(), caseId: state.caseId } } });
    state.srv.busy = false;
    if (!r.ok || !r.data) {
      state.srv.preflightError = r.error || `HTTP ${r.status}`;
      render();
      return toast(state.srv.preflightError, 'err');
    }
    state.srv.preflight = r.data;
    render();
    toast(r.data.ok ? T('ex.preflight.ok', { id: r.data.packageId }) : T('ex.preflight.found'), r.data.ok ? 'ok' : 'err');
  }

  async function loadPackageContext() {
    const p = state.pkg;
    if (!connected()) {
      p.loaded = true;
      return;
    }
    const [portals, list] = await Promise.all([api('/admin/api/portals'), api('/admin/api/packages')]);
    if (portals.ok && portals.data) {
      p.portals = Array.isArray(portals.data) ? portals.data : portals.data.portals || [];
      if (!p.portalId && p.portals.length) p.portalId = p.portals[0].id;
    }
    if (list.ok && list.data) {
      p.last = (list.data.packages || [])[0] || null;
      if (list.data.settings) p.rateKbps = Number(list.data.settings.rateKbps) || 0;
      if (list.data.settings && Number(list.data.settings.parallelChunks)) p.parallelChunks = Number(list.data.settings.parallelChunks);
      if (list.data.settings && Number(list.data.settings.parallelChunks)) p.parallelChunks = Number(list.data.settings.parallelChunks);
    }
    p.loaded = true;
    render();
  }

  async function buildPackage() {
    const p = state.pkg;
    if (!connected()) return toast(T('ex.demo.buildShort'), '');
    if (!p.portalId) return toast(T('ex.err.pickPortal'), 'err');
    p.error = '';
    // `sign`/`keyId` не се подават: add-on-ът прилага запазените настройки от „Настройки“.
    const body = { portalId: p.portalId, compression: p.compression };
    if (p.encryption === 'password') {
      body.encryption = 'password';
      if (p.password) body.password = p.password;
    }
    if (p.split !== 'none') body.split = { partMb: Number(p.split) };
    const r = await api('/admin/api/packages', { method: 'POST', json: body });
    if (!r.ok) {
      p.error = r.error || `HTTP ${r.status}`;
      toast(p.error, 'err');
      return render();
    }
    p.last = r.data;
    p.generatedPassword = r.data.generatedPassword || '';
    toast(T('ex.pkg.built', { name: r.data.fileName, n: r.data.files }), 'ok');
    render();
    // Разделен пакет се тегли част по част: всяка част има собствен номер и име.
    if (r.data.hasSplit) {
      for (const part of r.data.split.parts) {
        await download(`${base()}/admin/api/packages/${r.data.id}/download?part=${part.index}`, part.name);
      }
    } else {
      await download(`${base()}/admin/api/packages/${r.data.id}/download`, r.data.fileName);
    }
    if (r.data.hasSignature) await download(`${base()}/admin/api/packages/${r.data.id}/signature`, `${r.data.fileName}.asc`);
  }

  function wirePackage() {
    const q = (sel) => host.querySelector(sel);
    const p = state.pkg;
    if (q('#ec-pkg-portal')) {
      q('#ec-pkg-portal').addEventListener('change', (e) => {
        p.portalId = e.target.value;
      });
      if (q('#ec-pkg-compression')) q('#ec-pkg-compression').addEventListener('change', (e) => { p.compression = e.target.value; });
      if (q('#ec-pkg-encryption')) {
        q('#ec-pkg-encryption').addEventListener('change', (e) => {
          p.encryption = e.target.value;
          render();
        });
      }
      if (q('#ec-pkg-password')) q('#ec-pkg-password').addEventListener('input', (e) => { p.password = e.target.value; });
      if (q('#ec-pkg-split')) q('#ec-pkg-split').addEventListener('change', (e) => { p.split = e.target.value; }); if (q('#ec-pkg-rate')) {
        q('#ec-pkg-rate').addEventListener('change', async (e) => {
          const rateKbps = Number(e.target.value) || 0;
          const r = await api('/admin/api/packages/settings', { method: 'PATCH', json: { rateKbps } });
          if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
          p.rateKbps = rateKbps;
          toast(rateKbps ? T('ex.rate.set', { n: rateKbps }) : T('ex.rate.off'), 'ok');
        });
      }
      if (q('#ec-pkg-parallel')) {
        q('#ec-pkg-parallel').addEventListener('change', async (e) => {
          const parallelChunks = Number(e.target.value) || 1;
          const r = await api('/admin/api/packages/settings', { method: 'PATCH', json: { parallelChunks } });
          if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
          p.parallelChunks = parallelChunks;
          toast(T('ex.parallel.set', { n: parallelChunks }), 'ok');
        });
      } q('#ec-pkg-build').addEventListener('click', () => buildPackage());
      q('#ec-pkg-zip').addEventListener('click', () => p.last && download(`${base()}/admin/api/packages/${p.last.id}/download`, p.last.fileName));
      q('#ec-pkg-asc').addEventListener('click', () => p.last && download(`${base()}/admin/api/packages/${p.last.id}/signature`, `${p.last.fileName}.asc`));
      q('#ec-pkg-verify').addEventListener('click', async () => {
        if (!p.last) return;
        const r = await api(`/admin/api/packages/${p.last.id}/verify`, { method: 'POST', json: {} });
        if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
        toast(r.data.valid ? T('ex.sign.ok', { id: r.data.keyId }) : T('ex.sign.bad', { reason: r.data.reason }), r.data.valid ? 'ok' : 'err');
      });
      if (connected() && !p.loaded) void loadPackageContext();
    }
  }

  function wire(plan, cfg) {
    const q = (sel) => host.querySelector(sel);
    q('#ec-mode').addEventListener('change', (e) => {
      state.mode = e.target.value;
      state.contents = null;
      state.format = null;
      render();
    });
    host.querySelectorAll('[data-content]').forEach((el) => {
      el.addEventListener('change', () => {
        const set = new Set(state.contents || cfg.contents);
        if (el.checked) set.add(el.dataset.content);
        else set.delete(el.dataset.content);
        state.contents = [...set];
        render();
      });
    });
    q('#ec-format').addEventListener('change', (e) => {
      state.format = e.target.value;
      render();
    });
    q('#ec-location').addEventListener('change', (e) => {
      state.location = e.target.value;
      render();
    });
    q('#ec-case').addEventListener('change', (e) => {
      state.caseId = e.target.value.trim();
      render();
    });
    host.querySelectorAll('input[name="ec-conflict"]').forEach((el) => {
      el.addEventListener('change', () => {
        state.onConflict = el.value;
        render();
      });
    });
    const preflightButton = q('#ec-preflight');
    if (preflightButton) preflightButton.addEventListener('click', () => runPreflight());
    const verify = q('#ec-verify');
    if (verify) {
      verify.addEventListener('change', () => {
        if (R().requiresVerification(state.mode)) return;
        state.verifySha256 = verify.checked;
        render();
      });
    }
    q('#ec-readonly').addEventListener('change', (e) => {
      state.readOnly = e.target.checked;
      render();
    });
    q('#ec-copy').addEventListener('click', () => {
      copyText(JSON.stringify({ config: cfg, package: plan.packageId, entries: plan.entries }, null, 2));
    });
    q('#ec-download').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ config: cfg, package: plan.packageId, entries: plan.entries }, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'export_config.json';
      link.click();
      URL.revokeObjectURL(url);
      toast(T('ex.downloaded'), 'ok');
    });
    wirePackage();
  }

  function copyText(text) {
    const done = () => toast(T('ex.copied'), 'ok');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => legacyCopy(text, done));
      return;
    }
    legacyCopy(text, done);
  }

  function legacyCopy(text, done) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'absolute';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      toast(T('ex.copyUnsupported'), 'err');
    }
    area.remove();
  }

  function mount(node) {
    host = node;
    render();
    if (connected() && !state.srv.rules) void loadServerRules();
  }

  window.ExportCenterPanel = { mount, state };
})();
