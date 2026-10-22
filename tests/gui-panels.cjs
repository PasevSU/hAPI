'use strict';
// ВСИЧКИ панели на интерфейса, монтирани срещу ЖИВ add-on.
//
// Правилото на проекта: функция, която не може да се стигне от интерфейса, е недовършена.
// Затова тук се проверява точно това, което вижда потребителят:
//   • панелът се монтира и рисува РЕАЛНИ данни от API-то (не „демо“ числа);
//   • данните се създават ПРЕЗ ФОРМАТА на панела, после се проверява, че списъкът ги
//     показва — целият път DOM → HTTP → DOM;
//   • търсенето във формите наистина филтрира;
//   • нито един панел не пише в console.error и не казва „не е зареден“.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, mountUi, waitFor, root } = require('./lib/gui-harness.cjs');

const PANEL_MODULES = [
  'data.js',
  'icons.js',
  'report-studio.js',
  'portals.js',
  'portal-control.js',
  'portal-folders.js',
  'portal-files.js',
  'files-manager.js',
  'directory-panel.js',
  'dashboard-panel.js',
  'settings-panel.js',
  'export-center.js',
  'public-gateway.js',
  'visitors-panel.js',
  'secret-share.js',
  'report-sign.js',
];

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const buttonByText = (host, pattern) => host.querySelectorAll('button').find((b) => pattern.test(text(b))) || null;

