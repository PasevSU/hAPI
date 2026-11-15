'use strict';
// МОНИТОРИНГ — ЕДНА страница за всичко, което add-on-ът мери.
//
// Защо съществува (0.69.205): мониторингът беше разпръснат — седем карти в таблото, отделен
// блок „Ресурси и хранилище“, „Кой влиза“ и „Живи събития“ в таблото, и още един мониторинг
// ВЪТРЕ в панела с порталите (`files-manager.js`). Човек трябваше да обикаля страници, за да
// разбере дали нещо не е наред, а едни и същи числа се теглеха на две места. Сега всичко
// измервано стои тук, а другите страници не рисуват мониторинг.
//
// Правила, които модулът пази:
//   • без декоративни табелки „свързан“/„готово“: състоянието се казва с дума в карта
//     („здраво“, „внимание“, „критично“), а липсата на връзка — с изречение, не с чип;
//   • без твърдо зададени числа: всяка стойност идва от административния API;
//   • сгъващите се блокове са АКОРДЕОН: отваря се един, останалите се затварят, а при
//     затваряне не остава нищо отворено (начално състояние);
//   • отстоянията идват само от семантичните токени (`--gap-*`, `--pad-*`).
(function () {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Целият текст минава през речника (BG/EN/DE); липсващ ключ се вижда като ключа, не като български.
  const T = (key, vars) =>
    typeof window !== 'undefined' && window.HapiI18n ? window.HapiI18n.t(key, vars) : String(key);
  const base = () => (typeof window.hapiApiBase === 'function' ? window.hapiApiBase() : '').replace(/\/$/, '');
  const token = () => sessionStorage.getItem('hapiAdminToken') || '';

  async function api(path) {
    const url = base();
    if (!url) return { ok: false, offline: true };
    try {
      const res = await fetch(url + path, { headers: token() ? { Authorization: 'Bearer ' + token() } : {} });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, status: 0, error: e.message };
    }
  }

  const card = (label, value, note) => `
    <div class="dash-card">
      <span class="dash-label">${esc(label)}</span>
      <strong class="dash-value">${esc(value)}</strong>
      ${note ? `<small class="hint">${esc(note)}</small>` : ''}
    </div>`;

  const chip = (label, value) =>
    `<span class="fm-ico" title="${esc(label + ': ' + value)}"><span class="fm-ico-g" aria-hidden="true">•</span><span class="fm-ico-v">${esc(
      label + ' · ' + value,
    )}</span></span>`;

  /** Един отворен сгъваем блок: отваряне затваря останалите, затваряне не оставя нищо. */
  const wireAccordion = (root) => {
    const items = [...root.querySelectorAll('details[data-acc]')];
    for (const item of items) {
      item.addEventListener('toggle', () => {
        if (!item.open) return;
        for (const other of items) if (other !== item && other.open) other.open = false;
      });
    }
    return items.length;
  };

  // ── Жив поток от събития (SSE) ────────────────────────────────────────────
  let liveSource = null;
  let liveListEl = null;
  let liveWant = false; // човекът е на страницата: потокът трябва да е жив
  let liveTimer = null;
  let liveRetry = 0;
  const liveList = [];
  const renderLive = () => {
    if (!liveListEl) return;
    liveListEl.innerHTML = liveList.length
      ? liveList.map((item) => `<div class="fm-row"><span class="badge">${esc(item.event)}</span> <small class="hint">${esc(item.at)}</small></div>`).join('')
      : `<p class="hint">${esc(T('mon.live.empty'))}</p>`;
  };
  // Билетът е ЕДНОКРАТЕН, затова автоматичното повторно свързване на `EventSource` е
  // безполезно: то чука на вече изразходван билет и получава 401. Същото важи и за `bye`
  // след 30-минутния таван на сървъра. Затова панелът отваря наново САМ — с НОВ билет и с
  // нарастващо изчакване (1 → 2 → 5 → 15 → 30 s), вместо „Живи събития“ да замлъкне до
  // презареждане на страницата (0.69.207).
  const LIVE_BACKOFF = [1000, 2000, 5000, 15000, 30000];
  function stopLive() {
    liveWant = false;
    if (liveTimer) {
      clearTimeout(liveTimer);
      liveTimer = null;
    }
    if (liveSource) {
      try {
        liveSource.close();
      } catch {
        /* вече е затворен */
      }
      liveSource = null;
    }
    liveListEl = null;
  }
  function startLive(onEvent) {
    stopLive();
    const url = base();
    const adminToken = token();
    if (!url || !adminToken || typeof window.EventSource !== 'function') return Promise.resolve(false);
    liveWant = true;
    liveRetry = 0;

    /** Отваря отново след изчакване — само докато панелът е на екрана. */
    const schedule = () => {
      if (!liveWant || liveTimer) return;
      const wait = LIVE_BACKOFF[Math.min(liveRetry, LIVE_BACKOFF.length - 1)];
      liveRetry += 1;
      liveTimer = setTimeout(() => {
        liveTimer = null;
        void open();
      }, wait);
      liveTimer.unref?.();
    };

    const attach = (source) => {
      const forward = (name) =>
        source.addEventListener(name, (e) => {
          let payload;
          try {
            payload = JSON.parse(e.data);
          } catch {
            payload = { event: name };
          }
          onEvent(name, payload);
        });
      for (const name of ['document.finalized', 'job.completed', 'access.created', 'report.packaged', 'resync']) forward(name);
      // Таванът на сървъра (30 min) затваря потока с `bye`; всеки мрежов отказ дава
      // `error`. И двете значат едно: връзката я няма и трябва нов билет.
      source.addEventListener('bye', () => {
        try {
          source.close();
        } catch {
          /* вече е затворен */
        }
        if (liveSource === source) liveSource = null;
        schedule();
      });
      source.addEventListener('error', () => {
        try {
          source.close();
        } catch {
          /* вече е затворен */
        }
        if (liveSource === source) liveSource = null;
        schedule();
      });
    };

    // `EventSource` не може да слага `Authorization`, а администраторският токен НЕ бива да
    // влиза в адрес (история, `Referer`, логове на прокси). Затова първо се иска ЕДНОКРАТЕН
    // билет с обикновен `POST` и заглавка, а потокът получава само билета (0.69.206).
    const open = async () => {
      if (!liveWant) return false;
      let ticket;
      try {
        const res = await fetch(url + '/admin/api/events/ticket', { method: 'POST', headers: { Authorization: 'Bearer ' + adminToken } });
        const body = await res.json().catch(() => null);
        ticket = body && body.ticket ? String(body.ticket) : '';
      } catch {
        ticket = '';
      }
      if (!liveWant) return false;
      if (!ticket) {
        // Сървърът е недостъпен или токенът е изтекъл: опитва се пак, вместо да млъкне.
        schedule();
        return false;
      }
      try {
        liveSource = new window.EventSource(url + '/admin/api/events/stream?ticket=' + encodeURIComponent(ticket));
      } catch {
        liveSource = null;
        schedule();
        return false;
      }
      attach(liveSource);
      liveRetry = 0;
      return true;
    };
    return open();
  }

  async function mount(view) {
    view.innerHTML = `
      <div class="page-title">
        <h1>${esc(T('mon.title'))}</h1>
        <p class="hint">${esc(T('mon.subtitle'))}</p>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>${esc(T('mon.section.state'))}</h2></div>
        <div class="panel-body">
          <div class="dash-grid" id="mon-cards"></div>
          <p class="hint" id="mon-hint"></p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>${esc(T('mon.section.res'))}</h2></div>
        <div class="panel-body" id="mon-res"></div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>${esc(T('mon.section.visitors'))}</h2>
          <div class="u-row u-row-2">
            <select id="mon-portal" title="${esc(T('mon.portal.title'))}">
              <option value="">${esc(T('mon.portal.all'))}</option>
            </select>
            <button type="button" class="btn btn-sm" id="mon-refresh">${esc(T('mon.refresh'))}</button>
          </div>
        </div>
        <div class="panel-body" id="mon-visitors"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>${esc(T('mon.section.live'))}</h2></div>
        <div class="panel-body" id="mon-live"></div>
      </section>`;

    const cards = view.querySelector('#mon-cards');
    const hint = view.querySelector('#mon-hint');
    const resBox = view.querySelector('#mon-res');
    const visitBox = view.querySelector('#mon-visitors');
    const select = view.querySelector('#mon-portal');

    // Състоянието на екрана: кой портал е избран за „неговите“ числа и последните сензори.
    let monitor = null;
    let portals = [];
    let focus = '';

    const [portalsRes, jobs, audit, diagnostics] = await Promise.all([
      api('/admin/api/portals'),
      api('/admin/api/jobs'),
      api('/admin/api/audit/verify'),
      api('/admin/api/diagnostics'),
    ]);

    // Ако междувременно е монтиран ДРУГ изглед (навигация по време на зареждането), този
    // вече не притежава DOM-а: излизаме, вместо да рисуваме в откачени възли (това даваше
    // `Cannot set properties of null` при бързо превключване на раздели).
    if (view.querySelector('#mon-cards') !== cards) return;

    if (portalsRes.offline) {
      hint.textContent = T('mon.offline');
      cards.replaceChildren();
      resBox.innerHTML = `<p class="hint">${esc(T('mon.offline.diag'))}</p>`;
      visitBox.innerHTML = `<p class="hint">${esc(T('mon.offline.sensors'))}</p>`;
      view.querySelector('#mon-live').innerHTML = `<p class="hint">${esc(T('mon.live.closed'))}</p>`;
      return;
    }

    const list = portalsRes.ok && portalsRes.data ? (Array.isArray(portalsRes.data) ? portalsRes.data : portalsRes.data.portals || []) : [];
    portals = list;
    const files = list.reduce((sum, p) => sum + (Array.isArray(p.files) ? p.files.length : 0), 0);
    const publicPortals = list.filter((p) => p.visibility === 'public').length;

    const sensorRes = await api('/admin/api/sensors');
    monitor = sensorRes.ok && sensorRes.data ? sensorRes.data.visitorsIntel || null : null;
    // `guidance` е решението на add-on-а (decision-sensors.js): статус, измерени стойности
    // и ЕДНА препоръчана проверка. Панелът не смята прагове — иначе би показал друго от HA.
    const guidance = sensorRes.ok && sensorRes.data ? sensorRes.data.guidance || null : null;
    const observer = sensorRes.ok && sensorRes.data ? sensorRes.data.observer || null : null;
    const jobState = (jobs.ok && jobs.data) || null;
    const chain = (audit.ok && audit.data) || null;

    const healthLabel = guidance
      ? { ok: T('mon.health.ok'), warning: T('mon.health.warning'), critical: T('mon.health.critical'), unknown: T('mon.health.unknown') }[guidance.status] || guidance.status
      : '—';
    const healthHint = guidance && guidance.recommended
      ? guidance.recommended.reason || guidance.recommended.action
      : guidance
        ? T('mon.health.noCheck')
        : T('mon.health.noSensors');

    cards.innerHTML = [
      card(T('mon.card.state'), healthLabel, healthHint),
      card(T('mon.card.portals'), list.length ? String(list.length) : '0', publicPortals ? T('mon.card.publicCount', { n: publicPortals }) : T('mon.card.noPublic')),
      card(T('mon.card.files'), String(files), T('mon.card.filesNote')),
      card(T('mon.card.jobs'), jobState ? T('mon.card.active', { n: jobState.running || 0 }) : '—', jobState ? T('mon.card.queued', { n: jobState.queued || 0 }) : T('mon.card.noData')),
      card(T('mon.card.requests'), observer ? String(observer.http ? observer.http.total : 0) : '—', observer ? T('mon.card.sinceStart') : T('mon.card.noData')),
      card(T('mon.card.chain'), chain ? (chain.valid ? T('mon.card.chainValid') : T('mon.card.chainBroken')) : '—', chain ? T('mon.card.records', { n: chain.records || 0 }) : T('mon.card.noData')),
      card(T('mon.card.version'), String(window.HAPI_VERSION || '—'), 'hAPI Enterprise'),
    ].join('');

    const problems = [];
    if (!sensorRes.ok) problems.push(T('mon.health.noSensors'));
    if (!jobs.ok) problems.push(T('mon.problem.jobs'));
    if (!audit.ok) problems.push(T('mon.problem.audit'));
    if (chain && chain.valid === false) problems.push(T('mon.problem.chain'));
    if (guidance && guidance.recommended) problems.push(guidance.recommended.action || guidance.recommended.id);
    hint.textContent = problems.length ? T('mon.problem.prefix') + problems.join(' · ') : '';

    // ── Ресурси и структура ──────────────────────────────────────────────────
    const diag = diagnostics.ok && diagnostics.data ? diagnostics.data : null;
    if (!diag) {
      resBox.innerHTML = `<p class="hint">${esc(T('mon.res.noToken'))}</p>`;
    } else {
      const mb = (bytes) => (Number(bytes) / 1048576).toFixed(1) + ' MB';
      const storage = Array.isArray(diag.storage) ? diag.storage : [];
      const okRoots = storage.filter((s) => s.available && s.writable).length;
      const badRoots = storage.filter((s) => !s.available || !s.writable).map((s) => s.name + (s.error ? ' (' + s.error + ')' : ''));
      const traffic = diag.traffic || {};
      const load = traffic.load || {};
      const layout = diag.layout && Array.isArray(diag.layout.entries) ? diag.layout.entries : [];
      const layoutRows = layout
        .map(
          (e) =>
            `<tr><th>${esc(e.label)}</th><td><code>${esc(e.path)}</code>${
              e.checked
                ? e.exists
                  ? ` <span class="state-chip ok">${esc(T('mon.res.exists'))}</span>`
                  : ` <span class="state-chip err">${esc(T('mon.res.missing'))}</span>`
                : ` <span class="hint">${esc(T('mon.res.perPortal'))}</span>`
            }<br/><small class="hint">${esc(e.note || '')}</small></td></tr>`,
        )
        .join('');
      const layoutRoutes = diag.layout && Array.isArray(diag.layout.routes) ? diag.layout.routes : [];
      resBox.innerHTML = `
        <div class="dash-grid">
          ${card('Heap', mb(diag.runtime ? diag.runtime.heapUsedBytes : 0), T('mon.res.heapOf', { total: mb(diag.runtime ? diag.runtime.heapTotalBytes : 0) }))}
          ${card(T('mon.res.rss'), mb(diag.runtime ? diag.runtime.rssBytes : 0), diag.runtime ? 'Node ' + diag.runtime.node : '')}
          ${card(T('mon.res.uptime'), T('mon.res.minutes', { n: Math.floor((diag.uptimeSeconds || 0) / 60) }), diag.generatedAt ? T('mon.res.at', { when: String(diag.generatedAt).replace('T', ' ').slice(0, 16) }) : '')}
          ${card(T('mon.res.downloads'), String(traffic.activeDownloadStreams || 0) + ' / ' + String(traffic.effectiveDownloadStreams || 0), T('mon.res.streamsNote'))}
          ${card(T('mon.res.storages'), okRoots + ' / ' + storage.length, badRoots.length ? T('mon.res.missingList', { list: badRoots.join(', ') }) : T('mon.res.allRoots'))}
          ${card(T('mon.res.load'), load.level != null ? String(load.level) : '—', load.effective != null ? T('mon.res.effective', { n: load.effective }) : T('mon.card.noData'))}
        </div>
        ${
          layoutRows
            ? `<details class="u-mt" data-acc><summary>${esc(T('mon.res.layout'))}</summary>
                  <table class="grid"><tbody>${layoutRows}</tbody></table>
                  ${layoutRoutes.length ? `<p class="hint">${esc(T('mon.res.routes'))} ${layoutRoutes.map((r) => `<code>${esc(r.url)}</code> — ${esc(r.serves)}`).join(' · ')}</p>` : ''}
                </details>`
            : ''
        }
        <div class="row-actions">
          <button type="button" class="btn" data-goto="storage">${esc(T('mon.nav.storage'))}</button>
          <button type="button" class="btn" data-goto="security">${esc(T('mon.nav.security'))}</button>
          <button type="button" class="btn" data-goto="backups">${esc(T('mon.nav.backups'))}</button>
        </div>`;
      for (const button of resBox.querySelectorAll('button[data-goto]')) {
        button.addEventListener('click', () => {
          if (window.HapiUI && typeof window.HapiUI.go === 'function') window.HapiUI.go(button.dataset.goto);
        });
      }
    }

    // ── Посетители: общо за инсталацията или за избрания портал ──────────────
    if (select) {
      select.innerHTML =
        `<option value="">${esc(T('mon.portal.all'))}</option>` +
        list.map((p) => `<option value="${esc(p.id)}">${esc(p.title || p.slug || p.id)}</option>`).join('');
      select.addEventListener('change', () => {
        focus = select.value;
        renderVisitors();
      });
    }
    const refresh = view.querySelector('#mon-refresh');
    if (refresh) {
      refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        try {
          const again = await api('/admin/api/sensors');
          if (again.ok && again.data) monitor = again.data.visitorsIntel || null;
          renderVisitors();
        } finally {
          refresh.disabled = false;
        }
      });
    }

    const top = (bag, n = 6) => Object.entries(bag || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
    const chips = (bag, empty) => {
      const items = top(bag);
      return items.length
        ? `<div class="fm-ico-row u-grid u-grid-chips">${items.map(([k, v]) => chip(k, String(v))).join('')}</div>`
        : `<p class="hint">${esc(empty)}</p>`;
    };

    function renderVisitors() {
      if (!visitBox) return;
      if (!monitor) {
        visitBox.innerHTML = `<p class="hint">${esc(T('mon.vis.noToken'))}</p>`;
        return;
      }
      const m = monitor;
      const total = `
        <div class="dash-grid">
          ${card(T('mon.vis.unique'), String(m.unique_visitors || 0), T('mon.vis.uniqueNote'))}
          ${card(T('mon.vis.visits'), String((m.totals && m.totals.visits) || 0), T('mon.vis.visitsNote'))}
          ${card(T('mon.vis.downloads'), String((m.totals && m.totals.downloads) || 0), T('mon.vis.downloaders', { n: m.download_visitors || 0 }))}
          ${card(T('mon.vis.denied'), String(m.denied_total || 0), T('mon.vis.deniedNote'))}
          ${card(T('mon.vis.countries'), String(m.countries_known || 0), m.country_top ? T('mon.vis.topCountry', { c: m.country_top }) : T('mon.vis.noGeo'))}
          ${card(T('mon.vis.logins'), String(m.admin_logins || 0), T('mon.vis.loginsNote'))}
        </div>
        <p class="hint">${esc(
          T('mon.vis.privacy', {
            mode: (m.privacy && m.privacy.ipMode) || 'hashed',
            days: (m.privacy && m.privacy.retentionDays) || 0,
            geo: m.privacy && m.privacy.geoFile && m.privacy.geoFile.loaded ? T('mon.vis.ranges', { n: m.privacy.geoFile.ranges }) : T('mon.none'),
          }),
        )}</p>`;

      const reasons = Object.entries((m.denied && m.denied.reasons) || {});
      const reasonLine = reasons.length
        ? `<p class="hint">${esc(T('mon.vis.reasons', { list: reasons.map(([k, v]) => k + ' — ' + String(v)).join(' · ') }))}</p>`
        : '';

      const focusPortal = focus ? portals.find((p) => p.id === focus) || null : null;
      const focusBlock = focusPortal
        ? (() => {
            const own = (m.portals || []).find((p) => p.id === focusPortal.id);
            const fileIds = new Set((focusPortal.files || []).map((f) => f.id));
            const ownFiles = (m.files || []).filter((f) => fileIds.has(f.id));
            if (!own) return `<p class="hint">${esc(T('mon.vis.emptyPortal'))}</p>`;
            return `
              <h4>${esc(T('mon.vis.thisPortal'))}</h4>
              <div class="dash-grid">
                ${card(T('mon.vis.visits'), String(own.visits || 0))}
                ${card(T('mon.vis.downloads'), String(own.downloads || 0))}
                ${card(T('mon.vis.deniedShort'), String(own.denied || 0))}
                ${card(T('mon.vis.visitors'), String(own.visitors || 0), T('mon.vis.uniquePortal'))}
              </div>
              <h4>${esc(T('mon.vis.geoPortal'))}</h4>
              ${chips(own.geo && own.geo.countries, T('mon.vis.noGeoData'))}
              <h4>${esc(T('mon.vis.clients'))}</h4>
              ${chips(own.browsers, T('mon.vis.noClient'))}
              ${chips(own.languages, T('mon.vis.noLang'))}
              <h4>${esc(T('mon.vis.filesPortal'))}</h4>
              <table class="table" id="mon-files">
                <thead><tr><th>${esc(T('mon.th.file'))}</th><th>${esc(T('mon.th.downloads'))}</th><th>${esc(T('mon.th.visitors'))}</th><th>${esc(T('mon.th.last'))}</th></tr></thead>
                <tbody>${
                  ownFiles.length
                    ? ownFiles
                        .map(
                          (f) =>
                            `<tr><td>${esc(f.name || f.id)}</td><td>${esc(String(f.downloads || 0))}</td><td>${esc(
                              String(f.visitors || 0),
                            )}</td><td>${esc(f.lastAt ? String(f.lastAt).slice(0, 16) : '—')}</td></tr>`,
                        )
                        .join('')
                    : `<tr><td colspan="4" class="hint">${esc(T('mon.vis.noFilesPortal'))}</td></tr>`
                }</tbody>
              </table>`;
          })()
        : `
            <h4>${esc(T('mon.vis.topPortals'))}</h4>
            <table class="table" id="mon-portals">
              <thead><tr><th>${esc(T('mon.th.portal'))}</th><th>${esc(T('mon.th.visits'))}</th><th>${esc(T('mon.th.downloads'))}</th><th>${esc(T('mon.th.denied'))}</th><th>${esc(T('mon.th.visitors'))}</th></tr></thead>
              <tbody>${
                (m.portals || []).length
                  ? (m.portals || [])
                      .slice(0, 20)
                      .map(
                        (p) =>
                          `<tr><td>${esc(p.title || p.slug || p.id)}</td><td>${esc(String(p.visits || 0))}</td><td>${esc(
                            String(p.downloads || 0),
                          )}</td><td>${esc(String(p.denied || 0))}</td><td>${esc(String(p.visitors || 0))}</td></tr>`,
                      )
                      .join('')
                  : `<tr><td colspan="5" class="hint">${esc(T('mon.vis.noVisitors'))}</td></tr>`
              }</tbody>
            </table>
            <h4>${esc(T('mon.vis.filesAll'))}</h4>
            <table class="table" id="mon-files">
              <thead><tr><th>${esc(T('mon.th.file'))}</th><th>${esc(T('mon.th.downloads'))}</th><th>${esc(T('mon.th.visitors'))}</th><th>${esc(T('mon.th.last'))}</th></tr></thead>
              <tbody>${
                (m.files || []).length
                  ? (m.files || [])
                      .slice(0, 20)
                      .map(
                        (f) =>
                          `<tr><td>${esc(f.name || f.id)}</td><td>${esc(String(f.downloads || 0))}</td><td>${esc(
                            String(f.visitors || 0),
                          )}</td><td>${esc(f.lastAt ? String(f.lastAt).slice(0, 16) : '—')}</td></tr>`,
                      )
                      .join('')
                  : `<tr><td colspan="4" class="hint">${esc(T('mon.vis.noFiles'))}</td></tr>`
              }</tbody>
            </table>`;

      visitBox.innerHTML =
        total +
        reasonLine +
        focusBlock +
        `<div class="row-actions">
          <button type="button" class="btn" data-nav="visitors">${esc(T('mon.vis.seeAll'))}</button>
        </div>`;
      const go = visitBox.querySelector('button[data-nav="visitors"]');
      if (go) {
        go.addEventListener('click', () => {
          if (window.HapiUI && typeof window.HapiUI.go === 'function') window.HapiUI.go('visitors');
        });
      }
    }
    renderVisitors();

    // ── Живи събития ─────────────────────────────────────────────────────────
    const liveBox = view.querySelector('#mon-live');
    if (!liveBox) return;
    const liveOn = await startLive((name, payload) => {
      liveList.unshift({
        event: name,
        at: payload && payload.at ? String(payload.at).replace('T', ' ').slice(0, 19) : new Date().toISOString().replace('T', ' ').slice(0, 19),
      });
      if (liveList.length > 10) liveList.length = 10;
      renderLive();
    });
    // `startLive` вика `stopLive`, който пуска референцията към DOM — затова тя се слага
    // СЛЕД отварянето, иначе първото събитие би рисувало в `null`.
    liveListEl = liveBox;
    if (!liveOn) liveBox.innerHTML = `<p class="hint">${esc(T('mon.live.closedHint'))}</p>`;
    else renderLive();

    // Аккордеонът се закача СЛЕД рисуването — иначе слушателите остават върху стария DOM.
    wireAccordion(view);
  }

  // Издава се и `wireAccordion`, за да може правилото „един отворен“ да се провери върху
  // произволен DOM: страницата има само ЕДИН сгъваем блок, тоест затварянето на съседните
  // не се изпълнява при нито едно истинско щракване. Без това издание правилото щеше да е
  // „вярно по код, непроверено по поведение“ (вж. `tests/gui-monitoring.cjs`).
  window.HapiMonitoringPanel = { mount, unmount: stopLive, wireAccordion };
})();
