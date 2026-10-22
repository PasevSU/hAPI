'use strict';
// Enterprise Control Center — обвивка на GUI (Фаза 10 / UI-01).
// Панелите работят с реалните административни API-та на add-on-а; таблото и „Относно“
// се рисуват от dashboard-panel.js с данни от API-то (без измислени числа).
(function () {
  const I18N = {
    bg: {
      app: 'Enterprise Control Center',
      projects: 'Проект',
      dashboard: 'Dashboard',
      portals: 'Портали & файлове',
      contacts: 'Контакти',
      cases: 'Дела',
      files: 'Файлове',
      gateway: 'Публичен gateway',
      export: 'Експорт и изтегляне',
      users: 'Потребители & RBAC',
      jobs: 'Задачи',
      storage: 'Хранилища',
      analytics: 'Анализи',
      visitors: 'Кой влиза',
      security: 'Сигурност',
      backups: 'Резервни копия',
      qr: 'QR архиви',
      report: 'Report Studio',
      settings: 'Настройки',
      about: 'Относно',
      ready: 'Готов',
      metric: 'Показател',
      value: 'Стойност',
      module: 'Модул',
      state: 'Състояние',
      noBackend: 'няма връзка с add-on-а',
      barConnected: 'свързан · токен в сесията',
      barNoToken: 'свързан · без токен (само четене)',
    },
    en: {
      app: 'Enterprise Control Center',
      projects: 'Project',
      dashboard: 'Dashboard',
      portals: 'Portals & files',
      contacts: 'Contacts',
      cases: 'Cases',
      files: 'Files',
      gateway: 'Public gateway',
      export: 'Export & download',
      users: 'Users & RBAC',
      jobs: 'Jobs',
      storage: 'Storage',
      analytics: 'Analytics',
      visitors: 'Who visits',
      security: 'Security',
      backups: 'Backups',
      qr: 'QR archive',
      report: 'Report Studio',
      settings: 'Settings',
      about: 'About',
      ready: 'Ready',
      metric: 'Metric',
      value: 'Value',
      module: 'Module',
      state: 'State',
      noBackend: 'no connection to the add-on',
      barConnected: 'connected · token in session',
      barNoToken: 'connected · no token (read-only)',
    },
    de: {
      app: 'Enterprise Control Center',
      projects: 'Projekt',
      dashboard: 'Dashboard',
      portals: 'Portale & Dateien',
      contacts: 'Kontakte',
      cases: 'Fälle',
      files: 'Dateien',
      gateway: 'Public Gateway',
      export: 'Export & Download',
      users: 'Benutzer & RBAC',
      jobs: 'Aufgaben',
      storage: 'Speicher',
      analytics: 'Analysen',
      visitors: 'Wer besucht',
      security: 'Sicherheit',
      backups: 'Sicherungen',
      qr: 'QR-Archiv',
      report: 'Report Studio',
      settings: 'Einstellungen',
      about: 'Über',
      ready: 'Bereit',
      metric: 'Kennzahl',
      value: 'Wert',
      module: 'Modul',
      state: 'Status',
      noBackend: 'keine Verbindung zum Add-on',
      barConnected: 'verbunden · Token in der Sitzung',
      barNoToken: 'verbunden · kein Token (nur Lesen)',
    },
  };

  // Иконите на навигацията са от общия SVG набор (ui/icons.js) — един стил навсякъде.
  //
  // Списъкът следва плана (§6.11 `UI-01`: Enterprise Control Center с 13 панела).
  // Панелите, чиито данни се четат и пишат през административните секции, водят
  // директно към своята секция в „Настройки“ — едно място за логиката, без копия.
  const NAV = [
    { id: 'dashboard', ico: 'dashboard' },
    { id: 'portals', ico: 'folder' },
    { id: 'contacts', ico: 'person' },
    { id: 'cases', ico: 'case' },
    { id: 'gateway', ico: 'share' },
    { id: 'export', ico: 'download' },
    { id: 'users', ico: 'person', section: 'users' },
    { id: 'jobs', ico: 'clock', section: 'jobs' },
    { id: 'storage', ico: 'drive', section: 'storage' },
    { id: 'analytics', ico: 'chart', section: 'analytics' },
    { id: 'visitors', ico: 'person' },
    { id: 'security', ico: 'shield', section: 'security' },
    { id: 'backups', ico: 'archive', section: 'backups' },
    { id: 'qr', ico: 'qr', section: 'qr' },
    { id: 'report', ico: 'note' },
    { id: 'settings', ico: 'gear', section: 'general' },
    { id: 'about', ico: 'info' },
  ];

  // Измислените „демо“ числа бяха премахнати: таблото и „Относно“ се рисуват от
  // dashboard-panel.js с реални данни от административния API.

  let lang = 'bg';
  let current = 'dashboard';

  const $ = (sel, root = document) => root.querySelector(sel);
  const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.bg[key] || key;
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Версията идва от едно място — `window.HAPI_VERSION` в data.js (виж коментара там).
  // Твърдо кодирани стойности в HTML-а/панелите се разминават при всяко издание.
  const version = () => String(window.HAPI_VERSION || '').trim();
  const versionLabel = () => (version() ? 'v' + version() : '');

  function toast(message, kind = '') {
    const existing = $('.toast');
    if (existing) existing.remove();
    const node = document.createElement('div');
    node.className = `toast ${kind}`.trim();
    node.setAttribute('role', 'status');
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 5200);
  }

  function renderNav() {
    const nav = $('#nav');
    nav.innerHTML = '';
    for (const item of NAV) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `nav-item${item.id === current ? ' active' : ''}`;
      button.dataset.panel = item.id;
      button.innerHTML = `<span class="ico" aria-hidden="true">${window.HapiIcons ? window.HapiIcons.ico(item.ico) : ''
        }</span><span>${esc(t(item.id))}</span>`;
      button.addEventListener('click', () => {
        if (item.id === current) return;
        current = item.id;
        history.replaceState(null, '', `#${item.id}`);
        renderNav();
        renderView();
      });
      nav.appendChild(button);
    }
  }

  function renderView() {
    const view = $('#view');
    // Табло и „Относно“: РЕАЛНИ данни от add-on-а (dashboard-panel.js). Тук няма демо числа.
    if (current === 'dashboard' && window.HapiDashboardPanel) {
      view.innerHTML = '';
      window.HapiDashboardPanel.mount(view);
      return;
    }
    if (current === 'about' && window.HapiDashboardPanel) {
      view.innerHTML = '';
      window.HapiDashboardPanel.mountAbout(view);
      return;
    }
    if (current === 'report') {
      view.innerHTML = '';
      window.ReportStudio.mount(view);
      return;
    }
    if (current === 'visitors' && window.HapiVisitorsPanel) {
      view.innerHTML = '';
      window.HapiVisitorsPanel.mount(view);
      return;
    }
    if (current === 'portals' && window.FilesManagerPanel) {
      view.innerHTML = '';
      window.FilesManagerPanel.mount(view);
      return;
    }
    if (current === 'portals' && window.PortalsPanel) {
      view.innerHTML = '';
      window.PortalsPanel.mount(view);
      return;
    }
    if (current === 'files' && window.FilesManagerPanel) {
      view.innerHTML = '';
      window.FilesManagerPanel.mount(view);
      return;
    }
    if (current === 'export' && window.ExportCenterPanel) {
      view.innerHTML = '';
      window.ExportCenterPanel.mount(view);
      return;
    }
    if (current === 'gateway' && window.PublicGatewayPanel) {
      view.innerHTML = '';
      window.PublicGatewayPanel.mount(view);
      return;
    }
    if (current === 'contacts' && window.ContactsPanel) {
      view.innerHTML = '';
      window.ContactsPanel.mount(view);
      return;
    }
    if (current === 'cases' && window.CasesPanel) {
      view.innerHTML = '';
      window.CasesPanel.mount(view);
      return;
    }
    if (current === 'settings' && window.SettingsPanel) {
      view.innerHTML = '';
      window.SettingsPanel.state.section = 'general';
      window.SettingsPanel.mount(view);
      return;
    }
    // Панел, чиито данни живеят в секция на „Настройки“ (UI-01): отваряме точно нея.
    const navItem = NAV.find((n) => n.id === current);
    if (navItem && navItem.section && window.SettingsPanel) {
      view.innerHTML = '';
      window.SettingsPanel.state.section = navItem.section;
      window.SettingsPanel.mount(view);
      return;
    }
    // Нищо друго не бива да се показва като „данни“: ако панелът не е монтиран, казваме го.
    view.innerHTML = `
      <div class="page-title">
        <h1>${esc(t(current))}</h1>
        <span class="badge err">не е зареден</span>
      </div>
      <section class="panel">
        <div class="panel-body">
          <p class="hint">Панелът не е зареден — липсва неговият скрипт. Презареди страницата; ако
            проблемът остане, провери дали всички файлове от <code>ui/</code> са налични в изданието.</p>
        </div>
      </section>`;
  }

  function setLang(next) {
    if (!I18N[next]) return;
    lang = next;
    document.documentElement.lang = next;
    document.querySelectorAll('.langs button').forEach((b) => {
      b.classList.toggle('active', b.dataset.lang === next);
    });
    updateBar();
    renderNav();
    // Report Studio пази собствено състояние (манифест) — не го пре-монтираме
    // при смяна на език, за да не се губи редакцията.
    if (current !== 'report') renderView();
  }

  /**
   * Статусната лента казва ИСТИНАТА за връзката: има ли адрес, има ли токен в сесията.
   * Преди тук пишеше надпис за демо данни дори когато интерфейсът беше свързан с add-on-а.
   */
  function updateBar() {
    const bar = $('#bar-center');
    if (!bar) return;
    const url = localStorage.getItem('hapi.apiBase') || (location.protocol === 'file:' ? '' : location.origin);
    const token = sessionStorage.getItem('hapiAdminToken');
    bar.textContent = !url ? t('noBackend') : token ? t('barConnected') : t('barNoToken');
  }

  function boot() {
    const fromHash = (location.hash || '').replace('#', '');
    if (NAV.some((n) => n.id === fromHash)) current = fromHash;
    updateBar();

    document.querySelectorAll('.langs button').forEach((button) => {
      button.addEventListener('click', () => setLang(button.dataset.lang));
    });

    $('#theme-toggle').addEventListener('click', () => {
      document.body.classList.toggle('light');
    });

    document.querySelector('.langs button[data-lang="bg"]').classList.add('active');
    const versionEl = document.getElementById('app-version');
    if (versionEl) versionEl.textContent = versionLabel();
    renderNav();
    renderView();
  }

  // Панелите могат да водят към друг панел (напр. „Виж всички“ от таблото), без да
  // знаят как е устроена навигацията. `go` е единствената такава врата.
  function go(id) {
    if (!NAV.some((n) => n.id === id)) return false;
    current = id;
    history.replaceState(null, '', `#${id}`);
    renderNav();
    renderView();
    return true;
  }

  window.HapiUI = { toast, t, getLang: () => lang, setLang, go };
  document.addEventListener('DOMContentLoaded', boot);
})();
