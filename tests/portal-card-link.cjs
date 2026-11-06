'use strict';
// КАРТАТА НА ПОРТАЛА: адресът и QR кодът се виждат ВЕДНАГА, а действията по тях работят.
//
// Защо този тест: дотук QR кодът стоеше най-долу в дясната колона на СГЪНАТИЯ контролен
// панел, а адресът се виждаше само като бутон „Копирай адреса“ — тоест до кода се стигаше
// с три действия, а адресът не можеше нито да се прочете, нито да се провери. Освен това
// подписаният достъп на частен портал изтича и НЯМАШЕ как да се обнови от картата.
//
// Тестът пада, ако:
//   • блокът „Връзка и QR код“ не е ПЪРВИ и не е извън сгъваемия контролен панел;
//   • адресът не е истинско поле (не може да се маркира) или не носи подписания достъп;
//   • „Копирай адреса“ не копира ТОЧНО адреса от полето;
//   • „Обнови достъпа“ не иска нов подпис от сървъра и не обновява адреса на място;
//   • „Свали QR“ / „Печат на QR“ не работят (или печатният клас остава след печата);
//   • „Отвори портала“ не води до адреса на портала (същият таб — под Ingress нов таб губи сесията).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, mountUi, waitFor } = require('./lib/gui-harness.cjs');
const { stopChild } = require('./helpers.cjs');

const root = path.join(__dirname, '..');
const uiSrc = (f) => fs.readFileSync(path.join(root, 'hapi_enterprise', 'ui', f), 'utf8');
const panel = uiSrc('portal-control.js');
const manager = uiSrc('files-manager.js');
const css = fs.readFileSync(path.join(root, 'hapi_enterprise', 'ui', 'components.css'), 'utf8');

