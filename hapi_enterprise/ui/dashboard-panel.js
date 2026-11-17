'use strict';
// ТАБЛОТО (и „Относно“) — вход към разделите, без мониторинг.
//
// Защо е толкова малко (0.69.205): дотук таблото носеше седем карти със състояние, панел
// „Ресурси и хранилище“, „Кой влиза“, „Живи събития“ и отчетите — тоест беше натоварена
// страница, на която човек трябваше да търси къде да цъкне. Мониторингът се премести на
// едно място (`monitoring-panel.js`), а тук остават ДВЕ неща: списъкът с раздели (същият
// като в менюто) и отчетите по всички портали — защото това е вход към работа, не мониторинг.
//
// Правила, които модулът пази:
//   • без измислени числа и без декоративни табелки „свързан“: липсата на връзка се казва
//     с изречение;
//   • списъкът с раздели НЕ се дублира — идва от NAV през `HapiUI.nav()`;
//   • бутоните са равни по ширина (`.quick-grid`, `.row-actions` в components.css), за да не
//     изглежда редът като стълбичка.
(function () {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Целият текст минава през речника (BG/EN/DE); липсващ ключ се вижда като ключа, не като български.
  const T = (key, vars) =>
    typeof window !== 'undefined' && window.HapiI18n ? window.HapiI18n.t(key, vars) : String(key);
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

  async function mount(view) {
    view.innerHTML = `
      <div class="page-title">
        <h1>Dashboard</h1>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>${esc(T('dsh.all'))}</h2></div>
        <div class="panel-body">
          <div class="quick-grid" id="dash-quick"></div>
          <p class="hint" id="dash-quick-note">${esc(T('dsh.all.note'))}</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>${esc(T('dsh.reports'))}</h2></div>
        <div class="panel-body" id="dash-reports"></div>
      </section>`;

    const quickBox = view.querySelector('#dash-quick');
    const quickNote = view.querySelector('#dash-quick-note');
    const reportBox = view.querySelector('#dash-reports');

    // ── Всички раздели: един бутон за всяка точка от менюто ──────────────────
    // Списъкът НЕ се дублира тук: идва от NAV в app.js през `HapiUI.nav()`. Така нова
    // секция в менюто се появява на таблото без втори списък, който да изостане.
    const nav = window.HapiUI && typeof window.HapiUI.nav === 'function' ? window.HapiUI.nav() : [];
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
      // Броят е ИЗРЕЧЕНИЕ, не табелка: табелката „16 РАЗДЕЛА“ дублираше съдържанието и
      // изглеждаше като статус, който не носи информация.
      if (quickNote) {
        quickNote.textContent = T('dsh.all.count', { n: targets.length });
      }
    }

    const portals = await api('/admin/api/portals');
    if (portals.offline) {
      reportBox.innerHTML = `<p class="hint">${esc(T('dsh.offline'))}</p>`;
      return;
    }

    // ── Отчети: последните издадени линкове ─────────────────────────────────
    // Студиото (сглобяване на отчет на ръка) е премахнато в 0.69.242 — отчетът вече се
    // прави с ЕДНО натискане от мястото на обекта (портал · папка · файл · избрани).
    // Затова таблото не строи отчет, а показва издадените линкове: това е адресът, който
    // се изпраща на проверяващ, и той трябва да е видим, без да се рови в диска.
    // `GET …/reports/links` връща и последните, и старите — тук се взимат първите пет.
    const links = await api('/admin/api/v2/reports/links');
    const issued = links.ok && links.data && Array.isArray(links.data.links) ? links.data.links.slice(0, 5) : [];
    reportBox.innerHTML = `
      <p class="hint">${esc(T('dsh.report.hint'))}</p>
      ${issued.length
        ? `<ul class="dash-report-links">${issued
          .map((link) => `<li><a href="${esc(link.url)}" target="_blank" rel="noreferrer">${esc(link.name || link.url)}</a>
            <span class="hint">${esc([link.type, link.path || '', String(link.files || 0) + ' ' + T('rp.files')].filter(Boolean).join(' · '))}</span></li>`)
          .join('')}</ul>`
        : `<p class="hint">${esc(T('dsh.report.empty'))}</p>`}
      <p class="hint">${esc(T('dsh.report.list'))}</p>`;
  }

  function mountAbout(view) {
    view.innerHTML = `
      <div class="page-title"><h1>${esc(T('dsh.about.title'))}</h1></div>
      <section class="panel">
        <div class="panel-head"><h2>hAPI Enterprise</h2></div>
        <div class="panel-body">
          <dl class="fm-meta">
            <dt>${esc(T('dsh.about.product'))}</dt><dd>${esc(T('dsh.about.productValue'))}</dd>
            <dt>${esc(T('dsh.about.version'))}</dt><dd><code>${esc(String(window.HAPI_VERSION || '—'))}</code></dd>
            <dt>${esc(T('dsh.about.license'))}</dt><dd>Apache-2.0</dd>
            <dt>${esc(T('dsh.about.docs'))}</dt><dd><code>docs/</code> · <code>documentation/</code></dd>
            <dt>${esc(T('dsh.about.plan'))}</dt><dd><code>docs/plan/15-unified-master-plan-v6.0.md</code></dd>
            <dt>${esc(T('dsh.about.adr'))}</dt><dd><code>documentation/03_ADR/</code></dd>
          </dl>
          <p class="hint">${esc(T('dsh.about.hint'))}</p>
        </div>
      </section>`;
  }

  window.HapiDashboardPanel = { mount, mountAbout, unmount: () => undefined };
})();
