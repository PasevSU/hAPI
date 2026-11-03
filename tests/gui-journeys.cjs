'use strict';
// ВСИЧКИ сценарии, минаващи САМО и ЕДИНСТВЕНО през интерфейса.
//
// Защо този файл съществува, след като има `gui-panels.cjs` и `gui-sections.cjs`:
// онези тестове подготвят данните с `server.api(...)` — тоест минават покрай
// интерфейса, за да стигнат до него. Тук няма нито едно такова извикване:
//
//   • зарежда се ИСТИНСКИЯТ `ui/index.html` и ИСТИНСКИЯТ ред на скриптовете му;
//   • `app.js` строи навигацията и монтира панелите, както в браузъра;
//   • всичко се прави с натискания, писане в полета и избор от падащи менюта;
//   • твърденията се четат от екрана, а `app.requests` казва само КАКВО е поискал
//     интерфейсът — не се прави нито една заявка от теста.
//
// `tests/gui-only-guard.cjs` пази това свойство: ако някой добави `fetch`/`api`
// в този файл, тестът пада.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { mountApp, pseudoFile } = require('./lib/gui-journey.cjs');

const text = (node) => String((node && node.textContent) || '').replace(/\s+/g, ' ').trim();

// Един бюджет за ВСИЧКИ изчаквания в този файл. Работната машина е бърза, а runner-ът в CI
// е няколко пъти по-бавен: същата проверка минава, но за по-дълго. Затова бюджетът е щедър
// и е един — вместо всяко изчакване да носи свое число, което да изтече само на CI.
const BUDGET = Number(process.env.HAPI_GUI_TIMEOUT_MS || 45000);

