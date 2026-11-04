'use strict';
// Шрифтът и скриващото се меню (0.69.151) — проверени през САМИЯ интерфейс.
//
// Поводът: човекът поиска „увеличи шрифта и направи менюто така че да се скрива“.
// Двете неща се виждат само в браузър, затова тук се зарежда ИСТИНСКИЯТ `ui/index.html`
// с ИСТИНСКИЯ `app.js` (машината от `tests/lib/gui-journey.cjs`) и се натиска бутонът,
// който вижда човекът. Нищо не се проверява „по подниз в кода“ там, където може да се
// провери с натискане:
//
//   1. бутонът `#nav-toggle` съществува, обявява се като „показва/скрива менюто“ и е
//      СВЪРЗАН с менюто (`aria-controls="nav"`);
//   2. натискането СКРИВА менюто (клас `nav-collapsed` на `body`) и обръща `aria-expanded`;
//   3. второто натискане го ВРЪЩА — тоест не е еднократно и не чупи навигацията;
//   4. изборът се ПОМНИ: след ново отваряне панелът стартира скрит, както го е оставил
//      човекът (иначе трябва да се цъка при всяко отваряне в страничната лента на HA);
//   5. CSS-ът НАИСТИНА крие менюто — правилото `body.nav-collapsed .nav` със `display:none`
//      е в `layout.css`, а не само клас върху `body`, който нищо не прави;
//   6. шрифтът е уголемен: основата на `body` е 100% (16px) вместо досегашните 87.5%
//      (14px), а мащабът `--fs-*` остава проценти — тоест расте ЦЕЛИЯТ панел, не само текстът.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { mountApp } = require('./lib/gui-journey.cjs');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

