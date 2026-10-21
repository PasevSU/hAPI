'use strict';
// Enterprise Control Center — обвивка на GUI (Фаза 10 / UI-01).
// Всички данни тук са ДЕМО. Никаква връзка с backend, никакви издадени
// сертификати/подписи: Report Studio работи с реалния валидатор на манифеста.
(function () {
  const I18N = {
    bg: {
      app: 'Enterprise Control Center',
      demo: 'ДЕМО данни',
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
      security: 'Сигурност',
      backups: 'Резервни копия',
      qr: 'QR архиви',
      report: 'Report Studio',
      settings: 'Настройки',
      about: 'Относно',
      ready: 'Готов',
      planned: 'Този панел е обвивка: свързването с backend е част от Фаза 10 (UI-01).',
      metric: 'Показател',
      value: 'Стойност',
      module: 'Модул',
      state: 'Състояние',
      noBackend: 'ДЕМО данни · без backend връзка',
    },
    en: {
      app: 'Enterprise Control Center',
      demo: 'DEMO data',
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
      security: 'Security',
      backups: 'Backups',
      qr: 'QR archive',
      report: 'Report Studio',
      settings: 'Settings',
      about: 'About',
      ready: 'Ready',
      planned: 'This panel is a shell: backend wiring belongs to Phase 10 (UI-01).',
      metric: 'Metric',
      value: 'Value',
      module: 'Module',
      state: 'State',
      noBackend: 'DEMO data · no backend connection',
    },
    de: {
      app: 'Enterprise Control Center',
      demo: 'DEMO-Daten',
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
      security: 'Sicherheit',
      backups: 'Sicherungen',
      qr: 'QR-Archiv',
      report: 'Report Studio',
      settings: 'Einstellungen',
      about: 'Über',
      ready: 'Bereit',
      planned: 'Dieses Panel ist eine Hülle: die Backend-Anbindung gehört zu Phase 10 (UI-01).',
      metric: 'Kennzahl',
      value: 'Wert',
      module: 'Modul',
      state: 'Status',
      noBackend: 'DEMO-Daten · keine Backend-Verbindung',
    },
  };

  // Иконите на навигацията са от общия SVG набор (ui/icons.js) — един стил навсякъде.
  const NAV = [
    { id: 'dashboard', ico: 'dashboard' },
    { id: 'portals', ico: 'folder' },
    { id: 'contacts', ico: 'person' },
    { id: 'cases', ico: 'case' },
    { id: 'gateway', ico: 'share' },
    { id: 'export', ico: 'download' },
    { id: 'report', ico: 'note' },
    { id: 'settings', ico: 'gear' },
    { id: 'about', ico: 'info' },
  ];

  const DEMO = {
    dashboard: {
      stats: [
        ['Портали', '4'],
        ['Документи', '1 284'],
        ['Проверени', '1 279'],
        ['Нарушена цялост', '0'],
      ],
      table: {
        head: ['Модул', 'Състояние'],
        rows: [
          ['Ядро (групи/профили/променливи)', 'Готов'],
          ['Портално API v1 (legacy)', 'Sunset 2027-12-31'],
          ['QR + landing', 'Готов'],
          ['Report Studio', 'Прототип'],
        ],
      },
    },
    portals: {
      stats: [['Активни', '4'], ['С ключ', '3'], ['Публични', '1'], ['Отменени', '0']],
      table: {
        head: ['Портал', 'Режим', 'Файлове'],
        rows: [
          ['ChronoSeal-Vault', 'KEY_REQUIRED', '48'],
          ['DEW21 — документи', 'KEY_REQUIRED', '212'],
          ['Forensic — дело 2026-114', 'KEY_REQUIRED', '96'],
          ['Public notices', 'FREE', '8'],
        ],
      },
    },
    files: {
      stats: [['Файлове', '1 284'], ['Обем', '18,4 GB'], ['Версии', '312'], ['Шифровани', '41']],
      table: {
        head: ['Файл', 'Тип', 'Размер'],
        rows: [
          ['vestestveno-dokazatelstvo-A.pdf', 'PDF', '1,0 MB'],
          ['protokol-2026-114.docx', 'OOXML', '184 KB'],
          ['tablica-hashes.xlsx', 'OOXML', '96 KB'],
        ],
      },
    },
    users: {
      stats: [['Потребители', '12'], ['Админи', '2'], ['Оператори', '5'], ['Наблюдатели', '5']],
      table: {
        head: ['Роля', 'Права'],
        rows: [
          ['admin', 'пълен достъп'],
          ['operator', 'качване, редакция'],
          ['viewer', 'четене'],
          ['judge (Фаза 7)', 'четене + верификация'],
        ],
      },
    },
    jobs: {
      stats: [['В опашка', '2'], ['Изпълняват се', '1'], ['Завършени', '146'], ['Провалени', '3']],
      table: {
        head: ['Задача', 'Прогрес'],
        rows: [
          ['Проверка на цялост', '38 / 41'],
          ['Резервно копие', 'готово'],
          ['Миграция (dry-run)', 'чака потвърждение'],
        ],
      },
    },
    storage: {
      stats: [['Том', '2'], ['Свободно', '412 GB'], ['Артефакти', '1 284'], ['WORM', 'изкл.']],
      table: {
        head: ['Път', 'Състояние'],
        rows: [
          ['/data', 'OK'],
          ['/data/qr-records', 'OK'],
          ['/data/evidence (Фаза 7)', 'не е монтиран'],
        ],
      },
    },
    analytics: {
      stats: [['Сесии', '37'], ['Изтегляния', '512'], ['Верификации', '289'], ['Грешки', '4']],
      table: {
        head: ['Показател', 'Стойност'],
        rows: [
          ['Средно време за верификация', '0,4 s'],
          ['Най-активен портал', 'DEW21'],
        ],
      },
    },
    security: {
      stats: [['RBAC', 'вкл.'], ['AES-256-GCM', 'по избор'], ['HMAC-SHA256', 'вкл.'], ['TSA', 'не е конфигуриран']],
      table: {
        head: ['Контрол', 'Състояние'],
        rows: [
          ['Rate limit', 'вкл.'],
          ['Подписани URL', 'вкл.'],
          ['PKCS#7 / RFC 3161', 'Фаза 7'],
        ],
      },
    },
    backups: {
      stats: [['Копия', '7'], ['Последно', 'днес 04:00'], ['График', '24 h'], ['Проверени', '7']],
      table: {
        head: ['Копие', 'Статус'],
        rows: [
          ['backup-2026-10-20T04-00', 'OK'],
          ['backup-2026-10-19T04-00', 'OK'],
        ],
      },
    },
    qr: {
      stats: [['Активни QR', '9'], ['Отменени', '2'], ['Изтекли', '1'], ['Файлови', '5']],
      table: {
        head: ['QR', 'Цел'],
        rows: [
          ['qr-chronoseal-vault', 'портал'],
          ['qr-file-3f9a12', 'файл'],
        ],
      },
    },
    settings: {
      stats: [['Секции', '7'], ['Изискват рестарт', '6'], ['Профили', '3'], ['Версия', String(window.HAPI_VERSION || '')]],
      table: {
        head: ['Секция', 'Състояние'],
        rows: [
          ['Бранд', 'готово'],
          ['Съхранение', 'изисква рестарт'],
          ['Лимити и мрежа', 'готово'],
          ['Retention', 'готово'],
          ['Резервни копия', 'готово'],
        ],
      },
    },
    about: {
      stats: [['Версия', String(window.HAPI_VERSION || '')], ['Продукт', 'hAPI Enterprise'], ['Лиценз', 'Apache-2.0'], ['Режим', 'WebView2']],
      table: {
        head: ['Ресурс', 'Връзка'],
        rows: [
          ['Документация', 'docs/'],
          ['Единен план', 'docs/plan/15-unified-master-plan-v6.0.md'],
          ['ADR', 'documentation/03_ADR/'],
        ],
      },
    },
  };

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
      button.innerHTML = `<span class="ico" aria-hidden="true">${
        window.HapiIcons ? window.HapiIcons.ico(item.ico) : ''
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

  function statsHtml(stats) {
    return `<div class="stat-grid">${stats
      .map(([label, value]) => `<div class="stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`)
      .join('')}</div>`;
  }

  function tableHtml({ head, rows }) {
    return `<table class="grid"><thead><tr>${head
      .map((h) => `<th>${esc(h)}</th>`)
      .join('')}</tr></thead><tbody>${rows
      .map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`;
  }

  function renderView() {
    const view = $('#view');
    if (current === 'report') {
      view.innerHTML = '';
      window.ReportStudio.mount(view);
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
      window.SettingsPanel.mount(view);
      return;
    }
    const data = DEMO[current] || DEMO.dashboard;
    view.innerHTML = `
      <div class="page-title">
        <h1>${esc(t(current))}</h1>
        <span class="badge demo">${esc(t('demo'))}</span>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>${esc(t(current))}</h2><span class="badge">${esc(versionLabel())}</span></div>
        <div class="panel-body">
          ${statsHtml(data.stats)}
          <p class="hint">${esc(t('planned'))}</p>
          <div class="u-mt">${tableHtml(data.table)}</div>
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
    $('#bar-center').textContent = t('noBackend');
    renderNav();
    // Report Studio пази собствено състояние (манифест) — не го пре-монтираме
    // при смяна на език, за да не се губи редакцията.
    if (current !== 'report') renderView();
  }

  function boot() {
    const fromHash = (location.hash || '').replace('#', '');
    if (NAV.some((n) => n.id === fromHash)) current = fromHash;

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

  window.HapiUI = { toast, t, getLang: () => lang, setLang };
  document.addEventListener('DOMContentLoaded', boot);
})();
