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
      noPermission: 'Тази роля няма право на този панел. Правата се дават от администратор.',
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
      noPermission: 'This role has no access to this panel. Access is granted by an administrator.',
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
      noPermission: 'Diese Rolle hat keinen Zugriff auf dieses Panel. Zugriff vergibt ein Administrator.',
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
    // Скрити от менюто (по заявка): блоковете остават достъпни по id за сценариите,
    // но не се рисуват в навигацията.
    { id: 'backups', ico: 'archive', section: 'backups', hidden: true },
    { id: 'qr', ico: 'qr', section: 'qr', hidden: true },
    { id: 'report', ico: 'note' },
    { id: 'settings', ico: 'gear', section: 'general' },
    { id: 'about', ico: 'info' },
  ];

  // Измислените „демо“ числа бяха премахнати: таблото и „Относно“ се рисуват от
  // dashboard-panel.js с реални данни от административния API.

  // Регистърът на панелите (план 18 §7). Едно място за „кой панел как се отваря и как се
  // освобождава“ вместо верига от `if`-ове. Панелите се сочат по ИМЕ на глобален обект, защото
  // този файл се зарежда ПРЕДИ тях в `index.html` — регистърът ги търси в момента на
  // монтиране, а не при регистрация (иначе редът на `<script>`-овете решава кой работи).
  const panels = window.HapiPanelRegistry ? window.HapiPanelRegistry.create(window) : null;
  // Ролята още не е известна: `null` значи „не филтрирай“, а не „нищо не може“.
  let capabilities = null;
  if (panels) {
    // `capabilities` е същата способност, която съответните маршрути искат от сървъра
    // (`routes/*` → `adminGate`), за да не се показва панел, който ще отговори 403.
    panels.registerAll([
      { id: 'dashboard', title: 'Табло', global: 'HapiDashboardPanel' },
      { id: 'about', title: 'Относно', global: 'HapiDashboardPanel', method: 'mountAbout' },
      { id: 'report', title: 'Report Studio', global: 'ReportStudio', capabilities: ['settings'] },
      { id: 'visitors', title: 'Посетители', global: 'HapiVisitorsPanel', capabilities: ['sensors'] },
      // Порталът има две поколения панел; първият наличен печели.
      { id: 'portals', title: 'Портали', global: ['FilesManagerPanel', 'PortalsPanel'], capabilities: ['portals'] },
      { id: 'files', title: 'Файлове', global: 'FilesManagerPanel', capabilities: ['portals'] },
      { id: 'export', title: 'Експорт', global: 'ExportCenterPanel', capabilities: ['packages'] },
      { id: 'gateway', title: 'Публичен достъп', global: 'PublicGatewayPanel', capabilities: ['portals'] },
      { id: 'contacts', title: 'Контакти', global: 'ContactsPanel', capabilities: ['directory'] },
      { id: 'cases', title: 'Дела', global: 'CasesPanel', capabilities: ['cases'] },
    ]);
  }

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
      if (item.hidden) continue;
      // Панел, който иска способност, която ролята няма, не се показва. Проверява се само за
      // регистрираните панели: останалите входове водят към секция на „Настройки“ и се
      // решават от сървъра при самата заявка.
      if (panels && panels.has(item.id) && !panels.allowed(item.id, capabilities)) continue;
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
    // Всеки панел, който има `unmount`, получава шанс да освободи ресурси (напр. отворен SSE
    // поток). Досега това ставаше САМО за таблото, тоест панел със слушател оставаше монтиран
    // след напускане — видимо като растящ брой клиенти в `/admin/api/events`. Проверката е през
    // локална променлива, за да не изглежда като обявяване на панелен модул (виж
    // `tests/gui-coverage.cjs`).
    if (panels) panels.unmountAll();
    else {
      const dashboard = window.HapiDashboardPanel;
      if (dashboard && typeof dashboard.unmount === 'function') {
        try { dashboard.unmount() } catch { /* освобождаването не бива да чупи навигацията */ }
      }
    }
    if (window.SettingsPanel && typeof window.SettingsPanel.unmount === 'function') window.SettingsPanel.unmount();
    // Панелите от регистъра се монтират през него — едно място за „кой панел как се отваря“.
    // `available` се пита ПРЕДИ да се изчисти изгледът: иначе липсващ панел би оставил празен
    // екран без обяснение.
    if (panels && panels.available(current)) {
      view.innerHTML = '';
      const mounted = panels.mount(current, view, { capabilities });
      if (mounted === true) return;
      if (mounted === 'DENIED') {
        // Различава се от „липсва панел“: човекът има право да знае, че не е за него, а не
        // че модулът липсва. Правата ги налага сървърът; тук само не се показва бутон.
        view.innerHTML = `<div class="page-title"><h1>${esc(t(current))}</h1><p class="muted">${esc(t('noPermission'))}</p></div>`;
        return;
      }
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
    // Под HA Ingress адресът на add-on-а включва префикса (`/api/hassio_ingress/<token>`).
    // Затова идва САМО от api-base.js: резервен `location.origin` няма — той е адресът на
    // Home Assistant и при смяна на реда на зареждане дава тихо грешни заявки.
    const url = typeof window.hapiApiBase === 'function' ? window.hapiApiBase() : '';
    const token = sessionStorage.getItem('hapiAdminToken');
    bar.textContent = !url ? t('noBackend') : token ? t('barConnected') : t('barNoToken');
  }

  // Ролята и способностите идват от СЪЩИЯ източник, по който сървърът пуска заявките
  // (`GET /admin/api/whoami` → `rbac.capabilitiesOf`), а не от втори списък в GUI-я.
  // Докато отговорът не дойде, `capabilities` е `null` и нищо не се скрива — иначе при
  // бавна връзка интерфейсът би изчезнал за момент. Правата пак се налагат от API-то.
  async function loadCapabilities() {
    const base = typeof window.hapiApiBase === 'function' ? window.hapiApiBase() : '';
    const token = sessionStorage.getItem('hapiAdminToken');
    if (!base || !token || typeof fetch !== 'function') return;
    try {
      const res = await fetch(base + '/admin/api/whoami', { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data && data.capabilities)) return;
      capabilities = data.capabilities;
      renderNav();
      renderView();
    } catch {
      // Без роля интерфейсът остава както досега; това не е отстъпка по сигурност —
      // всяка заявка пак минава през `adminGate`.
    }
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

    // Скриване на менюто. Под Home Assistant Ingress панелът се отваря в страничната
    // лента, където лявото меню яде ширината на картите. Състоянието се помни, за да
    // не се цъка при всяко отваряне, и се обявява с `aria-expanded` за екранни четци.
    const navToggle = $('#nav-toggle');
    if (navToggle) {
      const applyNav = (collapsed) => {
        document.body.classList.toggle('nav-collapsed', collapsed);
        navToggle.setAttribute('aria-expanded', String(!collapsed));
        navToggle.title = collapsed ? 'Покажи менюто' : 'Скрий менюто';
        try {
          localStorage.setItem('hapi.navCollapsed', collapsed ? '1' : '0');
        } catch {
          // забранен storage (личен режим) — състоянието просто не се помни
        }
      };
      let saved;
      try {
        saved = localStorage.getItem('hapi.navCollapsed') === '1';
      } catch {
        // забранен storage (личен режим) — състоянието просто не се помни
      }
      applyNav(saved);
      navToggle.addEventListener('click', () => applyNav(!document.body.classList.contains('nav-collapsed')));
    }

    document.querySelector('.langs button[data-lang="bg"]').classList.add('active');
    const versionEl = document.getElementById('app-version');
    if (versionEl) versionEl.textContent = versionLabel();
    renderNav();
    renderView();
    void loadCapabilities();
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

  window.HapiUI = { toast, t, getLang: () => lang, setLang, go, nav: () => NAV.map((item) => ({ id: item.id, ico: item.ico })) };
  document.addEventListener('DOMContentLoaded', boot);
})();
