'use strict';
// РЕГИСТЪР НА ПАНЕЛИТЕ (план 18 §7: „панел като модул“).
//
// Проверява се онова, което регистърът обещава, а не че „има файл“:
//   • регистрацията не пипа `window` — `app.js` се зарежда ПРЕДИ панелите, затова обектът
//     се търси в момента на монтиране (иначе редът на `<script>`-овете решава кой панел
//     работи);
//   • повторен id се отказва, а не се презаписва тихо;
//   • `mount` на липсващ панел връща `false`, вместо да остави празен екран без обяснение;
//   • `unmountAll` вика `unmount` на ВСЕКИ панел, който го има — досега `app.js` викаше
//     само таблото, тоест всеки друг панел със слушател оставаше монтиран (класата теч,
//     намерен при живите събития);
//   • счупен `unmount` в един панел не спира останалите и не хвърля към навигацията.
const assert = require('node:assert/strict');
const { create } = require('../hapi_enterprise/ui/panel-registry.js');

const cases = [];
const ok = (label) => cases.push(label);

// ── 1. Лениво резолвване: глобалният обект може да дойде СЛЕД регистрацията ──
{
  const scope = {};
  const registry = create(scope);
  registry.register({ id: 'late', title: 'Късен панел', global: 'HapiLatePanel' });
  assert.equal(registry.has('late'), true);
  assert.equal(registry.available('late'), false, 'преди да има глобален обект панелът не е наличен');
  let mounted = 0;
  scope.HapiLatePanel = { mount: () => { mounted += 1 } };
  assert.equal(registry.available('late'), true, 'след появата на обекта е наличен');
  assert.equal(registry.mount('late', {}), true);
  assert.equal(mounted, 1, 'монтиран е веднага щом обектът съществува');
  ok('лениво резолвване: панел, регистриран преди глобалния обект, работи после');
}

// ── 2. Повторен id се отказва ────────────────────────────────────────────────
{
  const registry = create({});
  registry.register({ id: 'dup', mount: () => undefined });
  assert.throws(() => registry.register({ id: 'dup', mount: () => undefined }), /вече е регистриран/);
  try {
    registry.register({ id: 'dup', mount: () => undefined });
  } catch (error) {
    assert.equal(error.code, 'DUPLICATE_PANEL', 'причината има код, не само текст');
  }
  ok('повторен id → DUPLICATE_PANEL (не се презаписва тихо)');
}

// ── 3. Невалидна дефиниция се отказва с код ─────────────────────────────────
{
  const registry = create({});
  assert.throws(() => registry.register({ id: 'Bad Id', mount: () => undefined }), /id трябва/);
  assert.throws(() => registry.register({ id: 'nofn' }), /нито `mount`, нито `global`/);
  ok('невалиден id и панел без mount/global се отказват с обяснение');
}

// ── 4. `mount` на липсващ панел връща false, а не хвърля ────────────────────
{
  const registry = create({});
  assert.equal(registry.mount('няма-такъв', {}), false);
  registry.register({ id: 'ghost', global: 'HapiGhostPanel' });
  assert.equal(registry.mount('ghost', {}), false, 'няма глобален обект → false');
  assert.equal(registry.activeId(), null, 'нищо не е активно');
  ok('липсващ панел: `mount` → false и нищо не става активно');
}

// ── 5. unmountAll вика ВСЕКИ панел, който има unmount ───────────────────────
{
  const calls = [];
  const scope = {
    HapiA: { mount: () => calls.push('a.mount'), unmount: () => calls.push('a.unmount') },
    HapiB: { mount: () => calls.push('b.mount'), unmount: () => calls.push('b.unmount') },
    HapiNoUnmount: { mount: () => calls.push('c.mount') },
  };
  const registry = create(scope);
  registry.registerAll([
    { id: 'a', global: 'HapiA' },
    { id: 'b', global: 'HapiB' },
    { id: 'c', global: 'HapiNoUnmount' },
  ]);
  registry.mount('a', {});
  registry.mount('c', {});
  const called = registry.unmountAll();
  assert.equal(called, 2, 'освободени са двата панела, които имат unmount');
  assert.deepEqual(calls.filter((c) => c.endsWith('.unmount')).sort(), ['a.unmount', 'b.unmount'], 'извикани са и на панел, който не е бил активен');
  assert.equal(registry.activeId(), null);
  ok('`unmountAll` вика unmount на всеки панел с такъв (и на неактивните)');
}

// ── 6. Счупен unmount не спира останалите ───────────────────────────────────
{
  const calls = [];
  const scope = {
    HapiBad: { mount: () => undefined, unmount: () => { throw new Error('счупен') } },
    HapiGood: { mount: () => undefined, unmount: () => calls.push('good') },
  };
  const registry = create(scope);
  registry.registerAll([{ id: 'bad', global: 'HapiBad' }, { id: 'good', global: 'HapiGood' }]);
  const called = registry.unmountAll();
  assert.equal(called, 1, 'само здравият се брои');
  assert.deepEqual(calls, ['good'], 'хвърлящият панел не спря втория');
  ok('счупен `unmount` не спира останалите и не хвърля към навигацията');
}

// ── 7. Алтернативен глобален обект (порталът има два) ───────────────────────
{
  const scope = { SecondPanel: { mount: () => undefined } };
  const registry = create(scope);
  registry.register({ id: 'portals', global: ['MissingPanel', 'SecondPanel'] });
  assert.equal(registry.available('portals'), true, 'втората възможност се хваща');
  assert.equal(registry.mount('portals', {}), true);
  ok('списък от глобални обекти: първият наличен печели');
}

// ── 8. Различен метод (`mountAbout`) и `list()` ─────────────────────────────
{
  let viaAbout = 0;
  const scope = { HapiDashboardPanel: { mount: () => undefined, mountAbout: () => { viaAbout += 1 } } };
  const registry = create(scope);
  registry.registerAll([
    { id: 'dashboard', global: 'HapiDashboardPanel' },
    { id: 'about', global: 'HapiDashboardPanel', method: 'mountAbout' },
    { id: 'later', global: 'NoSuchPanel', capabilities: ['evidence'] },
  ]);
  assert.equal(registry.mount('about', {}), true);
  assert.equal(viaAbout, 1, 'извиква се поисканият метод');
  const listed = registry.list();
  assert.deepEqual(listed.map((p) => p.id), ['dashboard', 'about', 'later'], 'редът е на регистрацията');
  assert.deepEqual(listed[2].capabilities, ['evidence'], 'способностите се виждат');
  assert.equal(listed[2].available, false, 'липсващият панел е видим, но недостъпен');
  assert.equal(listed[0].available, true);
  ok('`method` (mountAbout), `list()` с реда на регистрацията и способности');
}

console.log('PASS panel-registry: ' + cases.length + ' проверки — ' + cases.join('; '));
