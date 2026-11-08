'use strict';
// ЗАКОН „ПАНЕЛЪТ С МЕНЮТО СЕ ПРИБИРА САМ“ (0.69.208).
//
// Поводът: менюто се скриваше само с бутона `#nav-toggle`. На тясен екран (и под HA Ingress,
// където панелът живее в странична лента) човек отваря менюто, избира си работа и после сам
// търси бутона, за да си върне ширината. Затова: клик ИЗВЪН менюто го затваря, клик ВЪТРЕ —
// не (иначе изборът на панел изчезва под ръката), а `#nav-toggle` пак работи.
//
// Проверява се през ИСТИНСКИЯ интерфейс (`mountApp` зарежда ui/index.html + app.js), защото
// тук става дума за поведение на цялата страница, а не за функция в модул.
const assert = require('node:assert/strict');
const { startServer } = require('./lib/gui-harness.cjs');
const { mountApp } = require('./lib/gui-journey.cjs');

(async () => {
  const server = await startServer({ keepData: true });
  try {
    const app = mountApp(server);
    const collapsed = () => app.document.body.classList.contains('nav-collapsed');
    assert.equal(collapsed(), false, 'в началото менюто е показано');

    // ── 1. Клик извън менюто го затваря ───────────────────────────────────────
    const outside = app.requireEl('#view', 'съдържанието на панела');
    outside.click();
    assert.equal(collapsed(), true, 'клик в съдържанието (извън менюто) прибира менюто');
    assert.equal(app.$('#nav-toggle').getAttribute('aria-expanded'), 'false', 'бутонът показва вярното състояние');
    assert.equal(app.sandbox.localStorage.getItem('hapi.navCollapsed'), '1', 'състоянието се помни и за следващо отваряне');

    // ── 2. Клик ВЪТРЕ в менюто не го затваря ──────────────────────────────────
    app.click('#nav-toggle', 'показване на менюто');
    assert.equal(collapsed(), false, 'менюто е показано отново');
    app.requireEl('#nav button[data-panel="portals"]', 'навигационен бутон').click();
    assert.equal(collapsed(), false, 'клик ВЪТРЕ в менюто не го прибира — навигацията остава под ръка');

    // ── 3. Клик върху самия бутон не се „самозатваря“ ─────────────────────────
    app.click('#nav-toggle', 'скриване на менюто');
    assert.equal(collapsed(), true, 'бутонът затваря менюто');
    app.click('#nav-toggle', 'показване на менюто');
    assert.equal(collapsed(), false, 'и го показва — двойното затваряне от собствения клик не се случва');

    // ── 4. Escape затваря (клавиатура, без координати) ────────────────────────
    app.document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(collapsed(), true, 'Escape прибира менюто');

    // ── 5. Затворено меню не се „затваря“ пак от кликове (няма излишна работа) ─
    const storedBefore = app.sandbox.localStorage.getItem('hapi.navCollapsed');
    outside.click();
    assert.equal(collapsed(), true, 'клик при вече затворено меню не променя нищо');
    assert.equal(app.sandbox.localStorage.getItem('hapi.navCollapsed'), storedBefore, 'и не презаписва избора');

    console.log('PASS nav-outside-click: клик извън менюто го прибира · вътре не · бутонът работи · Escape затваря · затворено остава затворено');
  } finally {
    await server.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