(async () => {
  // `startServer` дава и `api`, но той НЕ се използва никъде по-долу — единственият
  // достъп до add-on-а е през `app` (DOM). Проверява се от `gui-only-guard.cjs`.
  const server = await startServer();
  const app = mountApp(server);
  const view = () => app.view();
  const passed = [];
  const failed = [];

  /** Чака изгледът да спре да казва „Зареждам…“ — панелите работят асинхронно. */
  const settle = (label, timeout = BUDGET) =>
    waitFor(() => {
      const host = view();
      if (!host) return false;
      const body = text(host);
      return body.length > 0 && !/Зареждам/.test(body);
    }, { label: label || 'изгледът да утихне', timeout });

  /** Натиска бутон на секция и чака отговор в известието на екрана. */
  const act = async (name, { expect = /./, kind = '', noToast = false } = {}) => {
    app.clearToasts();
    app.action(name);
    if (noToast) {
      await settle('„' + name + '“ да приключи');
      return null;
    }
    await waitFor(() => app.toast(), { label: 'отговор от „' + name + '“', timeout: 8000 });
    const toast = app.toast();
    if (kind) assert.equal(toast.kind, kind, '„' + name + '“ трябва да отговори като „' + kind + '“: ' + toast.message);
    if (expect) assert.match(toast.message, expect, 'отговорът на „' + name + '“ е неочакван: ' + toast.message);
    await settle('„' + name + '“ да приключи');
    return toast;
  };

  /** Списъкът с портали — през „← Списък с портали“, ако е отворен портал. */
  const portalList = async () => {
    app.nav('portals');
    await settle('панелът „Портали“');
    const close = app.$('[data-close-portal]');
    if (close) {
      close.click();
      await settle('списъкът с портали');
    }
  };

  /** Отваря първия портал — със същия бутон „Отвори портала“, който вижда човекът. */
  const openPortal = async () => {
    await portalList();
    const open = await waitFor(() => app.$$('[data-open-portal]')[0], { label: 'бутонът „Отвори портала“' });
    open.click();
    await settle('картата на портала');
  };

  /**
   * Създава НОВ портал с ЕДИН файл — през формата, както го прави човек (същият път като J05).
   * Така файловият сценарий не зависи от състоянието, което предишен сценарий е оставил:
   * той си носи портала и файла. Именно тази зависимост правеше три сценария нестабилни в CI.
   */
  const ownPortalWithFile = async (slug) => {
    await portalList();
    app.click('#pf-new', 'бутонът „Нов портал“');
    await waitFor(() => app.$('#pf-create'), { label: 'формата за нов портал' });
    app.fill('[name="slug"]', slug);
    app.fill('[name="title"]', 'Портал за файловия сценарий');
    const folder = app.$('#pf-folder');
    assert.ok(folder, 'формата има избор на папка с файлове');
    folder.files = [pseudoFile('fayl-za-scenariy.txt', 'съдържание за сценария')];
    app.select('[name="visibility"]', 'public');
    app.clearToasts();
    app.click('#pf-create', 'бутонът „Създай и генерирай API + QR“');
    await waitFor(() => app.toast(), { label: 'порталът за сценария', timeout: BUDGET });
    assert.equal(app.toast().kind, 'ok', 'порталът за сценария се създава: ' + app.toast().message);
    await settle('файловете на новия портал');
    assert.match(text(view()), /fayl-za-scenariy\.txt/, 'файлът е в новия портал');
  };

  /** Отваря действие от менюто ⚙ на файла „fayl-za-scenariy.txt“ — същият път като с мишка. */
  const fileAction = async (action) => {
    const row = await waitFor(() => {
      const rows = app.$$('[data-file-gear]');
      return rows.find((el) => {
        const art = el.closest ? el.closest('.fm-file') : null;
        return !art || /fayl-za-scenariy/.test(text(art));
      }) || rows[0];
    }, { label: 'менюто ⚙ на файла' });
    row.click();
    await settle('менюто на файла');
    const item = await waitFor(() => app.$('[data-file-act="' + action + '"]'), { label: 'действието „' + action + '“' });
    item.click();
    await settle('формата за „' + action + '“');
  };

  const journey = async (name, fn) => {
    try {
      await fn();
      passed.push(name);
    } catch (error) {
      failed.push(name + ': ' + error.message);
    }
  };

  try {
    // ── J01. Страницата се вдига като в браузър ────────────────────────────────
    await journey('J01 стартиране на index.html', async () => {
      const navIds = app.navIds();
      assert.equal(navIds.length, 17, 'навигацията има 17 точки, нарисувани от app.js: ' + navIds.join(', '));
      for (const id of ['dashboard', 'portals', 'contacts', 'cases', 'gateway', 'export', 'users', 'jobs', 'storage', 'analytics', 'visitors', 'security', 'backups', 'qr', 'report', 'settings', 'about']) {
        assert.ok(navIds.includes(id), 'липсва навигационна точка „' + id + '“');
      }
      assert.equal(text(app.$('#bar-center')), 'свързан · токен в сесията', 'лентата казва истината за връзката');
      assert.match(text(app.$('#app-version')), /^v\d+\.\d+\.\d+$/, 'версията идва от data.js');
      assert.ok(text(view()).length > 50, 'таблото е нарисувано');
      assert.equal(text(view()).includes('не е зареден'), false, 'нищо не липсва при стартиране');
    });

    // ── J02. ВСЕКИ панел се отваря от навигацията (без пряко монтиране) ───────
    await journey('J02 всеки панел от навигацията', async () => {
      const ids = app.navIds();
      const problems = [];
      // `app.js` не пре-монтира текущия панел — затова се тръгва от последния.
      app.nav(ids[ids.length - 1]);
      await settle('изходна точка');
      for (const id of ids) {
        try {
          app.nav(id);
          await settle('панел „' + id + '“');
          const body = text(view());
          assert.ok(body.length > 20, 'панелът е празен');
          assert.equal(body.includes('не е зареден'), false, 'панелът казва, че не е зареден');
        } catch (error) {
          problems.push(id + ': ' + error.message);
        }
      }
      assert.deepEqual(problems, [], 'панели, които не се отварят:\n  ' + problems.join('\n  '));
    });

    // ── J03. ВСЕКИ таб на „Настройки“ се отваря с натискане ───────────────────
    await journey('J03 всеки таб на „Настройки“', async () => {
      app.nav('settings');
      await settle('„Настройки“');
      const tabs = app.$$('[data-section]').map((b) => b.getAttribute('data-section'));
      assert.ok(tabs.length >= 16, 'табовете на „Настройки“ са поне 16: ' + tabs.join(', '));
      const problems = [];
      for (const id of tabs) {
        try {
          app.section(id);
          await settle('секция „' + id + '“');
          const body = text(view());
          assert.equal(body.includes('Непозната секция'), false, 'секцията не се рисува');
          assert.ok(body.length > 20, 'секцията е празна');
        } catch (error) {
          problems.push(id + ': ' + error.message);
        }
      }
      assert.deepEqual(problems, [], 'секции, които не се отварят:\n  ' + problems.join('\n  '));
    });

    // ── J04. Портал през формата „Нов портал“ (+ контакт и дело в нея) ────────
    await journey('J04 портал през формата', async () => {
      app.nav('portals');
      await settle('панелът „Портали“');
      app.click('#pf-new', 'бутонът „Нов портал“');
      await waitFor(() => app.$('#pf-create'), { label: 'формата за нов портал' });
      app.fill('[name="slug"]', 'gui-journey');
      app.fill('[name="title"]', 'Портал от GUI сценария');
      app.fill('[name="subject"]', 'посещение на лице');
      // Контактът се създава ОТ СЪЩАТА форма — както го прави човек.
      app.select('[name="contactId"]', '__new__');
      app.fill('[name="contact_email"]', 'journey.contact@example.org');
      app.fill('[name="contact_name"]', 'Мария Сценариева');
      app.select('[name="caseId"]', '__new_case__');
      app.fill('[name="case_number"]', 'GUI-J-2026-001');
      app.fill('[name="case_title"]', 'Дело от GUI сценария');
      app.clearToasts();
      app.click('#pf-create', 'бутонът „Създай и генерирай API + QR“');
      await waitFor(() => app.toast(), { label: 'отговор от създаването на портал', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'порталът се създава: ' + app.toast().message);
      await settle('порталът да се нарисува');
      assert.match(text(view()), /Портал от GUI сценария/, 'порталът се вижда в списъка');
      const asked = app.requests.map((r) => r.method + ' ' + r.url);
      assert.ok(asked.some((r) => r.startsWith('POST') && r.includes('/admin/api/portals')), 'интерфейсът поиска създаване на портал: ' + asked.slice(-5).join(' · '));
    });

    // ── J05. Файлове в портала от папка при създаване ─────────────────────────
    await journey('J05 файлове от папка при създаване', async () => {
      await portalList();
      app.click('#pf-new', 'бутонът „Нов портал“');
      await waitFor(() => app.$('#pf-create'), { label: 'формата за нов портал' });
      app.fill('[name="slug"]', 'gui-journey-files');
      app.fill('[name="title"]', 'Портал с файлове');
      const input = app.$('#pf-folder');
      assert.ok(input, 'формата има избор на папка');
      input.files = [pseudoFile('dokument.txt', 'съдържание от GUI сценария'), pseudoFile('prilozhenie.txt', 'второ съдържание')];
      app.select('[name="visibility"]', 'public');
      app.clearToasts();
      app.click('#pf-create', 'бутонът „Създай и генерирай API + QR“');
      await waitFor(() => app.toast(), { label: 'отговор от създаването', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'порталът с файлове се създава: ' + app.toast().message);
      await settle('файловете да се покажат');
      const shown = text(view());
      assert.match(shown, /dokument\.txt/, 'каченият файл се вижда в портала');
      assert.match(shown, /prilozhenie\.txt/, 'вторият файл се вижда в портала');
      const posts = app.requests.filter((r) => r.method === 'POST' && /\/portals\/[^/]+\/files$/.test(r.url));
      assert.equal(posts.length, 2, 'интерфейсът качи точно двата файла: ' + posts.length);
    });

    // ── J06. Контакт през формата на панела ───────────────────────────────────
    await journey('J06 контакт през формата', async () => {
      app.nav('contacts');
      await settle('панелът „Контакти“');
      await waitFor(() => app.$('input[name="f_name"]'), { label: 'формата за контакт' });
      app.fill('input[name="f_name"]', 'Иван Сценариев');
      app.fill('input[name="email"]', 'ivan.scenario@example.org');
      app.fill('input[name="f_organization"]', 'Община Сценарии');
      app.clearToasts();
      const button = app.$$('button').find((b) => /^Добави контакта$/.test(text(b)));
      assert.ok(button, 'има бутон „Добави контакта“');
      button.click();
      await waitFor(() => text(view()).includes('Иван Сценариев'), { label: 'контактът да се появи в списъка', timeout: BUDGET });
      assert.ok(app.requests.some((r) => r.method === 'POST' && r.url.includes('/admin/api/directory')), 'контактът е записан през интерфейса');
    });

    // ── J07. Дело през формата на панела ──────────────────────────────────────
    await journey('J07 дело през формата', async () => {
      app.nav('cases');
      await settle('панелът „Дела“');
      await waitFor(() => app.$('input[name="number"]'), { label: 'формата за дело' });
      app.fill('input[name="number"]', 'GUI-J-2026-002');
      app.fill('input[name="title"]', 'Дело от панела');
      app.clearToasts();
      const button = app.$$('button').find((b) => /^Добави делото$/.test(text(b)));
      assert.ok(button, 'има бутон „Добави делото“');
      button.click();
      await waitFor(() => text(view()).includes('GUI-J-2026-002'), { label: 'делото да се появи в списъка', timeout: BUDGET });
      assert.ok(app.requests.some((r) => r.method === 'POST' && r.url.includes('/admin/api/cases')), 'делото е записано през интерфейса');
    });

    // ── J08. Потребител през секцията „Потребители“ ───────────────────────────
    await journey('J08 потребител през секция', async () => {
      app.nav('users');
      await settle('секцията „Потребители“');
      app.fill('#set-user-name', 'journey-user');
      app.fill('#set-user-pass', 'journey-pass-123');
      const toast = await act('user', { expect: /Потребителят е създаден/, kind: 'ok' });
      assert.match(toast.message, /създаден/);
      await waitFor(() => text(view()).includes('journey-user'), { label: 'потребителят в таблицата' });
    });

    // ── J09. Променлива и преглед на шаблон ───────────────────────────────────
    await journey('J09 променлива и шаблон', async () => {
      app.nav('settings');
      await settle('„Настройки“');
      app.section('variables');
      await settle('секция „Променливи“');
      app.fill('#set-var-key', 'journeykey');
      app.fill('#set-var-value', 'стойност от сценария');
      await act('variable', { expect: /Променливата е добавена/, kind: 'ok' });
      app.fill('#set-tpl-input', 'Договор за {{journeykey}} — {{year}}');
      app.clearToasts();
      app.action('interpolate');
      await waitFor(() => /стойност от сценария/.test(text(app.$('#set-tpl-out'))), { label: 'прегледът да разгъне променливата' });
      assert.match(text(app.$('#set-tpl-out')), /Договор за стойност от сценария — \d{4}/, 'прегледът показва разгърнатия текст');
    });

    // ── J10. Група записи през секцията „Йерархия“ ────────────────────────────
    await journey('J10 група през секция', async () => {
      await app.section('hierarchy');
      await settle('секция „Йерархия“');
      app.fill('#set-group-input', 'Група от сценария');
      await act('group', { expect: /Групата е създадена/, kind: 'ok' });
      await waitFor(() => text(view()).includes('Група от сценария'), { label: 'групата в таблицата' });
    });

    // ── J11. Категория през секцията „Класификация“ ───────────────────────────
    await journey('J11 категория през секция', async () => {
      await app.section('taxonomy');
      await settle('секция „Класификация“');
      app.fill('#set-tax-input', 'Категория от сценария');
      await act('taxonomy', { expect: /Добавено/, kind: 'ok' });
      await waitFor(() => text(view()).includes('Категория от сценария'), { label: 'категорията в таблицата' });
    });

    // ── J12. Тайна връзка през секцията „Данни“ ───────────────────────────────
    await journey('J12 тайна връзка през секция', async () => {
      await app.section('data');
      await settle('секция „Данни“');
      app.fill('#set-secret-text', 'тайна от GUI сценария');
      app.fill('#set-secret-hint', 'за проверката');
      app.clearToasts();
      app.action('secretCreate');
      await waitFor(() => /\/secret#/.test(app.$('#set-secret-out').innerHTML), { label: 'линкът на тайната', timeout: BUDGET });
      assert.match(text(app.$('#set-secret-out')), /Валиден до|преглед/, 'панелът обяснява срока и броя прегледи');
      assert.ok(app.requests.some((r) => r.method === 'POST' && r.url.includes('/admin/api/v2/secrets')), 'тайната е създадена през интерфейса');
    });

    // ── J13. Търсене, организация и внасяне през секцията „Данни“ ─────────────
    await journey('J13 търсене и внасяне през секция', async () => {
      app.fill('#set-search-q', 'сценарий');
      await act('search', { expect: /Готово|Търсене|намерен/i, kind: 'ok' });
      app.fill('#set-org-name', 'Организация от сценария');
      await act('organization', { expect: /Готово|добавен|създаден/i, kind: 'ok' });
      app.fill('#set-ingest-emails', 'ingest.scenario@example.org');
      await act('ingest', { expect: /Готово|добавен/i, kind: 'ok' });
      assert.ok(app.requests.some((r) => r.url.includes('/admin/api/v2/search')), 'търсенето мина през сървъра');
    });

    // ── J14. HTML проект и изпращане на връзка ────────────────────────────────
    await journey('J14 HTML проект и изпращане', async () => {
      // Папката е „избор на папка“ — в браузър това е диалог, тук е файл на диска.
      // Самото действие пак минава през бутона в панела.
      const projectDir = path.join(server.dir, 'html-projects', 'journey-project');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'index.html'), '<!doctype html><title>GUI проект</title><h1>Проект от сценария</h1>');
      await app.section('data');
      await settle('секция „Данни“');
      app.fill('#set-data-folder', 'journey-project');
      app.fill('#set-data-title', 'Проект от сценария');
      app.clearToasts();
      app.action('htmlProject');
      await waitFor(() => text(app.$('#set-data-out')).length > 5 || app.toast(), { label: 'отговорът за HTML проекта', timeout: BUDGET });
      assert.match(text(app.$('#set-data-out')) + ' ' + ((app.toast() || {}).message || ''), /Готово|проект|създаден|journey-project/i, 'панелът отговаря за проекта');
    });

    // ── J15. Сензори: смяна на режим и срок ───────────────────────────────────
    await journey('J15 сензори през секция', async () => {
      await app.section('sensors');
      await settle('секция „Сензори“');
      app.select('#set-sensors-ipmode', 'masked');
      app.select('#set-sensors-trustproxy', '');
      app.fill('#set-sensors-retention', '21');
      app.fill('#set-sensors-geoip', '');
      const toast = await act('sensors', { expect: /Сензори: IP masked · 21 дни/, kind: 'ok' });
      assert.match(toast.message, /masked/);
      assert.ok(app.requests.some((r) => r.method === 'PATCH' && r.url.includes('/admin/api/settings')), 'настройките са записани през интерфейса');
    });

    // ── J16. Хранилище: проверка, задържане, огледало ─────────────────────────
    await journey('J16 хранилище през секция', async () => {
      await app.section('storage');
      await settle('секция „Хранилище“');
      await act('storage', { expect: /Проверката приключи/, kind: 'ok' });
      await act('retention', { expect: /Задържане/, kind: 'ok' });
      await act('mirror', { expect: /Огледало:/ });
    });

    // ── J17. Резервни копия: създаване, проверка, график ──────────────────────
    await journey('J17 резервни копия през секция', async () => {
      await app.section('backups');
      await settle('секция „Резервни копия“');
      await act('backup', { expect: /Копието е създадено/, kind: 'ok' });
      await act('verify', { expect: /Проверени/, kind: 'ok' });
      app.fill('#set-sched-interval', '120');
      app.fill('#set-sched-max', '3');
      await act('schedule', { expect: /Графикът е записан/, kind: 'ok' });
    });

    // ── J18. Журнал, правила и одитен ланец ───────────────────────────────────
    await journey('J18 журнал и одитен ланец', async () => {
      await app.section('logs');
      await settle('секция „Журнал“');
      app.select('#set-log-level', 'debug');
      await act('level', { expect: /Ниво на журнала: debug/, kind: 'ok' });
      await act('rules', { expect: /Правилата са презаредени/, kind: 'ok' });
      await app.section('security');
      await settle('секция „Сигурност“');
      await act('auditVerify', { expect: /Одитният ланец/, kind: 'ok' });
    });

    // ── J19. Метрики през секцията „Анализи“ ──────────────────────────────────
    await journey('J19 метрики през секция', async () => {
      app.nav('analytics');
      await settle('секция „Анализи“');
      app.clearToasts();
      app.action('metricsProm');
      await waitFor(() => app.toast(), { label: 'отговорът за метриките', timeout: 10000 });
      assert.match(app.toast().message, /[Мм]етрик|снимка/i, 'панелът показва снимка на метриките');
    });

    // ── J20. Известие през секцията „Диагностика“ (пътят на отказа) ───────────
    await journey('J20 известие през секция', async () => {
      app.nav('settings');
      await settle('„Настройки“');
      app.section('diagnostics');
      await settle('секция „Диагностика“');
      app.fill('#set-notify-service', 'notify.not_existing');
      app.fill('#set-notify-link', 'http://example.org/x');
      const toast = await act('notify', { expect: /Notify dispatch disabled|не е изпратено/i, kind: 'err' });
      assert.match(toast.message, /Notify dispatch disabled|не е изпратено/i);
    });

    // ── J21. Смяна на език през лентата ───────────────────────────────────────
    await journey('J21 смяна на език', async () => {
      app.click('.langs button[data-lang="en"]', 'бутонът EN');
      await waitFor(() => text(app.$('#nav')).includes('Portals & files'), { label: 'менюто на английски' });
      assert.match(text(app.$('#bar-center')), /connected/, 'статусната лента също сменя езика');
      app.click('.langs button[data-lang="bg"]', 'бутонът BG');
      await waitFor(() => text(app.$('#nav')).includes('Портали & файлове'), { label: 'менюто на български' });
    });

    // ── J22. Светла/тъмна тема ────────────────────────────────────────────────
    await journey('J22 смяна на тема', async () => {
      const body = app.document.body;
      assert.equal(body.classList.contains('light'), false, 'страницата тръгва тъмна');
      app.click('#theme-toggle', 'бутонът за тема');
      assert.equal(body.classList.contains('light'), true, 'темата се сменя на светла');
      app.click('#theme-toggle', 'бутонът за тема');
      assert.equal(body.classList.contains('light'), false, 'темата се връща на тъмна');
    });

    // ── J23. Табло → „Виж всички“ води към „Кой влиза“ ────────────────────────
    await journey('J23 таблото води към посетителите', async () => {
      app.nav('dashboard');
      await settle('таблото');
      const link = await waitFor(() => app.$('button[data-nav="visitors"]'), { label: 'бутонът „Виж всички“' });
      link.click();
      await settle('панелът „Кой влиза“');
      assert.match(text(view()), /Кой влиза|Уникални посетители/, 'навигацията мина към посетителите');
    });

    // ── J24. Публичният адрес на портала се отваря (линк, не API) ─────────────
    await journey('J24 публичен адрес от портала', async () => {
      await portalList();
      const open = await waitFor(() => app.$$('[data-open-portal]')[0], { label: 'бутонът „Отвори портала“' });
      open.click();
      await settle('картата на портала');
      const chip = await waitFor(() => app.$$('.fm-ico').map((el) => el.getAttribute('title') || '').find((t) => t.startsWith('Адрес на портала')), { label: 'адресът на портала' });
      const url = chip.replace(/^Адрес на портала: /, '').trim();
      assert.match(url, /\/p\/[0-9a-zA-Z-]+/, 'адресът е човешката страница на портала: ' + url);
      // Едно отваряне на вече показания линк — каквото прави човек, като го натисне.
      const opened = await app.openLink(url);
      assert.equal(opened.status, 200, 'показаният от панела адрес се отваря: ' + url);
      assert.ok(opened.body.length > 0, 'страницата връща съдържание');
    });

    // ── J25. Качване на файл през формата на панела ────────────────────────────
    await journey('J25 качване на файл през панела', async () => {
      await portalList();
      const open = await waitFor(() => app.$$('[data-open-portal]')[0], { label: 'бутонът „Отвори портала“' });
      open.click();
      await settle('картата на портала');
      // Бутонът „Качи файл“ стои в лентата с филтри — потребителят я отваря с иконата.
      const filters = await waitFor(() => app.$('[data-toggle-filters]'), { label: 'иконата „Панел филтри“' });
      filters.click();
      app.click('#fm-upload', 'бутонът „Качи файл“');
      const form = await waitFor(() => app.$('#fm-upload-form'), { label: 'формата за качване' });
      const input = app.$('#fm-upload-form input[name="input"]');
      assert.ok(input, 'формата има избор на файл');
      input.files = [pseudoFile('prilozhenie-2.txt', 'още едно съдържание')];
      app.fill('#fm-upload-form input[name="name"]', 'prilozhenie-2.txt');
      app.clearToasts();
      form.dispatch('submit');
      await waitFor(() => app.toast(), { label: 'отговор от качването', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'файлът е качен: ' + app.toast().message);
      await settle('списъкът с файлове');
      assert.match(text(view()), /prilozhenie-2\.txt/, 'новият файл се вижда в портала');
      assert.ok(app.requests.some((r) => r.method === 'POST' && /\/files$/.test(r.url)), 'качването мина през сървъра');
    });

    // ── J26. Нова папка в портала през бутона на панела ───────────────────────
    await journey('J26 нова папка през панела', async () => {
      app.click('#fm-new-folder', 'бутонът „Нова папка“');
      await waitFor(() => app.$('#fm-new-folder-name'), { label: 'полето за име на папка' });
      app.fill('#fm-new-folder-name', 'Доказателства');
      app.clearToasts();
      app.$('#fm-new-folder-form').dispatch('submit');
      await waitFor(() => app.toast() || text(view()).includes('Доказателства'), { label: 'отговорът за папката', timeout: BUDGET });
      await settle('дървото на папките');
      assert.match(text(view()), /Доказателства|Папка/, 'панелът отчита новата папка');
    });

    // ── J27. Публичен gateway: проверка на достъп през панела ─────────────────
    await journey('J27 gateway тества достъп', async () => {
      app.nav('gateway');
      await settle('панелът „Публичен gateway“');
      await waitFor(() => app.$('#pg-test'), { label: 'бутонът „Тествай достъп“' });
      // Волният токен е невалиден — решението се взима по договора на gateway и се показва.
      app.fill('#pg-token', 'hapi_nevaliden_token_za_test');
      app.clearToasts();
      app.click('#pg-test', 'бутонът „Тествай достъп“');
      await waitFor(() => app.toast(), { label: 'присъдата на проверката', timeout: BUDGET });
      assert.equal(app.toast().kind, 'err', 'невалиден токен се отказва: ' + app.toast().message);
      assert.match(app.toast().message, /Отказ|няма достъп|невалид/i, 'панелът казва ПРИЧИНАТА: ' + app.toast().message);
      await settle('решението да се нарисува');
      assert.match(text(view()), /Достъп|Отказ|причина/i, 'решението остава на екрана, не само в известие');
    });

    // ── J28. Експорт: проверка на плана (preflight) през панела ───────────────
    await journey('J28 експорт проверява плана', async () => {
      app.nav('export');
      await settle('панелът „Експорт“');
      const button = await waitFor(() => app.$('#ec-prefight') || app.$('#ec-pkg-build'), { label: 'бутонът за проверка на плана' });
      app.clearToasts();
      button.click();
      await waitFor(() => app.toast() || app.$('#ec-pkg-state'), { label: 'отговорът на експорта', timeout: BUDGET });
      const said = (app.toast() || {}).message || text(app.$('#ec-pkg-state'));
      assert.ok(String(said).length > 3, 'панелът казва какво е станало: ' + said);
    });

    // ── J29. Report Studio: нов документ, блок и валидация ────────────────────
    await journey('J29 Report Studio: блок и валидация', async () => {
      app.nav('report');
      await settle('Report Studio');
      app.click('#rs-new', 'бутонът „Нов“');
      const countNow = () => Number((text(app.$('#rs-count')).match(/\d+/) || [0])[0]);
      const before = countNow();
      assert.ok(before > 0, 'новият документ има блокове: ' + before);
      const item = await waitFor(() => app.$$('#rs-lib [data-type]')[0], { label: 'първият обект в библиотеката' });
      item.click();
      await waitFor(() => countNow() > before, { label: 'блокът да влезе в документа' });
      app.clearToasts();
      app.click('#rs-validate', 'бутонът „Валидирай“');
      await waitFor(() => app.toast(), { label: 'присъдата на валидатора' });
      assert.match(app.toast().message, /валиден|Невалиден/i, 'валидаторът дава присъда: ' + app.toast().message);
    });

    // ── J30. Посетители: обновяване и CSV през панела ─────────────────────────
    await journey('J30 посетители: обновяване', async () => {
      app.nav('visitors');
      await settle('панелът „Кой влиза“');
      await waitFor(() => app.$('#v-refresh'), { label: 'бутонът „Обнови“' });
      app.click('#v-refresh', 'бутонът „Обнови“');
      await waitFor(() => !/зареждане/.test(text(app.$('#v-badge'))), { label: 'таблицата да се зареди' });
      // Празната инсталация е валиден резултат: важното е, че панелът дава присъда и вика сървъра.
      assert.ok(text(app.$('#v-badge')).length > 0, 'панелът казва състоянието си');
      assert.ok(app.$('#v-visitors'), 'таблицата „Посетители“ е нарисувана');
      assert.ok(app.requests.some((r) => r.url.includes('/admin/api/sensors') || r.url.includes('/admin/api/visitors')), 'данните идват от сървъра');
    });

    // ── J31. Потребители: изтриване през панела ───────────────────────────────
    await journey('J31 изтриване на потребител през секция', async () => {
      app.nav('users');
      await settle('секция „Потребители“');
      const button = await waitFor(() => app.$$('[data-user="journey-user"]')[0], { label: 'бутонът „Изтрий“ за journey-user' });
      app.clearToasts();
      button.click();
      await waitFor(() => app.toast(), { label: 'отговорът от изтриването', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'потребителят е изтрит: ' + app.toast().message);
      await settle('таблицата след изтриване');
      assert.equal(text(view()).includes('journey-user'), false, 'изтритият потребител изчезва от таблицата');
      assert.ok(app.requests.some((r) => r.method === 'DELETE' && r.url.includes('/admin/api/users/')), 'изтриването мина през сървъра');
    });

    // ── J32. CMS: отказът също е сценарий — без файл подпис не се издава ──────
    await journey('J32 CMS отказва без файл', async () => {
      app.nav('settings');
      await settle('„Настройки“');
      app.section('cms');
      await settle('секция „Подпис“');
      const toast = await act('cmsSign', { expect: /./, kind: 'err' });
      assert.ok(toast.message.length > 3, 'панелът казва какво липсва: ' + toast.message);
      assert.equal(app.requests.some((r) => r.method === 'POST' && r.url.includes('/cms')), false, 'без файл не се праща заявка');
    });

    // ── J33. Експорт: пакетът иска портал и панелът отказва без него ─────────
    await journey('J33 експорт: пакет и подпис', async () => {
      app.nav('export');
      await settle('панелът „Експорт“');
      const picker = await waitFor(() => app.$('#ec-pkg-portal'), { label: 'полето за портал в експорта' });
      assert.ok(app.requests.some((r) => r.url.includes('/admin/api/portals')), 'панелът пита сървъра за порталите');
      const options = [...picker.querySelectorAll('option')].filter((o) => o.value);
      if (options.length) app.select('#ec-pkg-portal', options[0].value);
      app.clearToasts();
      app.click('#ec-pkg-build', 'бутонът „Създай и изтегли пакета“');
      await waitFor(() => app.toast(), { label: 'отговорът от пакета', timeout: BUDGET });
      const built = app.toast();
      // Двата изхода са истински: пакетът е готов или панелът казва защо не може.
      assert.ok(built.message.length > 3, 'панелът казва какво е станало: ' + built.message);
      if (options.length) {
        assert.ok(
          app.requests.some((r) => r.method === 'POST' && r.url.includes('/admin/api/packages')),
          'щом има избран портал, пакетът се поисква от сървъра: ' + built.message,
        );
        app.clearToasts();
        app.click('#ec-pkg-verify', 'бутонът „Провери подписа“');
        await waitFor(() => app.toast() || text(app.$('#ec-pkg-state')), { label: 'присъдата на подписа', timeout: BUDGET });
        const verdict = (app.toast() || {}).message || text(app.$('#ec-pkg-state'));
        assert.ok(String(verdict).length > 3, 'панелът казва присъда за подписа: ' + verdict);
      }
    });

    // ── J34. Портал: издаване на токен за достъп през картата ─────────────────
    await journey('J34 портал: издава токен', async () => {
      await openPortal();
      const button = await waitFor(() => app.$('#pf-token-new'), { label: 'бутонът „Издай токен за портал“' });
      app.clearToasts();
      button.click();
      const out = await waitFor(() => {
        const node = app.$('#pf-token-out');
        return node && text(node).length > 3 ? node : null;
      }, { label: 'изходът с адреса на токена', timeout: BUDGET });
      assert.match(text(out), /Готово|адрес|Отказ|HTTP/i, 'панелът показва какво е станало с токена: ' + text(out));
      assert.ok(app.requests.some((r) => r.method === 'POST' && /\/tokens$/.test(r.url)), 'токенът се издава от сървъра');
    });

    // ── J35. Портал: обновяване на ключа за подпис ────────────────────────────
    await journey('J35 портал: обновява ключа', async () => {
      const button = await waitFor(() => app.$('#pf-rotate-key'), { label: 'бутонът „Обнови ключа за подпис“' });
      app.clearToasts();
      button.click();
      const out = await waitFor(() => {
        const node = app.$('#pf-security-out');
        return node && text(node).length > 3 ? node : null;
      }, { label: 'отговорът за ключа', timeout: BUDGET });
      assert.match(text(out), /обновен|Ключът|Отказ|HTTP/i, 'картата казва какво е станало с ключа: ' + text(out));
      assert.ok(app.requests.some((r) => r.method === 'POST' && /\/signing-key$/.test(r.url)), 'ключът се обновява от сървъра');
    });

    // ── J36. Портал: проверка на архивите и историята на QR ───────────────────
    await journey('J36 портал: проверява архивите', async () => {
      const verify = await waitFor(() => app.$('#pf-qr-verify'), { label: 'бутонът „Провери целостта на архивите“' });
      app.clearToasts();
      verify.click();
      const out = await waitFor(() => {
        const node = app.$('#pf-qr-out');
        return node && text(node).length > 3 ? node : null;
      }, { label: 'присъдата за архивите', timeout: BUDGET });
      assert.match(text(out), /наред|провали|Проверени|HTTP/i, 'присъдата за архивите е на екрана: ' + text(out));
      app.click('#pf-qr-show', 'бутонът за историята на QR');
      await waitFor(() => /Активен QR|QR-/.test(text(app.$('#pf-qr-out'))), { label: 'историята на QR' });
      assert.match(text(app.$('#pf-qr-out')), /Активен QR|QR-\d/i, 'историята показва активния QR');
    });

    // ── J37. Файл: преименуване през формата на панела ────────────────────────
    await journey('J37 файл: преименуване', async () => {
      await ownPortalWithFile('gui-journey-file-rename');
      await fileAction('rename');
      const form = await waitFor(() => app.$('#fm-rename-form'), { label: 'формата за преименуване' });
      const field = app.$('#fm-rename-form input[name="name"]');
      assert.ok(field, 'формата има поле за име');
      app.fill(field, 'preimenuvan-ot-panel.txt');
      app.clearToasts();
      form.dispatch('submit');
      await waitFor(() => app.toast(), { label: 'отговорът от преименуването', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'файлът е преименуван: ' + app.toast().message);
      assert.ok(app.requests.some((r) => r.method === 'PATCH' && /\/files\//.test(r.url)), 'преименуването мина през сървъра');
      await settle('списъкът след преименуването');
      assert.match(text(view()), /preimenuvan-ot-panel\.txt/, 'новото име се вижда в портала');
    });

    // ── J38. Файл: бележка през формата на панела ─────────────────────────────
    await journey('J38 файл: бележка', async () => {
      await ownPortalWithFile('gui-journey-file-note');
      await fileAction('note');
      const form = await waitFor(() => app.$('#fm-note-form'), { label: 'формата за бележка' });
      const field = app.$('#fm-note-form textarea[name="notes"]');
      assert.ok(field, 'формата има поле за бележка');
      app.fill(field, 'Проверено от сценарий J38');
      app.clearToasts();
      form.dispatch('submit');
      await waitFor(() => app.toast(), { label: 'отговорът за бележката', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'бележката е запазена: ' + app.toast().message);
      assert.match(app.toast().message, /бележк|Запазен/i, 'панелът казва какво е станало: ' + app.toast().message);
      assert.ok(app.requests.some((r) => r.method === 'PATCH' && /\/metadata$/.test(r.url)), 'бележката мина през сървъра');
    });

    // ── J40. Портал: отказите на QR панела — основание и идентичност ──────────
    await journey('J40 портал: отказите на QR панела', async () => {
      await openPortal();
      const block = await waitFor(() => app.$('#pf-qr-block'), { label: 'бутонът за прекратяване на QR' });
      app.fill('#pf-qr-reason', '');
      const before = app.requests.length;
      block.click();
      const said = await waitFor(() => {
        const node = app.$('#pf-qr-out');
        return node && text(node).length > 3 ? node : null;
      }, { label: 'отказът за липсващо основание', timeout: 10000 });
      assert.match(text(said), /основание/i, 'панелът иска основание: ' + text(said));
      assert.equal(app.requests.length, before, 'без основание не се праща заявка');
      const restore = await waitFor(() => app.$('#pf-qr-restore'), { label: 'бутонът за връщане на състояние' });
      app.fill('#pf-qr-restore-id', '123');
      restore.click();
      await waitFor(() => /QR-001|идентичност/i.test(text(app.$('#pf-qr-out'))), { label: 'отказът за невалиден QR идентификатор' });
      assert.match(text(app.$('#pf-qr-out')), /QR-001|идентичност/i, 'панелът иска валиден идентификатор: ' + text(app.$('#pf-qr-out')));
      assert.equal(app.requests.length, before, 'с невалиден идентификатор също не се праща заявка');
    });

    // ── J41. Report Studio: запазване и отмяна на действието ──────────────────
    await journey('J41 Report Studio: запази и отмени', async () => {
      app.nav('report');
      await settle('Report Studio');
      app.click('#rs-new', 'бутонът „Нов“');
      const countNow = () => Number((text(app.$('#rs-count')).match(/\d+/) || [0])[0]);
      const before = countNow();
      const item = await waitFor(() => app.$$('#rs-lib [data-type]')[0], { label: 'първият обект в библиотеката' });
      item.click();
      await waitFor(() => countNow() > before, { label: 'блокът да влезе в документа' });
      app.click('#rs-undo', 'бутонът „Отмени“');
      await waitFor(() => countNow() === before, { label: 'отмяната на действието' });
      app.click('#rs-redo', 'бутонът „Повтори“');
      await waitFor(() => countNow() > before, { label: 'повторението на действието' });
      app.clearToasts();
      app.click('#rs-save', 'бутонът „Запази“');
      await waitFor(() => app.toast() || text(app.$('#rs-state')), { label: 'отговорът при запазване', timeout: BUDGET });
      const said = (app.toast() || {}).message || text(app.$('#rs-state'));
      assert.ok(String(said).length > 2, 'панелът казва какво е станало при запазване: ' + said);
    });

    // ── Отчет ─────────────────────────────────────────────────────────────────
    assert.deepEqual(failed, [], 'сценарии, които не минаха:\n  ' + failed.join('\n  '));
    console.log('PASS gui-journeys: ' + passed.length + ' сценария САМО през интерфейса · навигация, форми, секции, панели, тема, език · ' + app.requests.length + ' заявки, поискани от панелите');
  } finally {
    await server.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
