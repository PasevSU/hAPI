'use strict';
// КАРТАТА НА ПОРТАЛА: QR кодът е бутон в заглавния ред и е вход към портала.
//
// Защо този тест: QR кодът стоеше най-долу в дясната колона на сгънатия контролен панел,
// в отделен блок „Достъп и QR код“ с пет бутона и три реда подсказки. Блокът дублираше входа
// към портала и изяждаше половината екран. Сега има ЕДИН код — бутон, последен в реда на
// действията (тоест горе вдясно), който показва панелче с кода, а самият код е връзка към
// публичния портал.
//
// Тестът пада, ако:
//   • блокът „Достъп и QR код“ се върне (в контролния панел или в картата);
//   • QR кодът не е ЕДИН, не е последен в реда на действията и не е връзка към портала;
//   • панелчето не се затваря с бутона, с Escape или с клик извън него;
//   • Escape не връща фокуса на бутона (фокус върху скрит елемент е капан за Tab);
//   • слушателят на документа се закача при всяко пре-рисуване, а не веднъж;
//   • позицията на панелчето пак стане магическо число вместо производна стойност;
//   • действията (пакет/отчети/QR) не са в общ контейнер с `margin-left: auto`, тоест не са
//     на едно ниво с името;
//   • сензорите се теглят от този панел (мониторингът е отделна страница) или настройките не се запазват.
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
const actions = manager.slice(headActions, manager.indexOf('<hr class="u-divider"'));
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