(async () => {
  const server = await startServer();
  try {
    // ── Данни, които панелите трябва да ПОКАЖАТ ──────────────────────────────────
    const portal = await server.api('/admin/api/portals', 'POST', { slug: 'gui-portal', title: 'Портал от GUI теста' });
    assert.equal(portal.status, 201, 'порталът е създаден: ' + JSON.stringify(portal.data));
    const uploaded = await server.authFetch(server.base + '/admin/api/portals/' + portal.data.id + '/files', {
      method: 'POST',
      headers: { 'x-file-name': 'dogovor.txt', 'content-type': 'text/plain' },
      body: 'съдържание от GUI теста',
    });
    assert.equal(uploaded.status, 201, 'файлът е качен');
    await server.api('/admin/api/v2/groups', 'POST', { name: 'GUI група', description: 'от теста' });
    await server.api('/admin/api/users', 'POST', { username: 'gui-user', password: 'gui-pass-123' });
    await server.api('/admin/api/variables', 'POST', { key: 'publisher', value: 'Община Тест' });

    const ui = mountUi(server, { modules: PANEL_MODULES });
    const w = ui.window;

    // ── 1. Модулите са заредени ─────────────────────────────────────────────────
    for (const name of ['HapiDashboardPanel', 'ReportStudio', 'FilesManagerPanel', 'PortalsPanel', 'ExportCenterPanel', 'PublicGatewayPanel', 'ContactsPanel', 'CasesPanel', 'SettingsPanel', 'HapiVisitorsPanel', 'HapiSecretShare', 'HapiReportSign']) {
      assert.ok(w[name], 'липсва ' + name + ' — app.js щеше да покаже „не е зареден“');
    }

    // ── 2. Всеки панел се монтира и рисува очакваното ───────────────────────────
    const NAV = [
      { id: 'dashboard', mount: (h) => w.HapiDashboardPanel.mount(h), expect: ['Портали', 'Файлове в порталите', 'Одитна верига'] },
      { id: 'about', mount: (h) => w.HapiDashboardPanel.mountAbout(h), expect: ['Относно hAPI Enterprise', 'Версия'] },
      { id: 'portals', mount: (h) => w.FilesManagerPanel.mount(h), expect: ['Портали', 'gui-portal', 'Портал от GUI теста'] },
      { id: 'contacts', mount: (h) => w.ContactsPanel.mount(h), expect: ['Контакти', 'Нов контакт'] },
      { id: 'cases', mount: (h) => w.CasesPanel.mount(h), expect: ['Дела', 'Ново дело'] },
      { id: 'gateway', mount: (h) => w.PublicGatewayPanel.mount(h), expect: ['Public Gateway', 'Публични портали'] },
      { id: 'export', mount: (h) => w.ExportCenterPanel.mount(h), expect: ['Export & Download Center', 'Режим на експортиране'] },
      { id: 'report', mount: (h) => w.ReportStudio.mount(h), expect: ['Report Studio', 'Документ структура'] },
      { id: 'visitors', mount: (h) => w.HapiVisitorsPanel.mount(h), expect: ['Кой влиза', 'Уникални посетители', 'Посетители'] },
      { id: 'settings', mount: (h) => { w.SettingsPanel.state.section = 'general'; w.SettingsPanel.mount(h) }, expect: ['Връзка с add-on-а', 'Публичен адрес'] },
    ];

    const missing = [];
    const consoleErrors = [];
    const realError = console.error;
    console.error = (...args) => { consoleErrors.push(args.map(String).join(' ')) };
    try {
      for (const nav of NAV) {
        const host = ui.container();
        try {
          nav.mount(host);
          await waitFor(() => nav.expect.every((needle) => text(host).includes(needle)), {
            label: 'панел „' + nav.id + '“ да покаже ' + nav.expect.join(' / '),
            timeout: 15000,
          });
          assert.equal(host.innerHTML.includes('не е зареден'), false, 'панел „' + nav.id + '“ казва, че не е зареден');
        } catch (e) {
          missing.push(nav.id + ': ' + e.message + ' · видяно: «' + text(host).slice(0, 160) + '»');
        } finally {
          host.remove();
        }
      }
    } finally {
      console.error = realError;
    }

    // ── 3. СЪЗДАВАНЕ ПРЕЗ ИНТЕРФЕЙСА: контакт, после дело ──────────────────────
    {
      const host = ui.container();
      w.ContactsPanel.mount(host);
      await waitFor(() => host.querySelector('input[name="f_name"]'), { label: 'формата за контакт' });
      host.querySelector('input[name="f_name"]').value = 'Иван Интерфейсов';
      host.querySelector('input[name="email"]').value = 'ivan.gui@example.org';
      host.querySelector('input[name="f_organization"]').value = 'Община GUI';
      const add = buttonByText(host, /^Добави контакта$/);
      assert.ok(add, 'има бутон „Добави контакта“');
      ui.clearToasts();
      add.click();
      await waitFor(() => text(host).includes('Иван Интерфейсов'), { label: 'списъкът да покаже новия контакт' });
      const contacts = await server.api('/admin/api/directory');
      assert.ok(JSON.stringify(contacts.data).includes('ivan.gui@example.org'), 'контактът е записан на сървъра през интерфейса: ' + JSON.stringify(contacts.data).slice(0, 200));
      host.remove();
    }
    {
      const host = ui.container();
      w.CasesPanel.mount(host);
      await waitFor(() => host.querySelector('input[name="number"]'), { label: 'формата за дело' });
      host.querySelector('input[name="number"]').value = 'GUI-2026-001';
      host.querySelector('input[name="title"]').value = 'Дело от интерфейса';
      const add = buttonByText(host, /^Добави делото$/);
      assert.ok(add, 'има бутон „Добави делото“');
      ui.clearToasts();
      add.click();
      await waitFor(() => text(host).includes('GUI-2026-001'), { label: 'делото да се появи в списъка' });
      const cases = await server.api('/admin/api/cases');
      assert.ok(JSON.stringify(cases.data).includes('GUI-2026-001'), 'делото е записано на сървъра през интерфейса');
      host.remove();
    }

    // ── 4. Търсенето във формата ФИЛТРИРА (не само рисува поле) ─────────────────
    {
      const host = ui.container();
      w.ContactsPanel.mount(host);
      await waitFor(() => text(host).includes('Иван Интерфейсов'), { label: 'списъкът с контакти' });
      const search = host.querySelector('#ct-search');
      assert.ok(search, 'има поле за търсене #ct-search');
      search.value = 'няма-такъв-контакт-xyz';
      search.dispatch('input');
      const searchBtn = buttonByText(host, /Търси/i);
      if (searchBtn) searchBtn.click();
      await waitFor(() => !text(host).includes('Иван Интерфейсов'), { label: 'търсенето да скрие несъвпадащия контакт' });
      host.remove();
    }

    // ── 5. Report Studio: присъдата идва от валидатора, не от теста ─────────────
    {
      const host = ui.container();
      w.ReportStudio.mount(host);
      await waitFor(() => buttonByText(host, /Валидирай/), { label: 'бутона „Валидирай“' });
      ui.clearToasts();
      buttonByText(host, /Валидирай/).click();
      await waitFor(() => ui.toasts.length > 0, { label: 'отговор от валидатора' });
      assert.match((ui.lastToast() || {}).message || '', /валид|грешк|проблем/i, 'валидаторът отговаря с присъда, не мълчи');
      host.remove();
    }

    // ── 6. Нито един панел не бива да „мълчи“ ───────────────────────────────────
    assert.deepEqual(missing, [], 'панелите не показаха очакваното:\n  ' + missing.join('\n  '));
    assert.deepEqual(consoleErrors, [], 'панелите писаха в console.error:\n  ' + consoleErrors.slice(0, 5).join('\n  '));

    // ── 7. Сървърът сервира всички файлове, които панелите искат ────────────────
    const serverSrc = fs.readFileSync(path.join(root, 'hapi_enterprise', 'server.js'), 'utf8');
    for (const file of PANEL_MODULES) assert.ok(serverSrc.includes("'" + file + "'"), 'server.js не сервира ' + file);

    console.log('PASS gui-panels: ' + NAV.length + ' панела на жив add-on · контакт и дело СЪЗДАДЕНИ през формата · търсене филтрира · валидаторът отговаря');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
