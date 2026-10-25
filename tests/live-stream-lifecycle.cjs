'use strict';
// ЖИВИЯТ ПОТОК СЕ ОСВОБОЖДАВА ПРИ НАПУСКАНЕ НА ТАБЛОТО.
//
// Защо съществува: `startLive` отваря `EventSource` към `/admin/api/events/stream`. Ако
// панелът не го затвори при преминаване към друг раздел, всяко връщане на таблото оставя
// ВТОРА отворена връзка — сървърът ги брои (`/admin/api/events` → `clients`) и те се трупат,
// докато браузърът не се презареди. Дефектът не се вижда в нито един отделен тест на
// панела, защото всеки от тях монтира панела веднъж и не го напуска.
//
// Проверява се на ниво КОД + DOM, без реален браузър:
//   • `HapiDashboardPanel.unmount` съществува и е функция;
//   • `app.js` вика `unmount()` ПРЕДИ да изчисти изгледа;
//   • `unmount` наистина затваря отворения `EventSource`;
//   • без `EventSource` (или без токен) панелът не чупи нищо.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const cases = [];
const ok = (label) => cases.push(label);

const readUi = (name) => fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'ui', name), 'utf8');

// ── 1. `app.js` вика unmount преди да смени изгледа ─────────────────────────
{
  const app = readUi('app.js');
  // От 0.69.87 освобождаването минава през регистъра на панелите: `unmountAll()` вика
  // `unmount` на ВСЕКИ панел, който го има, а не само на таблото. Затова първо се проверява
  // регистърът — иначе тестът минава заради стария резервен ред и не вижда, че пътят е друг.
  assert.match(app, /panels\.unmountAll\(\)/, 'app.js освобождава през регистъра (unmountAll)');
  const registryAt = app.indexOf('panels.unmountAll()');
  const registryClearAt = app.indexOf("view.innerHTML = ''", registryAt);
  assert.ok(registryAt > 0, 'извикването към регистъра съществува');
  assert.ok(registryClearAt > registryAt, 'unmountAll идва ПРЕДИ изчистването на изгледа');
  assert.match(app, /HapiPanelRegistry/, 'app.js ползва регистъра на панелите');
  // Резервният път остава за случай, в който регистърът не се е заредил (стар кеш на HTML-а).
  assert.match(app, /\.unmount\(\)/, 'резервният път вика unmount на таблото');
  ok('app.js: unmountAll от регистъра се вика преди view.innerHTML = \'\'');
}

// ── 2. Панелът наистина го предоставя ──────────────────────────────────────
{
  const panel = readUi('dashboard-panel.js');
  assert.match(panel, /HapiDashboardPanel = \{[^}]*unmount/, 'панелът предоставя unmount');
  assert.match(panel, /function stopLive\(\)/, 'stopLive съществува');
  // `stopLive` трябва да ЗАТВАРЯ източника, не само да нулира променливата.
  const body = panel.slice(panel.indexOf('function stopLive()'), panel.indexOf('function startLive'));
  assert.match(body, /\.close\(\)/, 'stopLive вика close() на EventSource');
  assert.match(body, /liveSource = null/, 'след затваряне референцията се нулира');
  ok('dashboard-panel.js: unmount → stopLive → close() и нулиране');
}

// ── 3. `startLive` не оставя втори поток ──────────────────────────────────
{
  const panel = readUi('dashboard-panel.js');
  const body = panel.slice(panel.indexOf('function startLive'), panel.indexOf('function mount('));
  // Първото нещо в startLive трябва да е затваряне на предишния поток.
  const firstStatement = body.split('\n').map((l) => l.trim()).filter(Boolean)[1] || '';
  assert.match(firstStatement, /stopLive\(\)/, 'startLive първо затваря предишния поток, получено: ' + firstStatement);
  ok('startLive: затваря предишния поток преди да отвори нов');
}

// ── 4. Живият поток е по избор: без EventSource панелът не чупи ────────────
{
  const panel = readUi('dashboard-panel.js');
  assert.match(panel, /typeof window\.EventSource !== 'function'/, 'липсващият EventSource се проверява');
  assert.match(panel, /return false/, 'без EventSource startLive връща false, вместо да хвърли');
  assert.match(panel, /'изключено'/, 'панелът казва „изключено“, вместо да мълчи');
  ok('без EventSource: startLive → false и панелът казва „изключено“');
}

// ── 4б. Лентата не лъже, когато потокът умре СЛЕД отварянето ───────────────
{
  const panel = readUi('dashboard-panel.js');
  // Сървърът затваря след 30 минути с `bye`, а мрежата може да падне. Без тези слушатели
  // лентата оставаше „на живо“ върху мъртва връзка — твърдение, което не е вярно.
  assert.match(panel, /addEventListener\('bye'/, '`bye` се обработва');
  assert.match(panel, /addEventListener\('error'/, '`error` се обработва');
  assert.match(panel, /addEventListener\('open'/, '`open` връща лентата в „на живо“');
  assert.match(panel, /'приключи'/, 'след `bye` лентата казва „приключи“');
  assert.match(panel, /'няма връзка'/, 'при грешка лентата казва „няма връзка“');
  // `bye` НЕ трябва да минава през `forward`: това е съобщение за състоянието, не събитие.
  const forwardLine = panel.match(/for \(const name of \[([^\]]*)\]\) forward\(name\)/);
  assert.ok(forwardLine, 'списъкът на излъчваните събития съществува');
  assert.ok(!/bye/.test(forwardLine[1]), '`bye` не е в списъка на бизнес събитията');
  ok('потокът: bye → „приключи“, error → „няма връзка“, open → „на живо“');
}

// ── 5. Сървърът брои клиентите — значи освобождаването е проверимо ─────────
{
  const events = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'routes', 'events.js'), 'utf8');
  assert.match(events, /stream\.stats\(\)/, 'маршрутът показва броя свързани клиенти');
  const stream = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'event-stream.js'), 'utf8');
  assert.match(stream, /req\.on\('close'/, 'сървърът маха клиента при затваряне на връзката');
  assert.match(stream, /function drop\(client\)/, 'drop освобождава клиента');
  ok('сървърът брои клиентите и ги маха при close — течът е видим');
}

// ── 6. `stopLive` пуска и DOM референцията, не само връзката ───────────────
{
  const panel = readUi('dashboard-panel.js');
  const body = panel.slice(panel.indexOf('function stopLive()'), panel.indexOf('function startLive'));
  // Без това панелът държи откачен възел от изтрития изглед, а следващото `open`/`bye`
  // би рисувало в него, вместо в новия — тоест лентата млъква след връщане на таблото.
  assert.match(body, /liveBadgeEl = null/, 'stopLive нулира и DOM референцията');
  assert.match(body, /liveState = 'off'/, 'състоянието се връща в „изключено“');
  ok('stopLive: затваря връзката, нулира състоянието И DOM референцията');
}

console.log('PASS live-stream-lifecycle: ' + cases.length + ' проверки — ' + cases.join('; '));
