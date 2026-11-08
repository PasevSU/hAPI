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
// Отстоянието е ИЗВЕДЕНО, не магическо число: `top: 38px` падаше при смяна на шрифта и не
// казваше от какво идва. Редът на заглавната част е висок 2em (иконите в него са 2em), затова
// панелът започва точно под него плюс стъпката на разредката. Мутация проверява това правило:
// `top: 38px` НЕ се хващаше от нито един тест до 0.69.204.
const qrPopStart = css.indexOf('.pf-qr-pop {');
const qrPopRule = css.slice(qrPopStart, css.indexOf('}', qrPopStart) + 1);
assert.equal(/top:\s*-?\d+(\.\d+)?(px|em|rem)\b/.test(qrPopRule), false, 'панелчето не се позиционира с магическо число: ' + qrPopRule.replace(/\s+/g, ' '));
assert.match(qrPopRule, /top: calc\(2em \+ var\(--sp-4\)\)/, 'отстоянието е производно от реда на заглавната част и от стъпката на разредката');

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
    // Ловим слушателите на документа: `wire()` се вика след ВСЯКО рисуване, затова без
    // предпазител след десет пре-рисувания висят десет еднакви слушателя.
    const qrListeners = () => {
      const map = ui.window.document.listeners;
      const out = [];
      if (!map || typeof map.forEach !== 'function') return out;
      map.forEach((fns, type) => {
        for (const fn of fns || []) if (String(fn).includes('closeQrPops')) out.push(type);
      });
      return out;
    };
    ui.window.FilesManagerPanel.state.openPortal = portalId;
    ui.window.FilesManagerPanel.state.panel = 'actions';
    ui.window.FilesManagerPanel.mount(host);
    await waitFor(() => host.querySelector('[data-qr-portal]'), { label: 'QR бутонът в главата на картата' });
    // ── 7а. Слушателят е на ДОКУМЕНТА и е закачен точно веднъж ─────────────
    const boundFirst = qrListeners().slice().sort();
    assert.deepEqual(boundFirst, ['click', 'keydown'], 'Escape и клик извън кода слушат документа: ' + JSON.stringify(boundFirst));

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

    // ── 9б. Escape и клик извън кода също го затварят ─────────────────────
    // Дотук кодът се затваряше само с бутона си. Клавиатурният потребител оставаше с
    // отворено панелче, докато не намери бутона отново, а клик върху картата не го скриваше.
    // Двете се проверяват тук, защото са поведение — не присъствие на атрибут.
    btn.click();
    await waitFor(() => host.querySelector('[data-qr-pop]').hidden === false, { label: 'отворения QR код' });
    assert.equal(typeof btn.focus, 'function', 'бутонът може да поеме фокуса обратно');
    ui.window.document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    await waitFor(() => host.querySelector('[data-qr-pop]').hidden === true, { label: 'затворения от Escape код' });
    assert.equal(btn.getAttribute('aria-expanded'), 'false', 'Escape връща aria-expanded на false');
    assert.equal(ui.window.document.activeElement, btn, 'Escape връща фокуса на бутона, а не го оставя върху скрит елемент');

    btn.click();
    await waitFor(() => host.querySelector('[data-qr-pop]').hidden === false, { label: 'пак отворения QR код' });
    ui.window.document.dispatchEvent({ type: 'click', target: host });
    await waitFor(() => host.querySelector('[data-qr-pop]').hidden === true, { label: 'затворения при клик извън кода' });
    assert.equal(btn.getAttribute('aria-expanded'), 'false', 'клик извън кода също връща aria-expanded на false');

    // ── 10. Сензорите НЕ се теглят от този панел, а настройките се запазват ──
    const monitorCalls = calls.filter((c) => c.endsWith('/admin/api/sensors'));
    assert.equal(monitorCalls.length, 0, 'порталите не теглят сензори (мониторингът е отделна страница): ' + monitorCalls.length);

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
    // Записът пре-рисува картата (тоест `wire()` пак е минал) — броят на слушателите трябва
    // да е СЪЩИЯТ. Без предпазителя този ред расте с всяко действие.
    assert.deepEqual(qrListeners().slice().sort(), boundFirst, 'слушателят не се закача втори път при пре-рисуване: ' + JSON.stringify(qrListeners()));
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
