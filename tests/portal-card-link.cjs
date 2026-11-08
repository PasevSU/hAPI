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
//   • контролният панел (настройки + сигурност) пак рисува QR код под бутоните си;
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

// ── 1. Блокът „Достъп и QR код“ е МАХНАТ отвсякъде ────────────────────────
assert.equal(/data-block="link"/.test(panel), false, 'контролният панел не рисува блок „Достъп и QR код“');
assert.equal(/\$\{linkBlock\}/.test(panel), false, 'шаблонът на махнатия блок не се използва');
for (const id of ['pf-open-portal', 'pf-refresh-access', 'pf-qr-download', 'pf-qr-print', 'pf-open-folder', 'pf-link-state', 'pf-link-url', 'pf-copy-portal', 'pf-dl-api']) {
  assert.equal(new RegExp(`id="${id}"`).test(panel + manager), false, `елементът ${id} е махнат от панела`);
  assert.equal(new RegExp(`#${id}`).test(manager), false, `слушателят за #${id} е махнат (мъртви бутони не се оставят)`);
}
// 0.69.181: адресът, „Копирай“ и „Свали api.json“ са махнати от картата — копираният адрес
// водеше към API-то (JSON), а не към портала (това видя човек в браузъра си).
assert.equal(/id="pf-link-url"/.test(panel), false, 'адресът не се показва като поле');
assert.equal(/id="pf-copy-portal"/.test(panel + manager), false, 'няма „Копирай адреса“');
assert.equal(/id="pf-dl-api"/.test(panel + manager), false, 'няма сваляне на api.json');
assert.equal(/\bdownloadJson\b/.test(manager), false, 'мъртвият JSON помощник е махнат');
assert.equal(/\bcopyText\(state\.api/.test(manager), false, 'картата не копира адреси');

// ── 1г. QR кодът НЕ живее в контролния панел ─────────────────────────────
// Панелът за настройки е място за текстове и ключове, не за картинката. До 0.69.199 QR
// стоеше в отделен блок над него — с пет бутона и три реда подсказки. Сега кодът е само
// бутон в главата на картата.
const controlBlock = panel.slice(panel.indexOf('data-block="control"'));
assert.ok(controlBlock.length > 500, 'контролният панел е наличен');
assert.equal(/qf-svg|qrSvg\(/.test(controlBlock), false, 'контролният панел не рисува QR код');
assert.equal(/class="pf-link/.test(panel + manager), false, 'няма останали класове от махнатия блок');

// ── 2. Трите икони и QR бутонът са в ЕДИН ред, на едно ниво с името ────────
// Изискване: трите бутона да са на равно с името на портала. Дотук те стояха до табелките
// в един flex-ред с пренасяне и на тясна карта падаха под тях. Сега има отделен контейнер
// за действията (`margin-left: auto`), който държи иконите и QR бутона на реда на името.
const headMain = manager.indexOf('class="pf-portal-head-main"');
const headActions = manager.indexOf('class="pf-portal-head-actions"');
assert.ok(headMain > 0, 'главата на картата има контейнер с име и табелки');
assert.ok(headActions > headMain, 'действията са в СВОЙ контейнер след името');
const actions = manager.slice(headActions, manager.indexOf('class="pf-qr-pop"'));
assert.ok(actions.length > 200, 'контейнерът с действията е наличен');
for (const attr of ['data-pkg-portal', 'data-report-portal', 'data-report-recursive', 'data-qr-portal']) {
  assert.ok(actions.includes(attr), `${attr} е в ОБЩИЯ ред на действията, не на отделен ред`);
}
// QR бутонът е ПОСЛЕДЕН в реда, тоест горе вдясно, където човек го търси.
assert.ok(
  actions.indexOf('data-pkg-portal') < actions.indexOf('data-qr-portal') &&
  actions.indexOf('data-report-recursive') < actions.indexOf('data-qr-portal'),
  'QR бутонът е последен в реда (горе вдясно)',
);
assert.match(css, /\.pf-portal-head \{[\s\S]{0,200}align-items: center/, 'заглавният ред подравнява по вертикала (име и бутони на равно)');
assert.match(css, /\.pf-portal-head-actions \{[\s\S]{0,160}margin-left: auto/, 'действията са притиснати вдясно');
assert.match(css, /\.pf-portal-head \.pf-qr-btn \{[\s\S]{0,120}color: var\(--accent\)/, 'QR бутонът е откроен');
assert.match(css, /\.pf-qr-pop \{[\s\S]{0,200}position: absolute/, 'кодът излиза като панелче');
assert.match(css, /\.pf-qr-pop \{[\s\S]{0,200}right: var\(--sp-4\)/, 'панелчето е ВДЯСНО (кодът е от дясно на информацията)');

// ── 3. QR кодът е ЕДИН и е връзка към ПУБЛИЧНИЯ портал ─────────────────────
// Дотук всеки файл и всяка папка рисуваха свой код с друг адрес (подписан за един час или
// администраторски, който иска вход) — при 30 файла това бяха 30 кода, повечето мъртви за
// получателя. Затова кодът е един: в главата на картата, обвит във връзка към портала.
assert.ok(manager.includes('class="pf-qr-pop-link" href="${esc(qrUrl)}"'), 'кодът е връзка (`<a href>`) към портала');
assert.match(manager, /const qrUrl = api \? api\.folderUrl \|\| api\.landing \|\| '' : ''/, 'адресът на кода е страницата на портала, не API-то');
assert.ok(manager.includes('data-qr-pop="${i}" hidden'), 'кодът е скрит, докато не се поиска');
for (const f of fs.readdirSync(path.join(root, 'hapi_enterprise', 'ui'))) {
  if (!f.endsWith('.js') || !/qrSvg\s*\(/.test(uiSrc(f))) continue;
  assert.ok(['files-manager.js'].includes(f), 'qrSvg се вика само за един код, а се среща и в ' + f);
}
assert.equal(/data-file-qr/.test(manager), false, 'файлът няма собствен QR код');
assert.equal(/data-folder-qr/.test(manager + uiSrc('portal-folders.js')), false, 'папката няма собствен QR код');
assert.equal(/window\.open/.test(manager), false, 'панелът не отваря нов таб');
assert.equal(/в нов таб/i.test(panel), false, 'подсказките не обещават нов таб');

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

// ── 2б. Едно зареждане на сензорите ──────────────────────────────────
// `mount()` вика `loadMonitor()` и после `reload()`, който също го викаше — тоест панелът
// теглеше сензорите ДВА ПЪТИ при всяко отваряне (и след всяко действие).
assert.match(manager, /monitorInFlight/, 'товарът на сензорите не се повтаря, докато тече');
assert.match(manager, /state\.monitorAt/, 'има кратък кеш за сензорите');
assert.match(manager, /\.finally\(\(\) => \{ monitorInFlight = null \}\)/, 'товарът се освобождава и при грешка');
// Адресът и „Свали api.json“ са махнати: копираното водеше към API-то, а файлът не се
// сваляше. Затова и няма съобщение за свалено машинно описание.
assert.equal(/това е машинното описание/.test(manager), false, 'картата не сваля api.json');
// „Отвори портала“ е в СЪЩИЯ таб: под Ingress нов таб губи сесията.
assert.equal(/window\.open/.test(manager), false, 'панелът не отваря нов таб');
// …и подсказката трябва да казва СЪЩОТО, а не да обещава нов таб.
assert.equal(/в нов таб/i.test(panel), false, 'подсказката не обещава нов таб');
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
    await waitFor(() => host.querySelector('[data-qr-portal]'), { label: 'QR бутонът в главата на картата' });

    // ── 6. Блокът „Достъп и QR код“ ГО НЯМА на екрана ───────────────────────
    assert.equal(host.textContent.includes('Достъп и QR код'), false, 'блокът не се рисува');
    for (const id of ['pf-open-portal', 'pf-refresh-access', 'pf-qr-download', 'pf-qr-print', 'pf-open-folder', 'pf-portal-qr']) {
      assert.equal(host.querySelector('#' + id), null, `на екрана няма #${id}`);
    }

    // ── 7. QR кодът е бутон горе вдясно и се отваря с едно натискане ─────────
    const btn = host.querySelector('[data-qr-portal]');
    assert.equal(btn.getAttribute('aria-expanded'), 'false', 'кодът е скрит в начало');
    assert.ok(host.querySelector('[data-qr-pop]'), 'панелчето с кода съществува');
    assert.equal(host.querySelector('[data-qr-pop]').hidden, true, 'панелчето е скрито');
    btn.click();
    await waitFor(() => host.querySelector('[data-qr-pop]').hidden === false, { label: 'показания QR код' });
    assert.equal(btn.getAttribute('aria-expanded'), 'true', 'бутонът отчита, че кодът е отворен');

    // ── 8. Кодът е връзка към ПУБЛИЧНИЯ портал ──────────────────────────────
    const link = host.querySelector('.pf-qr-pop-link');
    assert.ok(link, 'кодът е обвит във връзка');
    const href = String(link.getAttribute('href'));
    assert.match(href, /\/p\/[0-9a-f]{16,}/, 'връзката сочи страницата на портала: ' + href);
    assert.match(href, /expires=/, 'частният портал носи подписан достъп: ' + href);
    assert.ok(link.querySelector('svg'), 'QR кодът е нарисуван');
    assert.equal(host.querySelector('#pf-link-url'), null, 'в картата няма поле с адрес');
    assert.equal(host.querySelector('#pf-copy-portal'), null, 'в картата няма „Копирай адреса“');
    assert.equal(host.querySelector('#pf-dl-api'), null, 'в картата няма „Свали api.json“');
    const ready = await fetch(href);
    assert.equal(ready.status, 200, 'адресът от кода се отваря: ' + ready.status);
    assert.match(await ready.text(), /portal\.js/, 'това е страницата на портала, не JSON');

    // ── 9. Второ натискане скрива кода ─────────────────────────────────────
    btn.click();
    await waitFor(() => host.querySelector('[data-qr-pop]').hidden === true, { label: 'скрития QR код' });
    assert.equal(btn.getAttribute('aria-expanded'), 'false', 'бутонът отчита, че кодът е скрит');

    // ── 10. Сензорите се теглят ВЕДНЪЖ за отваряне, а настройките се запазват ──
    const monitorCalls = calls.filter((c) => c.endsWith('/admin/api/sensors'));
    assert.equal(monitorCalls.length, 1, 'сензорите се теглят един път при отваряне, а не два: ' + monitorCalls.length);

    const toggle = host.querySelector('[data-pf-control-tog]');
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
    const settings = await waitFor(() => host.querySelector('#pf-settings'), { label: 'формата с настройките' });
    // Всички полета са в ЕДНА форма — мрежата ги подрежда в три колони, а не ги разкъсва.
    for (const name of ['title', 'slug', 'subject', 'category', 'flag', 'storage_root', 'description', 'notes', 'visibility']) {
      assert.ok(settings.querySelector(`[name="${name}"]`), `полето ${name} е в същата форма`);
    }
    assert.equal(host.querySelector('[data-block="control"] [data-qr-pop]'), null, 'в отворения контролен панел няма QR код');
    settings.querySelector('[name="title"]').value = 'Портал с код (обновен)';
    ui.clearToasts();
    settings.querySelector('button[type="submit"]').click();
    await waitFor(() => ui.toasts.some((t) => /обновен/i.test(t.message)), { label: 'съобщението след запис' });
    const saved = await server.api('/admin/api/portals/' + portalId);
    assert.equal(saved.data.title, 'Портал с код (обновен)', 'заглавието стигна до сървъра');
    host.remove();
  } finally {
    await stopChild(server.child);
  }
  console.log(
    'PASS portal-card-link: блокът „Достъп и QR код“ е махнат · QR е бутон горе вдясно до трите икони · ' +
    'кодът е връзка към публичния портал · показва се и се скрива с бутона · сензорите се теглят веднъж · ' +
    'настройките се запазват',
  );
})();
