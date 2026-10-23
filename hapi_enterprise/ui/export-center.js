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

  const base = () =>
    (window.hapiApiBase
      ? window.hapiApiBase()
      : localStorage.getItem('hapi.apiBase') || (location.protocol === 'file:' ? '' : location.origin)).replace(/\/$/, '');
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

  /** Панелът „Пакет и PGP подпис“ — отделна функция, за да остане разметката четима. */
  function packagePanelHtml() {
    const p = state.pkg;
    const dis = connected() ? '' : 'disabled';
    const off = connected() && p.encryption === 'password' ? '' : 'disabled';
    const badge = connected() ? '<span class="badge ok">реален експорт</span>' : '<span class="badge demo">изисква връзка</span>';
    const portals = (p.portals || [])
      .map((x) => `<option value="${esc(x.id)}" ${p.portalId === x.id ? 'selected' : ''}>${esc(x.title)} (${esc(x.slug)})</option>`)
      .join('');
    const option = (value, current, label) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
    const stateLine = !connected()
      ? 'Демо: създаването на пакет изисква свързан add-on.'
      : p.error
        ? esc(p.error)
        : p.last
          ? lastPackageHtml(p)
          : 'Избери портал и натисни „Създай и изтегли пакета“.';
    return `
      <section class="panel u-mt">
        <div class="panel-head"><h2>Пакет и PGP подпис</h2>${badge}</div>
        <div class="panel-body">
          <p class="hint">Пакетът е ZIP с <code>PACKAGE_INDEX.json</code>, <code>hashes/sha256sum.txt</code>, манифест и оригиналите. Дали се подписва с PGP се задава в <strong>„Настройки → PGP ключ и автоподписване“</strong> — тук не се пита.</p>
          <div class="u-grid u-grid-fields">
            <div class="field"><label>Портал</label>
              <select id="ec-pkg-portal" ${dis}>${portals}</select>
            </div>
            <div class="field"><label>Компресия на пакета</label>
              <select id="ec-pkg-compression" ${dis}>
                ${option('none', p.compression, 'Без компресия (0)')}
                ${option('default', p.compression, 'Обичайна (6)')}
                ${option('max', p.compression, 'Максимална (9)')}
              </select>
            </div>
            <div class="field"><label>Криптиране на пакета</label>
              <select id="ec-pkg-encryption" ${dis}>
                ${option('none', p.encryption, 'Без криптиране')}
                ${option('password', p.encryption, 'С парола (AES-256-GCM)')}
              </select>
            </div>
            <div class="field"><label>Парола за пакета</label>
              <input type="password" id="ec-pkg-password" autocomplete="new-password" placeholder="минимум 8 знака · празно = генерирана"
                value="${esc(p.password)}" ${off} />
            </div>
            <div class="field"><label>Размер на частта</label>
              <select id="ec-pkg-split" ${dis}>
                ${option('none', p.split, 'Без разделяне')}
                ${option('10', p.split, 'Части по 10 MB')}
                ${option('50', p.split, 'Части по 50 MB')}
                ${option('100', p.split, 'Части по 100 MB')}
              </select>
            </div>
            <div class="field"><label>Ограничение на скоростта</label>
              <select id="ec-pkg-rate" ${dis}>
                ${option('0', String(p.rateKbps), 'Без ограничение')}
                ${option('128', String(p.rateKbps), '128 KB/s')}
                ${option('512', String(p.rateKbps), '512 KB/s')}
                ${option('2048', String(p.rateKbps), '2 MB/s')}
              </select>
            </div>
            <div class="field"><label>Паралелни заявки</label>
              <select id="ec-pkg-parallel" ${dis}>
                ${option('1', String(p.parallelChunks), '1 (един поток)')}
                ${option('2', String(p.parallelChunks), '2 потока')}
                ${option('4', String(p.parallelChunks), '4 потока')}
                ${option('8', String(p.parallelChunks), '8 потока')}
              </select>
            </div>
          </div>
          <div class="u-row u-row-4 u-mt">
            <button type="button" class="btn btn-primary" id="ec-pkg-build" ${dis}>Създай и изтегли пакета</button>
            <button type="button" class="btn" id="ec-pkg-zip" ${p.last ? '' : 'disabled'}>Свали ZIP</button>
            <button type="button" class="btn" id="ec-pkg-asc" ${p.last && p.last.hasSignature ? '' : 'disabled'}>Свали .asc</button>
            <button type="button" class="btn" id="ec-pkg-verify" ${p.last && p.last.hasSignature ? '' : 'disabled'}>Провери подписа</button>
          </div>
          <p class="hint" id="ec-pkg-state">${stateLine}</p>
        </div>
      </section>`;
  }

  function lastPackageHtml(p) {
    const last = p.last;
    const sig = last.hasSignature ? `подпис ${esc(last.signature.keyId)}` : 'без подпис';
    const enc = last.hasEncryption ? `криптиран (${esc(last.encryption.cipher)})` : 'без криптиране';
    const split = last.hasSplit
      ? `${last.split.count} части по ${Math.round(last.split.partBytes / 1024 / 1024)} MB`
      : 'един файл';
    const pass = p.generatedPassword
      ? ` · <strong>генерирана парола: <code>${esc(p.generatedPassword)}</code></strong> (показва се само сега)`
      : '';
    const head = `Последен пакет: <code>${esc(last.fileName)}</code> · ${last.files} файла`;
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
        <p>Правила за изтегляне и експорт · проверка и пакет от add-on-а</p>
        <span class="badge ${connected() ? 'ok' : 'demo'}">${connected() ? 'свързан с add-on-а' : 'офлайн преглед'}</span>
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
          (id) => `<label><input type="checkbox" data-content="${id}" ${cfg.contents.includes(id) ? 'checked' : ''
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
              <label><input type="checkbox" id="ec-verify" ${cfg.verifySha256 ? 'checked' : ''} ${locked ? 'disabled' : ''
      }/> Проверка на SHA-256 след запис</label>
              <label><input type="checkbox" id="ec-readonly" ${cfg.readOnly ? 'checked' : ''}/> Read-only атрибут, когато се поддържа</label>
            </div>
            ${locked
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
          ${check.errors.length
        ? `<ul class="err-list">${check.errors.map((e) => `<li>${esc(e.message)}</li>`).join('')}</ul>`
        : ''
      }
          ${check.warnings.length
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

      ${packagePanelHtml()}

      <section class="panel u-mt">
        <div class="panel-head">
          <h2>Правила и проверка от add-on-а</h2>
          <span class="badge ${state.srv.rules ? 'ok' : 'demo'}">${state.srv.rules ? `схема ${esc(state.srv.rules.schema_version)}` : 'без връзка'}</span>
        </div>
        <div class="panel-body">
          <p class="hint">Правилата се четат от <code>GET /admin/api/v2/export/rules</code>, а проверката минава през
            <code>POST /admin/api/v2/export/preflight</code> — тоест тук се вижда какво ще направи САМИЯТ add-on,
            включително проверките на средата (права, свободно място, read-only корени), които браузърът не може да направи.</p>
          ${state.srv.rulesError ? `<ul class="err-list"><li>${esc(state.srv.rulesError)}</li></ul>` : ''}
          ${rulesSummaryHtml()}
          <div class="u-row u-row-2 u-mt">
            <button type="button" class="btn btn-primary" id="ec-preflight" ${connected() && !state.srv.busy ? '' : 'disabled'}>
              ${state.srv.busy ? 'Проверка…' : 'Провери конфигурацията (preflight)'}
            </button>
          </div>
          ${preflightHtml()}
        </div>
      </section>

      <section class="panel u-mt">
        <div class="panel-head"><h2>Enterprise опции (capabilities)</h2><span class="badge ${state.srv.rules ? 'ok' : 'demo'}">${state.srv.rules ? 'от add-on-а' : 'офлайн'}</span></div>
        <div class="panel-body">
          <div class="grid-2">
            ${(state.srv.rules && Array.isArray(state.srv.rules.capabilities) ? state.srv.rules.capabilities : R().capabilities())
        .map(
          (c) =>
            `<div class="cap-row"><span>${esc(c.label)}</span><span class="state-chip ${c.implemented ? 'ok' : 'warn'}">${c.implemented ? 'готово' : 'планирано'
            }</span></div>`,
        )
        .join('')}
          </div>
          <p class="hint">Capabilities не се показват като работещи преди реалната им имплементация; когато има връзка, списъкът идва от add-on-а.</p>
        </div>
      </section>`;

    wire(plan, cfg);
  }

  /** Резюме на правилата, дошли от add-on-а (без измислени стойности). */
  function rulesSummaryHtml() {
    const rules = state.srv.rules;
    if (!rules) {
      return '<p class="hint">Няма връзка с add-on-а — правилата не са заредени. По-долу виждаш само офлайн преглед по същите споделени правила.</p>';
    }
    const profiles = rules.export_profiles && rules.export_profiles.profiles ? Object.keys(rules.export_profiles.profiles) : [];
    const impl = (rules.capabilities || []).filter((c) => c.implemented).length;
    const checks = rules.download_rules || {};
    return `
      <table class="grid">
        <thead><tr><th>Правило</th><th>Стойност от add-on-а</th></tr></thead>
        <tbody>
          <tr><td>Схема</td><td><code>${esc(rules.schema_version)}</code></td></tr>
          <tr><td>Профили за експорт</td><td>${profiles.length ? profiles.map((p) => `<code>${esc(p)}</code>`).join(' · ') : 'няма'}</td></tr>
          <tr><td>Проверка на SHA-256</td><td>${checks.verify_sha256 ? 'задължителна според правилата' : 'по избор'}</td></tr>
          <tr><td>При конфликт по подразбиране</td><td><code>${esc(checks.on_conflict || '—')}</code></td></tr>
          <tr><td>Разрешени корени</td><td><code>${esc(((checks.storage || {}).allowed_roots || []).join(', ') || '—')}</code></td></tr>
          <tr><td>Готови capabilities</td><td>${impl} от ${(rules.capabilities || []).length}</td></tr>
        </tbody>
      </table>`;
  }

  /** Резултатът от preflight-а на add-on-а: истинският отговор, не пресметнат в браузъра. */
  function preflightHtml() {
    if (state.srv.preflightError) return `<ul class="err-list"><li>${esc(state.srv.preflightError)}</li></ul>`;
    const p = state.srv.preflight;
    if (!p) return '<p class="hint">Preflight още не е пускан в тази сесия.</p>';
    const failed = (p.preflight && p.preflight.checks ? p.preflight.checks : []).filter((c) => !c.ok);
    return `
      <p class="hint summary-line">Пакет <code>${esc(p.packageId || '—')}</code> · ${p.entries ? p.entries.length : 0} записа · ${p.ok ? 'готово за експорт' : 'има пречки'}</p>
      ${p.summary ? `<p class="hint">${esc(p.summary)}</p>` : ''}
      ${failed.length
        ? `<ul class="err-list">${failed.map((c) => `<li><strong>${esc(c.id || '')}</strong> ${esc(c.detail || c.reason || '')}</li>`).join('')}</ul>`
        : '<p class="hint">Всички проверки на средата минават.</p>'
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
    if (!connected()) return toast('Preflight изисква връзка с add-on-а', 'err');
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
    toast(r.data.ok ? `Preflight OK · ${r.data.packageId}` : 'Preflight намери пречки', r.data.ok ? 'ok' : 'err');
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
    if (!connected()) return toast('Демо: пакетът се създава от add-on-а', '');
    if (!p.portalId) return toast('Избери портал', 'err');
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
    toast(`Пакет ${r.data.fileName} · ${r.data.files} файла`, 'ok');
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
          toast(rateKbps ? `Ограничение: ${rateKbps} KB/s` : 'Ограничението е изключено', 'ok');
        });
      }
      if (q('#ec-pkg-parallel')) {
        q('#ec-pkg-parallel').addEventListener('change', async (e) => {
          const parallelChunks = Number(e.target.value) || 1;
          const r = await api('/admin/api/packages/settings', { method: 'PATCH', json: { parallelChunks } });
          if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
          p.parallelChunks = parallelChunks;
          toast(`Паралелни заявки: ${parallelChunks}`, 'ok');
        });
      } q('#ec-pkg-build').addEventListener('click', () => buildPackage());
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
    if (connected() && !state.srv.rules) void loadServerRules();
  }

  window.ExportCenterPanel = { mount, state };
})();
