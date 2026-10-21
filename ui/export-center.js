'use strict';
// Export & Download Center (FD-2) — интерактивен модел на правилата за експорт.
//
// Панелът НЕ извършва трансфер. Той изчислява реалната конфигурация чрез
// HapiExportRules: режим, съдържание, формат, политика при конфликт, име на пакета,
// дърво на пакета и валидация. Всичко, което не е реализирано, е надписано „планирано“.
(function () {
  const R = () => globalThis.HapiExportRules;
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    // Реален експорт (свързан режим): портал и последен пакет.
    pkg: { portalId: '', last: null, error: '', loaded: false },
  };

  const base = () => (localStorage.getItem('hapi.apiBase') || (location.protocol === 'file:' ? '' : location.origin)).replace(/\/$/, '');
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
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch (e) {
      toast(`Няма връзка: ${e.message}`, 'err');
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

  function render() {
    const cfg = config();
    const plan = R().planPaths(cfg, { date: new Date(), caseId: cfg.caseId });
    const check = R().validateConfig(cfg);
    const sum = R().summary(cfg);
    const locked = R().requiresVerification(cfg.mode);

    host.innerHTML = `
      <div class="page-title">
        <h1>Export &amp; Download Center</h1>
        <p>Правила за изтегляне и експорт · модел без реален трансфер</p>
        <span class="badge demo">интерактивен модел</span>
      </div>

      <div class="two-col">
        <section class="panel">
          <div class="panel-head"><h2>Режим на експортиране</h2><span class="badge">${esc(cfg.mode)}</span></div>
          <div class="panel-body">
            <div class="field">
              <label>Режим</label>
              <select id="ec-mode">
                ${R()
                  .MODES.map((m) => `<option value="${m.id}" ${m.id === cfg.mode ? 'selected' : ''}>${esc(m.label)}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label>Съдържание на пакета</label>
              <div class="checks">
                ${R()
                  .CONTENT_IDS.map(
                    (id) => `<label><input type="checkbox" data-content="${id}" ${
                      cfg.contents.includes(id) ? 'checked' : ''
                    }/> ${esc(R().contentLabel(id))}</label>`,
                  )
                  .join('')}
              </div>
            </div>
            <div class="two-col">
              <div class="field">
                <label>Формат</label>
                <select id="ec-format">
                  ${Object.entries(R().FORMATS)
                    .map(([id, f]) => `<option value="${id}" ${id === cfg.format ? 'selected' : ''}>${esc(f.label)}</option>`)
                    .join('')}
                </select>
              </div>
              <div class="field">
                <label>Местоназначение</label>
                <select id="ec-location">
                  ${Object.entries(R().LOCATIONS)
                    .map(([id, l]) => `<option value="${id}" ${id === cfg.location ? 'selected' : ''}>${esc(l.label)}</option>`)
                    .join('')}
                </select>
              </div>
            </div>
            <div class="field">
              <label>Дело (за име на пакета)</label>
              <input id="ec-case" value="${esc(cfg.caseId)}" placeholder="CASE001" />
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>Политика при запис</h2></div>
          <div class="panel-body">
            <div class="field">
              <label>При съществуващ файл</label>
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
              <label><input type="checkbox" id="ec-verify" ${cfg.verifySha256 ? 'checked' : ''} ${
                locked ? 'disabled' : ''
              }/> Проверка на SHA-256 след запис</label>
              <label><input type="checkbox" id="ec-readonly" ${cfg.readOnly ? 'checked' : ''}/> Read-only атрибут, когато се поддържа</label>
            </div>
            ${
              locked
                ? '<p class="hint">Режимът е доказателствен: проверката на SHA-256 е задължителна и не може да бъде изключена.</p>'
                : ''
            }
            <p class="hint">Презаписът е изключен по подразбиране; за доказателствени архиви е забранен.</p>
          </div>
        </section>
      </div>

      <section class="panel u-mt">
        <div class="panel-head">
          <h2>Пакет</h2>
          <span class="badge ${check.ok ? 'ok' : 'err'}">${check.ok ? 'валидна конфигурация' : `${check.errors.length} грешки`}</span>
        </div>
        <div class="panel-body">
          <p class="hint summary-line" id="ec-summary">${esc(sum.text)}</p>
          <pre class="tree" aria-label="Дърво на пакета">${esc(treeText(plan))}</pre>
          <h4 class="u-mt">Файлове в пакета (${plan.entries.length})</h4>
          <table class="grid">
            <thead><tr><th>#</th><th>Относителен път</th><th>Тип</th><th>Категория</th></tr></thead>
            <tbody>${plan.entries
              .map(
                (e, i) => `<tr><td>${i + 1}</td><td><code>${esc(e.path)}${e.kind === 'folder' ? '/' : ''}</code></td><td>${esc(
                  e.kind,
                )}</td><td>${esc(e.content === 'index' ? 'PACKAGE_INDEX.json' : R().contentLabel(e.content))}</td></tr>`,
              )
              .join('')}</tbody>
          </table>
          <p class="hint">PACKAGE_INDEX.json съдържа за всеки файл относителен път, размер, SHA-256, тип, източник и резултат от проверката.</p>
          ${
            check.errors.length
              ? `<ul class="err-list">${check.errors.map((e) => `<li>${esc(e.message)}</li>`).join('')}</ul>`
              : ''
          }
          ${
            check.warnings.length
              ? `<ul class="hint">${check.warnings.map((w) => `<li>${esc(w.message)}</li>`).join('')}</ul>`
              : ''
          }
          <div class="u-row u-row-2 u-mt">
            <button type="button" class="btn btn-primary" id="ec-copy">Копирай конфигурацията като JSON</button>
            <button type="button" class="btn" id="ec-download">Свали export_config.json</button>
          </div>
          <pre class="tree u-mt" id="ec-json">${esc(JSON.stringify({ config: cfg, package: plan.packageId, entries: plan.entries }, null, 2))}</pre>
        </div>
      </section>

      <section class="panel u-mt">
        <div class="panel-head"><h2>Пакет и PGP подпис</h2><span class="badge ${connected() ? 'ok' : 'demo'}">${
          connected() ? 'реален експорт' : 'изисква връзка'
        }</span></div>
        <div class="panel-body">
          <p class="hint">Пакетът е ZIP с <code>PACKAGE_INDEX.json</code>, <code>hashes/sha256sum.txt</code>, манифест и оригиналите. Дали се подписва с PGP се задава в <strong>„Настройки → PGP ключ и автоподписване“</strong> — тук не се пита.</p>
          <div class="u-grid u-grid-fields">
            <div class="field"><label>Портал</label>
              <select id="ec-pkg-portal" ${connected() ? '' : 'disabled'}>
                ${(state.pkg.portals || []).map((p) => `<option value="${esc(p.id)}" ${state.pkg.portalId === p.id ? 'selected' : ''}>${esc(p.title)} (${esc(p.slug)})</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="u-row u-row-4 u-mt">
            <button type="button" class="btn btn-primary" id="ec-pkg-build" ${connected() ? '' : 'disabled'}>Създай и изтегли пакета</button>
            <button type="button" class="btn" id="ec-pkg-zip" ${state.pkg.last ? '' : 'disabled'}>Свали ZIP</button>
            <button type="button" class="btn" id="ec-pkg-asc" ${state.pkg.last && state.pkg.last.hasSignature ? '' : 'disabled'}>Свали .asc</button>
            <button type="button" class="btn" id="ec-pkg-verify" ${state.pkg.last && state.pkg.last.hasSignature ? '' : 'disabled'}>Провери подписа</button>
          </div>
          <p class="hint" id="ec-pkg-state">${
            !connected()
              ? 'Демо: създаването на пакет изисква свързан add-on.'
              : state.pkg.error
                ? esc(state.pkg.error)
                : state.pkg.last
                  ? `Последен пакет: <code>${esc(state.pkg.last.fileName)}</code> · ${state.pkg.last.files} файла · SHA-256 <code>${esc(
                      String(state.pkg.last.sha256).slice(0, 8),
                    )}</code> · ${state.pkg.last.hasSignature ? `подпис ${esc(state.pkg.last.signature.keyId)}` : 'без подпис'}`
                  : 'Избери портал и натисни „Създай и изтегли пакета“.'
          }</p>
        </div>
      </section>

      <section class="panel u-mt">
        <div class="panel-head"><h2>Enterprise опции (capabilities)</h2><span class="badge demo">по план</span></div>
        <div class="panel-body">
          <div class="grid-2">
            ${R()
              .capabilities()
              .map(
                (c) =>
                  `<div class="cap-row"><span>${esc(c.label)}</span><span class="state-chip ${c.implemented ? 'ok' : 'warn'}">${
                    c.implemented ? 'готово' : 'планирано'
                  }</span></div>`,
              )
              .join('')}
          </div>
          <p class="hint">Capabilities не се показват като работещи преди реалната им имплементация.</p>
        </div>
      </section>`;

    wire(plan, cfg);
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
    if (list.ok && list.data) p.last = (list.data.packages || [])[0] || null;
    p.loaded = true;
    render();
  }

  async function buildPackage() {
    const p = state.pkg;
    if (!connected()) return toast('Демо: пакетът се създава от add-on-а', '');
    if (!p.portalId) return toast('Избери портал', 'err');
    p.error = '';
    // `sign`/`keyId` не се подават: add-on-ът прилага запазените настройки от „Настройки“.
    const r = await api('/admin/api/packages', { method: 'POST', json: { portalId: p.portalId } });
    if (!r.ok) {
      p.error = r.error || `HTTP ${r.status}`;
      toast(p.error, 'err');
      return render();
    }
    p.last = r.data;
    toast(`Пакет ${r.data.fileName} · ${r.data.files} файла`, 'ok');
    render();
    await download(`${base()}/admin/api/packages/${r.data.id}/download`, r.data.fileName);
    if (r.data.hasSignature) await download(`${base()}/admin/api/packages/${r.data.id}/signature`, `${r.data.fileName}.asc`);
  }

  function wirePackage() {
    const q = (sel) => host.querySelector(sel);
    const p = state.pkg;
    if (q('#ec-pkg-portal')) {
      q('#ec-pkg-portal').addEventListener('change', (e) => {
        p.portalId = e.target.value;
      });
      q('#ec-pkg-build').addEventListener('click', () => buildPackage());
      q('#ec-pkg-zip').addEventListener('click', () => p.last && download(`${base()}/admin/api/packages/${p.last.id}/download`, p.last.fileName));
      q('#ec-pkg-asc').addEventListener('click', () => p.last && download(`${base()}/admin/api/packages/${p.last.id}/signature`, `${p.last.fileName}.asc`));
      q('#ec-pkg-verify').addEventListener('click', async () => {
        if (!p.last) return;
        const r = await api(`/admin/api/packages/${p.last.id}/verify`, { method: 'POST', json: {} });
        if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
        toast(r.data.valid ? `Подписът е валиден · ${r.data.keyId}` : `Невалиден подпис: ${r.data.reason}`, r.data.valid ? 'ok' : 'err');
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
      toast('export_config.json е изтеглен', 'ok');
    });
    wirePackage();
  }

  function copyText(text) {
    const done = () => toast('Конфигурацията е копирана в клипборда', 'ok');
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
      toast('Копирането не е поддържано от тази среда', 'err');
    }
    area.remove();
  }

  function mount(node) {
    host = node;
    render();
  }

  window.ExportCenterPanel = { mount, state };
})();
