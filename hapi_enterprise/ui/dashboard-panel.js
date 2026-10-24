'use strict';
// Табло и „Относно“ — с РЕАЛНИ данни от add-on-а.
//
// Преди тук имаше обект с измислени бройки за документи и свободно място, който се
// показваше като състояние на системата. Сега всяка стойност идва от административния API,
// а при липса на връзка панелът казва точно това — без числа.
(function () {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Адресът идва само от api-base.js (той пази `hapi.apiBase` и Ingress префикса).
  const base = () => (typeof window.hapiApiBase === 'function' ? window.hapiApiBase() : '').replace(/\/$/, '');
  const token = () => sessionStorage.getItem('hapiAdminToken') || '';

  /** Единственото място, което говори с add-on-а от този панел. */
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

  async function mount(view) {
    view.innerHTML = `
      <div class="page-title">
        <h1>Dashboard</h1>
        <span class="badge demo" id="dash-badge">зареждане…</span>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>Състояние на add-on-а</h2></div>
        <div class="panel-body">
          <div class="dash-grid" id="dash-cards"></div>
          <p class="hint" id="dash-hint"></p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Всички раздели</h2><span class="badge" id="dash-quick-count">—</span></div>
        <div class="panel-body">
          <div class="quick-grid" id="dash-quick"></div>
          <p class="hint">Същите раздели като в менюто — таблото е и вход към тях. Броят идва от навигацията, не от отделен списък.</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Ресурси и хранилище</h2><span class="badge" id="dash-res-badge">—</span></div>
        <div class="panel-body" id="dash-res"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Кой влиза</h2></div>
        <div class="panel-body" id="dash-visitors"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Отчети</h2><span class="badge" id="dash-report-state">—</span></div>
        <div class="panel-body" id="dash-reports"></div>
      </section>`;

    const cards = view.querySelector('#dash-cards');
    const badge = view.querySelector('#dash-badge');
    const hint = view.querySelector('#dash-hint');
    const visitBox = view.querySelector('#dash-visitors');
    const reportBox = view.querySelector('#dash-reports');
    const reportState = view.querySelector('#dash-report-state');
    const quickBox = view.querySelector('#dash-quick');
    const quickCount = view.querySelector('#dash-quick-count');
    const resBox = view.querySelector('#dash-res');
    const resBadge = view.querySelector('#dash-res-badge');

    // ── Всички раздели: един бутон за всяка точка от менюто ──────────────────
    // Списъкът НЕ се дублира тук: идва от NAV в app.js през `HapiUI.nav()`. Така нова
    // секция в менюто се появява на таблото без втори списък, който да изостане.
    const nav = (window.HapiUI && typeof window.HapiUI.nav === 'function') ? window.HapiUI.nav() : [];
    const targets = nav.filter((item) => item.id !== 'dashboard');
    if (quickBox) {
      quickBox.innerHTML = targets
        .map((item) => `<button type="button" class="btn" data-goto="${esc(item.id)}">${esc(window.HapiUI.t(item.id))}</button>`)
        .join('');
      for (const button of quickBox.querySelectorAll('button[data-goto]')) {
        button.addEventListener('click', () => {
          if (window.HapiUI && typeof window.HapiUI.go === 'function') window.HapiUI.go(button.dataset.goto);
        });
      }
      if (quickCount) {
        quickCount.className = 'badge';
        quickCount.textContent = targets.length + ' раздела';
      }
    }

    const [portals, sensors, jobs, audit, diagnostics] = await Promise.all([
      api('/admin/api/portals'),
      api('/admin/api/sensors'),
      api('/admin/api/jobs'),
      api('/admin/api/audit/verify'),
      api('/admin/api/diagnostics'),
    ]);

    if (portals.offline) {
      badge.textContent = 'няма връзка';
      hint.textContent = 'Свържи add-on-а от „Настройки“ (адрес и токен), за да видиш реалните числа.';
      cards.replaceChildren();
      if (reportBox) reportBox.innerHTML = '<p class="hint">Отчетите се сглобяват от данните на add-on-а — без връзка няма какво да влезе в тях.</p>';
      return;
    }

    const list = portals.ok && portals.data ? (Array.isArray(portals.data) ? portals.data : portals.data.portals || []) : [];
    const files = list.reduce((sum, p) => sum + (Array.isArray(p.files) ? p.files.length : 0), 0);
    const publicPortals = list.filter((p) => p.visibility === 'public').length;
    const observer = (sensors.ok && sensors.data && sensors.data.observer) || null;
    const jobState = (jobs.ok && jobs.data) || null;
    const chain = (audit.ok && audit.data) || null;

    badge.textContent = portals.ok ? 'свързан' : `HTTP ${portals.status}`;
    badge.className = 'badge ' + (portals.ok ? 'ok' : 'err');

    cards.innerHTML = [
      card('Портали', list.length ? String(list.length) : '0', publicPortals ? `${publicPortals} публични` : 'няма публични'),
      card('Файлове в порталите', String(files), 'общо във всички портали'),
      card('Задачи', jobState ? `${jobState.running || 0} активни` : '—', jobState ? `${jobState.queued || 0} в опашка` : 'няма данни'),
      card('Заявки', observer ? String(observer.http ? observer.http.total : 0) : '—', observer ? 'от старта на add-on-а' : 'няма данни'),
      card('Одитна верига', chain ? (chain.valid ? 'валидна' : 'нарушена') : '—', chain ? `${chain.records || 0} записа` : 'няма данни'),
      card('Версия', String(window.HAPI_VERSION || '—'), 'hAPI Enterprise'),
    ].join('');

    const problems = [];
    if (!sensors.ok) problems.push('сензорите не отговарят');
    if (!jobs.ok) problems.push('опашката не отговаря');
    if (!audit.ok) problems.push('одитната проверка не отговаря');
    if (chain && chain.valid === false) problems.push('одитната верига е нарушена');
    hint.textContent = problems.length ? 'Внимание: ' + problems.join(' · ') : '';

    // ── Ресурси и хранилище: какво още може да се поиска от add-on-а ─────────
    // Всичко идва от `/admin/api/diagnostics` — същият маршрут, който ползва
    // „Настройки → Диагностика“. Тук няма изчислени „на око“ стойности.
    if (resBox) {
      const diag = diagnostics.ok && diagnostics.data ? diagnostics.data : null;
      if (!diag) {
        resBadge.className = 'badge err';
        resBadge.textContent = diagnostics.offline ? 'няма връзка' : 'HTTP ' + diagnostics.status;
        resBox.innerHTML = '<p class="hint">Диагностиката не е достъпна с този токен — ресурсите се виждат в „Настройки → Диагностика“.</p>';
      } else {
        const mb = (bytes) => (Number(bytes) / 1048576).toFixed(1) + ' MB';
        const storage = Array.isArray(diag.storage) ? diag.storage : [];
        const okRoots = storage.filter((s) => s.available && s.writable).length;
        const badRoots = storage.filter((s) => !s.available || !s.writable).map((s) => s.name + (s.error ? ' (' + s.error + ')' : ''));
        const traffic = diag.traffic || {};
        const load = traffic.load || {};
        // Структурата на файловете идва от същия отговор (`layout`), за да не се гадае къде
        // е portal.html или папката на портала: всяко място е с път и състояние.
        const layout = diag.layout && Array.isArray(diag.layout.entries) ? diag.layout.entries : [];
        const layoutRows = layout
          .map(
            (e) =>
              `<tr><th>${esc(e.label)}</th><td><code>${esc(e.path)}</code>${e.checked ? (e.exists ? ' <span class="state-chip ok">има</span>' : ' <span class="state-chip err">липсва</span>') : ' <span class="hint">за всеки портал</span>'
              }<br/><small class="hint">${esc(e.note || '')}</small></td></tr>`,
          )
          .join('');
        const layoutRoutes = diag.layout && Array.isArray(diag.layout.routes) ? diag.layout.routes : [];
        resBadge.className = 'badge ' + (badRoots.length ? 'err' : 'ok');
        resBadge.textContent = badRoots.length ? 'хранилище: проблем' : 'хранилище: готово';
        resBox.innerHTML = `
          <div class="dash-grid">
            ${card('Heap', mb(diag.runtime ? diag.runtime.heapUsedBytes : 0), 'от ' + mb(diag.runtime ? diag.runtime.heapTotalBytes : 0))}
            ${card('Памет (RSS)', mb(diag.runtime ? diag.runtime.rssBytes : 0), diag.runtime ? 'Node ' + diag.runtime.node : '')}
            ${card('Работи от', Math.floor((diag.uptimeSeconds || 0) / 60) + ' мин', diag.generatedAt ? 'към ' + String(diag.generatedAt).replace('T', ' ').slice(0, 16) : '')}
            ${card('Изтегляния', String(traffic.activeDownloadStreams || 0) + ' / ' + String(traffic.effectiveDownloadStreams || 0), 'активни / ефективен лимит')}
            ${card('Хранилища', okRoots + ' / ' + storage.length, badRoots.length ? 'липсва: ' + badRoots.join(', ') : 'всички достъпни и записваеми')}
            ${card('Натоварване', load.level != null ? String(load.level) : '—', load.effective != null ? 'ефективен паралелизъм ' + load.effective : 'без данни')}
          </div>
          ${layoutRows
            ? `<details class="u-mt"><summary>Къде какво стои (структура на файловете)</summary>
                  <table class="grid"><tbody>${layoutRows}</tbody></table>
                  ${layoutRoutes.length
              ? `<p class="hint">Адреси: ${layoutRoutes.map((r) => `<code>${esc(r.url)}</code> — ${esc(r.serves)}`).join(' · ')}</p>`
              : ''
            }
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
    }

    // Комуникация: кратко резюме на сензорите с врата към панела „Кой влиза“.
    const intel = sensors.ok && sensors.data ? sensors.data.visitorsIntel : null;
    if (intel) {
      visitBox.innerHTML = `
        <div class="dash-grid">
          ${card('Уникални посетители', String(intel.unique_visitors || 0), 'по хеш от IP + клиент')}
          ${card('Отказани достъпи', String(intel.denied_total || 0), 'провери причините в панела')}
          ${card('Държава (топ)', intel.country_top || '—', intel.countries_known ? intel.countries_known + ' държави' : 'няма офлайн база')}
          ${card('Админ. влизания', String(intel.admin_logins || 0), 'успешни')}
        </div>
        <div class="row-actions">
          <button type="button" class="btn" data-nav="visitors">Виж всички</button>
        </div>`;
      const go = visitBox.querySelector('button[data-nav="visitors"]');
      if (go) go.addEventListener('click', () => {
        if (window.HapiUI && typeof window.HapiUI.go === 'function') window.HapiUI.go('visitors');
      });
    } else {
      visitBox.innerHTML = '<p class="hint">Сензорите за посетители не са достъпни с този токен.</p>';
    }

    // ── Отчети: комбо и рекурсивен комбо — тук, на главното табло ────────────
    // Отчетът за един портал или за един файл стои там, където е самият обект
    // (опциите на файла; картата на портала). На таблото стоят само обхватите
    // „всичко“, защото тук се вижда цялата система.
    if (reportBox) {
      if (!list.length) {
        reportBox.innerHTML = '<p class="hint">Няма портали — комбо отчетът би бил празен. Създай портал от „Портали“.</p>';
        if (reportState) reportState.textContent = 'няма данни';
      } else {
        if (reportState) {
          reportState.className = 'badge ok';
          reportState.textContent = list.length + (list.length === 1 ? ' портал' : ' портала') + ' · ' + files + ' файла';
        }
        reportBox.innerHTML = `
          <p class="hint">Отчетът се сглобява от данните на порталите и се отваря в „Отчети“ — там се
            проверява, подпечатва (RFC 3161) и сваля като PDF.</p>
          <div class="row-actions">
            <button type="button" class="btn btn-primary" data-report="combo">Комбо отчет (всички портали)</button>
            <button type="button" class="btn" data-report="combo-recursive">Рекурсивен комбо отчет (с папките)</button>
          </div>
          <p class="hint" id="dash-report-note"></p>`;
        const note = reportBox.querySelector('#dash-report-note');
        const buttons = [...reportBox.querySelectorAll('button[data-report]')];
        const toast = (message, kind) => {
          if (window.HapiUI && typeof window.HapiUI.toast === 'function') window.HapiUI.toast(message, kind);
        };
        const runReport = async (recursive, button) => {
          const S = window.HapiReportScope;
          if (!S) return toast('Модулът за отчети (report-scope.js) не е зареден', 'err');
          const restore = button.textContent;
          button.disabled = true;
          button.textContent = 'Сглобявам отчета…';
          try {
            // Рекурсивният обхват включва и папките от хранилището на всеки портал.
            let trees = null;
            if (recursive) {
              trees = {};
              await Promise.all(list.map(async (p) => {
                const res = await api('/admin/api/portals/' + encodeURIComponent(p.id) + '/tree');
                if (res.ok && res.data) trees[p.id] = res.data;
              }));
            }
            const result = S.buildCombo({ portals: list, trees, recursive });
            S.open(result);
            if (note) note.textContent = result.label + ' · ' + (result.summary.files || 0) + ' файла';
          } catch (e) {
            toast('Отчетът не може да се сглоби: ' + (e && e.message ? e.message : e), 'err');
          } finally {
            button.disabled = false;
            button.textContent = restore;
          }
        };
        for (const button of buttons) {
          button.addEventListener('click', () => { void runReport(button.dataset.report === 'combo-recursive', button) });
        }
      }
    }
  }

  function mountAbout(view) {
    view.innerHTML = `
      <div class="page-title"><h1>Относно</h1></div>
      <section class="panel">
        <div class="panel-head"><h2>hAPI Enterprise</h2><span class="badge">${esc(String(window.HAPI_VERSION || ''))}</span></div>
        <div class="panel-body">
          <dl class="fm-meta">
            <dt>Продукт</dt><dd>hAPI Enterprise — портали с проверима цялост на документите</dd>
            <dt>Версия</dt><dd><code>${esc(String(window.HAPI_VERSION || '—'))}</code></dd>
            <dt>Лиценз</dt><dd>Apache-2.0</dd>
            <dt>Документация</dt><dd><code>docs/</code> · <code>documentation/</code></dd>
            <dt>Единен план</dt><dd><code>docs/plan/15-unified-master-plan-v6.0.md</code></dd>
            <dt>Архитектурни решения</dt><dd><code>documentation/03_ADR/</code></dd>
          </dl>
          <p class="hint">Всички стойности в таблото идват от административния API на add-on-а —
            интерфейсът не показва измислени числа.</p>
        </div>
      </section>`;
  }

  window.HapiDashboardPanel = { mount, mountAbout };
})();
