'use strict';
// Табло и „Относно“ — с РЕАЛНИ данни от add-on-а.
//
// Преди тук имаше обект с измислени бройки за документи и свободно място, който се
// показваше като състояние на системата. Сега всяка стойност идва от административния API,
// а при липса на връзка панелът казва точно това — без числа.
(function () {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const base = () => (localStorage.getItem('hapi.apiBase') || (location.protocol === 'file:' ? '' : location.origin)).replace(/\/$/, '');
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
        <div class="panel-head"><h2>Кой влиза</h2></div>
        <div class="panel-body" id="dash-visitors"></div>
      </section>`;

    const cards = view.querySelector('#dash-cards');
    const badge = view.querySelector('#dash-badge');
    const hint = view.querySelector('#dash-hint');
    const visitBox = view.querySelector('#dash-visitors');

    const [portals, sensors, jobs, audit] = await Promise.all([
      api('/admin/api/portals'),
      api('/admin/api/sensors'),
      api('/admin/api/jobs'),
      api('/admin/api/audit/verify'),
    ]);

    if (portals.offline) {
      badge.textContent = 'няма връзка';
      hint.textContent = 'Свържи add-on-а от „Настройки“ (адрес и токен), за да видиш реалните числа.';
      cards.replaceChildren();
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
