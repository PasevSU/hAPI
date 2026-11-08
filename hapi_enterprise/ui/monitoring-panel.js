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
  const liveList = [];
  const renderLive = () => {
    if (!liveListEl) return;
    liveListEl.innerHTML = liveList.length
      ? liveList.map((item) => `<div class="fm-row"><span class="badge">${esc(item.event)}</span> <small class="hint">${esc(item.at)}</small></div>`).join('')
      : '<p class="hint">Още нищо не е станало от отварянето на панела.</p>';
  };
  function stopLive() {
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
    if (!url || !adminToken || typeof window.EventSource !== 'function') return false;
    try {
      liveSource = new window.EventSource(url + '/admin/api/events/stream?token=' + encodeURIComponent(adminToken));
    } catch {
      liveSource = null;
      return false;
    }
    const forward = (name) =>
      liveSource.addEventListener(name, (e) => {
        let payload;
        try {
          payload = JSON.parse(e.data);
        } catch {
          payload = { event: name };
        }
        onEvent(name, payload);
      });
    for (const name of ['document.finalized', 'job.completed', 'access.created', 'report.packaged', 'resync']) forward(name);
    liveSource.addEventListener('bye', () => {
      try {
        liveSource.close();
      } catch {
        /* вече е затворен */
      }
      liveSource = null;
    });
    return true;
  }

  async function mount(view) {
    view.innerHTML = `
      <div class="page-title">
        <h1>Мониторинг</h1>
        <p class="hint">Едно място за всичко, което add-on-ът мери: състояние, ресурси, хранилища,
          посетители и живи събития. Другите страници не рисуват мониторинг.</p>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>Състояние</h2></div>
        <div class="panel-body">
          <div class="dash-grid" id="mon-cards"></div>
          <p class="hint" id="mon-hint"></p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Ресурси и хранилище</h2></div>
        <div class="panel-body" id="mon-res"></div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>Посетители</h2>
          <div class="u-row u-row-2">
            <select id="mon-portal" title="За кой портал да се покажат числата">
              <option value="">всички портали</option>
            </select>
            <button type="button" class="btn btn-sm" id="mon-refresh">Обнови</button>
          </div>
        </div>
        <div class="panel-body" id="mon-visitors"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Живи събития</h2></div>
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
      hint.textContent = 'Няма връзка с add-on-а. Свържи го от „Настройки“ (адрес и токен), за да видиш реалните числа.';
      cards.replaceChildren();
      resBox.innerHTML = '<p class="hint">Диагностиката също иска връзка.</p>';
      visitBox.innerHTML = '<p class="hint">Сензорите също искат връзка.</p>';
      view.querySelector('#mon-live').innerHTML = '<p class="hint">Потокът не е отворен.</p>';
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
      ? { ok: 'здраво', warning: 'внимание', critical: 'критично', unknown: 'още не е измерено' }[guidance.status] || guidance.status
      : '—';
    const healthHint = guidance && guidance.recommended
      ? guidance.recommended.reason || guidance.recommended.action
      : guidance
        ? 'няма препоръчана проверка'
        : 'сензорите не отговарят';

    cards.innerHTML = [
      card('Състояние', healthLabel, healthHint),
      card('Портали', list.length ? String(list.length) : '0', publicPortals ? `${publicPortals} публични` : 'няма публични'),
      card('Файлове в порталите', String(files), 'общо във всички портали'),
      card('Задачи', jobState ? `${jobState.running || 0} активни` : '—', jobState ? `${jobState.queued || 0} в опашка` : 'няма данни'),
      card('Заявки', observer ? String(observer.http ? observer.http.total : 0) : '—', observer ? 'от старта на add-on-а' : 'няма данни'),
      card('Одитна верига', chain ? (chain.valid ? 'валидна' : 'нарушена') : '—', chain ? `${chain.records || 0} записа` : 'няма данни'),
      card('Версия', String(window.HAPI_VERSION || '—'), 'hAPI Enterprise'),
    ].join('');

    const problems = [];
    if (!sensorRes.ok) problems.push('сензорите не отговарят');
    if (!jobs.ok) problems.push('опашката не отговаря');
    if (!audit.ok) problems.push('одитната проверка не отговаря');
    if (chain && chain.valid === false) problems.push('одитната верига е нарушена');
    if (guidance && guidance.recommended) problems.push(guidance.recommended.action || guidance.recommended.id);
    hint.textContent = problems.length ? 'Внимание: ' + problems.join(' · ') : '';

    // ── Ресурси и структура ──────────────────────────────────────────────────
    const diag = diagnostics.ok && diagnostics.data ? diagnostics.data : null;
    if (!diag) {
      resBox.innerHTML = '<p class="hint">Диагностиката не е достъпна с този токен — ресурсите се виждат в „Настройки → Диагностика“.</p>';
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
                  ? ' <span class="state-chip ok">има</span>'
                  : ' <span class="state-chip err">липсва</span>'
                : ' <span class="hint">за всеки портал</span>'
            }<br/><small class="hint">${esc(e.note || '')}</small></td></tr>`,
        )
        .join('');
      const layoutRoutes = diag.layout && Array.isArray(diag.layout.routes) ? diag.layout.routes : [];
      resBox.innerHTML = `
        <div class="dash-grid">
          ${card('Heap', mb(diag.runtime ? diag.runtime.heapUsedBytes : 0), 'от ' + mb(diag.runtime ? diag.runtime.heapTotalBytes : 0))}
          ${card('Памет (RSS)', mb(diag.runtime ? diag.runtime.rssBytes : 0), diag.runtime ? 'Node ' + diag.runtime.node : '')}
          ${card('Работи от', Math.floor((diag.uptimeSeconds || 0) / 60) + ' мин', diag.generatedAt ? 'към ' + String(diag.generatedAt).replace('T', ' ').slice(0, 16) : '')}
          ${card('Изтегляния', String(traffic.activeDownloadStreams || 0) + ' / ' + String(traffic.effectiveDownloadStreams || 0), 'активни / ефективен лимит')}
          ${card('Хранилища', okRoots + ' / ' + storage.length, badRoots.length ? 'липсва: ' + badRoots.join(', ') : 'всички достъпни и записваеми')}
          ${card('Натоварване', load.level != null ? String(load.level) : '—', load.effective != null ? 'ефективен паралелизъм ' + load.effective : 'без данни')}
        </div>
        ${
          layoutRows
            ? `<details class="u-mt" data-acc><summary>Къде какво стои (структура на файловете)</summary>
                  <table class="grid"><tbody>${layoutRows}</tbody></table>
                  ${layoutRoutes.length ? `<p class="hint">Адреси: ${layoutRoutes.map((r) => `<code>${esc(r.url)}</code> — ${esc(r.serves)}`).join(' · ')}</p>` : ''}
                </details>`
            : ''
        }
        <div class="row-actions">
          <button type="button" class="btn" data-goto="storage">Хранилища</button>
          <button type="button" class="btn" data-goto="security">Сигурност</button>
          <button type="button" class="btn" data-goto="backups">Резервни копия</button>
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
        '<option value="">всички портали</option>' +
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
        visitBox.innerHTML = '<p class="hint">Сензорите за посетители не са достъпни с този токен.</p>';
        return;
      }
      const m = monitor;
      const total = `
        <div class="dash-grid">
          ${card('Уникални посетители', String(m.unique_visitors || 0), 'по хеш от IP + клиент')}
          ${card('Посещения', String((m.totals && m.totals.visits) || 0), 'отваряния на портали')}
          ${card('Изтегляния', String((m.totals && m.totals.downloads) || 0), (m.download_visitors || 0) + ' души са теглили')}
          ${card('Отказани достъпи', String(m.denied_total || 0), 'виж причините долу')}
          ${card('Държави', String(m.countries_known || 0), m.country_top ? 'най-много: ' + m.country_top : 'няма офлайн база')}
          ${card('Админ. влизания', String(m.admin_logins || 0), 'успешни')}
        </div>
        <p class="hint">Режим на IP: ${esc((m.privacy && m.privacy.ipMode) || 'hashed')} · срок на пазене: ${esc(
          (m.privacy && m.privacy.retentionDays) || 0,
        )} дни · външни заявки: не · офлайн база: ${
          m.privacy && m.privacy.geoFile && m.privacy.geoFile.loaded ? esc(m.privacy.geoFile.ranges + ' диапазона') : 'няма'
        }</p>`;

      const reasons = Object.entries((m.denied && m.denied.reasons) || {});
      const reasonLine = reasons.length
        ? `<p class="hint">Откази по причина: ${reasons.map(([k, v]) => esc(k) + ' — ' + esc(String(v))).join(' · ')}</p>`
        : '';

      const focusPortal = focus ? portals.find((p) => p.id === focus) || null : null;
      const focusBlock = focusPortal
        ? (() => {
            const own = (m.portals || []).find((p) => p.id === focusPortal.id);
            const fileIds = new Set((focusPortal.files || []).map((f) => f.id));
            const ownFiles = (m.files || []).filter((f) => fileIds.has(f.id));
            if (!own) return '<p class="hint">За този портал още няма наблюдение — никой не го е отварял.</p>';
            return `
              <h4>Този портал</h4>
              <div class="dash-grid">
                ${card('Посещения', String(own.visits || 0))}
                ${card('Изтегляния', String(own.downloads || 0))}
                ${card('Откази', String(own.denied || 0))}
                ${card('Посетители', String(own.visitors || 0), 'уникални за портала')}
              </div>
              <h4>Откъде идват (този портал)</h4>
              ${chips(own.geo && own.geo.countries, 'Няма локация — или няма офлайн база, или още няма посетители.')}
              <h4>Клиенти и езици (този портал)</h4>
              ${chips(own.browsers, 'Няма данни за клиента.')}
              ${chips(own.languages, 'Няма данни за езика.')}
              <h4>Файлове на този портал</h4>
              <table class="table" id="mon-files">
                <thead><tr><th>Файл</th><th>Изтегляния</th><th>Посетители</th><th>Последно</th></tr></thead>
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
                    : '<tr><td colspan="4" class="hint">Няма изтегляния на файлове от този портал.</td></tr>'
                }</tbody>
              </table>`;
          })()
        : `
            <h4>Най-активни портали</h4>
            <table class="table" id="mon-portals">
              <thead><tr><th>Портал</th><th>Посещения</th><th>Изтегляния</th><th>Откази</th><th>Посетители</th></tr></thead>
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
                  : '<tr><td colspan="5" class="hint">Още няма посетители.</td></tr>'
              }</tbody>
            </table>
            <h4>Какво се тегли (всички портали)</h4>
            <table class="table" id="mon-files">
              <thead><tr><th>Файл</th><th>Изтегляния</th><th>Посетители</th><th>Последно</th></tr></thead>
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
                  : '<tr><td colspan="4" class="hint">Няма изтегляния.</td></tr>'
              }</tbody>
            </table>`;

      visitBox.innerHTML =
        total +
        reasonLine +
        focusBlock +
        `<div class="row-actions">
          <button type="button" class="btn" data-nav="visitors">Виж всички</button>
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
    const liveOn = startLive((name, payload) => {
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
    if (!liveOn) liveBox.innerHTML = '<p class="hint">Потокът не е отворен: нужен е токен в сесията и HTTPS/Ingress.</p>';
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
