'use strict';
// КАРТАТА НА ПОРТАЛА: QR кодът се вижда ВЕДНАГА и е вход към портала.
//
// Защо този тест: дотук QR кодът стоеше най-долу в дясната колона на СГЪНАТИЯ контролен
// панел. После до него застана адрес с „Копирай“, но копираното водеше към API-то (JSON),
// а не към страницата, а „Свали api.json“ не даваше файл. Затова картата остава само с
// кода — най-вдясно — и с действията по него; двойно щракване върху кода отваря портала.
//
// Тестът пада, ако:
//   • блокът „Достъп и QR код“ не е ПЪРВИ и не е извън сгъваемия контролен панел;
//   • картата пак показва адрес, „Копирай“ или сваля api.json;
//   • QR кодът не е ЕДИН, не е последен в блока (най-вдясно) и не носи адреса на портала;
//   • двойното щракване върху кода не отваря портала, а единичното — изкарва човека от панела;
//   • „Обнови достъпа“ не иска нов подпис от сървъра и не обновява кода на място;
//   • „Свали QR“ / „Печат на QR“ не работят (или печатният клас остава след печата);
//   • настройките на портала са пак в ЕДИН стълб, вместо в мрежа, която пада колона по колона;
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

// ── 1. Блокът е ПЪРВИ, винаги отворен и БЕЗ адрес ──────────────────────────
assert.ok(
  panel.indexOf('data-block="link"') > 0 && panel.indexOf('data-block="link"') < panel.indexOf('data-block="control"'),
  'блокът „Достъп и QR код“ се рисува преди контролния панел',
);
assert.match(panel, /\$\{linkBlock\}\s*\n\s*<section class="pf-block \$\{open \? '' : 'pf-collapsed'\}"/, 'QR кодът НЕ е в сгъваемата част');
assert.match(panel, /id="pf-refresh-access"/, 'има действие за нов подписан достъп');
assert.match(panel, /id="pf-qr-download"/, 'QR кодът може да се свали');
assert.match(panel, /id="pf-qr-print"/, 'QR кодът може да се отпечата');
assert.match(panel, /class="pf-link-state/, 'състоянието на достъпа се вижда (важи/изтекъл)');
// 0.69.181: адресът, „Копирай“ и „Свали api.json“ са махнати от картата — копираният адрес
// водеше към API-то (JSON), а не към портала (това видя човек в браузъра си).
assert.equal(/id="pf-link-url"/.test(panel), false, 'адресът не се показва като поле');
assert.equal(/id="pf-copy-portal"/.test(panel + manager), false, 'няма „Копирай адреса“');
assert.equal(/id="pf-dl-api"/.test(panel + manager), false, 'няма сваляне на api.json');
assert.equal(/\bdownloadJson\b/.test(manager), false, 'мъртвият JSON помощник е махнат');
assert.equal(/\bcopyText\(state\.api/.test(manager), false, 'картата не копира адреси');

// ── 1в. QR кодът в панела е ЕДИН — този на портала ────────────────────────
// Дотук всеки файл и всяка папка рисуваха свой код с друг адрес (подписан за един час или
// администраторски, който иска вход) — при 30 файла това бяха 30 кода, повечето мъртви за
// получателя. Затова кодът е един: в блока „Достъп и QR код“, с действията до него.
assert.equal((panel.match(/class="qf-svg"/g) || []).length, 1, 'картата рисува ТОЧНО един QR код');
assert.match(panel, /class="pf-link-qr" id="pf-portal-qr"/, 'кодът на портала има стабилен идентификатор');
assert.match(panel, /id="pf-portal-qr"[^>]*data-portal-url="\$\{esc\(qrPage\)\}"/, 'кодът носи адреса, който отваря');
assert.match(panel, /portal\.link\.single/, 'картата казва с думи, че кодът е един');
for (const f of fs.readdirSync(path.join(root, 'hapi_enterprise', 'ui'))) {
  if (!f.endsWith('.js') || !/qrSvg\s*\(/.test(uiSrc(f))) continue;
  assert.ok(['portal-control.js', 'files-manager.js'].includes(f), 'qrSvg се вика само за един код, а се среща и в ' + f);
}
assert.equal(/data-file-qr/.test(manager), false, 'файлът няма собствен QR код');
assert.equal(/data-folder-qr/.test(manager + uiSrc('portal-folders.js')), false, 'папката няма собствен QR код');

// ── 1б. Действията са в ЕДНА лента, а QR кодът е НАЙ-ВДЯСНО ────────────────
// Дотук действията стояха в три отделни реда (`u-row`), после в решетка с фиксирани колони —
// и двете разтягат бутоните до пълна ширина и на тясна карта се получава стена от бутони.
const actions = panel.slice(panel.indexOf('class="pf-link-actions"'), panel.indexOf('portal.link.hint1'));
assert.ok(actions.length > 200, 'блокът с действията е наличен');
for (const id of ['pf-open-portal', 'pf-refresh-access', 'pf-qr-download', 'pf-qr-print', 'pf-open-folder']) {
  assert.ok(actions.includes(`id="${id}"`), `действието ${id} е в ОБЩАТА лента, не в отделен ред`);
}
assert.equal(/class="u-row/.test(actions), false, 'в групата на действията няма отделни редове (u-row)');
// QR кодът е ПОСЛЕДЕН в блока — тоест най-вдясно, където човек го търси.
assert.ok(
  panel.indexOf('class="pf-link-side"') < panel.indexOf('class="pf-link-qr"'),
  'QR кодът е СЛЕД групата с действията (най-вдясно в блока)',
);
assert.match(css, /\.pf-link-qr \{[\s\S]{0,200}margin-inline-start: auto/, 'QR кодът е притиснат най-вдясно');
assert.match(css, /\.pf-link-qr \{[\s\S]{0,200}cursor: pointer/, 'кодът показва, че е бутон');
// Лента, не решетка: бутоните са с ширината на съдържанието си (`flex: 0 0 auto`), а на
// тесен екран остават само иконите — иначе „един подбор“ пак става стена от бутони.
assert.match(css, /\.pf-link-actions \{[\s\S]{0,120}display: flex;/, 'действията са в една лента (flex)');
assert.match(css, /\.pf-link-actions \{[\s\S]{0,160}flex-wrap: wrap/, 'лентата се пренася, вместо да се разтяга');
assert.match(css, /\.pf-link-actions \.btn \{[\s\S]{0,120}flex: 0 0 auto/, 'бутоните не се разтягат до пълна ширина');
assert.match(css, /@media \(max-width: 560px\) \{[\s\S]{0,160}\.pf-link-actions \.btn-label \{\s*display: none/, 'под 560px остават само иконите (текстът е в title/aria-label)');
assert.match(css, /@media \(max-width: 720px\) \{[\s\S]{0,200}\.pf-link-qr \{\s*order: -1/, 'на тясна карта QR минава над групата, вместо да я разкъса');

// ── 1в. Настройките на портала са в ТРИ колони, докато екранът е широк ────
// Дотук формата беше един стълб дори при 1300px карта (полетата в цялата ширина), тоест
// половината екран стоеше празен. Сега мрежата е auto-fit с минимум ~телефонен екран:
// на широка карта — три полета на ред, при намаляване — две и едно, едно по едно.
assert.match(css, /#pf-settings \{[\s\S]{0,200}display: grid;/, 'настройките са в мрежа, не в един стълб');
assert.match(
  css,
  /#pf-settings \{[\s\S]{0,300}grid-template-columns: repeat\(auto-fit, minmax\(min\(360px, 100%\), 1fr\)\)/,
  'колоните са auto-fit с минимум ~стандартен телефонен екран (360px), но не повече от картата',
);
assert.match(css, /#pf-settings > \.field \{[\s\S]{0,140}margin-bottom: 0/, 'отстоянието идва от мрежата, не се удвоява');
assert.match(
  css,
  /#pf-settings > button\[type='submit'\] \{[\s\S]{0,120}grid-column: 1 \/ -1/,
  '„Запази настройките“ заема реда под колоните',
);

// ── 2б. Едно зареждане на сензорите ────────────────────────────────────────
// `mount()` вика `loadMonitor()` и после `reload()`, който също го викаше — тоест панелът
// теглеше сензорите ДВА ПЪТИ при всяко отваряне (и след всяко действие).
assert.match(manager, /monitorInFlight/, 'товарът на сензорите не се повтаря, докато тече');
assert.match(manager, /state\.monitorAt/, 'има кратък кеш за сензорите');
assert.match(manager, /\.finally\(\(\) => \{ monitorInFlight = null \}\)/, 'товарът се освобождава и при грешка');
// Адресът и „Свали api.json“ са махнати: копираното водеше към API-то, а файлът не се
// сваляше. Затова и няма съобщение за свалено машинно описание.
assert.equal(/това е машинното описание/.test(manager), false, 'картата не сваля api.json');
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
    await waitFor(() => host.textContent.includes('Достъп и QR код'), { label: 'блокът за достъпа и QR' });

    // ── 3. QR кодът е наличен БЕЗ да се отваря контролният панел ────────────
    const qrBox = await waitFor(() => host.querySelector('#pf-portal-qr'), { label: 'QR кодът на портала' });
    assert.match(String(qrBox.dataset.portalUrl), /\/p\/[0-9a-f]{16,}/, 'кодът носи адреса на портала: ' + qrBox.dataset.portalUrl);
    assert.match(String(qrBox.dataset.portalUrl), /expires=/, 'частният портал носи подписан достъп: ' + qrBox.dataset.portalUrl);
    assert.ok(qrBox.querySelector('.qf-svg svg'), 'QR кодът е нарисуван');
    assert.equal(host.querySelector('#pf-link-url'), null, 'в картата няма поле с адрес');
    assert.equal(host.querySelector('#pf-copy-portal'), null, 'в картата няма „Копирай адреса“');
    assert.equal(host.querySelector('#pf-dl-api'), null, 'в картата няма „Свали api.json“');

    // ── 4. „Обнови достъпа“ иска нов подпис и обновява кода ────────────────
    const before = ui.requests ? ui.requests.length : 0;
    ui.clearToasts();
    host.querySelector('#pf-refresh-access').click();
    await waitFor(() => ui.toasts.some((t) => /нов подписан достъп|публичен/i.test(t.message)), {
      label: 'отговорът от обновяването',
    });
    const infoCall = (ui.requests || []).slice(before).find((r) => r.url.endsWith('/api-info'));
    if (ui.requests) assert.ok(infoCall, 'панелът поиска нов подпис от сървъра (/api-info)');
    await waitFor(() => {
      const q = host.querySelector('#pf-portal-qr');
      return q && /expires=/.test(String(q.dataset.portalUrl));
    }, { label: 'обновеният адрес на кода' });
    const fresh = host.querySelector('#pf-portal-qr').dataset.portalUrl;
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
    // Всички полета са в ЕДНА форма — мрежата ги подрежда в три колони, а не ги разкъсва.
    for (const name of ['title', 'slug', 'subject', 'category', 'flag', 'storage_root', 'description', 'notes', 'visibility']) {
      assert.ok(settings.querySelector(`[name="${name}"]`), `полето ${name} е в същата форма`);
    }
    settings.querySelector('[name="title"]').value = 'Портал с код (обновен)';
    ui.clearToasts();
    settings.querySelector('button[type="submit"]').click();
    await waitFor(() => ui.toasts.some((t) => /обновен/i.test(t.message)), { label: 'съобщението след запис' });
    const saved = await server.api('/admin/api/portals/' + portalId);
    assert.equal(saved.data.title, 'Портал с код (обновен)', 'заглавието стигна до сървъра');

    // ── 7. Вход към портала: едно щракване не прави нищо, две отварят ──────
    ui.window.location.href = 'about:blank';
    host.querySelector('#pf-portal-qr').dispatch('click');
    assert.equal(String(ui.window.location.href), 'about:blank', 'едно щракване не изкарва човека от панела');
    host.querySelector('#pf-open-portal').click();
    await waitFor(() => /\/p\/[0-9a-f]{16,}/.test(String(ui.window.location.href)), { label: 'адресът след „Отвори портала“' });
    const openedByButton = String(ui.window.location.href);
    assert.match(openedByButton, /\/p\/[0-9a-f]{16,}/, 'отваря се порталът, а не панелът');
    ui.window.location.href = 'about:blank';
    host.querySelector('#pf-portal-qr').dispatch('dblclick');
    await waitFor(() => /\/p\/[0-9a-f]{16,}/.test(String(ui.window.location.href)), { label: 'адресът след двойното щракване' });
    const openedByQr = String(ui.window.location.href);
    assert.equal(openedByQr, openedByButton, 'кодът и бутонът водят до СЪЩИЯ адрес');
    const opened = await fetch(openedByQr);
    assert.equal(opened.status, 200, 'адресът от кода отваря портала: ' + opened.status);
    assert.match(await opened.text(), /portal\.js/, 'това е страницата на портала, не JSON');
    host.remove();
  } finally {
    await stopChild(server.child);
  }
  console.log(
    'PASS portal-card-link: QR кодът е пръв, единствен и най-вдясно · няма адрес/копиране/api.json · ' +
    'двойното щракване отваря портала, а „Отвори“ води до СЪЩИЯ адрес · обновяването иска нов подпис · ' +
    'QR се сваля и печата · сензорите се теглят веднъж · настройките се запазват',
  );
})();