// ── 1. Блокът е ПЪРВИ и винаги отворен ─────────────────────────────────────
assert.ok(
  panel.indexOf('data-block="link"') > 0 && panel.indexOf('data-block="link"') < panel.indexOf('data-block="control"'),
  'блокът „Връзка и QR код“ се рисува преди контролния панел',
);
assert.match(panel, /\$\{linkBlock\}\s*\n\s*<section class="pf-block \$\{open \? '' : 'pf-collapsed'\}"/, 'адресът и QR кодът НЕ са в сгъваемата част');
assert.match(panel, /id="pf-link-url"/, 'адресът е поле, което се маркира и копира');
assert.match(panel, /id="pf-refresh-access"/, 'има действие за нов подписан достъп');
assert.match(panel, /id="pf-qr-download"/, 'QR кодът може да се свали');
assert.match(panel, /id="pf-qr-print"/, 'QR кодът може да се отпечата');
assert.match(panel, /class="pf-link-state/, 'състоянието на достъпа се вижда (важи/изтекъл)');

// ── 2б. Едно зареждане на сензорите + видим отговор при сваляне на api.json ─
// `mount()` вика `loadMonitor()` и после `reload()`, който също го викаше — тоест панелът
// теглеше сензорите ДВА ПЪТИ при всяко отваряне (и след всяко действие).
assert.match(manager, /monitorInFlight/, 'товарът на сензорите не се повтаря, докато тече');
assert.match(manager, /state\.monitorAt/, 'има кратък кеш за сензорите');
assert.match(manager, /\.finally\(\(\) => \{ monitorInFlight = null \}\)/, 'товарът се освобождава и при грешка');
// Свален файл без съобщение изглежда като нищо — затова свалянето на api.json казва какво е.
assert.match(manager, /това е машинното описание/, 'свалянето на api.json се съобщава');
assert.match(manager, /classList\.add\('printing-qr'\)/, 'печатът на QR слага класа');
assert.match(manager, /finally[\s\S]{0,200}classList\.remove\('printing-qr'\)/, 'класът се маха и при отказ');
assert.match(css, /body\.printing-qr \.pf-link-qr \.qf-svg svg/, 'при печат остава само QR кодът');
// „Отвори портала“ е в СЪЩИЯ таб: под Ingress нов таб губи сесията.
assert.equal(/window\.open/.test(manager), false, 'панелът не отваря нов таб');
// …и подсказката трябва да казва СЪЩОТО, а не да обещава нов таб.
assert.equal(/в нов таб/i.test(panel), false, 'подсказката на „Отвори портала“ не обещава нов таб');
// След промяна на настройките (slug/видимост) адресите се строят НАНОВО — иначе в картата
// остава адрес, който вече връща 404.
assert.match(
  manager,
  /await reload\(\);[\s\S]{0,900}generateApi\(fresh, true, access\)/,
  'след запис на настройките препратките се преизчисляват от обновения портал',
);

(async () => {
  const server = await startServer();
  try {
    // Частен портал: адресът ТРЯБВА да носи подписан достъп, иначе връща 404.
    const made = await server.api('/admin/api/portals', 'POST', {
      slug: 'card-link-demo',
      title: 'Портал с код',
      visibility: 'private',
    });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const portalId = made.data.id;

    const ui = mountUi(server, { modules: ['data.js', 'icons.js', 'portal-control.js', 'portal-folders.js', 'portal-files.js', 'files-manager.js'] });
    ui.window.isSecureContext = true;
    // Броим заявките за сензорите: при отваряне те трябва да са ЕДНА, не две.
    const calls = [];
    const rawFetch = ui.sandbox.fetch;
    ui.sandbox.fetch = (url, init) => {
      calls.push(String(url));
      return rawFetch(url, init);
    };
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portalId;
    ui.window.FilesManagerPanel.state.panel = 'actions';
    ui.window.FilesManagerPanel.mount(host);
    await waitFor(() => host.textContent.includes('Връзка и QR код'), { label: 'блокът за връзката и QR' });

    // ── 3. Адресът и кодът са налични БЕЗ да се отваря контролният панел ────
    const field = await waitFor(() => host.querySelector('#pf-link-url'), { label: 'полето с адреса' });
    assert.match(field.value, /\/p\/[0-9a-f]{16,}/, 'полето носи адреса на портала: ' + field.value);
    assert.match(field.value, /expires=/, 'частният портал носи подписан достъп: ' + field.value);
    assert.ok(host.querySelector('.pf-link-qr .qf-svg svg'), 'QR кодът е нарисуван до адреса');

    // ── 4. „Копирай адреса“ копира ТОЧНО адреса от полето ──────────────────
    const copy = host.querySelector('#pf-copy-portal');
    assert.ok(copy, 'бутонът „Копирай адреса“ е в блока');
    copy.click();
    await waitFor(() => ui.copied.length > 0, { label: 'копиран адрес' });
    assert.equal(ui.copied[ui.copied.length - 1], field.value, 'копираното е адресът, който се вижда');

    // ── 5. „Обнови достъпа“ иска нов подпис и обновява адреса ───────────────
    // Чака се СЪОБЩЕНИЕТО за обновяването, не „някакво съобщение“: копирането е асинхронно
    // (`navigator.clipboard.writeText`) и може да вдигне своето съобщение след `clearToasts`.
    await waitFor(() => ui.toasts.some((t) => /копиран/i.test(t.message)), { label: 'съобщението за копиране' });
    const before = ui.requests ? ui.requests.length : 0;
    ui.clearToasts();
    host.querySelector('#pf-refresh-access').click();
    await waitFor(() => ui.toasts.some((t) => /нов подписан достъп|публичен/i.test(t.message)), {
      label: 'отговорът от обновяването',
    });
    const infoCall = (ui.requests || []).slice(before).find((r) => r.url.endsWith('/api-info'));
    if (ui.requests) assert.ok(infoCall, 'панелът поиска нов подпис от сървъра (/api-info)');
    await waitFor(() => {
      const f = host.querySelector('#pf-link-url');
      return f && /expires=/.test(f.value);
    }, { label: 'обновеният адрес' });
    const fresh = host.querySelector('#pf-link-url').value;
    const res = await fetch(fresh);
    assert.equal(res.status, 200, 'обновеният адрес се отваря: ' + res.status);
    assert.match(await res.text(), /portal\.js/, 'обновеният адрес е истинската страница на портала');

    // ── 6. „Свали QR“ и „Печат на QR“ ─────────────────────────────────────
    ui.clearToasts();
    host.querySelector('#pf-qr-download').click();
    await waitFor(() => ui.toasts.some((t) => /свален като SVG/.test(t.message)), {
      label: 'съобщението за сваления QR',
    });

    ui.clearToasts();
    host.querySelector('#pf-qr-print').click();
    await waitFor(() => ui.toasts.some((t) => /към печат/.test(t.message)), {
      label: 'съобщението за печата',
    });
    assert.equal(
      ui.window.document.body.classList.contains('printing-qr'),
      false,
      'печатният клас е махнат след печата (иначе следващият печат е празен)',
    );

    // ── 6б. Сензорите се теглят ВЕДНЪЖ за отваряне, а настройките наистина се запазват ──
    const monitorCalls = calls.filter((c) => c.endsWith('/admin/api/sensors'));
    assert.equal(monitorCalls.length, 1, 'сензорите се теглят един път при отваряне, а не два: ' + monitorCalls.length);

    const toggle = host.querySelector('[data-pf-control-tog]');
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
    const settings = await waitFor(() => host.querySelector('#pf-settings'), { label: 'формата с настройките' });
    settings.querySelector('[name="title"]').value = 'Портал с код (обновен)';
    ui.clearToasts();
    settings.querySelector('button[type="submit"]').click();
    await waitFor(() => ui.toasts.some((t) => /обновен/i.test(t.message)), { label: 'съобщението след запис' });
    const saved = await server.api('/admin/api/portals/' + portalId);
    assert.equal(saved.data.title, 'Портал с код (обновен)', 'заглавието стигна до сървъра');

    // ── 7. „Отвори портала“ води до адреса на портала (същият таб) ─────────
    ui.window.location.href = 'about:blank';
    host.querySelector('#pf-open-portal').click();
    await waitFor(() => /\/p\/[0-9a-f]{16,}/.test(String(ui.window.location.href)), { label: 'адресът след „Отвори портала“' });
    assert.match(String(ui.window.location.href), /\/p\/[0-9a-f]{16,}/, 'отваря се порталът, а не панелът');
    host.remove();
  } finally {
    await stopChild(server.child);
  }
  console.log(
    'PASS portal-card-link: адресът и QR са първи и винаги видими · копира се същият адрес · ' +
    'обновяването иска нов подпис и адресът се отваря · QR се сваля и печата · „Отвори портала“ води до портала · ' +
    'сензорите се теглят веднъж · настройките се запазват',
  );
})();
