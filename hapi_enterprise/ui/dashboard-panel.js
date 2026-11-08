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
        <div class="panel-head"><h2>Всички раздели</h2></div>
        <div class="panel-body">
          <div class="quick-grid" id="dash-quick"></div>
          <p class="hint" id="dash-quick-note">Същите раздели като в менюто — таблото е и вход към тях.</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Отчети</h2></div>
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
        quickNote.textContent = targets.length + ' раздела · същите като в менюто — таблото е и вход към тях.';
      }
    }

    const portals = await api('/admin/api/portals');
    if (portals.offline) {
      reportBox.innerHTML = '<p class="hint">Няма връзка с add-on-а. Свържи го от „Настройки“ (адрес и токен), за да видиш отчетите.</p>';
      return;
    }

    const list = portals.ok && portals.data ? (Array.isArray(portals.data) ? portals.data : portals.data.portals || []) : [];
    const files = list.reduce((sum, p) => sum + (Array.isArray(p.files) ? p.files.length : 0), 0);

    // ── Отчети: комбо и рекурсивен комбо — тук, на главното табло ────────────
    // Отчетът за един портал или за един файл стои там, където е самият обект
    // (опциите на файла; картата на портала). На таблото стоят само обхватите
    // „всичко“, защото тук се вижда цялата система.
    if (!list.length) {
      reportBox.innerHTML = '<p class="hint">Няма портали — комбо отчетът би бил празен. Създай портал от „Портали“.</p>';
      return;
    }
    reportBox.innerHTML = `
      <p class="hint">Отчетът се сглобява от данните на порталите и се отваря в „Отчети“ — там се
        проверява, подпечатва (RFC 3161) и сваля като PDF. Обхват: ${list.length}
        ${list.length === 1 ? 'портал' : 'портала'} · ${files} файла.</p>
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
        // Рекурсивният обхват включва и папките от хранилището на всеки портал. Чете се
        // последователно (`for … of` с `await`): `map` с `async` връща обещания, които
        // никой не чака, и грешка в средата остава необслужена (пази `logic-audit`).
        let trees = null;
        if (recursive) {
          trees = {};
          for (const p of list) {
            const res = await api('/admin/api/portals/' + encodeURIComponent(p.id) + '/tree');
            if (res.ok && res.data) trees[p.id] = res.data;
          }
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
      button.addEventListener('click', () => {
        void runReport(button.dataset.report === 'combo-recursive', button);
      });
    }
  }

  function mountAbout(view) {
    view.innerHTML = `
      <div class="page-title"><h1>Относно</h1></div>
      <section class="panel">
        <div class="panel-head"><h2>hAPI Enterprise</h2></div>
        <div class="panel-body">
          <dl class="fm-meta">
            <dt>Продукт</dt><dd>hAPI Enterprise — портали с проверима цялост на документите</dd>
            <dt>Версия</dt><dd><code>${esc(String(window.HAPI_VERSION || '—'))}</code></dd>
            <dt>Лиценз</dt><dd>Apache-2.0</dd>
            <dt>Документация</dt><dd><code>docs/</code> · <code>documentation/</code></dd>
            <dt>Единен план</dt><dd><code>docs/plan/15-unified-master-plan-v6.0.md</code></dd>
            <dt>Архитектурни решения</dt><dd><code>documentation/03_ADR/</code></dd>
          </dl>
          <p class="hint">Всички стойности в панелите идват от административния API на add-on-а —
            интерфейсът не показва измислени числа.</p>
        </div>
      </section>`;
  }

  window.HapiDashboardPanel = { mount, mountAbout, unmount: () => undefined };
})();