(async () => {
  const server = await startServer({ keepData: true });
  try {
    // ── 1. Бутонът съществува и е свързан с менюто ─────────────────────────────
    const app = mountApp(server);
    const toggle = app.$('#nav-toggle');
    assert.ok(toggle, 'topbar-ът има бутон #nav-toggle за скриване на менюто');
    assert.equal(toggle.getAttribute('aria-controls'), 'nav', 'бутонът сочи менюто, което скрива');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'в началото менюто е ПОКАЗАНО');
    assert.match(toggle.getAttribute('title') || '', /Скрий менюто/, 'подсказката казва какво прави бутонът');
    assert.ok(app.navIds().length >= 15, 'менюто е нарисувано: ' + app.navIds().length + ' секции');
    assert.equal(app.document.body.classList.contains('nav-collapsed'), false, 'в началото панелът не е свит');

    // ── 2. Натискане → менюто се скрива ────────────────────────────────────────
    app.click('#nav-toggle', 'бутон за скриване на менюто');
    assert.equal(app.document.body.classList.contains('nav-collapsed'), true, 'натискането слага nav-collapsed');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'aria-expanded става false');
    assert.match(toggle.getAttribute('title') || '', /Покажи менюто/, 'след скриване подсказката предлага показване');
    assert.equal(app.sandbox.localStorage.getItem('hapi.navCollapsed'), '1', 'изборът се пази за следващото отваряне');

    // ── 3. Второ натискане → връща менюто, навигацията пак работи ──────────────
    app.click('#nav-toggle', 'бутон за показване на менюто');
    assert.equal(app.document.body.classList.contains('nav-collapsed'), false, 'второто натискане връща менюто');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'aria-expanded се връща на true');
    assert.equal(app.sandbox.localStorage.getItem('hapi.navCollapsed'), '0', 'и това се пази');
    app.nav('portals');
    assert.ok(app.$('#nav button[data-panel="portals"]').getAttribute('class').includes('active'), 'навигацията работи след показване');

    // Свит панел също трябва да може да навигира: менюто е скрито с CSS, не изтрито.
    app.click('#nav-toggle', 'бутон за скриване на менюто');
    assert.equal(app.document.body.classList.contains('nav-collapsed'), true, 'менюто е скрито');
    app.nav('storage');
    // `renderNav()` прерисува менюто, затова елементът се взима НАНОВО — старият е отпаднал.
    const navButton = app.requireEl('#nav button[data-panel="storage"]', 'навигационен бутон „storage“');
    assert.ok(navButton.getAttribute('class').includes('active'), 'навигацията работи и при скрито меню');

    // ── 4. Изборът се помни при ново отваряне ─────────────────────────────────
    const remembered = mountApp(server, { local: { 'hapi.navCollapsed': '1' } });
    assert.equal(remembered.document.body.classList.contains('nav-collapsed'), true, 'запомненото „скрито“ се прилага при старт');
    assert.equal(remembered.$('#nav-toggle').getAttribute('aria-expanded'), 'false', 'и бутонът показва вярното състояние');
    const shown = mountApp(server, { local: { 'hapi.navCollapsed': '0' } });
    assert.equal(shown.document.body.classList.contains('nav-collapsed'), false, 'запомненото „показано“ също се спазва');

    // ── 5. CSS-ът наистина крие менюто ────────────────────────────────────────
    const layout = read('hapi_enterprise/ui/layout.css');
    assert.match(layout, /body\.nav-collapsed \.nav \{[^}]*display: none/, 'layout.css крие менюто при свито състояние');
    assert.match(layout, /\.view \{[^}]*flex: 1/, 'съдържанието взима останалата ширина');
    const html = read('hapi_enterprise/ui/index.html');
    assert.ok(html.indexOf('id="nav-toggle"') > 0, 'index.html съдържа бутона');
    assert.ok(
      html.indexOf('id="nav-toggle"') < html.indexOf('class="langs"'),
      'бутонът е ПРЕДИ езиците в лентата — иначе се губи при тясна странична лента',
    );

    // ── 6. Шрифтът е уголемен ────────────────────────────────────────────────
    assert.match(layout, /html \{[^}]*font-size: 100%/, 'коренът е 100% (16px)');
    assert.match(layout, /\nbody \{[^}]*font-size: 100%/, 'основата на панела е 100% от корена, не 87.5%');
    assert.equal(/font-size: 87\.5%/.test(layout), false, 'старите 14px са премахнати');
    const tokens = read('hapi_enterprise/ui/tokens.css');
    const scale = [...tokens.matchAll(/--fs-[0-9-]+:\s*([0-9.]+)%/g)].map((m) => Number(m[1]));
    assert.ok(scale.length >= 10, 'мащабът --fs-* е зададен в проценти');
    assert.ok(Math.max(...scale) >= 140, 'най-големият размер в мащаба е поне 140% от основата, а е ' + Math.max(...scale) + '%');

    // ── 7. Порталите се отварят със СГЪНАТИ блокове ───────────────────────────
    // Проверява се на ЧЕСТ монтаж на панела (ново зареждане на страницата): в рамките на
    // една сесия изборът на човека се помни, затова „по подразбиране“ може да се види само
    // така. Порталът се създава през API-то — това е подготовка на данните, а действието
    // (отваряне и разгъване) минава през самия интерфейс.
    const made = await server.api('/admin/api/portals', 'POST', {
      slug: 'shell-blocks', title: 'Портал със сгънати блокове', visibility: 'public',
    });
    assert.equal(made.status, 201, 'порталът за проверката се създава: ' + JSON.stringify(made.data));
    const fresh = mountApp(server);
    fresh.nav('portals');
    const row = await waitFor(() => fresh.$$('[data-open-portal]')[0], {
      label: 'порталът в списъка', timeout: 15000,
    });
    row.click();
    const BLOCKS = [
      ['[data-pf-control-tog]', '#pf-settings', 'контролния панел'],
      ['[data-pf-folders-tog]', '.fm-folders', 'папките'],
      ['[data-pf-files-tog]', '.fm-files-box', 'файловете'],
    ];
    for (const [toggleSel, bodySel, what] of BLOCKS) {
      const toggle = await waitFor(() => fresh.$(toggleSel), { label: 'заглавието на ' + what, timeout: 15000 });
      assert.equal(toggle.getAttribute('aria-expanded'), 'false', what + ' е СГЪНАТ по подразбиране');
      assert.equal(fresh.$(bodySel), null, 'тялото на „' + what + '“ не се рисува, докато е сгънато');
    }
    // И се разгъва с едно натискане — иначе „сгънато“ би значело „скрито завинаги“.
    fresh.$('[data-pf-files-tog]').click();
    await waitFor(() => fresh.$('.fm-files-box'), { label: 'файловете след разгъване', timeout: 15000 });
    assert.equal(fresh.$('[data-pf-files-tog]').getAttribute('aria-expanded'), 'true', 'след натискане блокът е разгънат');

    console.log('PASS ui-shell-nav: скриващо се меню (натискане · помнене · CSS) · уголемен шрифт (100% основа, ' +
      scale.length + ' степени в мащаба) · порталът се отваря със сгънати блокове');
  } finally {
    await server.stop();
  }
})().catch((error) => {
  console.error('FAIL ui-shell-nav:', error && error.message ? error.message : error);
  process.exitCode = 1;
});
