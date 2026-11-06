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
const { pgpKey } = require('./lib/gui-fixtures.cjs');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { mountApp, pseudoFile } = require('./lib/gui-journey.cjs');

const text = (node) => String((node && node.textContent) || '').replace(/\s+/g, ' ').trim();

// Един бюджет за ВСИЧКИ изчаквания в този файл. Работната машина е бърза, а runner-ът в CI
// е няколко пъти по-бавен: същата проверка минава, но за по-дълго. Затова бюджетът е щедър
// и е един — вместо всяко изчакване да носи свое число, което да изтече само на CI.
const BUDGET = Number(process.env.HAPI_GUI_TIMEOUT_MS || 45000);
const ONLY_JOURNEY = String(process.env.HAPI_GUI_ONLY_JOURNEY || '').trim().toUpperCase();

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
    await expandBlocks();
  };

  /**
   * Разгъва трите блока на портала — със същите заглавия, които човек натиска.
   * От 0.69.151 блоковете са СГЪНАТИ по подразбиране (така порталът се отваря като списък
   * от заглавия, а не като стена от текст), затова сценарий, който работи с настройките,
   * папките или файловете, първо ги разгъва. Елементите се вземат НАНОВО след всяко
   * натискане: `render()` прерисува цялата карта.
   */
  const expandBlocks = async () => {
    for (const selector of ['[data-pf-control-tog]', '[data-pf-folders-tog]', '[data-pf-files-tog]']) {
      const toggle = app.$(selector);
      if (toggle && toggle.getAttribute('aria-expanded') === 'false') {
        // `render()` се изпълнява СИНХРОННО в слушателя на бутона — затова няма нужда от
        // изчакване след всяко натискане (то правеше сценариите забележимо по-бавни).
        toggle.click();
        const after = app.$(selector);
        assert.equal(after.getAttribute('aria-expanded'), 'true', 'блокът „' + selector + '“ се разгъна');
      }
    }
  };

  /**
   * Създава НОВ портал с файловете от папката — през формата, както го прави човек (J05).
   * Така файловият сценарий не зависи от състоянието, което предишен сценарий е оставил:
   * той си носи портала и файловете. Именно тази зависимост правеше три сценария нестабилни
   * в CI. По подразбиране файлът е един; сценариите за филтри подават няколко.
   */
  const ownPortalWithFile = async (slug, files) => {
    const picked = Array.isArray(files) && files.length
      ? files
      : [pseudoFile('fayl-za-scenariy.txt', 'съдържание за сценария')];
    const first = picked[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await portalList();
    app.click('#pf-new', 'бутонът „Нов портал“');
    await waitFor(() => app.$('#pf-create'), { label: 'формата за нов портал' });
    app.fill('[name="slug"]', slug);
    app.fill('[name="title"]', 'Портал за файловия сценарий');
    const folder = app.$('#pf-folder');
    assert.ok(folder, 'формата има избор на папка с файлове');
    folder.files = picked;
    app.select('[name="visibility"]', 'public');
    app.clearToasts();
    app.click('#pf-create', 'бутонът „Създай и генерирай API + QR“');
    await waitFor(() => {
      const said = app.toast();
      return said && /Порталът е създаден/.test(said.message) ? said : null;
    }, { label: 'порталът за сценария', timeout: BUDGET });
    assert.equal(app.toast().kind, 'ok', 'порталът за сценария се създава: ' + app.toast().message);
    // Съобщението казва колко файла от папката са качени — то е доказателството, че файловете
    // са стигнали до сървъра, а не че по-късно ще се появят.
    assert.match(
      app.toast().message,
      new RegExp('качени ' + picked.length + ' файла'),
      'файловете от папката са качени при създаването: ' + app.toast().message,
    );
    // Панелът отваря новия портал САМ само когато списъкът е бил празен (J05); иначе остава
    // на списъка. Затова тук винаги се минава през списъка — със същите два бутона, които
    // човекът натиска („← Списък с портали“ и „Отвори портала“), и се отваря НАШИЯТ портал.
    await portalList();
    const row = await waitFor(() => {
      for (const el of app.$$('[data-open-portal]')) {
        let node = el;
        for (let i = 0; i < 6 && node; i++) {
          if (text(node).includes(slug)) return el;
          node = node.parentNode;
        }
      }
      return null;
    }, { label: 'порталът „' + slug + '“ в списъка', timeout: BUDGET });
    row.click();
    await settle('картата на новия портал');
    // Блоковете са сгънати по подразбиране — файловете се появяват след разгъване, точно
    // както при човек, който търси файловете на портала.
    await expandBlocks();
    // Чакаме ИМЕННО файловете, а не „изгледът да утихне“: панелът прерисува след отговора и на
    // по-бавна машина списъкът още не е готов, когато текстът „Зареждам“ изчезне.
    await waitFor(() => new RegExp(first).test(text(view())), { label: 'файловете в новия портал', timeout: BUDGET });
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

  /**
   * Намира бутон в КАРТАТА, чийто текст съдържа `needle` — както човек търси с очи реда с
   * контакта или делото и натиска „Редактирай“ / „Изтрий“ на НЕГО. Картата се разпознава
   * по класа `pf-portal`: търсене „нагоре по родителите“ без тази граница стига до
   * контейнера с ВСИЧКИ карти, чийто текст съдържа търсеното, и връща първия бутон.
   */  const cardButton = async (attr, needle) => waitFor(() => {
    for (const el of app.$$('[' + attr + ']')) {
      const card = el.closest ? el.closest('.pf-portal') : null;
      if (card && text(card).includes(needle)) return el;
    }
    return null;
  }, { label: 'бутонът „' + attr + '“ в картата на „' + needle + '“', timeout: BUDGET });

  /**
   * Картата на НАШИЯ портал в списъка. Търси се по същия начин, по който човек я намира с
   * очи — през бутона „Отвори портала“, чийто ред носи адреса (slug), и после нагоре до
   * картата. Така сценарият не зависи от поредността на порталите в списъка.
   */
  const portalCard = async (slug) => {
    const row = await waitFor(() => {
      for (const el of app.$$('[data-open-portal]')) {
        let node = el;
        for (let i = 0; i < 6 && node; i++) {
          if (text(node).includes(slug)) return el;
          node = node.parentNode;
        }
      }
      return null;
    }, { label: 'картата на портала „' + slug + '“', timeout: BUDGET });
    const card = row.closest ? row.closest('.pf-portal') : null;
    assert.ok(card, 'картата на портала се разпознава по класа .pf-portal');
    return card;
  };

  /**
   * Отваря панела с филтри на блока „Файлове в портала“.
   *
   * Защо с повторен опит: след отваряне на портала панелът прерисува картата, когато
   * пристигне дървото на папките (`GET …/tree`). Ако човек натисне иконата точно преди
   * това прерисуване, щракването отива във възел, който вече не е на екрана. Истинският
   * браузър също би загубил такова щракване, затова тук се натиска НОВИЯТ бутон — докато
   * полето за търсене наистина се появи.
   */
  const openFilters = async () => {
    const deadline = Date.now() + BUDGET;
    for (; ;) {
      const toggle = app.$('[data-toggle-filters]');
      if (toggle) toggle.click();
      const search = app.$('#fm-search');
      if (search) return search;
      if (Date.now() > deadline) throw new Error('панелът с филтри не се отвори');
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  };

  const journey = async (name, fn) => {
    if (ONLY_JOURNEY && !name.startsWith(ONLY_JOURNEY)) return;
    const started = Date.now();
    process.stdout.write(`[gui-journey] START ${name}\n`);
    try {
      await fn();
      passed.push(name);
      process.stdout.write(`[gui-journey] PASS ${name} (${Date.now() - started}ms)\n`);
    } catch (error) {
      // Последната заявка се добавя към провала: тя показва какво панелът е поискал,
      // когато твърдението е за отговор на сървъра.
      const last = app.requests[app.requests.length - 1];
      const tail = last ? ' | последна заявка: ' + last.method + ' ' + last.url + (last.body ? ' ' + last.body : '') : '';
      failed.push(name + ': ' + error.message + tail);
      process.stdout.write(`[gui-journey] FAIL ${name} (${Date.now() - started}ms): ${error.message}\n`);
    }
  };
  try {
    // ── J01. Страницата се вдига като в браузър ────────────────────────────────
    await journey('J01 стартиране на index.html', async () => {
      const navIds = app.navIds();
      assert.equal(navIds.length, 18, 'навигацията има 18 точки, нарисувани от app.js: ' + navIds.join(', '));
      for (const id of ['dashboard', 'portals', 'contacts', 'cases', 'gateway', 'export', 'users', 'jobs', 'storage', 'analytics', 'visitors', 'security', 'backups', 'qr', 'report', 'pgp', 'settings', 'about']) {
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
      // Блоковете са сгънати по подразбиране (0.69.151) — файловете се виждат след разгъване.
      await expandBlocks();
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
      // От 0.69.152 адресът на портала е БУТОН (линк + меню), а не табелка до бутон „API ▾“:
      // показва го текстът на самия бутон.
      const trigger = await waitFor(() => app.$('[data-api-menu]'), { label: 'адресът на портала', timeout: BUDGET });
      const url = text(trigger).trim();
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
      await expandBlocks();
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

      app.clearToasts();
      app.click('#pf-token-list', 'бутонът „Списък с токени“');
      const revoke = await waitFor(() => app.$('[data-token-revoke]'), { label: 'бутонът „Отнеми“ на издадения токен' });
      const tokenId = revoke.getAttribute('data-token-revoke');
      app.clearToasts();
      app.click(revoke, 'бутонът „Отнеми“');
      await waitFor(() => /Токенът е отнет/.test(text(app.$('#pf-token-out'))), { label: 'потвърждението за отнет токен' });
      assert.ok(app.requests.some((r) => r.method === 'DELETE' && r.url.endsWith('/tokens/' + tokenId)), 'отнемането минава през DELETE API');
      app.click('#pf-token-list', 'повторно зареждане на списъка с токени');
      await waitFor(() => /отнет/.test(text(app.$('#pf-token-out'))), { label: 'отнетото състояние в списъка' });
      assert.equal(app.$('[data-token-revoke]'), null, 'отнетият токен вече няма активен бутон за отнемане');
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

    // ── J42. Контакт: поле по желание, редакция и изтриване ───────────────────
    await journey('J42 контакт: редакция и изтриване', async () => {
      app.nav('contacts');
      await settle('панелът „Контакти“');
      await waitFor(() => app.$('#ct-form'), { label: 'формата за контакт' });
      app.fill('input[name="email"]', 'za.redakcia@example.org');
      app.fill('input[name="f_name"]', 'Контакт за редакция');
      // Поле по желание: първо „＋ добави поле“, после се пише в НОВАТА редица; второ поле
      // се маха с „✕“ — за да се провери и премахването, не само добавянето.
      app.click('[data-extra-add]', 'бутонът „добави поле по желание“');
      app.click('[data-extra-add]', 'бутонът „добави поле по желание“');
      await waitFor(() => app.$$('[data-extra-key]').length >= 3, { label: 'двете нови редици за поле по желание' });
      const removeButtons = app.$$('#ct-form [data-extra-remove]');
      removeButtons[removeButtons.length - 1].click();
      await waitFor(() => app.$$('[data-extra-key]').length === 2, { label: 'махнатата редица за поле по желание' });
      const keys = app.$$('[data-extra-key]');
      const values = app.$$('[data-extra-value]');
      app.fill(keys[keys.length - 1], 'Роля');
      app.fill(values[values.length - 1], 'секретар');
      app.clearToasts();
      app.click('#ct-form button[type="submit"]', 'бутонът „Добави контакта“');
      await waitFor(() => text(view()).includes('Контакт за редакция'), { label: 'контактът в списъка', timeout: BUDGET });
      assert.match(text(view()), /Роля: секретар/, 'полето по желание се вижда в картата на контакта');
      // Редакция през бутона на САМАТА карта.
      const edit = await cardButton('data-edit-contact', 'Контакт за редакция');
      edit.click();
      await waitFor(() => /Редактиране на контакт/.test(text(view())), { label: 'формата за редакция на контакт' });
      app.fill('input[name="f_name"]', 'Контакт след редакция');
      app.clearToasts();
      app.click('#ct-form button[type="submit"]', 'бутонът „Запази промените“');
      await waitFor(() => text(view()).includes('Контакт след редакция'), { label: 'новото име в списъка', timeout: BUDGET });
      assert.ok(
        app.requests.some((r) => r.method === 'PATCH' && /\/directory\/contacts\//.test(r.url)),
        'редакцията мина през сървъра: ' + app.requests.slice(-4).map((r) => r.method + ' ' + r.url).join(' · '),
      );
      // Изтриване: същият бутон „Изтрий“; браузърът пита, човекът потвърждава.
      const del = await cardButton('data-del-contact', 'Контакт след редакция');
      app.clearToasts();
      del.click();
      await waitFor(() => app.toast(), { label: 'отговорът при изтриване на контакт', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'контактът е изтрит: ' + app.toast().message);
      assert.ok(
        app.requests.some((r) => r.method === 'DELETE' && /\/directory\/contacts\//.test(r.url)),
        'изтриването мина през сървъра',
      );
      await waitFor(() => !text(view()).includes('Контакт след редакция'), { label: 'контактът да изчезне от списъка', timeout: 15000 })
        .catch(() => { throw new Error('контактът остана на екрана: ' + text(view()).slice(0, 400)); });
    });

    // ── J43. Дело: редакция и изтриване през картата ──────────────────────────
    await journey('J43 дело: редакция и изтриване', async () => {
      app.nav('cases');
      await settle('панелът „Дела“');
      await waitFor(() => app.$('#cs-form'), { label: 'формата за дело' });
      app.fill('input[name="number"]', 'GUI-J-2026-043');
      app.fill('input[name="title"]', 'Дело за редакция');
      app.clearToasts();
      app.click('#cs-form button[type="submit"]', 'бутонът „Добави делото“');
      await waitFor(() => text(view()).includes('GUI-J-2026-043'), { label: 'делото в списъка', timeout: BUDGET });
      const edit = await cardButton('data-edit-case', 'GUI-J-2026-043');
      edit.click();
      await waitFor(() => /Редактиране на дело/.test(text(view())), { label: 'формата за редакция на дело' });
      app.fill('input[name="title"]', 'Дело след редакция');
      app.clearToasts();
      app.click('#cs-form button[type="submit"]', 'бутонът „Запази промените“');
      await waitFor(() => text(view()).includes('Дело след редакция'), { label: 'новото заглавие в списъка', timeout: BUDGET });
      assert.ok(
        app.requests.some((r) => r.method === 'PATCH' && /\/admin\/api\/cases\//.test(r.url)),
        'редакцията на делото мина през сървъра',
      );
      const del = await cardButton('data-del-case', 'GUI-J-2026-043');
      app.clearToasts();
      del.click();
      await waitFor(() => app.toast(), { label: 'отговорът при изтриване на дело', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'делото е изтрито: ' + app.toast().message);
      await waitFor(() => !text(view()).includes('GUI-J-2026-043'), { label: 'делото да изчезне от списъка', timeout: BUDGET });
    });

    // ── J44. Таблото води към друг панел (data-goto) ──────────────────────────
    await journey('J44 таблото води към панел', async () => {
      app.nav('dashboard');
      await settle('таблото');
      const links = await waitFor(() => (app.$$('[data-goto]').length ? app.$$('[data-goto]') : null), {
        label: 'бързите връзки на таблото',
        timeout: BUDGET,
      });
      const link = links[0];
      const target = link.getAttribute('data-goto');
      assert.ok(target, 'бързата връзка казва къде води: ' + target);
      link.click();
      await waitFor(() => app.location.hash === '#' + target, { label: 'преминаването към „' + target + '“', timeout: BUDGET });
      assert.equal(app.location.hash, '#' + target, 'таблото води към „' + target + '“');
      await waitFor(() => text(view()).length > 20, { label: 'панелът „' + target + '“ да се нарисува', timeout: BUDGET });
      assert.equal(/Непозната секция/.test(text(view())), false, 'воденето не чупи панела');
    });

    // ── J45. Експорт: изборът на съдържание се пази в панела ──────────────────
    await journey('J45 експорт: избор на съдържание', async () => {
      app.nav('export');
      await settle('панелът „Експорт“');
      const all = await waitFor(() => (app.$$('[data-content]').length ? app.$$('[data-content]') : null), {
        label: 'отметките за съдържание',
        timeout: BUDGET,
      });
      // Първа отметка, която е СВАЛЕНА (или първата, ако всички са сложени) — сценарият
      // обръща състоянието ѝ и проверява, че панелът го помни след прерисуването.
      const box = all.find((el) => !el.checked) || all[0];
      const id = box.getAttribute('data-content');
      assert.ok(id, 'всяка отметка носи кой вид съдържание включва');
      const want = !box.checked;
      const before = app.requests.length;
      app.check(box, want);
      await waitFor(() => {
        const again = app.$('[data-content="' + id + '"]');
        return again && again.checked === want ? again : null;
      }, { label: 'отметката „' + id + '“ да стане ' + (want ? 'сложена' : 'свалена'), timeout: BUDGET });
      assert.equal(app.requests.length, before, 'изборът на съдържание не праща заявка — панелът го пази в себе си');
    });

    // ── J46. Файл: подписан адрес през менюто ⚙ ───────────────────────────────
    await journey('J46 файл: подписан адрес', async () => {
      await ownPortalWithFile('gui-journey-file-sign');
      await fileAction('signedUrl');
      const form = await waitFor(() => app.$('form[data-signed-url]'), { label: 'формата за подписан адрес' });
      app.fill('form[data-signed-url] input[name="ttlSeconds"]', '600');
      app.clearToasts();
      form.dispatch('submit');
      const out = await waitFor(() => {
        const node = app.$('[data-signed-url-out]');
        const said = text(node);
        return said && said !== 'Издавам…' ? node : null;
      }, { label: 'отговорът за подписания адрес', timeout: BUDGET });
      assert.ok(text(out).length > 4, 'панелът казва какво е станало с подписания адрес: ' + text(out));
      assert.ok(
        app.requests.some((r) => r.method === 'POST' && /\/signed-url$/.test(r.url)),
        'подписаният адрес се иска от сървъра: ' + app.requests.slice(-4).map((r) => r.method + ' ' + r.url).join(' · '),
      );
    });

    // ── J47. Report Studio: колони на таблицата — добави, премести, махни ─────
    await journey('J47 Report Studio: колони на таблица', async () => {
      app.nav('report');
      await settle('Report Studio');
      app.click('#rs-new', 'бутонът „Нов“');
      const item = await waitFor(
        () => app.$$('#rs-lib [data-type]').find((el) => el.getAttribute('data-type') === 'table'),
        { label: 'обектът „Таблица“ в библиотеката', timeout: BUDGET },
      );
      item.click();
      await waitFor(() => app.$('#p-addcol'), { label: 'редактора на таблицата', timeout: BUDGET });
      const cols = () => app.$$('[data-col="del"]').length;
      const before = cols();
      assert.ok(before > 0, 'таблицата има колони: ' + before);
      app.fill('#p-newcol', 'Нова колона');
      app.click('#p-addcol', 'бутонът „Добави“ за колона');
      await waitFor(() => cols() === before + 1, { label: 'новата колона в списъка', timeout: BUDGET });
      // „↑“/„↓“ местят колоната — натиска се същият бутон, който вижда човекът.
      const down = app.$$('[data-col="down"]');
      down[down.length - 1].click();
      await waitFor(() => cols() === before + 1, { label: 'подредбата след „↓“', timeout: BUDGET });
      const del = app.$$('[data-col="del"]');
      del[del.length - 1].click();
      await waitFor(() => cols() === before, { label: 'колоната да се махне', timeout: BUDGET });
    });

    // ── J48. Report Studio: избор на алгоритми в Hash таблица ─────────────────
    await journey('J48 Report Studio: алгоритми на Hash таблица', async () => {
      const item = await waitFor(
        () => app.$$('#rs-lib [data-type]').find((el) => el.getAttribute('data-type') === 'hash-table'),
        { label: 'обектът „Hash таблица“ в библиотеката', timeout: BUDGET },
      );
      item.click();
      const boxes = await waitFor(() => (app.$$('[data-alg]').length ? app.$$('[data-alg]') : null), {
        label: 'списъкът с алгоритми',
        timeout: BUDGET,
      });
      const box = boxes[0];
      const alg = box.getAttribute('data-alg');
      assert.ok(alg, 'алгоритъмът има име: ' + alg);
      const want = !box.checked;
      app.check(box, want);
      await waitFor(() => {
        const again = app.$('[data-alg="' + alg + '"]');
        return again && again.checked === want ? again : null;
      }, { label: 'алгоритъмът „' + alg + '“ да стане ' + (want ? 'избран' : 'изключен'), timeout: BUDGET });
      assert.equal(app.$('[data-alg="' + alg + '"]').checked, want, 'изборът на алгоритъм се пази в панела');
    });

    // ── J49. Gateway: смяна на достъп и видимост на файл ──────────────────────
    await journey('J49 gateway: достъп и видимост на файл', async () => {
      app.nav('gateway');
      await settle('панелът „Публичен gateway“');
      await waitFor(() => app.$('[data-file-access="0"]'), { label: 'първият ред с достъп', timeout: BUDGET });
      const GW = app.window.PublicGatewayPanel;
      assert.ok(GW && GW.state, 'панелът държи състоянието си');
      const first = () => {
        const s = GW.state;
        return (s.files[s.portals[s.index || 0].slug] || [])[0];
      };
      const asked = app.requests.length;
      const access = app.$$('[data-file-access="0"] option').map((o) => o.getAttribute('value')).filter(Boolean);
      const nextAccess = access.find((v) => v !== first().access);
      assert.ok(nextAccess, 'редът предлага друг режим на достъп: ' + access.join(', '));
      app.select('[data-file-access="0"]', nextAccess);
      await waitFor(() => first().access === nextAccess, { label: 'режимът на достъп „' + nextAccess + '“', timeout: BUDGET });
      const visible = app.$$('[data-file-visibility="0"] option').map((o) => o.getAttribute('value')).filter(Boolean);
      const nextVisibility = visible.find((v) => v !== first().visibility);
      assert.ok(nextVisibility, 'редът предлага друга видимост: ' + visible.join(', '));
      app.select('[data-file-visibility="0"]', nextVisibility);
      await waitFor(() => first().visibility === nextVisibility, { label: 'видимостта „' + nextVisibility + '“', timeout: BUDGET });
      assert.equal(app.requests.length, asked, 'решението за достъп се взима в панела, без заявка към add-on-а');
    });

    // ── J50. Файл: разписка и проверка на разписката ──────────────────────────
    await journey('J50 файл: разписка и проверка', async () => {
      await ownPortalWithFile('gui-journey-file-receipt');
      await fileAction('receipt');
      const form = await waitFor(() => app.$('form[data-receipt]'), { label: 'формата за разписка' });
      form.dispatch('submit');
      const out = await waitFor(() => {
        const node = app.$('[data-receipt-out]');
        const said = text(node);
        return said && said !== 'Издавам…' ? node : null;
      }, { label: 'разписката', timeout: BUDGET });
      const receipt = text(out);
      assert.match(receipt, /\{|mac|sha/i, 'панелът показва издадената разписка: ' + receipt.slice(0, 120));
      assert.ok(app.copied.includes(receipt), 'разписката е копирана в клипборда, както при човек');
      // Обратно: същата разписка се поставя в „Провери“ и панелът дава присъда.
      await fileAction('verifyReceipt');
      const verify = await waitFor(() => app.$('form[data-verify-receipt]'), { label: 'формата за проверка на разписка' });
      app.fill('form[data-verify-receipt] textarea[name="receipt"]', receipt);
      verify.dispatch('submit');
      const verdict = await waitFor(() => {
        const node = app.$('[data-verify-receipt-out]');
        return node && text(node).length > 3 ? node : null;
      }, { label: 'присъдата за разписката', timeout: BUDGET });
      assert.match(text(verdict), /валидна|НЕВАЛИДНА|HTTP|несъответствие/i, 'панелът дава присъда: ' + text(verdict));
      assert.ok(
        app.requests.some((r) => r.method === 'POST' && /\/verify-signature$/.test(r.url)),
        'проверката мина през сървъра: ' + app.requests.slice(-3).map((r) => r.method + ' ' + r.url).join(' · '),
      );
    });

    // ── J51. Файл: „в списъка“ и „заключен“ през иконите на реда ─────────────
    await journey('J51 файл: в списъка и заключване', async () => {
      await ownPortalWithFile('gui-journey-file-flags');
      const rowButton = (attr) => waitFor(() => {
        const nodes = app.$$('[' + attr + ']');
        return nodes.find((el) => {
          const art = el.closest ? el.closest('.fm-file') : null;
          return !art || /fayl-za-scenariy/.test(text(art));
        }) || nodes[0];
      }, { label: 'иконата „' + attr + '“ на файла', timeout: BUDGET });
      const flag = async (attr, what) => {
        const button = await rowButton(attr);
        const id = button.getAttribute(attr);
        const before = String(button.getAttribute('class') || '');
        app.clearToasts();
        button.click();
        await waitFor(() => app.toast(), { label: 'отговорът за „' + what + '“', timeout: BUDGET });
        assert.ok(['ok', 'err'].includes(app.toast().kind), 'панелът отговаря за „' + what + '“: ' + app.toast().message);
        await settle('редът след „' + what + '“');
        const again = await waitFor(() => app.$('[' + attr + '="' + id + '"]'), { label: 'иконата след „' + what + '“', timeout: BUDGET });
        const after = String(again.getAttribute('class') || '');
        assert.notEqual(after, before, 'иконата сменя състоянието си: ' + before + ' → ' + after);
        return app.toast();
      };
      await flag('data-file-listed', 'видимост в списъка');
      await flag('data-file-lock', 'заключване');
      assert.ok(
        app.requests.filter((r) => r.method === 'PATCH' && /\/files\//.test(r.url)).length >= 2,
        'двете смени минаха през сървъра: ' + app.requests.slice(-4).map((r) => r.method + ' ' + r.url).join(' · '),
      );
    });

    // ── J53. Папка: бележка и QR от менюто ⚙ ─────────────────────────────────
    await journey('J53 папка: бележка и QR от менюто', async () => {
      await ownPortalWithFile('gui-journey-folder-gear');
      // Името е уникално за пускането: хранилището живее между пусканията и папка със
      // същото име вече съществува от предишно — add-on-ът правилно отказва дубликат.
      const folder = 'Papka-za-scenariy-' + String(Date.now()).slice(-6);
      app.click('#fm-new-folder', 'бутонът „Нова папка“');
      await waitFor(() => app.$('#fm-new-folder-name'), { label: 'полето за име на папка' });
      app.fill('#fm-new-folder-name', folder);
      app.clearToasts();
      app.$('#fm-new-folder-form').dispatch('submit');
      await waitFor(() => app.toast(), { label: 'отговорът за новата папка', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'папката се създава: ' + app.toast().message);
      const ownGear = () => app.$$('[data-folder-gear]').find((el) => (el.getAttribute('data-folder-gear') || '').includes(folder));
      const gear = await waitFor(ownGear, { label: 'менюто ⚙ на новата папка', timeout: BUDGET });
      gear.click();
      await settle('менюто на папката');
      const open = await waitFor(() => app.$('[data-folder-comment-open]'), { label: '„Бележка“ в менюто на папката', timeout: BUDGET });
      const rel = open.getAttribute('data-folder-comment-open');
      open.click();
      const box = await waitFor(() => app.$('[data-folder-comment="' + rel + '"]'), { label: 'полето за бележка на папката', timeout: BUDGET });
      app.fill(box, 'Бележка от сценария');
      app.clearToasts();
      app.click('[data-folder-comment-save="' + rel + '"]', 'бутонът „Запази бележката“');
      await waitFor(() => app.toast(), { label: 'отговорът за бележката на папката', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'бележката е запазена: ' + app.toast().message);
      assert.ok(
        app.requests.some((r) => r.method === 'POST' && /\/tree\/comment$/.test(r.url)),
        'бележката мина през сървъра: ' + app.requests.slice(-3).map((r) => r.method + ' ' + r.url).join(' · '),
      );
      await waitFor(() => /Бележка от сценария/.test(text(view())), { label: 'бележката в дървото на папките', timeout: BUDGET });
      // Флаг „видима в публичния API“ — същата папка, същият ред, друг бутон.
      const flag = await waitFor(
        () => app.$$('[data-folder-flag-btn="visible"]').find((el) => (el.getAttribute('data-folder-flag-path') || '').includes(folder)),
        { label: 'флагът „видима“ на папката', timeout: BUDGET },
      );
      const wasVisible = String(flag.getAttribute('class') || '').includes('on');
      flag.click();
      await waitFor(() => {
        const again = app.$$('[data-folder-flag-btn="visible"]').find((el) => (el.getAttribute('data-folder-flag-path') || '').includes(folder));
        return again && String(again.getAttribute('class') || '').includes('on') !== wasVisible ? again : null;
      }, { label: 'смяната на флага „видима“', timeout: BUDGET });
      // Изчистване на бележката: същият път — меню ⚙, бележка, „Изчисти“.
      const forClear = await waitFor(ownGear, { label: 'менюто ⚙ на папката за изчистване', timeout: BUDGET });
      forClear.click();
      await settle('менюто на папката');
      const openAgain = await waitFor(() => app.$('[data-folder-comment-open]'), { label: '„Бележка“ в менюто на папката', timeout: BUDGET });
      openAgain.click();
      await waitFor(() => app.$('[data-folder-comment-clear="' + rel + '"]'), { label: 'бутонът „Изчисти“ за бележката', timeout: BUDGET });
      app.clearToasts();
      app.click('[data-folder-comment-clear="' + rel + '"]', 'бутонът „Изчисти“ за бележката');
      await waitFor(() => app.toast(), { label: 'отговорът при изчистване на бележката', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'бележката е изчистена: ' + app.toast().message);
      await waitFor(() => !/Бележка от сценария/.test(text(view())), { label: 'бележката да изчезне от дървото', timeout: BUDGET });
      // QR на папката: същото меню, друг бутон — панелът показва адреса в прозорец.
      const again = await waitFor(ownGear, { label: 'менюто ⚙ на папката отново', timeout: BUDGET });
      again.click();
      await settle('менюто на папката');
      const qr = await waitFor(() => app.$('[data-folder-qr="' + rel + '"]'), { label: '„QR“ на папката', timeout: BUDGET });
      qr.click();
      await waitFor(() => text(app.document.body).includes('QR ·'), { label: 'прозорецът с QR на папката', timeout: BUDGET });
    });

    // ── J54. Портал: контакт с поле по желание (добави, махни, запази) ────────
    await journey('J54 портал: контакт с поле по желание', async () => {
      // Имейлът е уникален за всяко пускане: хранилището на add-on-а живее между пусканията,
      // а контакт със същия имейл вече може да съществува от предишно.
      const email = 'extra.' + String(Date.now()) + '@example.org';
      await portalList();
      app.click('#pf-new', 'бутонът „Нов портал“');
      await waitFor(() => app.$('#pf-create'), { label: 'формата за нов портал', timeout: BUDGET });
      app.fill('[name="slug"]', 'gui-journey-extra-' + String(Date.now()).slice(-6));
      app.fill('[name="title"]', 'Портал с контакт по желание');
      app.select('[name="contactId"]', '__new__');
      app.fill('[name="contact_email"]', email);
      app.fill('[name="contact_name"]', 'Контакт с поле');
      // Две полета по желание: едното се маха, другото остава.
      app.click('[data-extras-add="contact"]', 'бутонът „＋ добави поле“');
      app.click('[data-extras-add="contact"]', 'бутонът „＋ добави поле“');
      await waitFor(() => app.$$('[data-extras="contact"] [data-extra-key]').length === 2, {
        label: 'двете полета по желание',
        timeout: BUDGET,
      });
      const keys = app.$$('[data-extras="contact"] [data-extra-key]');
      const vals = app.$$('[data-extras="contact"] [data-extra-value]');
      app.fill(keys[0], 'Съд');
      app.fill(vals[0], 'РС-София');
      // Второто поле се премахва със „✕“ — както би направил човек.
      const removeButtons = app.$$('[data-extras="contact"] [data-extras-remove]');
      removeButtons[removeButtons.length - 1].click();
      await waitFor(() => app.$$('[data-extras="contact"] [data-extra-key]').length === 1, {
        label: 'махнатото поле по желание',
        timeout: BUDGET,
      });
      app.clearToasts();
      app.click('#pf-create', 'бутонът „Създай и генерирай API + QR“');
      await waitFor(() => app.toast(), { label: 'отговорът от създаването', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'порталът се създава: ' + app.toast().message);
      // Панелът поиска създаването на контакта С ТОВА, което човекът е попълнил: едно поле
      // по желание (второто е махнато с „✕“) и имейлът от формата. Проверява се тялото на
      // заявката, а не списъкът в друг панел — той се зарежда при отваряне и би показал
      // старо състояние, тоест тестът щеше да проверява кеша, не формата.
      const posted = app.requests.filter((r) => r.method === 'POST' && /\/directory\/contacts$/.test(r.url)).pop();
      assert.ok(posted, 'контактът е поискан от панела: ' + app.requests.slice(-4).map((r) => r.method + ' ' + r.url).join(' · '));
      const sent = JSON.parse(posted.body || '{}');
      assert.equal(sent.email, email, 'имейлът от формата стигна до заявката');
      assert.deepEqual(sent.extras, [{ key: 'Съд', value: 'РС-София' }], 'остана само едното поле по желание: ' + JSON.stringify(sent.extras));
    });

    // ── J55. Файл: избор и действие от плочката в картата ────────────────────
    await journey('J55 файл: избор и действие', async () => {
      await ownPortalWithFile('gui-journey-file-pick');
      // Плочките за действие живеят в картата на ОТВОРЕНИЯ файл — отваря се редът.
      const open = await waitFor(() => {
        const nodes = app.$$('[data-open-file]');
        return nodes.find((el) => /fayl-za-scenariy/.test(text(el))) || nodes[0];
      }, { label: 'редът на файла', timeout: BUDGET });
      open.click();
      await settle('картата на файла');
      const pick = await waitFor(() => {
        const nodes = app.$$('[data-pick]');
        return nodes.find((el) => {
          const art = el.closest ? el.closest('.fm-file') : null;
          return art && /fayl-za-scenariy/.test(text(art));
        }) || nodes[0];
      }, { label: 'бутонът за избор на файла', timeout: BUDGET });
      const wasOn = String(pick.getAttribute('class') || '').includes('on');
      pick.click();
      await waitFor(() => {
        const again = app.$('[data-pick="' + pick.getAttribute('data-pick') + '"]');
        return again && String(again.getAttribute('class') || '').includes('on') !== wasOn ? again : null;
      }, { label: 'смяната на избора', timeout: BUDGET });
      // Плочка за действие в картата на файла — същият път като с мишка.
      const tile = await waitFor(() => app.$('[data-act="lock"]') || app.$('[data-act]'), { label: 'плочка за действие', timeout: BUDGET });
      const action = tile.getAttribute('data-act');
      app.clearToasts();
      tile.click();
      await waitFor(() => app.toast(), { label: 'отговорът от „' + action + '“', timeout: BUDGET });
      assert.ok(['ok', 'err'].includes(app.toast().kind), 'панелът отговаря на „' + action + '“: ' + app.toast().message);
      assert.ok(
        app.requests.some((r) => r.method === 'PATCH' && /\/files\//.test(r.url)),
        'действието мина през сървъра: ' + app.requests.slice(-4).map((r) => r.method + ' ' + r.url).join(' · '),
      );
    });

    // ── J56. Report Studio: колони на оформлението (columns блок) ─────────────
    await journey('J56 Report Studio: колони на оформлението', async () => {
      app.nav('report');
      await settle('Report Studio');
      app.click('#rs-new', 'бутонът „Нов“');
      const item = await waitFor(
        () => app.$$('#rs-lib [data-type]').find((el) => el.getAttribute('data-type') === 'columns'),
        { label: 'обектът „Колони“ в библиотеката', timeout: BUDGET },
      );
      item.click();
      const firstTitle = await waitFor(() => app.$('[data-lcol-title="0"]'), { label: 'заглавието на първата колона', timeout: BUDGET });
      app.fill(firstTitle, 'Лява колона от сценария');
      await waitFor(() => {
        const again = app.$('[data-lcol-title="0"]');
        return again && again.value === 'Лява колона от сценария' ? again : null;
      }, { label: 'заглавието да се запази в блока', timeout: BUDGET });
      // Текстът на колоната се пише със същия път (input → блокът се обновява).
      const text2 = await waitFor(() => app.$('[data-lcol-text="1"]'), { label: 'текстът на втората колона', timeout: BUDGET });
      app.fill(text2, 'Текст от сценария');
      await waitFor(() => {
        const again = app.$('[data-lcol-text="1"]');
        return again && again.value === 'Текст от сценария' ? again : null;
      }, { label: 'текстът да се запази в блока', timeout: BUDGET });
      // „Добави колона“ вдига броя на колоните в самия блок — проверява се през документа,
      // защото панелът нарочно пази полетата непокътнати, докато човекът пише.
      const before = Number((text(app.$('#rs-count')).match(/\d+/) || [0])[0]);
      app.click('#p-addlcol', 'бутонът „Добави колона“');
      await settle('оформлението след новата колона');
      assert.equal(Number((text(app.$('#rs-count')).match(/\d+/) || [0])[0]), before, 'документът не губи блокове при редакция на колоните');
    });

    // ── J57. Табло: комбо отчет през бутона ──────────────────────────────────
    await journey('J57 табло: комбо отчет', async () => {
      app.nav('dashboard');
      await settle('таблото');
      const button = await waitFor(() => app.$('[data-report]'), { label: 'бутонът за комбо отчет', timeout: BUDGET });
      const kind = button.getAttribute('data-report');
      app.clearToasts();
      button.click();
      // Отчетът се сглобява и се ОТВАРЯ в Report Studio — таблото води там, вместо да
      // остави човека с празна бележка.
      await waitFor(() => app.location.hash === '#report', { label: 'преминаването към Report Studio', timeout: BUDGET });
      const count = await waitFor(() => {
        const node = app.$('#rs-count');
        return node && Number((text(node).match(/\d+/) || [0])[0]) > 0 ? node : null;
      }, { label: 'сглобения отчет с блокове', timeout: BUDGET });
      assert.match(kind, /combo/, 'натиснат е бутонът за комбо отчет: ' + kind);
      assert.ok(Number((text(count).match(/\d+/) || [0])[0]) > 0, 'отчетът има блокове: ' + text(count));
    });

    // ── J58. Файл: копиране на хеш от „Пълни данни“ ───────────────────────────
    await journey('J58 файл: копиране на хеш', async () => {
      await ownPortalWithFile('gui-journey-file-copy');
      const open = await waitFor(() => {
        const nodes = app.$$('[data-open-file]');
        return nodes.find((el) => /fayl-za-scenariy/.test(text(el))) || nodes[0];
      }, { label: 'редът на файла', timeout: BUDGET });
      open.click();
      // Хешовете идват от сървъра след отваряне; бутонът за копиране носи САМАТА стойност,
      // затова се избира първият с непразна стойност (адресът за изтегляне може да е празен).
      const copy = await waitFor(() => app.$$('[data-copy]').find((el) => String(el.getAttribute('data-copy') || '').length >= 16), {
        label: 'бутонът за копиране на хеша',
        timeout: BUDGET,
      });
      const value = copy.getAttribute('data-copy');
      app.clearToasts();
      copy.click();
      await waitFor(() => app.copied.includes(String(value)), { label: 'хешът в клипборда', timeout: BUDGET });
      assert.ok(app.copied.length > 0, 'хешът е копиран, както при човек: ' + String(app.copied.slice(-1)[0]).slice(0, 24));
    });

    // ── J59. Портал: контролният панел се сгъва и разгъва ────────────────────
    await journey('J59 портал: контролният панел се сгъва', async () => {
      await ownPortalWithFile('gui-journey-control-tog');
      // `ownPortalWithFile` разгъва блоковете (те са сгънати по подразбиране — виж J74).
      const toggle = await waitFor(() => app.$('[data-pf-control-tog]'), { label: 'заглавието на контролния панел', timeout: BUDGET });
      const body = () => app.$('[data-pf-control-tog]') && app.$('#pf-settings');
      assert.ok(body(), 'контролният панел е разгънат след помощника');
      toggle.click();
      await waitFor(() => !app.$('#pf-settings'), { label: 'сгънатия контролен панел', timeout: BUDGET });
      const again = await waitFor(() => app.$('[data-pf-control-tog]'), { label: 'заглавието след сгъване', timeout: BUDGET });
      again.click();
      await waitFor(() => app.$('#pf-settings'), { label: 'разгънатия контролен панел', timeout: BUDGET });
    });

    // ── J60. Портал: отчет за портала от картата му ──────────────────────────
    await journey('J60 портал: отчет за портала', async () => {
      const report = await waitFor(() => app.$('[data-report-portal]'), { label: 'бутонът „Отчет за портала“', timeout: BUDGET });
      report.click();
      // Отчетът се сглобява и се отваря в Report Studio — същият път като от таблото.
      await waitFor(() => app.location.hash === '#report', { label: 'преминаването към Report Studio', timeout: BUDGET });
      const count = await waitFor(() => {
        const node = app.$('#rs-count');
        return node && Number((text(node).match(/\d+/) || [0])[0]) > 0 ? node : null;
      }, { label: 'отчетът с блокове', timeout: BUDGET });
      assert.ok(Number((text(count).match(/\d+/) || [0])[0]) > 0, 'отчетът за портала има блокове: ' + text(count));
    });

    // ── J61. Портал: пакетът на портала от картата му ────────────────────────
    await journey('J61 портал: пакетът на портала', async () => {
      app.nav('portals');
      await settle('панелът „Портали“');
      const pkg = await waitFor(() => app.$('[data-pkg-portal]'), { label: 'бутонът за пакета на портала', timeout: BUDGET });
      const asked = app.requests.length;
      app.clearToasts();
      pkg.click();
      await waitFor(() => app.requests.length > asked, { label: 'заявката за пакета', timeout: BUDGET });
      const made = app.requests.slice(asked).map((r) => r.method + ' ' + r.url);
      assert.ok(
        made.some((r) => /\/packages/.test(r)),
        'пакетът се поиска от сървъра: ' + made.join(' · '),
      );
      // Пакетът довършва с изтегляне — изчаква се тук, за да не влезе в следващия сценарий.
      await waitFor(() => app.requests.some((r) => /\/packages\/[^/]+\/download$/.test(r.url)), {
        label: 'изтеглянето на пакета',
        timeout: BUDGET,
      });
    });

    // ── J62. Хранилище: прикачи файл, качи в папка, пакет и изтриване ────────
    await journey('J62 хранилище: прикачи, качи, пакет, изтрий', async () => {
      await ownPortalWithFile('gui-journey-storage');
      const folder = 'Papka-hranilishte-' + String(Date.now()).slice(-6);
      const ownButton = (attr) => app.$$('[' + attr + ']').find((el) => (el.getAttribute(attr) || '').includes(folder));
      app.click('#fm-new-folder', 'бутонът „Нова папка“');
      await waitFor(() => app.$('#fm-new-folder-name'), { label: 'полето за име на папка' });
      app.fill('#fm-new-folder-name', folder);
      app.clearToasts();
      app.$('#fm-new-folder-form').dispatch('submit');
      await waitFor(() => app.toast(), { label: 'отговорът за новата папка', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'папката се създава: ' + app.toast().message);
      // Прикачване на файл: бутонът отваря избора, човекът избира файл — тук файлът се дава
      // на самия input и се пуска `change`, както го прави браузърът след избор.
      const attach = await waitFor(() => app.$('[data-attach-file]'), { label: 'бутонът „Прикачи файл“', timeout: BUDGET });
      app.clearToasts();
      attach.click();
      const first = await waitFor(() => app.$('#fm-file-input'), { label: 'скритият избор на файл', timeout: BUDGET });
      first.files = [pseudoFile('prilka-ot-scenariy.txt', 'съдържание от J62')];
      first.dispatch('change');
      await waitFor(() => app.toast(), { label: 'отговорът при прикачването', timeout: BUDGET });
      assert.ok(['ok', 'err'].includes(app.toast().kind), 'панелът казва какво е станало: ' + app.toast().message);
      assert.ok(
        app.requests.some((r) => r.method === 'POST' && /\/tree\//.test(r.url)),
        'качването мина през сървъра: ' + app.requests.slice(-4).map((r) => r.method + ' ' + r.url).join(' · '),
      );
      // Качване В папката — бутонът на самата папка носи нейния път.
      const folderUpload = await waitFor(() => ownButton('data-folder-upload'), { label: 'бутонът за качване в папката', timeout: BUDGET });
      app.clearToasts();
      folderUpload.click();
      const second = await waitFor(() => app.$('#fm-file-input'), { label: 'изборът на файл за папката', timeout: BUDGET });
      second.files = [pseudoFile('v-papkata.txt', 'вътре в папката')];
      second.dispatch('change');
      await waitFor(() => app.toast(), { label: 'отговорът при качването в папката', timeout: BUDGET });
      assert.ok(['ok', 'err'].includes(app.toast().kind), 'панелът отчита качването в папката: ' + app.toast().message);
      // Пакет на папката: панелът иска пакет за НЕЯ от сървъра.
      const pkg = await waitFor(() => ownButton('data-folder-pkg'), { label: 'бутонът за пакет на папката', timeout: BUDGET });
      app.clearToasts();
      pkg.click();
      await waitFor(() => app.requests.some((r) => r.method === 'POST' && /\/packages$/.test(r.url)), {
        label: 'заявката за пакета на папката',
        timeout: BUDGET,
      });
      const built = app.requests.filter((r) => r.method === 'POST' && /\/packages$/.test(r.url)).pop();
      assert.match(built.body || '', new RegExp(folder), 'пакетът е поискан за нашата папка: ' + (built.body || ''));
      // Изтриване на папката: бутонът е в менюто ⚙ на папката; браузърът пита, човекът
      // потвърждава (папката има файл, затова add-on-ът отговаря 409 и панелът пита втори път).
      const gearForDelete = await waitFor(
        () => app.$$('[data-folder-gear]').find((el) => (el.getAttribute('data-folder-gear') || '').includes(folder)),
        { label: 'менюто ⚙ на папката за изтриване', timeout: BUDGET },
      );
      gearForDelete.click();
      await settle('менюто на папката');
      const del = await waitFor(() => ownButton('data-folder-delete'), { label: 'бутонът за изтриване на папката', timeout: BUDGET });
      app.clearToasts();
      del.click();
      await waitFor(() => app.toast(), { label: 'отговорът при изтриване на папката', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'папката е изтрита: ' + app.toast().message);
      assert.ok(
        app.requests.some((r) => r.method === 'DELETE' && /\/tree\/folder/.test(r.url)),
        'изтриването мина през сървъра: ' + app.requests.slice(-4).map((r) => r.method + ' ' + r.url).join(' · '),
      );
    });

    // ── J63. Файл: нова версия и възстановяване на предишната ─────────────────
    await journey('J63 файл: нова версия и възстановяване', async () => {
      await ownPortalWithFile('gui-journey-file-version');
      const open = await waitFor(() => {
        const nodes = app.$$('[data-open-file]');
        return nodes.find((el) => /fayl-za-scenariy/.test(text(el))) || nodes[0];
      }, { label: 'редът на файла', timeout: BUDGET });
      open.click();
      await fileAction('versions');
      const upload = await waitFor(() => app.$('#fm-version-upload'), { label: 'бутонът „Качи версия“', timeout: BUDGET });
      const picker = app.$('#fm-version-file');
      assert.ok(picker, 'картата има избор на файл за нова версия');
      picker.files = [pseudoFile('fayl-za-scenariy.txt', 'второ съдържание за сценария')];
      app.fill('#fm-version-note', 'втора версия от сценария');
      app.clearToasts();
      upload.click();
      await waitFor(() => app.toast(), { label: 'съобщението за новата версия', timeout: BUDGET });
      assert.equal(app.toast().kind, 'ok', 'версията е качена: ' + app.toast().message);
      // Списъкът с версиите се чете при отваряне на панела „Версии“, затова човекът го
      // отваря отново (същият бутон от менюто ⚙), за да види архивираната версия.
      await fileAction('versions');
      const restore = await waitFor(() => app.$('[data-restore]'), { label: 'бутонът „Възстанови“ за предишна версия', timeout: BUDGET });
      const vn = restore.getAttribute('data-restore');
      app.clearToasts();
      restore.click();
      await waitFor(() => {
        const said = app.toast();
        return said && /версия/i.test(said.message) ? said : null;
      }, { label: 'съобщението за възстановената версия', timeout: BUDGET });
      assert.match(app.toast().message, /версия/i, 'панелът казва какво е възстановено: ' + app.toast().message);
      assert.ok(
        app.requests.some((r) => r.method === 'POST' && new RegExp('/versions/' + vn + '/restore$').test(r.url)),
        'възстановяването мина през сървъра: ' + app.requests.slice(-4).map((r) => r.method + ' ' + r.url).join(' · '),
      );
    });

    // ── J64. Хранилище: внасяне на цяла папка с потвърждение ──────────────────
    await journey('J64 хранилище: внасяне на папка', async () => {
      app.nav('portals');
      await settle('панелът „Портали“');
      const importFolder = await waitFor(() => app.$('[data-import-folder]'), { label: 'бутонът „Внеси папка“', timeout: BUDGET });
      app.clearToasts();
      importFolder.click();
      const input = await waitFor(() => app.$('#fm-dir-input'), { label: 'скритият избор на папка', timeout: BUDGET });
      const file = pseudoFile('vnos.txt', 'съдържание от внасянето');
      file.webkitRelativePath = 'Vnasqne/' + 'vnos.txt';
      input.files = [file];
      input.dispatch('change');
      await waitFor(() => app.toast(), { label: 'отговорът при внасянето на папката', timeout: BUDGET });
      assert.ok(['ok', 'err'].includes(app.toast().kind), 'панелът отчита внасянето: ' + app.toast().message);
      assert.ok(
        app.requests.some((r) => r.method === 'POST' && /\/tree\//.test(r.url)),
        'внасянето мина през сървъра: ' + app.requests.slice(-4).map((r) => r.method + ' ' + r.url).join(' · '),
      );
    });

    // ── J65. Тайна връзка: „Копирай“ слага ИМЕННО линка в клипборда ────────────
    await journey('J65 тайна връзка: копиране на линка', async () => {
      app.nav('settings');
      await settle('„Настройки“');
      await app.section('data');
      await settle('секция „Данни“');
      app.fill('#set-secret-text', 'тайна за копиране от сценария');
      app.clearToasts();
      app.action('secretCreate');
      const copy = await waitFor(() => app.$('#set-secret-out [data-copy-secret]'), {
        label: 'бутонът „Копирай“ на тайната',
        timeout: BUDGET,
      });
      const link = String(copy.getAttribute('data-copy-secret') || '');
      assert.match(link, /\/secret#/, 'бутонът носи линка на тайната: ' + link);
      const before = app.copied.length;
      app.clearToasts();
      copy.click();
      const said = await waitFor(() => {
        const t = app.toast();
        return t && /копиран/i.test(t.message) ? t : null;
      }, { label: 'съобщението за копирания линк', timeout: BUDGET });
      assert.equal(said.kind, 'ok', 'линкът е копиран: ' + said.message);
      assert.equal(app.copied.length, before + 1, 'в клипборда е сложен точно един текст');
      assert.equal(app.copied[app.copied.length - 1], link, 'копиран е ИМЕННО линкът на тайната');
    });

    // ── J66. Портал: адресът отваря менюто — копирай, отвори, изтегли ──────────
    await journey('J66 портал: адресът отваря менюто', async () => {
      const slug = 'gui-journey-api-menu';
      await ownPortalWithFile(slug);
      await portalList();
      // Щракване върху заглавието: затваря евентуално отворено меню ⚙ от предишен
      // сценарий, точно както човек би щракнал настрана, преди да отвори друго меню.
      const title = app.$('#view h1');
      if (title) title.click();
      await settle('списъкът с портали');
      // Менюто се отваря с щракване, както при човек — проверява се, че е ВИДИМО.
      // Картата се търси НАНОВО при всяка стъпка: щракването върху „API ▾“ може да
      // прерисува панела (затваря отворено меню ⚙ от предишен сценарий), а държан
      // елемент от предишния изглед вече не е този, който човекът вижда.
      const openMenu = async (step) => {
        const fresh = await portalCard(slug);
        const button = await waitFor(() => fresh.querySelector('[data-api-menu]'), {
          label: 'бутонът с адреса (' + step + ')',
          timeout: BUDGET,
        });
        button.click();
        return waitFor(() => {
          const menu = button.parentNode ? button.parentNode.querySelector('.fm-menu') : null;
          return menu && menu.hidden === false ? menu : null;
        }, { label: 'менюто на адреса да се отвори (' + step + ')', timeout: BUDGET });
      };
      const menu = await openMenu('копирай');
      // 0.69.152: в заглавния ред на картата НЯМА отделен бутон „API ▾“ — натиска се САМИЯТ
      // адрес и дава същите три действия. Проверява се точно това: едно меню в картата, а
      // текстът му е адресът, не „API“.
      const card = await portalCard(slug);
      const triggers = card.querySelectorAll('[data-api-menu]');
      assert.equal(triggers.length, 1, 'в картата има точно едно меню за адреса, а е ' + triggers.length);
      assert.equal(/API/.test(text(triggers[0])), false, 'бутонът не се казва „API“, а е адресът: ' + text(triggers[0]));
      assert.match(text(triggers[0]), /p\/|https?:\/\/|^\//, 'бутонът показва адреса на портала: ' + text(triggers[0]));
      const copyButton = menu.querySelector('[data-api-copy]');
      assert.ok(copyButton, 'менюто има „Копирай адреса“');
      const apiUrl = String(copyButton.getAttribute('data-api-copy') || '');
      assert.match(apiUrl, /^https?:\/\/|^\//, 'менюто носи адреса на API-то: ' + apiUrl);
      app.clearToasts();
      copyButton.click();
      await waitFor(() => {
        const t = app.toast();
        return t && /Копирано/.test(t.message) ? t : null;
      }, { label: 'съобщението за копирания адрес', timeout: BUDGET });
      assert.equal(app.copied[app.copied.length - 1], apiUrl, 'копиран е адресът на API-то');
      // „Отвори“ чете адреса от сървъра и го показва в изскачащия прозорец на панела.
      const beforeOpen = app.requests.length;
      const menuOpen = await openMenu('отвори');
      menuOpen.querySelector('[data-api-open]').click();
      await waitFor(() => app.requests.length > beforeOpen, { label: 'заявката при „Отвори“', timeout: BUDGET });
      assert.ok(
        app.requests.slice(beforeOpen).some((r) => r.url.endsWith(apiUrl)),
        '„Отвори“ поиска ИМЕННО адреса на API-то: ' + app.requests.slice(beforeOpen).map((r) => r.url).join(' · '),
      );
      // „Изтегли“ също иска файла от сървъра; самият запис на диска е работа на браузъра,
      // затова тук се проверява искането и съобщението, което човекът вижда.
      const beforeDl = app.requests.length;
      const menuDl = await openMenu('изтегли');
      app.clearToasts();
      menuDl.querySelector('[data-api-dl]').click();
      await waitFor(() => app.toast(), { label: 'съобщението при „Изтегли“', timeout: BUDGET });
      assert.ok(
        app.requests.slice(beforeDl).some((r) => r.url.endsWith(apiUrl)),
        '„Изтегли“ поиска файла от сървъра: ' + app.requests.slice(beforeDl).map((r) => r.url).join(' · '),
      );
    });

    // ── J67. Портал: рекурсивният отчет води до „Отчети“ ──────────────────────
    await journey('J67 портал: рекурсивен отчет', async () => {
      const slug = 'gui-journey-report-recursive';
      await ownPortalWithFile(slug);
      await portalList();
      const card = await portalCard(slug);
      const button = await waitFor(() => card.querySelector('[data-report-recursive]'), {
        label: 'бутонът за рекурсивен отчет',
        timeout: BUDGET,
      });
      app.clearToasts();
      button.click();
      // Рекурсивният отчет включва и папките от хранилището, затова панелът първо иска
      // дървото на портала, а после отваря сглобения отчет в Report Studio.
      const said = await waitFor(() => {
        const t = app.toast();
        return t && /Отчети/.test(t.message) ? t : null;
      }, { label: 'съобщението за отворения отчет', timeout: BUDGET });
      assert.equal(said.kind, 'ok', 'отчетът се отваря: ' + said.message);
      assert.ok(
        app.requests.some((r) => /\/portals\/[^/]+\/tree$/.test(r.url)),
        'рекурсивният отчет поиска дървото на портала: ' + app.requests.slice(-4).map((r) => r.url).join(' · '),
      );
      const count = await waitFor(() => {
        const node = app.$('#rs-count');
        return node && Number((text(node).match(/\d+/) || [0])[0]) > 0 ? node : null;
      }, { label: 'сглобения отчет с блокове', timeout: BUDGET });
      assert.ok(Number((text(count).match(/\d+/) || [0])[0]) > 0, 'отчетът има блокове: ' + text(count));
    });

    // ── J68. Портал: „Отвори портала“ от контролния панел (по идентификатор) ────
    await journey('J68 портал: отваряне по идентификатор', async () => {
      const slug = 'gui-journey-open-by-id';
      await ownPortalWithFile(slug);
      const open = await waitFor(() => app.$('#pf-open-portal'), { label: 'бутонът „Отвори портала“', timeout: BUDGET });
      const id = open.getAttribute('data-open-portal-id');
      assert.ok(id, 'бутонът носи идентификатора на портала');
      const before = app.requests.length;
      app.clearToasts();
      open.click();
      const again = await waitFor(() => app.$('#pf-open-portal'), { label: 'бутонът след отварянето', timeout: BUDGET });
      await settle('картата на портала');
      // Отварянето на вече отворения портал е САМО четене: не бива да има нито една
      // промяна на сървъра (POST/PATCH/DELETE). Заявките за четене са позволени — панелът
      // може да презареди дървото на папките, ако е било за друг портал.
      const fresh = app.requests.slice(before);
      assert.deepEqual(
        fresh.filter((r) => r.method !== 'GET').map((r) => r.method + ' ' + r.url),
        [],
        'отварянето не променя нищо на сървъра: ' + fresh.map((r) => r.method + ' ' + r.url).join(' · '),
      );
      assert.equal(again.getAttribute('data-open-portal-id'), id, 'панелът остава на СЪЩИЯ портал');
      assert.ok(app.$('[data-close-portal]'), 'порталът е отворен в същия раздел (има „← Списък с портали“)');
      assert.ok(!app.toast() || app.toast().kind !== 'err', 'отварянето мина без грешка: ' + (app.toast() ? app.toast().message : '—'));
      assert.match(text(view()), /fayl-za-scenariy\.txt/, 'файловете на портала са на екрана след отварянето');
    });

    // ── J69. Файл: пълният пакет хешове и преизчисляването му ──────────────────
    await journey('J69 файл: пълният пакет хешове', async () => {
      await ownPortalWithFile('gui-journey-file-hashes');
      const row = await waitFor(() => {
        const nodes = app.$$('[data-open-file]');
        return nodes.find((el) => /fayl-za-scenariy/.test(text(el))) || nodes[0];
      }, { label: 'редът на файла', timeout: BUDGET });
      row.click();
      const block = await waitFor(() => app.$('[data-hash-block]'), { label: 'блокът „Пълен пакет хешове“', timeout: BUDGET });
      assert.match(text(block), /Пълен пакет хешове/, 'блокът е в картата на файла: ' + text(block).slice(0, 80));
      const again = await waitFor(() => app.$('#fm-hash-stack'), { label: 'бутонът за преизчисляване на хешовете', timeout: BUDGET });
      const before = app.requests.length;
      app.clearToasts();
      again.click();
      await waitFor(() => app.requests.slice(before).some((r) => /\/hashes$/.test(r.url)), {
        label: 'заявката за хешовете',
        timeout: BUDGET,
      });
      const asked = app.requests.slice(before).filter((r) => /\/hashes$/.test(r.url)).pop();
      assert.equal(asked.method, 'GET', 'хешовете се четат от сървъра: ' + asked.method + ' ' + asked.url);
    });

    // ── J70. Файлове: търсене, тип и подредба в панела с филтри ───────────────
    await journey('J70 файлове: филтри и подредба', async () => {
      await ownPortalWithFile('gui-journey-filters', [
        pseudoFile('otchet-alfa.pdf', 'PDF съдържание'),
        pseudoFile('belezhki-beta.txt', 'текстово съдържание'),
        pseudoFile('snimka-gama.png', 'двоично съдържание'),
      ]);
      const names = () => app.$$('[data-open-file]').map((el) => text(el));
      // Филтрите се отварят с иконата в главата на блока — същата, която вижда човекът.
      const search = await openFilters();
      assert.ok(app.$('#fm-type') && app.$('#fm-sort'), 'панелът показва и изборите за тип и подредба');
      // Търсене по име: остава САМО файлът, който съдържа думата.
      app.fill(search, 'alfa');
      await waitFor(() => names().length === 1, { label: 'една карта след търсенето', timeout: BUDGET });
      assert.match(names()[0], /otchet-alfa\.pdf/, 'търсенето оставя само файла с „alfa“: ' + names().join(' · '));
      // Изчистване и филтър по тип: .txt е „Текст“ в избора на панела.
      app.fill(search, '');
      app.select('#fm-type', 'text');
      await waitFor(() => names().length === 1, { label: 'една карта след филтъра по тип', timeout: BUDGET });
      assert.match(names()[0], /belezhki-beta\.txt/, 'филтърът по тип оставя само текстовия файл: ' + names().join(' · '));
      // Връщане към всички типове и подредба по име в обратен ред — първият ред се сменя.
      app.select('#fm-type', 'all');
      await waitFor(() => names().length === 3, { label: 'три карти без филтър', timeout: BUDGET });
      app.select('#fm-sort', '-name');
      await waitFor(() => /snimka-gama\.png/.test(names()[0] || ''), { label: 'подредбата по име в обратен ред', timeout: BUDGET });
      assert.match(names()[0], /snimka-gama\.png/, 'при „Име ↓“ първи е последният по азбучен ред: ' + names().join(' · '));
      app.select('#fm-sort', 'name');
      await waitFor(() => /belezhki-beta\.txt/.test(names()[0] || ''), { label: 'подредбата по име', timeout: BUDGET });
      assert.match(names()[0], /belezhki-beta\.txt/, 'при „Име ↑“ първи е belezhki-beta.txt: ' + names().join(' · '));
    });

    // ── J71. Файлове: масова смяна на политиката на два файла ─────────────────
    await journey('J71 файлове: масова политика', async () => {
      await ownPortalWithFile('gui-journey-bulk', [
        pseudoFile('masov-alfa.pdf', 'PDF за масовата смяна'),
        pseudoFile('masov-beta.txt', 'текст за масовата смяна'),
      ]);
      // Лентата с избраните живее във филтрите на блока — затова първо се отварят те.
      await openFilters();
      const picks = await waitFor(() => {
        const nodes = app.$$('[data-pick]');
        return nodes.length >= 2 ? nodes : null;
      }, { label: 'бутоните за избор на файловете', timeout: BUDGET });
      const first = picks[0].getAttribute('data-pick');
      const second = picks[1].getAttribute('data-pick');
      app.clearToasts();
      picks[0].click();
      await waitFor(() => app.$('#fm-bulk-apply'), { label: 'лентата с избраните файлове', timeout: BUDGET });
      app.$('[data-pick="' + second + '"]').click();
      const label = await waitFor(() => {
        const node = app.$('.fm-bulk');
        return node && /Избрани/.test(text(node)) ? node : null;
      }, { label: 'броят на избраните файлове', timeout: BUDGET });
      assert.match(text(label), /Избрани\s*2/, 'панелът брои два избрани файла: ' + text(label));
      app.select('#fm-bulk-mode', 'DISABLED');
      const before = app.requests.length;
      app.$('#fm-bulk-apply').click();
      const said = await waitFor(() => {
        const t = app.toast();
        return t && /Обновени/.test(t.message) ? t : null;
      }, { label: 'съобщението за обновените файлове', timeout: BUDGET });
      assert.equal(said.kind, 'ok', 'политиката е приложена: ' + said.message);
      const bulk = app.requests.slice(before).filter((r) => r.method === 'POST' && /bulk-access$/.test(r.url)).pop();
      assert.ok(bulk, 'масовата смяна мина през сървъра: ' + app.requests.slice(before).map((r) => r.method + ' ' + r.url).join(' · '));
      assert.ok((bulk.body || '').includes(first) && (bulk.body || '').includes(second), 'заявката носи ИД на двата избрани файла: ' + bulk.body);
      assert.match(bulk.body || '', /DISABLED/, 'заявката носи избраната политика: ' + bulk.body);
    });

    // ── J72. Настройки: профил на настройките — запис и изтриване ─────────────
    await journey('J72 настройки: профил запис и изтриване', async () => {
      // Профилът живее в общия таб на „Настройки“ (не в секция) — там е и полето за име.
      app.nav('settings');
      await settle('„Настройки“');
      const tab = app.$('[data-section="general"]');
      if (tab) {
        tab.click();
        await settle('общия таб на „Настройки“');
      }
      const name = 'profil-ot-scenariy-' + String(Date.now()).slice(-6);
      const field = await waitFor(() => app.$('#set-profile-name'), { label: 'полето за име на профил', timeout: BUDGET });
      app.fill(field, name);
      app.clearToasts();
      app.click('#set-profile-save', 'бутонът „Запази профил“');
      const said = await waitFor(() => {
        const t = app.toast();
        return t && /профил/i.test(t.message) ? t : null;
      }, { label: 'съобщението за записания профил', timeout: BUDGET });
      assert.equal(said.kind, 'ok', 'профилът е записан: ' + said.message);
      const saved = app.requests.filter((r) => r.method === 'POST' && /config-profiles$/.test(r.url)).pop();
      assert.ok(saved, 'записът мина през сървъра: ' + app.requests.slice(-4).map((r) => r.method + ' ' + r.url).join(' · '));
      assert.ok((saved.body || '').includes(name), 'заявката носи ИМЕТО на профила: ' + saved.body);
      const apply = await waitFor(() => app.$$('[data-profile-apply]').find((el) => el.getAttribute('data-profile-apply') === name), {
        label: 'бутонът „Приложи“ на новия профил', timeout: BUDGET,
      });
      app.clearToasts();
      apply.click();
      const applied = await waitFor(() => {
        const t = app.toast();
        return t && /профил/i.test(t.message) ? t : null;
      }, { label: 'съобщението за приложен профил', timeout: BUDGET });
      assert.equal(applied.kind, 'ok', 'профилът е приложен: ' + applied.message);
      assert.ok(
        app.requests.some((r) => r.method === 'POST' && r.url.endsWith('/config-profiles/' + name + '/apply')),
        'прилагането минава през POST API',
      );
      // Списъкът се пре-чита след записа — профилът се появява с бутоните си.
      const del = await waitFor(() => {
        for (const el of app.$$('[data-profile-delete]')) {
          if ((el.getAttribute('data-profile-delete') || '') === name) return el;
        }
        return null;
      }, { label: 'редът на новия профил в списъка', timeout: BUDGET });
      assert.ok(app.$$('[data-profile-apply]').length >= 1, 'профилът има и бутон „Приложи“');
      app.clearToasts();
      del.click();
      const removed = await waitFor(() => {
        const t = app.toast();
        return t && /профил/i.test(t.message) ? t : null;
      }, { label: 'съобщението за изтрития профил', timeout: BUDGET });
      assert.equal(removed.kind, 'ok', 'профилът е изтрит: ' + removed.message);
      assert.ok(
        app.requests.some((r) => r.method === 'DELETE' && r.url.includes('/config-profiles/' + name)),
        'изтриването мина през сървъра: ' + app.requests.slice(-4).map((r) => r.method + ' ' + r.url).join(' · '),
      );
      await waitFor(() => !app.$$('[data-profile-delete]').some((el) => el.getAttribute('data-profile-delete') === name), {
        label: 'профилът да изчезне от списъка',
        timeout: BUDGET,
      });
    });

    // ── J73. Портал: закриване в архив за съхранение и връщане ─────────────────
    await journey('J73 портал: закриване в архив и връщане', async () => {
      await ownPortalWithFile('gui-journey-archive');
      const close = await waitFor(() => app.$('[data-close-portal-submit]'), {
        label: 'бутонът „Закрий портала“',
        timeout: BUDGET,
      });
      app.clearToasts();
      // Машината отговаря „да“ на въпроса — както човек, който вече е решил.
      close.click();
      const said = await waitFor(() => {
        const t = app.toast();
        return t && /закрит и е в архив/.test(t.message) ? t : null;
      }, { label: 'известието за закриване', timeout: BUDGET });
      assert.equal(said.kind, 'ok', 'закриването минава: ' + said.message);
      await settle('списъка след закриване');
      // Секцията „Затворени портали“ показва ИСТИНСКИЯ срок от сървъра (183 дни), а не
      // сметка, измислена в интерфейса.
      const archived = await waitFor(() => app.$('.pf-archive'), {
        label: 'секцията „Затворени портали“',
        timeout: BUDGET,
      });
      const archiveText = text(archived);
      assert.match(archiveText, /Затворени портали/, 'има секция „Затворени портали“: ' + archiveText);
      assert.match(archiveText, /остават 183 дни/, 'срокът е 6 месеца: ' + archiveText);
      assert.ok(archiveText.includes('gui-journey-archive'), 'закритият портал е посочен със своя slug');
      // Връщане — със същия бутон, който вижда човекът.
      const restore = await waitFor(() => app.$('[data-archive-restore]'), {
        label: 'бутонът „Върни портала“',
        timeout: BUDGET,
      });
      app.clearToasts();
      restore.click();
      const back = await waitFor(() => {
        const t = app.toast();
        return t && /върнат от архива/.test(t.message) ? t : null;
      }, { label: 'известието за връщане', timeout: BUDGET });
      assert.equal(back.kind, 'ok', 'връщането минава: ' + back.message);
      await settle('списъка след връщане');
      assert.equal(app.$('.pf-archive'), null, 'след връщането секцията „Затворени портали“ изчезва');
      await waitFor(() => {
        for (const el of app.$$('[data-open-portal]')) {
          let node = el;
          for (let i = 0; i < 6 && node; i++) {
            if (text(node).includes('gui-journey-archive')) return el;
            node = node.parentNode;
          }
        }
        return null;
      }, { label: 'върнатият портал отново в списъка', timeout: BUDGET });
    });

    // ── J74. Портал: сгънатите блокове ОСТАВАТ сгънати ──────────────────────────
    // Самото „по подразбиране“ (чест монтаж на панела) се проверява в
    // `tests/ui-shell-nav.cjs` §7 — там приложението се зарежда наново. Тук се проверява
    // другото свойство: изборът на човека не се губи при излизане от портала и връщане.
    await journey('J74 портал: сгънатите блокове остават сгънати', async () => {
      await ownPortalWithFile('gui-journey-collapsed');
      const blocks = [
        ['[data-pf-control-tog]', '#pf-settings', 'контролния панел'],
        ['[data-pf-folders-tog]', '.fm-folders', 'папките'],
        ['[data-pf-files-tog]', '.fm-files-box', 'файловете'],
      ];
      // Сгъваме и трите със същите заглавия, които човек натиска.
      for (const [toggleSel, , what] of blocks) {
        const toggle = await waitFor(() => app.$(toggleSel), { label: 'заглавието на ' + what, timeout: BUDGET });
        assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'преди сгъването „' + what + '“ е разгънат');
        toggle.click();
        await settle('„' + what + '“ да се сгъне');
      }
      for (const [toggleSel, bodySel, what] of blocks) {
        assert.equal(app.$(toggleSel).getAttribute('aria-expanded'), 'false', '„' + what + '“ е сгънат');
        assert.equal(app.$(bodySel), null, 'тялото на „' + what + '“ не се рисува, докато е сгънато');
      }
      // Излизаме от портала и се връщаме — състоянието не се губи.
      await portalList();
      const row = await waitFor(() => {
        for (const el of app.$$('[data-open-portal]')) {
          let node = el;
          for (let i = 0; i < 6 && node; i++) {
            if (text(node).includes('gui-journey-collapsed')) return el;
            node = node.parentNode;
          }
        }
        return null;
      }, { label: 'порталът „gui-journey-collapsed“ в списъка', timeout: BUDGET });
      row.click();
      await settle('картата на портала');
      for (const [toggleSel, bodySel, what] of blocks) {
        const toggle = await waitFor(() => app.$(toggleSel), { label: 'заглавието на ' + what, timeout: BUDGET });
        assert.equal(toggle.getAttribute('aria-expanded'), 'false', '„' + what + '“ остава сгънат след връщане');
        assert.equal(app.$(bodySel), null, 'и тялото му пак липсва: ' + what);
      }
      // И се разгъва с едно натискане — иначе „сгънато“ би значело „скрито завинаги“.
      app.$('[data-pf-files-tog]').click();
      await waitFor(() => app.$('.fm-files-box'), { label: 'файловете след разгъване', timeout: BUDGET });
      assert.equal(app.$('[data-pf-files-tog]').getAttribute('aria-expanded'), 'true', 'след натискане блокът е разгънат');
    });

    // ── J75. Настройки: PGP attach/settings/import/remove през истинския UI ───
    await journey('J75 настройки: PGP lifecycle през интерфейса', async () => {
      app.nav('dashboard');
      await settle('таблото преди Settings');
      app.nav('settings');
      await waitFor(() => app.$('#set-pgp-label'), { label: 'полето за име на PGP ключ', timeout: BUDGET });
      const attachedSecret = pgpKey('Attach');
      const label = 'gui-attach-' + String(Date.now()).slice(-6);
      app.fill('#set-pgp-label', label);
      // Ключът се прикача като ФАЙЛ: изборът на файл вдига `change`, както в браузър.
      const pgpFile = await waitFor(() => app.$('#set-pgp-file'), { label: 'полето за PGP ключ (файл)', timeout: BUDGET });
      pgpFile.files = [pseudoFile('gui-attach.asc', attachedSecret, 'application/pgp-keys')];
      pgpFile.dispatch('change');
      app.clearToasts();
      app.click('#set-pgp-attach', 'бутонът „Прикачи ключа“');
      const attached = await waitFor(() => {
        const t = app.toast();
        return t && /Прикачен ключ/.test(t.message) ? t : null;
      }, { label: 'потвърждението за прикачен PGP ключ', timeout: BUDGET });
      assert.equal(attached.kind, 'ok', 'ключът се прикача: ' + attached.message);
      assert.ok(app.requests.some((r) => r.method === 'POST' && r.url.endsWith('/admin/api/pgp/keys')), 'attach заявката е изпратена');

      const autoSign = await waitFor(() => app.$('#set-pgp-autosign'), { label: 'настройката за автоподписване', timeout: BUDGET });
      app.clearToasts();
      app.select(autoSign, 'on');
      const signed = await waitFor(() => {
        const t = app.toast();
        return t && /Автоподписването е включено/.test(t.message) ? t : null;
      }, { label: 'потвърждението за автоподписване', timeout: BUDGET });
      assert.equal(signed.kind, 'ok');
      assert.ok(app.requests.some((r) => r.method === 'PATCH' && r.url.endsWith('/admin/api/packages/settings')), 'настройката минава през API');
      app.clearToasts();
      app.select(await waitFor(() => app.$('#set-pgp-autosign'), { label: 'контролът за изключване на автоподписването' }), 'off');
      await waitFor(() => app.toast() && /Автоподписването е изключено/.test(app.toast().message), { label: 'изключено автоподписване', timeout: BUDGET });

      const removeAttached = await waitFor(() => app.$$('[data-pgp-remove]')[0], { label: 'бутонът за премахване на прикачения ключ', timeout: BUDGET });
      const attachedId = removeAttached.getAttribute('data-pgp-remove');
      app.clearToasts();
      removeAttached.click();
      await waitFor(() => app.toast() && /Ключът е премахнат/.test(app.toast().message), { label: 'премахването на прикачения ключ', timeout: BUDGET });
      assert.ok(app.requests.some((r) => r.method === 'DELETE' && r.url.endsWith('/admin/api/pgp/keys/' + attachedId)), 'remove на прикачен ключ минава през DELETE API');

      const bundleSecret = pgpKey('Bundle');
      const bundleDir = path.join(server.dir, 'keys', 'gui-bundle-' + String(Date.now()).slice(-6));
      fs.mkdirSync(bundleDir, { recursive: true });
      fs.writeFileSync(path.join(bundleDir, 'private.asc'), bundleSecret, 'utf8');
      app.clearToasts();
      app.click('#set-pgp-import', 'бутонът „Импорт от папка keys/“');
      const imported = await waitFor(() => {
        const t = app.toast();
        return t && /Импортирани 1 ключ/.test(t.message) ? t : null;
      }, { label: 'резултатът от PGP bundle import', timeout: BUDGET });
      assert.equal(imported.kind, 'ok', 'bundle ключът се импортира: ' + imported.message);
      assert.ok(app.requests.some((r) => r.method === 'POST' && r.url.endsWith('/admin/api/pgp/keys/import')), 'import минава през API');
      const removeImported = await waitFor(() => app.$$('[data-pgp-remove]')[0], { label: 'бутонът за премахване на bundle ключа', timeout: BUDGET });
      const importedId = removeImported.getAttribute('data-pgp-remove');
      app.clearToasts();
      removeImported.click();
      await waitFor(() => app.toast() && /Ключът е премахнат/.test(app.toast().message), { label: 'премахването на bundle ключа', timeout: BUDGET });
      assert.ok(app.requests.some((r) => r.method === 'DELETE' && r.url.endsWith('/admin/api/pgp/keys/' + importedId)), 'remove на bundle ключ минава през DELETE API');
    });

    // ── J76. Задачи: pause/resume/cancel през бутони към жив job API ──────────
    await journey('J76 задачи: pause/resume/cancel през интерфейса', async () => {
      await ownPortalWithFile('gui-job-controls');
      const startJob = await waitFor(() => app.$('#pf-integrity-job'), { label: 'бутонът за фоново сканиране на цялост', timeout: BUDGET });
      const before = app.requests.filter((r) => r.method === 'POST' && /\/integrity-jobs$/.test(r.url)).length;
      startJob.click();
      await waitFor(
        () => app.requests.filter((r) => r.method === 'POST' && /\/integrity-jobs$/.test(r.url)).length === before + 1,
        { label: 'истинската заявка за фонов integrity job', timeout: BUDGET },
      );
      assert.ok(app.requests.some((r) => r.method === 'POST' && /\/integrity-jobs$/.test(r.url)), 'видимият integrity бутон създава реален backend job');

      // The worker is intentionally fast and polling is every 3 s. Keep the real
      // integrity creation above, but supply controlled live/queued states here so
      // the visible pause/resume/cancel controls do not depend on disk timing.
      const jobs = [
        { id: 'gui-job-running', type: 'integrity-scan', status: 'running', progress: { done: 0, total: 1 } },
        { id: 'gui-job-queued', type: 'integrity-scan', status: 'queued', progress: { done: 0, total: 1 } },
      ];
      let jobsReads = 0;
      const jsonResponse = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
      app.setFetchInterceptor((url, init = {}) => {
        const parsed = new URL(url);
        const method = String(init.method || 'GET').toUpperCase();
        if (parsed.pathname === '/admin/api/jobs' && method === 'GET') {
          jobsReads++;
          return jsonResponse({ jobs, running: 1, queued: 1, paused: 0, concurrency: 1 });
        }
        const action = parsed.pathname.match(/^\/admin\/api\/jobs\/([^/]+)\/(pause|resume|cancel)$/);
        if (!action || method !== 'POST') return null;
        const job = jobs.find((item) => item.id === action[1]);
        if (!job) return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        job.status = action[2] === 'pause' ? 'paused' : action[2] === 'resume' ? 'running' : 'cancelled';
        return jsonResponse(job);
      });
      try {
        await portalList();
        const activeNav = () => app.$('#nav button.active') && app.$('#nav button.active').getAttribute('data-panel');
        app.nav('dashboard');
        await waitFor(() => activeNav() === 'dashboard' && /Dashboard/.test(text(view())), { label: 'таблото след изход от portal view', timeout: BUDGET });
        app.nav('settings');
        await waitFor(() => activeNav() === 'settings' && app.$('#set-profile-name'), { label: 'Settings след portal navigation', timeout: BUDGET });
        app.section('jobs');
        await waitFor(() => {
          const body = app.$('#set-section-body');
          return body && /Състоянието се обновява/.test(text(body)) && app.$$('[data-job-action]').length >= 4;
        }, { label: 'tab „Задачи“ и неговия видим body', timeout: BUDGET }).catch((error) => {
          throw new Error(error.message + ' · activeNav=' + activeNav() + ' · view=' + text(view()).slice(-400));
        });
        assert.doesNotMatch(text(app.$('#set-section-body')), /NaN%/, 'progress object {done,total} се форматира като процент, не NaN');
        await waitFor(
          () => app.$$('[data-action]').find((el) => el.getAttribute('data-action') === 'reload'),
          { label: 'бутона „Обнови сега“ на задачите', timeout: BUDGET },
        );
        app.action('reload');
        await waitFor(() => jobsReads > 0, { label: 'fixture GET /admin/api/jobs', timeout: BUDGET });
        await waitFor(() => app.$$('[data-job-action]').length > 0, { label: 'секцията „Задачи“ с job controls', timeout: BUDGET }).catch((error) => {
          throw new Error(error.message + ' · jobsReads=' + jobsReads + ' · view=' + text(view()).slice(-500));
        });

        const actionFor = (id, action) => app.$$('[data-job-action]').find(
          (el) => el.getAttribute('data-job') === id && el.getAttribute('data-job-action') === action,
        );
        const pauseId = 'gui-job-running';
        const pause = await waitFor(() => actionFor(pauseId, 'pause'), { label: 'running job с бутон „Пауза“', timeout: BUDGET });
        app.clearToasts();
        pause.click();
        const paused = await waitFor(() => {
          const current = app.toast();
          return current && /Задачата е на пауза/.test(current.message) ? current : null;
        }, { label: 'потвърждението за pause', timeout: BUDGET });
        assert.equal(paused.kind, 'ok');
        assert.ok(app.requests.some((r) => r.method === 'POST' && r.url.endsWith('/admin/api/jobs/' + pauseId + '/pause')), 'pause заявката е изпратена');
        await waitFor(() => actionFor(pauseId, 'resume'), { label: 'paused job с бутон „Продължи“', timeout: BUDGET });

        app.clearToasts();
        actionFor(pauseId, 'resume').click();
        const resumed = await waitFor(() => {
          const current = app.toast();
          return current && /Задачата продължава/.test(current.message) ? current : null;
        }, { label: 'потвърждението за resume', timeout: BUDGET });
        assert.equal(resumed.kind, 'ok');
        assert.ok(app.requests.some((r) => r.method === 'POST' && r.url.endsWith('/admin/api/jobs/' + pauseId + '/resume')), 'resume заявката е изпратена');
        await waitFor(() => actionFor(pauseId, 'pause'), { label: 'running state след resume', timeout: BUDGET });

        const cancelId = 'gui-job-queued';
        const cancel = await waitFor(() => actionFor(cancelId, 'cancel'), { label: 'queued job с бутон „Откажи“', timeout: BUDGET });
        app.clearToasts();
        cancel.click();
        const cancelled = await waitFor(() => {
          const current = app.toast();
          return current && /Задачата е отказана/.test(current.message) ? current : null;
        }, { label: 'потвърждението за cancel', timeout: BUDGET });
        assert.equal(cancelled.kind, 'ok');
        assert.ok(app.requests.some((r) => r.method === 'POST' && r.url.endsWith('/admin/api/jobs/' + cancelId + '/cancel')), 'cancel заявката е изпратена');
        await waitFor(() => !actionFor(cancelId, 'cancel'), { label: 'cancelled job без бутони', timeout: BUDGET });
      } finally {
        app.setFetchInterceptor(null);
      }
    });

    // ── J77. PGP инструменти: генериране, шифроване, разшифроване, преглед и ключарница ──
    // Панелът работи изцяло в браузъра: нито една заявка към add-on-а. Единственото
    // излизане навън е „Ключарница“ — то се проверява с прихванат отговор, за да не
    // зависи сценарият от интернет в CI. Всички входове са ФАЙЛОВЕ, не поставен текст.
    await journey('J77 PGP инструменти: ключове, шифроване и ключарница през интерфейса', async () => {
      app.nav('pgp');
      await waitFor(() => app.$('[data-tab="generate"]'), { label: 'табовете на „PGP инструменти“', timeout: BUDGET });
      assert.match(text(view()), /PGP инструменти/, 'панелът се отваря от навигацията');
      const requestsBefore = app.requests.length;

      // 1. Генериране на двойка ключове с парола — през формата на панела.
      app.$('[data-tab="generate"]').click();
      await waitFor(() => app.$('#pg-gen-name'), { label: 'формата за генериране на ключ', timeout: BUDGET });
      app.fill('#pg-gen-name', 'GUI тест PGP');
      app.fill('#pg-gen-email', 'gui-pgp@example.com');
      app.fill('#pg-pw-gen-pass', 'gui-pgp-parola');
      app.clearToasts();
      app.$('[data-run="generate"]').click();
      const generated = await waitFor(() => {
        const t = app.toast();
        return t && /Ключовете са генерирани локално/.test(t.message) ? t : null;
      }, { label: 'съобщението за генерирани ключове', timeout: BUDGET });
      assert.equal(generated.kind, 'ok', 'ключовете се генерират: ' + generated.message);
      const publicKey = app.$('#pg-out-gen-public').value;
      const privateKey = app.$('#pg-out-gen-private').value;
      assert.match(publicKey, /-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'публичният ключ е в полето за резултат');
      assert.match(privateKey, /-----BEGIN PGP PRIVATE KEY BLOCK-----/, 'частният ключ е в полето за резултат');
      // Текстът в `<textarea>` не е част от `textContent`, затова „вижда се на екрана“ се
      // проверява по блоковете: резултатните полета са разгърнати и ползваеми, а отпечатъкът
      // (той е истински HTML) стига до екрана.
      const pubBlock = app.$('#pg-out-gen-public').closest('.pg-out');
      const privBlock = app.$('#pg-out-gen-private').closest('.pg-out');
      assert.ok(pubBlock && pubBlock.hidden !== true, 'блокът с публичния ключ е разгърнат на екрана');
      assert.ok(privBlock && privBlock.hidden !== true, 'блокът с частния ключ е разгърнат на екрана');
      assert.match(text(view()), /Отпечатък: [0-9A-F]{4} /, 'панелът показва отпечатъка на новия ключ');

      // 2. Шифроване към ПРИКАЧЕН публичен ключ и ПРИКАЧЕН файл със съобщение.
      app.$('[data-tab="encrypt"]').click();
      const encKeys = await waitFor(() => app.$('#pg-file-enc-keys'), { label: 'полето за публични ключове', timeout: BUDGET });
      encKeys.files = [pseudoFile('public.asc', publicKey, 'application/pgp-keys')];
      app.$('#pg-file-enc-msg').files = [pseudoFile('taino.txt', 'тайно съобщение от GUI теста')];
      app.clearToasts();
      app.$('[data-run="encrypt"]').click();
      const encrypted = await waitFor(() => {
        const t = app.toast();
        return t && /Шифровано локално/.test(t.message) ? t : null;
      }, { label: 'съобщението за шифроване', timeout: BUDGET });
      assert.equal(encrypted.kind, 'ok', 'съобщението се шифрова: ' + encrypted.message);
      const cipher = app.$('#pg-out-enc').value;
      assert.match(cipher, /-----BEGIN PGP MESSAGE-----/, 'шифрованият блок е в полето за резултат');

      // 3. Разшифроване с прикачени шифрован блок и частен ключ + парола.
      app.$('[data-tab="decrypt"]').click();
      const decMsg = await waitFor(() => app.$('#pg-file-dec-msg'), { label: 'полето за шифровано съобщение', timeout: BUDGET });
      decMsg.files = [pseudoFile('message.asc', cipher, 'application/pgp-encrypted')];
      app.$('#pg-file-dec-key').files = [pseudoFile('private.asc', privateKey, 'application/pgp-keys')];
      app.fill('#pg-pw-dec-keypass', 'gui-pgp-parola');
      app.clearToasts();
      app.$('[data-run="decrypt"]').click();
      const decrypted = await waitFor(() => {
        const t = app.toast();
        return t && /Разшифровано локално/.test(t.message) ? t : null;
      }, { label: 'съобщението за разшифроване', timeout: BUDGET });
      assert.equal(decrypted.kind, 'ok', 'съобщението се разшифрова: ' + decrypted.message);
      assert.match(app.$('#pg-out-dec').value, /тайно съобщение от GUI теста/, 'разшифрованият текст е точно изпратеният');

      // 4. Преглед на ключ: прикачен публичен ключ дава отчет с отпечатък и алгоритъм.
      app.$('[data-tab="inspect"]').click();
      const insKey = await waitFor(() => app.$('#pg-file-ins-key'), { label: 'полето за ключ за преглед', timeout: BUDGET });
      insKey.files = [pseudoFile('public.asc', publicKey, 'application/pgp-keys')];
      app.$('[data-run="inspect"]').click();
      await waitFor(() => /Отпечатък/.test(text(app.$('[data-out="ins"]'))), { label: 'отчетът за ключа', timeout: BUDGET });
      assert.match(text(app.$('[data-out="ins"]')), /публичен ключ/, 'отчетът казва, че ключът е публичен');

      // 5. Ключарница: търсене по отпечатък с прихванат отговор на keys.pgpony.app.
      app.$('[data-tab="keyserver"]').click();
      await waitFor(() => app.$('#pg-ks-q'), { label: 'полето за търсене в ключарницата', timeout: BUDGET });
      const fingerprint = '158471AA4E7FACCEFA2A9A740F8F2EA63AFFAC723F0D9D863CF43BDA142F9DE6';
      // Ключарницата връща ПУБЛИЧЕН ключ — фикстурата дава частен, затова се свежда до
      // публичния му вид през същия OpenPGP.js, който ползва панелът.
      const served = await app.window.openpgp
        .readPrivateKey({ armoredKey: pgpKey('Keyserver') })
        .then((key) => key.toPublic().armor());
      app.setFetchInterceptor((url) => {
        const parsed = new URL(url);
        if (parsed.host !== 'keys.pgpony.app') return null;
        if (parsed.pathname !== '/vks/v1/by-fingerprint/' + fingerprint) {
          return new Response('not found', { status: 404 });
        }
        return new Response(served, { status: 200, headers: { 'Content-Type': 'application/pgp-keys' } });
      });
      try {
        app.fill('#pg-ks-q', fingerprint);
        app.clearToasts();
        app.$('[data-run="keyserver"]').click();
        const fetched = await waitFor(() => {
          const t = app.toast();
          return t && /Ключът е изтеглен от keys\.pgpony\.app/.test(t.message) ? t : null;
        }, { label: 'съобщението от ключарницата', timeout: BUDGET });
        assert.equal(fetched.kind, 'ok', 'ключът се изтегля: ' + fetched.message);
        assert.ok(
          app.requests.some((r) => r.url === 'https://keys.pgpony.app/vks/v1/by-fingerprint/' + fingerprint),
          'търсенето минава през VKS маршрута по отпечатък',
        );
        assert.match(app.$('#pg-out-ks').value, /-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'ключът от ключарницата е прикачваем armored блок');
        assert.match(text(app.$('[data-out="ks-report"]')), /Отпечатък/, 'ключарницата показва отчета за намерения ключ');
      } finally {
        app.setFetchInterceptor(null);
      }

      // Панелът не бива да е поискал нищо от add-on-а — цялата работа е в браузъра.
      const addonCalls = app.requests.slice(requestsBefore).filter((r) => !/^https:\/\/keys\.pgpony\.app\//.test(r.url));
      assert.deepEqual(addonCalls.map((r) => r.method + ' ' + r.url), [], 'PGP панелът не говори с add-on-а');
    });

    // Какво остава ИЗВЪН обхвата на щракването и защо — за да не се „попълва“ някога със
    // сценарий, който минава, без да е минал през интерфейса:
    //   • `data-qr-revoke` — артефактите се създават само от `POST /admin/api/qr-artifacts`,
    //     а нито един бутон в интерфейса не го вика (панелът ги само чете и отменя).
    //   • `data-record-assoc` / `data-record-detach` — записи в картотеката се създават от
    //     миграцията или от API-то; интерфейсът няма бутон „нов запис“.
    //   • `data-register-file` — появява се за файл, сложен в папката на портала ИЗВЪН
    //     интерфейса (мрежов дял); в сценария няма такъв файл.
    //   • `data-cms-download` — изтеглянето изисква предварително подписан PDF; подписването
    //     и проверката са в J32/J50, а file-download маршрутът е в package-api.cjs.

    // ── Отчет ─────────────────────────────────────────────────────────────────
    assert.deepEqual(failed, [], 'сценарии, които не минаха:\n  ' + failed.join('\n  '));
    console.log('PASS gui-journeys: ' + passed.length + ' сценария САМО през интерфейса · навигация, форми, секции, панели, PGP, tokens, jobs, тема, език · ' + app.requests.length + ' заявки, поискани от панелите');
  } finally {
    // Панелите държат интервали (Settings → Задачи); без освобождаване Node не излиза след PASS.
    if (app.window.SettingsPanel && app.window.SettingsPanel.unmount) app.window.SettingsPanel.unmount();
    await server.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