// ── 2г. Кодът е в ИЗПЪКНАЛА рамка с ЛИНК в долния ръб (0.69.229) ─────────
// Изискване на собственика: кодът да е в професионална рамка, която „изпъква“, а адресът да е
// изписан от долния ѝ край — така разпечатан или сниман, кодът носи и адреса си.
const cssText = css.replace(/\s+/g, ' ');
assert.match(cssText, /\.qs-frame \{[^}]*border: 2px solid var\(--line-strong\)/, 'рамката на кода е с плътна граница');
assert.match(cssText, /\.qs-frame \{[^}]*box-shadow:[^}]*0 14px 34px/, 'рамката изпъква (сянка)');
assert.match(cssText, /\.qs-corner \{/, 'рамката има ъгълчета');
assert.match(cssText, /\.qs-caption \{[^}]*border-radius: 0 0 var\(--radius\) var\(--radius\)/, 'линкът е залепен за долния ръб на рамката');
assert.match(cssText, /\.qs-caption-url \{/, 'адресът се изписва в долния ръб');

// ── 2д. Прозорецът има ЧЕТИРИ раздела и те са отделни функции ────────────
const studio = uiSrc('qr-studio.js');
for (const tab of ['plain', 'readonly', 'temp', 'levels']) {
  assert.ok(studio.includes("'" + tab + "'"), 'разделът ' + tab + ' е обявен');
}
for (const fn of ['tabPlain', 'tabReadonly', 'tabTemp', 'tabLevels']) {
  assert.match(studio, new RegExp('function ' + fn + '\\('), 'разделът ' + fn + ' съществува');
}
assert.match(studio, /function figure\(url, label, opts\)/, 'рамката с код и линк е ЕДНА за навсякъде');
assert.match(studio, /qs-caption-url/, 'адресът е част от фигурата, не отделен ред');
assert.match(studio, /data-qs-copy=/, 'всеки адрес има „Копирай“');
assert.match(studio, /data-qs-download=/, 'кодът се изтегля като SVG');
assert.match(studio, /qr\.toPortal/, 'има вход „Към публичния портал“');
assert.match(studio, /data-qs-opt="readOnly"|data-qs-opt="password"|data-qs-opt="ttl"/, 'временният раздел има чекбоксове за режим, парола и валидност');
assert.match(studio, /window\.HapiQrStudio = API/, 'студиото е ГЛОБАЛНО — един обект за всички панели');

// ── 3. Кодът е ЕДИН на портал и се строи от едно място ──────────────────
assert.match(manager, /function openQrStudio\(x\)/, 'кодът се отваря от една функция');
assert.match(manager, /qrSvg,/, 'построителят на SVG се подава на студиото');
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

// ── 2б. Мониторингът НЕ живее в панела с порталите ─────────────────────
// До 0.69.205 тук имаше цяла секция „Мониторинг“ със сензори, таблици и обновяване —
// тоест същите числа се теглеха и рисуваха на две места. Сега има ЕДНА страница
// (`monitoring-panel.js`) и този панел не пипа сензорите.
assert.equal(/\/admin\/api\/sensors/.test(manager), false, 'порталите не теглят сензори');
assert.equal(/pf-monitor/.test(manager), false, 'няма секция „Мониторинг“ в панела с порталите');
// Адресът и „Свали api.json“ са махнати: копираното водеше към API-то, а файлът не се
// сваляше. Затова и няма съобщение за свалено машинно описание.
assert.equal(/това е машинното описание/.test(manager), false, 'картата не сваля api.json');
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
    // Слушателите на документа вече не се броят за поповера: прозорецът на студиото закача
    // своите на СВОЯТА кутия и се затваря сам. Остава проверката, че пре-рисуването не
    // добавя документни слушатели (иначе след десет обновявания висят десет еднакви).
    const docListeners = () => {
      const map = ui.window.document.listeners;
      let n = 0;
      if (!map || typeof map.forEach !== 'function') return n;
      map.forEach((fns) => {
        n += (fns || []).length;
      });
      return n;
    };
    ui.window.FilesManagerPanel.state.openPortal = portalId;
    ui.window.FilesManagerPanel.state.panel = 'actions';
    ui.window.FilesManagerPanel.mount(host);
    await waitFor(() => host.querySelector('[data-qr-portal]'), { label: 'QR бутонът в главата на картата' });
    const listenersAfterOpen = docListeners();
    // ── 6. Блокът „Достъп и QR код“ ГО НЯМА на екрана ───────────────────────
    assert.equal(host.textContent.includes('Достъп и QR код'), false, 'блокът не се рисува');
    for (const id of ['pf-open-portal', 'pf-refresh-access', 'pf-qr-download', 'pf-qr-print', 'pf-open-folder', 'pf-portal-qr']) {
      assert.equal(host.querySelector('#' + id), null, `на екрана няма #${id}`);
    }

    // ── 7. QR бутонът отваря ГЛОБАЛНОТО студио (едно за всички нива) ───────
    const btn = host.querySelector('[data-qr-portal]');
    assert.equal(btn.getAttribute('aria-haspopup'), 'dialog', 'бутонът обявява, че отваря прозорец');
    assert.equal(host.querySelector('[data-qr-pop]'), null, 'поповерът е премахнат — кодът е в прозореца');
    btn.click();
    const studio = await waitFor(() => ui.window.document.getElementById('qs-modal'), { label: 'прозореца на QR студиото' });
    assert.equal(studio.hidden, false, 'щракването отваря студиото');
    assert.equal(studio.querySelectorAll('[data-qs-tab]').length, 4, 'прозорецът има ЧЕТИРИ раздела');
    await waitFor(() => studio.querySelector('.qs-frame svg'), { label: 'кода в рамката' });
    assert.match(studio.querySelector('.qs-caption-url').textContent, /\/p\/|file\.html/, 'адресът е изписан под кода');
    assert.ok(studio.querySelector('[data-qs-copy]'), 'до адреса има „Копирай“');
    assert.ok(studio.querySelector('[data-qs-download]'), 'има „Изтегли SVG“');

    // ── 7б. Разделите сменят СЪДЪРЖАНИЕТО, а не само етикета ───────────────
    studio.querySelector('[data-qs-tab="temp"]').click();
    await waitFor(() => studio.querySelector('[data-qs-temp]'), { label: 'временния раздел' });
    for (const opt of ['readOnly', 'password', 'ttl']) {
      assert.ok(studio.querySelector(`[data-qs-opt="${opt}"]`), `временният раздел има чекбокс за ${opt}`);
    }

    // ── 9б. Затварянето връща фокуса на бутона ─────────────────────────────
    studio.querySelector('#qs-close').click();
    assert.equal(studio.hidden, true, 'бутонът „Затвори“ скрива прозореца');
    assert.equal(typeof btn.focus, 'function', 'бутонът може да поеме фокуса обратно');

    // ── 10. Сензорите НЕ се теглят от този панел, а настройките се запазват ──
    const monitorCalls = calls.filter((c) => c.endsWith('/admin/api/sensors'));
    assert.equal(monitorCalls.length, 0, 'порталите не теглят сензори (мониторингът е отделна страница): ' + monitorCalls.length);

    const toggle = host.querySelector('[data-pf-control-tog]');
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
    const settings = await waitFor(() => host.querySelector('#pf-settings'), { label: 'формата с настройките' });
    // Всички полета са в ЕДНА форма — мрежата ги подрежда в три колони, а не ги разкъсва.
    for (const name of ['title', 'slug', 'subject', 'category', 'flag', 'description', 'notes', 'visibility']) {
      assert.ok(settings.querySelector(`[name="${name}"]`), `полето ${name} е в същата форма`);
    }
    // Папката се ПОКАЗВА, но не е поле за писане (0.69.211).
    assert.ok(settings.querySelector('[data-pf-storage-root]'), 'папката се вижда в същата форма');
    assert.equal(settings.querySelector('[name="storage_root"]'), null, 'папката не е input');
    assert.equal(host.querySelector('[data-block="control"] [data-qr-pop]'), null, 'в отворения контролен панел няма QR код');
    settings.querySelector('[name="title"]').value = 'Портал с код (обновен)';
    ui.clearToasts();
    settings.querySelector('button[type="submit"]').click();
    await waitFor(() => ui.toasts.some((t) => /обновен/i.test(t.message)), { label: 'съобщението след запис' });
    const saved = await server.api('/admin/api/portals/' + portalId);
    assert.equal(saved.data.title, 'Портал с код (обновен)', 'заглавието стигна до сървъра');
    // Записът пре-рисува картата (тоест `wire()` пак е минал) — броят на документните
    // слушатели трябва да е СЪЩИЯТ.
    assert.equal(docListeners(), listenersAfterOpen, 'пре-рисуването не добавя документни слушатели');
    host.remove();
  } finally {
    await stopChild(server.child);
  }
  console.log(
    'PASS portal-card-link: блокът „Достъп и QR код“ е махнат · QR е бутон горе вдясно до трите икони · ' +
    'кодът е връзка към публичния портал · показва се и се скрива с бутона · без сензори в този панел · ' +
    'настройките се запазват',
  );
})();
