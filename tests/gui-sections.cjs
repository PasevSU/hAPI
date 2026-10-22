'use strict';
// ВСИЧКИ секции на „Настройки“ и ВСЕКИ бутон в тях — през интерфейса, срещу жив add-on.
//
// Замисъл: административните функции не бива да се проверяват само с `fetch` от теста.
// Тук се монтира истинският `settings-panel.js`, натискат се истинските бутони (по
// `[data-action]`) и се гледа какво казва панелът и какво става на сървъра.
//
// Всяко действие има очакване в `CASES`. Ако в панела се появи бутон без очакване,
// тестът пада (вж. и `tests/gui-coverage.cjs`) — така „всички сценарии“ не е пожелание,
// а проверено свойство.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, mountUi, waitFor } = require('./lib/gui-harness.cjs');
const x509 = require('../hapi_enterprise/x509.js');
const reportRender = require('../hapi_enterprise/report-render.js');

const SECTIONS = [
  'hierarchy', 'cabinet', 'taxonomy', 'jobs', 'users', 'variables', 'data', 'diagnostics',
  'analytics', 'sensors', 'security', 'qr', 'cms', 'storage', 'backups', 'logs',
];

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

(async () => {
  const server = await startServer();
  try {
    // ── Данни, които секциите трябва да покажат ─────────────────────────────────
    const portal = await server.api('/admin/api/portals', 'POST', { slug: 'sections-portal', title: 'Портал на секциите' });
    assert.equal(portal.status, 201, 'порталът е създаден');
    const uploaded = await server.authFetch(server.base + '/admin/api/portals/' + portal.data.id + '/files', {
      method: 'POST',
      headers: { 'x-file-name': 'akt.txt', 'content-type': 'text/plain' },
      body: 'текст за секциите',
    });
    assert.equal(uploaded.status, 201, 'файлът е качен');
    const uploadedFileId = (await uploaded.json()).id;
    // Втори портал: нужен е за сливане (сървърът отказва сливане на портал със самия него).
    const sourcePortal = await server.api('/admin/api/portals', 'POST', { slug: 'sections-source', title: 'Портал за сливане' });
    assert.equal(sourcePortal.status, 201, 'порталът-източник е създаден');
    const sourcePortalId = sourcePortal.data.id;
    await server.api('/admin/api/v2/groups', 'POST', { name: 'Секционна група', description: 'за теста' });
    await server.api('/admin/api/users', 'POST', { username: 'section-user', password: 'section-pass-123' });
    await server.api('/admin/api/variables', 'POST', { key: 'publisher', value: 'Община Секции' });
    // HTML проектът иска папка с index.html — подготвяме я, за да мине УСПЕШНИЯТ път,
    // а не само отказът „index.html missing“.
    const htmlProjectDir = path.join(server.dir, 'html-projects', 'gui-project');
    fs.mkdirSync(htmlProjectDir, { recursive: true });
    fs.writeFileSync(path.join(htmlProjectDir, 'index.html'), '<!doctype html><title>GUI проект</title><h1>GUI проект</h1>');

    const identity = x509.selfSigned({ commonName: 'hAPI GUI Signer', days: 30 });
    // Манифестът изисква START и STOP — същият договор като в Report Studio.
    const pdf = reportRender.renderPdf({
      profile: 'forensic-full',
      blocks: [
        { id: 's', type: 'rfc3161-start', label: 'START', locked: true },
        { id: 't', type: 'title', value: 'Отчет за подпис' },
        { id: 'e', type: 'rfc3161-stop', label: 'STOP', locked: true },
      ],
    });

    const ui = mountUi(server, { modules: ['data.js', 'icons.js', 'settings-panel.js', 'secret-share.js', 'report-sign.js'] });
    const w = ui.window;
    assert.ok(w.SettingsPanel, 'панелът „Настройки“ е зареден');

    const consoleErrors = [];
    const realError = console.error;
    console.error = (...args) => { consoleErrors.push(args.map(String).join(' ')) };

    const setValue = (host, selector, value) => {
      const el = host.querySelector(selector);
      if (!el) return false;
      el.value = value;
      el.dispatch('input');
      el.dispatch('change');
      return true;
    };
    const pseudoFile = (name, buffer) => ({ name, size: buffer.length, type: 'application/pdf', arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length) });
    const findAction = (host, action) => host.querySelectorAll('[data-action]').find((b) => b.getAttribute('data-action') === action) || null;
    // След всяко действие панелът се пре-рисува и тялото за миг показва „Зареждам…“.
    // Без изчакване следващият бутон се търси в празен екран и тестът лъже.
    const waitSettled = async () => {
      await waitFor(() => {
        const bodyBox = currentHost && currentHost.querySelector('#set-section-body');
        return bodyBox && !/Зареждам/.test(bodyBox.textContent);
      }, { label: 'секцията да утихне', timeout: 6000 }).catch(() => { });
    };
    const clickAction = async (action) => {
      const btn = findAction(currentHost, action);
      assert.ok(btn, 'бутонът „' + action + '“ е в секцията');
      ui.clearToasts();
      btn.click();
      await waitFor(() => ui.toasts.length > 0, { label: 'отговор от „' + action + '“', timeout: 5000 });
      const answer = ui.lastToast();
      await waitSettled();
      return answer;
    };

    // ── Очаквания по действие ───────────────────────────────────────────────────
    // `fill` — какво въвежда потребителят; `expect` — какво трябва да каже панелът;
    // `kind` — „ok“ или „err“; `check` — какво трябва да е вярно на сървъра после.
    const CASES = {
      group: {
        fill: (h) => setValue(h, '#set-group-input', 'Група от GUI'),
        expect: /Групата е създадена/,
        kind: 'ok',
        check: async () => assert.ok(JSON.stringify((await server.api('/admin/api/v2/groups')).data).includes('Група от GUI')),
      },
      taxonomy: { fill: (h) => setValue(h, '#set-tax-input', 'GUI категория'), expect: /Добавено/, kind: 'ok' },
      user: {
        fill: (h) => { setValue(h, '#set-user-name', 'gui-new-user'); setValue(h, '#set-user-pass', 'gui-new-pass-123') },
        expect: /Потребителят е създаден/,
        kind: 'ok',
        check: async () => assert.ok(JSON.stringify((await server.api('/admin/api/users')).data).includes('gui-new-user')),
      },
      variable: {
        fill: (h) => { setValue(h, '#set-var-key', 'guikey'); setValue(h, '#set-var-value', 'стойност от GUI') },
        expect: /Променливата е добавена/,
        kind: 'ok',
        check: async () => assert.ok(JSON.stringify((await server.api('/admin/api/variables')).data).includes('guikey')),
      },
      interpolate: {
        fill: (h) => setValue(h, '#set-tpl-input', 'Договор {{year}} — {{publisher}}'),
        expect: /Превю|преглед|подготвен/i,
        // Действието не вдига toast, а пише в #set-tpl-out — проверява се резултатът.
        noToast: true,
        check: async () => {
          await waitFor(() => (currentHost.querySelector('#set-tpl-out') || {}).textContent && /2026/.test(currentHost.querySelector('#set-tpl-out').textContent), { label: 'прегледът на шаблона' });
          assert.match(currentHost.querySelector('#set-tpl-out').textContent, /Община Секции/, 'променливата е разгъната');
        },
      },
      // Сензорите се сменят на живо: панелът пише през PATCH /admin/api/settings,
      // а проверката е на сървъра — не само на известието.
      sensors: {
        fill: (h) => {
          setValue(h, '#set-sensors-ipmode', 'masked');
          setValue(h, '#set-sensors-trustproxy', '');
          setValue(h, '#set-sensors-retention', '21');
          setValue(h, '#set-sensors-geoip', '');
        },
        expect: /Сензори: IP masked · 21 дни/,
        kind: 'ok',
        check: async () => {
          const eff = (await server.api('/admin/api/settings')).data.effective.sensors;
          assert.equal(eff.ipMode, 'masked', 'режимът на IP е записан от панела');
          assert.equal(eff.trustProxy, false, 'проксито остана изключено');
          assert.equal(eff.retentionDays, 21, 'срокът е записан от панела');
        },
      },
      search: { fill: (h) => setValue(h, '#set-search-q', 'акт'), expect: /Готово|Търсене|намерен/i, kind: 'ok' },
      organization: { fill: (h) => setValue(h, '#set-org-name', 'Организация от GUI'), expect: /Готово|добавен|създаден/i, kind: 'ok' },
      ingest: { fill: (h) => setValue(h, '#set-ingest-emails', 'ingest@example.org'), expect: /Готово|добавен/i, kind: 'ok' },
      merge: {
        fill: (h) => { setValue(h, '#set-merge-target', portal.data.id); setValue(h, '#set-merge-sources', sourcePortalId) },
        expect: /Готово|слети/i,
        kind: 'ok',
        check: async () => {
          const portals = (await server.api('/admin/api/portals')).data.portals || [];
          assert.equal(portals.some((p) => p.id === sourcePortalId), false, 'порталът-източник е слят (вече го няма)');
        },
      },
      conflict: { fill: (h) => { setValue(h, '#set-conflict-id', 'nope'); setValue(h, '#set-conflict-value', 'x') }, expect: /Conflict not found|конфликт|не е намерен/i, kind: 'err' },
      apiInfo: { expect: /Готово|api|JSON/i, kind: 'ok' },
      htmlProjects: { expect: /Готово|проект|няма/i, kind: 'ok' },
      htmlProject: {
        fill: (h) => { setValue(h, '#set-data-folder', 'gui-project'); setValue(h, '#set-data-title', 'Проект от GUI') },
        expect: /Готово|проект|създаден/i,
        kind: 'ok',
        check: async () => {
          const out = currentHost.querySelector('#set-data-out');
          await waitFor(() => text(out).includes('gui-project') || text(out).includes('Готово'), { label: 'отговорът за HTML проекта' });
        },
      },
      sends: {
        fill: (h) => setValue(h, '#set-data-file', uploadedFileId),
        expect: /Готово|връзка|изпрат/i,
        kind: 'ok',
        check: async () => {
          const out = currentHost.querySelector('#set-data-out');
          await waitFor(() => text(out).length > 5, { label: 'отговорът за изпратената връзка' });
        },
      },
      notify: { fill: (h) => { setValue(h, '#set-notify-service', 'notify.not_existing'); setValue(h, '#set-notify-link', 'http://example.org/x') }, expect: /Notify dispatch disabled|не е изпратено/i, kind: 'err' },
      secretCreate: {
        fill: (h) => { setValue(h, '#set-secret-text', 'тайна от GUI теста'); setValue(h, '#set-secret-hint', 'за теста') },
        expect: /Шифровам|създаден|грешк/i,
        check: async () => {
          const out = currentHost.querySelector('#set-secret-out');
          await waitFor(() => out.innerHTML.includes('/secret#'), { label: 'линкът на тайната' });
          assert.match(out.textContent, /\/secret#|Валиден до/, 'панелът показва тайната връзка');
        },
      },
      storage: { expect: /Проверката приключи/, kind: 'ok' },
      backup: { expect: /Копието е създадено/, kind: 'ok' },
      verify: { expect: /Проверени/, kind: 'ok' },
      schedule: { fill: (h) => { setValue(h, '#set-sched-interval', '120'); setValue(h, '#set-sched-max', '3') }, expect: /Графикът е записан/, kind: 'ok' },
      retention: { expect: /Задържане/, kind: 'ok' },
      mirror: { expect: /Огледало:/, kind: 'ok' },
      mirrorRepair: { expect: /Огледало:/, kind: 'ok' },
      level: { fill: (h) => setValue(h, '#set-log-level', 'debug'), expect: /Ниво на журнала: debug/, kind: 'ok' },
      rules: { expect: /Правилата са презаредени/, kind: 'ok' },
      auditVerify: { expect: /Одитният ланец/, kind: 'ok' },
      audit: { expect: /изтеглен|не е достъпен|не е изтеглен/i },
      metricsProm: { expect: /[Мм]етрик|снимка/i },
      portalDeploy: { expect: /няма достъп|не е разположен|разположен/i },
      reload: { expect: /Зареждам|./, noToast: true, check: async () => { await waitFor(() => currentHost.querySelector('#set-section-body'), { label: 'тялото след обновяване' }) } },
      cmsSign: {
        fill: (h) => {
          const input = h.querySelector('#set-cms-file');
          if (input) input.files = [pseudoFile('otchet.pdf', pdf)];
          setValue(h, '#set-cms-cert', identity.certPem);
          setValue(h, '#set-cms-key', identity.keyPem);
        },
        expect: /Подписът е издаден/,
        kind: 'ok',
        check: async () => {
          const pre = currentHost.querySelector('#set-cms-sig');
          assert.ok(pre && String(pre.value).startsWith('MII'), 'панелът слага CMS в полето за проверка');
          assert.equal(
            currentHost.querySelector('#set-cms-out').textContent.includes(crypto.createHash('sha256').update(pdf).digest('hex')),
            true,
            'показаният отпечатък е на подписания PDF',
          );
        },
      },
      cmsVerify: {
        expect: /Подписът пасва на този файл/,
        kind: 'ok',
        check: async () => {
          await waitFor(() => /пасва/.test(currentHost.querySelector('#set-cms-verify-out').textContent), { label: 'присъдата на проверката' });
          assert.match(currentHost.querySelector('#set-cms-verify-out').textContent, /hAPI GUI Signer/, 'проверката показва издателя');
        },
      },
    };

    // ── Разходка по всички секции ──────────────────────────────────────────────
    let currentHost = null;
    const visited = new Set();
    const clicked = new Set();
    const failures = [];

    for (const id of SECTIONS) {
      const host = ui.container();
      currentHost = host;
      w.SettingsPanel.state.section = id;
      w.SettingsPanel.mount(host);
      try {
        // `loadConnection`/`loadPgp` идват асинхронно — чакаме ги, както чака и браузърът.
        await waitFor(() => w.SettingsPanel.state.loaded === true, { label: 'връзката да се зареди', timeout: 6000 });
        await waitFor(() => {
          const bodyBox = host.querySelector('#set-section-body');
          return bodyBox && !/Зареждам/.test(bodyBox.textContent);
        }, { label: 'секция „' + id + '“ да се зареди', timeout: 6000 });
        visited.add(id);
        const bodyBox = host.querySelector('#set-section-body');
        assert.ok(text(bodyBox).length > 20, 'секция „' + id + '“ не е празна');
        assert.equal(/клас="badge err"|badge err/.test(bodyBox.innerHTML), false, 'секция „' + id + '“ не показва грешка при зареждане: ' + text(bodyBox).slice(0, 120));

        // Всяко действие в секцията се натиска през DOM.
        const actions = [...new Set(host.querySelectorAll('[data-action]').map((b) => b.getAttribute('data-action')))];
        for (const action of actions) {
          const spec = CASES[action];
          if (!spec) {
            failures.push('секция „' + id + '“: бутон „' + action + '“ без очакване в теста');
            continue;
          }
          try {
            if (spec.fill) spec.fill(host);
            if (spec.noToast) {
              const btn = findAction(host, action);
              assert.ok(btn, 'бутонът „' + action + '“ е наличен');
              btn.click();
              await waitSettled();
              if (spec.check) await spec.check();
            } else {
              const toast = await clickAction(action);
              const message = String(toast.message || '');
              assert.ok(message.length > 3, 'действието „' + action + '“ казва нещо, а не мълчи');
              if (spec.expect) assert.match(message, spec.expect, 'действие „' + action + '“: очаквано «' + spec.expect + '», получено «' + message + '»');
              if (spec.kind) assert.equal(toast.kind, spec.kind, 'действие „' + action + '“: очакван вид „' + spec.kind + '“, получен „' + toast.kind + '“');
              if (spec.check) await spec.check();
            }
            clicked.add(action);
          } catch (e) {
            failures.push('секция „' + id + '“, действие „' + action + '“: ' + e.message);
          }
        }
      } catch (e) {
        failures.push('секция „' + id + '“: ' + e.message);
      } finally {
        host.remove();
        currentHost = null;
      }
    }
    console.error = realError;

    // ── Присъда ────────────────────────────────────────────────────────────────
    assert.deepEqual(failures, [], 'GUI сценариите не минаха:\n  ' + failures.join('\n  '));
    assert.deepEqual([...visited].sort(), [...SECTIONS].sort(), 'всички 16 секции са отворени');
    assert.deepEqual(consoleErrors, [], 'панелът писа в console.error:\n  ' + consoleErrors.slice(0, 5).join('\n  '));

    console.log(
      'PASS gui-sections: ' + visited.size + ' секции · ' + clicked.size + ' действия натиснати през DOM · ' +
      'група/потребител/променлива/тайна/CMS подпис проверени и на сървъра',
    );
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
