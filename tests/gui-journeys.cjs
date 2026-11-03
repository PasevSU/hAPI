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

(async () => {
  // `startServer` дава и `api`, но той НЕ се използва никъде по-долу — единственият
  // достъп до add-on-а е през `app` (DOM). Проверява се от `gui-only-guard.cjs`.
  const server = await startServer();
  const app = mountApp(server);
  const view = () => app.view();
  const passed = [];
  const failed = [];

  /** Чака изгледът да спре да казва „Зареждам…“ — панелите работят асинхронно. */
  const settle = (label, timeout = 15000) =>
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
      await waitFor(() => app.toast(), { label: 'отговор от създаването на портал', timeout: 15000 });
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
      await waitFor(() => app.toast(), { label: 'отговор от създаването', timeout: 20000 });
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
      await waitFor(() => text(view()).includes('Иван Сценариев'), { label: 'контактът да се появи в списъка', timeout: 15000 });
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
      await waitFor(() => text(view()).includes('GUI-J-2026-002'), { label: 'делото да се появи в списъка', timeout: 15000 });
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
      await waitFor(() => /\/secret#/.test(app.$('#set-secret-out').innerHTML), { label: 'линкът на тайната', timeout: 15000 });
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
      await waitFor(() => text(app.$('#set-data-out')).length > 5 || app.toast(), { label: 'отговорът за HTML проекта', timeout: 15000 });
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

    // ── Отчет ─────────────────────────────────────────────────────────────────
    assert.deepEqual(failed, [], 'сценарии, които не минаха:\n  ' + failed.join('\n  '));
    console.log('PASS gui-journeys: ' + passed.length + ' сценария САМО през интерфейса · навигация, форми, секции, тема, език · ' + app.requests.length + ' заявки, поискани от панелите');
  } finally {
    await server.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
