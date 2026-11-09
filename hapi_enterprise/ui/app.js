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
      monitoring: 'Мониторинг',
      // Заглавия на групите на менюто (закон „симетрия и логика“): по четири секции.
      navGroupOverview: 'Преглед',
      navGroupContent: 'Съдържание',
      navGroupAccess: 'Достъп и отчети',
      navGroupSystem: 'Система',
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
      monitoring: 'Monitoring',
      navGroupOverview: 'Overview',
      navGroupContent: 'Content',
      navGroupAccess: 'Access and reports',
      navGroupSystem: 'System',
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
      monitoring: 'Monitoring',
      navGroupOverview: 'Übersicht',
      navGroupContent: 'Inhalt',
      navGroupAccess: 'Zugang und Berichte',
      navGroupSystem: 'System',
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
  // ЗАКОН „менюто има симетрия и логика“ (0.69.208): и главното меню не е един дълъг списък.
  // Секциите са в ЧЕТИРИ групи по ЧЕТИРИ, по смисъл:
  //   • Преглед — какво се гледа: табло, мониторинг, анализи, кой влиза;
  //   • Съдържание — с какво се работи: портали, контакти, дела, изтегляне;
  //   • Достъп и отчети — кой какво може и какво излиза навън: шлюз, потребители, сигурност, отчети;
  //   • Система — задачи, хранилища, настройки, „Относно“.
  // Редът на групите е редът на работа, а равенството (4 × 4) пази редовете равни. Пази го
  // `tests/ui-nav-symmetry.cjs`; живият екран го проверява със закона `balanced-groups`.
  const NAV = [
    { id: 'dashboard', ico: 'dashboard', group: 'overview' },
    { id: 'monitoring', ico: 'chart', group: 'overview' },
    { id: 'analytics', ico: 'chart', section: 'analytics', group: 'overview' },
    { id: 'visitors', ico: 'person', group: 'overview' },
    { id: 'portals', ico: 'folder', group: 'content' },
    { id: 'contacts', ico: 'person', group: 'content' },
    { id: 'cases', ico: 'case', group: 'content' },
    { id: 'export', ico: 'download', group: 'content' },
    { id: 'gateway', ico: 'share', group: 'access' },
    { id: 'users', ico: 'person', section: 'users', group: 'access' },
    { id: 'security', ico: 'shield', section: 'security', group: 'access' },
    { id: 'report', ico: 'note', group: 'access' },
    { id: 'jobs', ico: 'clock', section: 'jobs', group: 'system' },
    { id: 'storage', ico: 'drive', section: 'storage', group: 'system' },
    { id: 'settings', ico: 'gear', section: 'general', group: 'system' },
    { id: 'about', ico: 'info', group: 'system' },
    // Скрити от менюто (по заявка): блоковете остават достъпни по id за сценариите,
    // но не се рисуват в навигацията — затова не влизат в броя на групите.
    { id: 'backups', ico: 'archive', section: 'backups', group: 'system', hidden: true },
    { id: 'qr', ico: 'qr', section: 'qr', group: 'access', hidden: true },
  ];

  // Групите на менюто в РЕДА, в който се показват: заглавието е ключ от речника по-горе.
  const NAV_GROUPS = [
    { id: 'overview', title: 'navGroupOverview' },
    { id: 'content', title: 'navGroupContent' },
    { id: 'access', title: 'navGroupAccess' },
    { id: 'system', title: 'navGroupSystem' },
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
      // Мониторингът е ЕДНА страница за всичко, което add-on-ът мери (0.69.205).
      // Иска същата способност като сензорите, защото без нея няма какво да покаже.
      { id: 'monitoring', title: 'Мониторинг', global: 'HapiMonitoringPanel', capabilities: ['sensors'] },
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
    // Законът: рисува се по ГРУПИ, а не по плосък списък. Всяка група е `role="group"` с име,
    // за да може екранният четец (и законът `balanced-groups`) да я види като група.
    for (const group of NAV_GROUPS) {
      const items = NAV.filter((item) => item.group === group.id && !item.hidden);
      if (!items.length) continue;
      const block = document.createElement('div');
      block.className = 'nav-group';
      block.dataset.navGroup = group.id;
      block.setAttribute('role', 'group');
      block.setAttribute('aria-labelledby', `nav-group-${group.id}`);
      const title = document.createElement('span');
      title.className = 'nav-group-title';
      title.id = `nav-group-${group.id}`;
      title.textContent = t(group.title);
      block.appendChild(title);
      for (const item of items) {
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
        block.appendChild(button);
      }
      nav.appendChild(block);
    }
  }

  /** Свързва етикетите с полетата в изгледа (`for`/`id`) веднага след рендер (DEF-38). */
  function bindLabels(root) {
    if (root && window.HapiFieldLabels) window.HapiFieldLabels.bind(root);
  }

  function renderView() {
    const view = $('#view');
    // Етикетите на полетата се свързват с тях (`for`/`id`) — иначе екранният четец не
    // обявява име (DEF-38). Прави се след всеки рендер; виж и наблюдателя по-долу, защото
    // панелите рисуват наново и СЛЕД монтирането (при заредени данни).
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
      bindLabels(view);
      if (mounted === true) return;
      if (mounted === 'DENIED') {
        // Различава се от „липсва панел“: човекът има право да знае, че не е за него, а не
        // че модулът липсва. Правата ги налага сървърът; тук само не се показва бутон.
        view.innerHTML = `<div class="page-title"><h1>${esc(t(current))}</h1><p class="muted">${esc(t('noPermission'))}</p></div>`;
        bindLabels(view);
        return;
      }
    }

    if (current === 'settings' && window.SettingsPanel) {
      view.innerHTML = '';
      window.SettingsPanel.state.section = 'general';
      window.SettingsPanel.mount(view);
      bindLabels(view);
      return;
    }
    // Панел, чиито данни живеят в секция на „Настройки“ (UI-01): отваряме точно нея.
    const navItem = NAV.find((n) => n.id === current);
    if (navItem && navItem.section && window.SettingsPanel) {
      view.innerHTML = '';
      window.SettingsPanel.state.section = navItem.section;
      window.SettingsPanel.mount(view);
      bindLabels(view);
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
    bindLabels(view);
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

    // ВТОРА КОЖА („модерен“ изглед). Сменя само оформлението — същите панели, същите
    // бутони, същите заявки. Изборът се помни в `localStorage`, защото е предпочитание на
    // човека, а не състояние на сесията; при забранен storage просто не се помни.
    const skinToggle = $('#skin-toggle');
    const applySkin = (modern, persist = true) => {
      document.body.classList.toggle('skin-modern', modern);
      if (skinToggle) {
        skinToggle.setAttribute('aria-pressed', String(modern));
        skinToggle.title = modern ? 'Класически изглед' : 'Модерен изглед';
      }
      if (!persist) return;
      try {
        localStorage.setItem('hapi.skin', modern ? 'modern' : 'classic');
      } catch {
        // забранен storage (личен режим) — кожата работи, но не се помни
      }
    };
    let savedSkin = false;
    try {
      savedSkin = localStorage.getItem('hapi.skin') === 'modern';
    } catch {
      // забранен storage (личен режим) — остава класическата кожа
    }
    applySkin(savedSkin, false);
    if (skinToggle) {
      skinToggle.addEventListener('click', () => applySkin(!document.body.classList.contains('skin-modern')));
    }

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

      // ЗАКОН „менюто се прибира само“ (0.69.208): отвореното меню се затваря при клик ИЗВЪН
      // него, без човек да търси бутона. Вътре в менюто кликът не го затваря — иначе изборът
      // на панел щеше да изчезва под ръката. Бутонът `#nav-toggle` е изключение: той сам решава
      // (иначе „покажи“ веднага щеше да се затвори от собствения си клик).
      // Escape прави същото за клавиатура — там „извън менюто“ няма координати.
      const navPanel = $('#nav');
      const navOpen = () => !document.body.classList.contains('nav-collapsed');
      const closeNav = () => {
        if (navOpen()) applyNav(true);
      };
      document.addEventListener('click', (event) => {
        if (!navOpen()) return;
        const target = event && event.target;
        if (!target) return;
        if (navPanel && navPanel.contains && navPanel.contains(target)) return;
        if (navToggle.contains && navToggle.contains(target)) return;
        closeNav();
      });
      document.addEventListener('keydown', (event) => {
        if (event && event.key === 'Escape') closeNav();
      });
    }

    document.querySelector('.langs button[data-lang="bg"]').classList.add('active');
    const versionEl = document.getElementById('app-version');
    if (versionEl) versionEl.textContent = versionLabel();
    // Наблюдател: панел, който се рисува наново след зареждане на данни, също получава
    // свързани етикети, без да знае за това правило (DEF-38). Гледа се само `#view`, а
    // смяната на атрибути не поражда `childList` — тоест няма безкраен цикъл.
    const viewRoot = $('#view');
    if (viewRoot && typeof MutationObserver === 'function') {
      const labels = new MutationObserver(() => {
        if (window.HapiFieldLabels) window.HapiFieldLabels.bind(viewRoot);
      });
      labels.observe(viewRoot, { childList: true, subtree: true });
    }
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

  // `nav()` издава СЪЩОТО, което рисува менюто: скритите входове (`hidden: true`, напр. `qr`
  // — отваря се от картата на портала) не са раздели и не бива да стават бутони на таблото.
  // Иначе таблото показваше 17 бутона при 16 в менюто и подписът „същите като в менюто“ лъжеше.
  window.HapiUI = {
    toast,
    t,
    getLang: () => lang,
    setLang,
    go,
    nav: () => NAV.filter((item) => !item.hidden).map((item) => ({ id: item.id, ico: item.ico })),
  };
  document.addEventListener('DOMContentLoaded', boot);
})();
