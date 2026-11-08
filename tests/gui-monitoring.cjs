'use strict';
// ПРАВИЛАТА НА ГРАФИЧНИЯ ИНТЕРФЕЙС, ЗА КОИТО СЕ ДОКЛАДВА (0.69.205).
//
// Докладът беше от шест точки и нито една не беше „липсва функция“ — всичките бяха
// липсващи ПРАВИЛА:
//   1. отстоянията не са регламентирани → семантични токени (`tests/ui-spacing.cjs`);
//   2. бутоните не са равни по реда → `repeat(auto-fit, minmax(…, 1fr))`;
//   3. мониторингът е разпръснат по страниците → ЕДНА страница „Мониторинг“;
//   4. сгъваемите блокове се отварят всички наведнъж → акордеон: само един отворен,
//      затварянето връща началния вид;
//   5. декоративните баджове „свързан“/„готов“ са шум → махнати.
//
// Този файл пази 3, 4 и 5 — и то върху ЖИВИЯ интерфейс, не върху поднизове в сорса.
// Отстоянията и равните бутони са в `tests/ui-spacing.cjs`, защото са договор в CSS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { mountApp } = require('./lib/gui-journey.cjs');

const root = path.join(__dirname, '..');
const ui = (name) => fs.readFileSync(path.join(root, 'hapi_enterprise', 'ui', name), 'utf8');
const text = (node) => String((node && node.textContent) || '').replace(/\s+/g, ' ').trim();
const BUDGET = Number(process.env.HAPI_GUI_TIMEOUT_MS || 45000);

(async () => {
  const server = await startServer();
  const app = mountApp(server);
  const view = () => app.view();
  const settle = (label, timeout = BUDGET) =>
    waitFor(() => {
      const host = view();
      if (!host) return false;
      const body = text(host);
      return body.length > 0 && !/Зареждам/.test(body);
    }, { label: label || 'изгледът да утихне', timeout });

  // ── 0. Фалшив `EventSource` ───────────────────────────────────────────────
  // Живият поток дотук беше пазен само СТАТИЧНО (`live-stream-lifecycle.cjs` чете сорса с
  // регулярен израз). Това не е проверка на поведение: събитие, което не стига до екрана,
  // минава зелено. Затова тук се слага истински обект с формата на `EventSource` и се
  // проверява какво вижда човекът: ред в „Живи събития“, затваряне при `bye` и при изход.
  const live = { instances: [] };
  class FakeEventSource {
    constructor(url) {
      this.url = String(url);
      this.listeners = new Map();
      this.closed = false;
      live.instances.push(this);
    }
    addEventListener(name, cb) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(cb);
    }
    emit(name, data) {
      for (const cb of this.listeners.get(name) || []) cb({ data: JSON.stringify(data || {}) });
    }
    close() {
      this.closed = true;
    }
  }
  app.window.EventSource = FakeEventSource;

  try {
    // ── 1. ЕДНА страница за мониторинг, а не парче във всяка страница ─────────
    assert.ok(app.navIds().includes('monitoring'), 'менюто има раздел „Мониторинг“: ' + app.navIds().join(', '));
    // Сорсът на порталите и таблото НЕ бива да пита сензорите: числата живеят само на
    // страницата за мониторинг. (Проверява се и на живо по-долу — по заявките.)
    for (const name of ['files-manager.js', 'portal-control.js', 'portal-folders.js', 'portal-files.js', 'dashboard-panel.js']) {
      assert.equal(ui(name).includes('/admin/api/sensors'), false, name + ' не бива да пита сензорите — това е работа на „Мониторинг“');
    }

    // Таблото: нито един от блоковете на мониторинга не е останал там.
    app.nav('dashboard');
    await settle('таблото');
    for (const selector of ['#mon-cards', '#mon-visitors', '#mon-res', '#mon-live', '#mon-refresh']) {
      assert.equal(app.$(selector), null, 'таблото не показва ' + selector);
    }
    const dashText = text(view());
    assert.equal(/Уникални посетители|Отказани достъпи|Ресурси и хранилище/.test(dashText), false, 'таблото няма мониторинг числа: ' + dashText.slice(0, 160));

    // ── 2. Табло: вход към разделите, без декоративни баджове ────────────────
    // „изведените баджове свързан, готов и т.н. са ненужни“: таблото показва същите
    // раздели като менюто, но не и табелка „готов“ до заглавието.
    assert.ok(app.$('#dash-quick'), 'таблото има бърз достъп до разделите');
    const quick = app.$$('#dash-quick [data-goto]').map((el) => el.getAttribute('data-goto'));
    assert.deepEqual(
      quick.slice().sort(),
      app.navIds().filter((id) => id !== 'dashboard').sort(),
      'бързият достъп е точно менюто без таблото: ' + quick.join(', '),
    );
    // Един дял за всеки бутон: равен брой колони се задава от мрежата, а не от текста.
    assert.equal(app.$$('#dash-quick .badge').length, 0, 'бързият достъп няма табелки към бутоните');
    assert.equal(app.$('#status-pill'), null, 'няма табелка „Готов“ до заглавието на приложението');
    assert.equal(ui('index.html').includes('status-pill'), false, 'index.html не рисува status-pill');
    for (const [file, pattern] of [
      ['dashboard-panel.js', /badge ok/],
      ['files-manager.js', /badge ok">свързан/],
      ['export-center.js', /реален експорт/],
    ]) {
      assert.equal(pattern.test(ui(file)), false, file + ' не бива да показва декоративна табелка за връзка');
    }

    // ── 3. Порталите: НИКАКВА заявка за сензори ──────────────────────────────
    app.nav('portals');
    await settle('панелът „Портали“');
    const askedSensors = app.requests.filter((r) => /\/admin\/api\/sensors/.test(r.url));
    assert.deepEqual(askedSensors.map((r) => r.url), [], 'страницата с порталите не пита сензорите');
    // И при отваряне на портал — там има три сгъваеми блока, но не и мониторинг.
    const row = app.$('[data-open-portal]');
    if (row) {
      row.click();
      await settle('картата на портала');
      assert.deepEqual(app.requests.filter((r) => /\/admin\/api\/sensors/.test(r.url)).map((r) => r.url), [], 'и отвореният портал не пита сензорите');
      // ── 4. Акордеон: само един блок отворен, затварянето връща началния вид ──
      const togs = ['[data-pf-control-tog]', '[data-pf-folders-tog]', '[data-pf-files-tog]'];
      const states = () => togs.map((s) => app.$(s).getAttribute('aria-expanded'));
      const openCount = () => states().filter((v) => v === 'true').length;
      // Затваряме всичко, ако нещо е останало открито — началното състояние е „нищо“.
      for (let i = 0; i < togs.length; i++) if (states()[i] === 'true') { app.$(togs[i]).click(); await settle('сгъване'); }
      assert.deepEqual(states(), ['false', 'false', 'false'], 'в началото нищо не е отворено');
      for (const tog of togs) {
        app.$(tog).click();
        await settle('разгъване на ' + tog);
        assert.equal(openCount(), 1, 'след натискане на ' + tog + ' е отворен ТОЧНО един блок: ' + states().join(','));
        assert.equal(states()[togs.indexOf(tog)], 'true', 'натиснатият блок е отворен: ' + tog);
      }
      // Затваряне на последния отворен → отново нищо не е отворено.
      const lastOpen = togs[states().indexOf('true')];
      app.$(lastOpen).click();
      await settle('затваряне на последния блок');
      assert.deepEqual(states(), ['false', 'false', 'false'], 'затварянето не оставя нищо отворено');
    }

    // ── 5. Страницата „Мониторинг“: четирите секции и живите числа ───────────
    const before = app.requests.length;
    app.nav('monitoring');
    await waitFor(() => app.$('#mon-cards'), { label: 'картите на мониторинга', timeout: BUDGET });
    await waitFor(() => app.$('#mon-visitors'), { label: 'секцията „Посетители“', timeout: BUDGET });
    assert.ok(app.$('#mon-res'), 'има секция „Ресурси и хранилище“');
    assert.ok(app.$('#mon-live'), 'има секция „Живи събития“');
    assert.equal(app.$$('.panel').length >= 4, true, 'страницата е от панели, не от един дълъг текст');
    // Всяка карта е в общата мрежа на таблото — равни дялове, една междина.
    const cards = await waitFor(() => {
      const found = app.$$('#mon-cards .dash-card');
      return found.length >= 3 ? found : null;
    }, { label: 'картите на състоянието', timeout: BUDGET });
    for (const card of cards) assert.ok(/dash-grid/.test(card.parentNode.className || ''), 'картата е в .dash-grid');
    assert.match(text(app.$('#mon-cards')), /\d/, 'картите показват число, не „—“');
    // Данните идват по мрежата от административния API — точно една заявка за сензори.
    const asked = app.requests.slice(before).filter((r) => /\/admin\/api\/sensors/.test(r.url));
    assert.equal(asked.length >= 1, true, 'страницата иска сензорите: ' + app.requests.slice(before).map((r) => r.url).join(' · '));
    // Сгъваемата таблица с папките е част от ЕДИН акордеон (`data-acc`), не отделен панел.
    const acc = app.$$('details[data-acc]');
    assert.ok(acc.length >= 1, 'структурата на папките е в сгъваем блок с data-acc');
    assert.match(ui('monitoring-panel.js'), /other !== item && other\.open/, 'акордеонът затваря останалите отворени');

    // ── 5б. Живият поток: събитие стига до екрана, `bye` и изходът затварят ──
    // Страницата има само ЕДИН `details[data-acc]`, затова „затвори съседните“ не се
    // изпълнява при истинско щракване. Проверява се върху синтетичен корен със СЪЩАТА
    // функция, която страницата ползва — иначе правилото остава непроверено по поведение.
    const synth = app.document.createElement('div');
    const d1 = app.document.createElement('details');
    const d2 = app.document.createElement('details');
    for (const d of [d1, d2]) {
      d.setAttribute('data-acc', '');
      synth.appendChild(d);
    }
    assert.equal(app.window.HapiMonitoringPanel.wireAccordion(synth), 2, 'акордеонът закача и двата сгъваеми блока');
    // Браузърът сменя `open` ПРЕДИ да излъчи `toggle` — тук се прави същото, иначе тестът
    // проверява събитие, каквото браузърът не излъчва.
    d1.open = true;
    d1.dispatch('toggle');
    assert.equal(d1.open, true, 'първият блок се отваря');
    d2.open = true;
    d2.dispatch('toggle');
    assert.equal(d2.open, true, 'вторият блок се отваря');
    assert.equal(d1.open, false, 'отварянето на втория блок затваря първия');
    d2.open = false;
    d2.dispatch('toggle');
    assert.equal(d2.open, false, 'след затваряне не остава отворен блок');
    assert.equal(d1.open, false, 'и първият не се отваря сам');

    // Потокът: адресът е същият административен маршрут, но носи ЕДНОКРАТЕН БИЛЕТ, а не
    // администраторския токен (0.69.206: токен в адрес влиза в история, Referer и логове).
    await waitFor(() => live.instances.length === 1, { label: 'потокът да се отвори', timeout: BUDGET });
    assert.equal(live.instances.length, 1, 'страницата отваря ТОЧНО един поток: ' + live.instances.length);
    const source = live.instances[0];
    assert.match(
      source.url,
      /\/admin\/api\/events\/stream\?ticket=[0-9a-f]{32,}/,
      'потокът е към административния маршрут и носи билет: ' + source.url,
    );
    const adminToken = app.window.sessionStorage.getItem('hapiAdminToken');
    assert.ok(adminToken, 'сесията има токен — иначе проверката по-долу е празна');
    assert.equal(source.url.includes(adminToken), false, 'администраторският токен НЕ влиза в адреса на потока: ' + source.url);
    assert.equal(source.closed, false, 'потокът е отворен, докато панелът е на екрана');
    const liveBox = app.$('#mon-live');
    assert.match(text(liveBox), /Още нищо не е станало/, 'преди събитие секцията казва, че е празна');
    source.emit('document.finalized', { at: '2026-11-08T10:20:30.000Z' });
    await waitFor(() => /document\.finalized/.test(text(app.$('#mon-live'))), { label: 'събитието в „Живи събития“', timeout: BUDGET });
    assert.match(text(app.$('#mon-live')), /2026-11-08 10:20:30/, 'събитието носи и часа си');
    // Изходът от панела затваря връзката — иначе всяко превключване на раздел оставя поток.
    app.window.HapiMonitoringPanel.unmount();
    assert.equal(source.closed, true, 'unmount затваря потока');

    // ── 5в. „Виж всички“ води към страницата с посетителите ─────────────────
    const goto = app.$('#mon-visitors [data-nav="visitors"]');
    assert.ok(goto, 'секцията „Посетители“ има бутон „Виж всички“');
    goto.click();
    await waitFor(() => app.$('#visitors-cards') || /Посетители/.test(text(view())), { label: 'страницата с посетители', timeout: BUDGET });
    assert.ok(app.navIds().includes('visitors'), 'страницата „Посетители“ съществува');

    console.log(
      'PASS gui-monitoring: единна страница „Мониторинг“ (състояние · ресурси · посетители · живи събития) · ' +
      'таблото без мониторинг и без табелки „готов/свързан“ · порталите не питат сензорите · ' +
      'акордеон: точно един блок отворен и затварянето връща началния вид',
    );
  } catch (e) {
    console.error('\n✘ ПРОВАЛ: ' + (e && e.message ? e.message : e) + '\n');
    throw e;
  } finally {
    // Живият поток (SSE) и интервалите на „Задачи“ държат процеса буден — освобождават се,
    // за да излезе Node след PASS, както прави `gui-journeys`.
    const w = app.window;
    if (w.HapiMonitoringPanel && w.HapiMonitoringPanel.unmount) w.HapiMonitoringPanel.unmount();
    if (w.SettingsPanel && w.SettingsPanel.unmount) w.SettingsPanel.unmount();
    await server.stop();
  }
})().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
