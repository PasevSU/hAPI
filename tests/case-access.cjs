'use strict';
// ОГРАНИЧАВАНЕ ПО ДЕЛО (план 17, F7-1, DoD „достъп по дело“) — договорът от
// `documentation/02_TO_BE_ARCHITECTURE/COURT_ROLES.md`.
//
// Проверява се това, на което съдът НАИСТИНА може да разчита:
//   • съдебна роля вижда САМО порталите на делата, които ѝ е зададено;
//   • без назначение не вижда НИЩО (fail-closed), а причината се казва с думи;
//   • портал без `caseId` НЕ се вижда от съд — не знаем кое дело е;
//   • `*` дава всички дела СЪЗНАТЕЛНО;
//   • не-съдебните роли не се ограничават (промяната не чупи работеща инсталация);
//   • назначенията се пазят в базата и се заместват, не се трупат.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const access = require('../hapi_enterprise/case-access.js');
const { open: openStore } = require('../hapi_enterprise/sqlite-store.js');

const cases = [];
const ok = (label) => cases.push(label);

const PORTALS = [
  { id: 'p1', caseId: 'C-1' },
  { id: 'p2', caseId: 'C-2' },
  { id: 'p3', caseId: null }, // несвързан с дело
  { id: 'p4' }, // без поле
];

// ── 1. Съдебна роля вижда само своите дела ────────────────────────────────
{
  const ids = access.allowedPortalIds({ role: 'judge', assignments: ['C-1'], portals: PORTALS });
  assert.deepEqual(ids, ['p1'], 'съдия по C-1 вижда само портала на C-1: ' + JSON.stringify(ids));
  const both = access.allowedPortalIds({ role: 'prosecutor', assignments: ['C-1', 'C-2'], portals: PORTALS });
  assert.deepEqual(both.sort(), ['p1', 'p2'], 'прокурор по две дела вижда двата портала');
  ok('съдебна роля: само порталите на зададените дела');
}

// ── 2. Без назначение → НИЩО, с причина ───────────────────────────────────
{
  assert.deepEqual(access.allowedPortalIds({ role: 'judge', assignments: [], portals: PORTALS }), [], 'без назначение → нищо');
  const why = access.explain({ role: 'judge', assignments: [], portals: PORTALS });
  assert.equal(why.restricted, true);
  assert.equal(why.reason, 'NO_CASE_ASSIGNED', 'причината е „няма назначение“, не общо „няма достъп“');
  // Назначение по дело, в което няма портал — също нищо, но с ДРУГА причина.
  const empty = access.explain({ role: 'clerk', assignments: ['C-99'], portals: PORTALS });
  assert.equal(empty.reason, 'NO_PORTAL_IN_ASSIGNED_CASES', 'различната причина се различава');
  ok('без назначение → нищо + NO_CASE_ASSIGNED; празно дело → NO_PORTAL_IN_ASSIGNED_CASES');
}

// ── 3. Портал без caseId не се вижда от съд ───────────────────────────────
{
  const ids = access.allowedPortalIds({ role: 'judge', assignments: ['C-1', 'C-2'], portals: PORTALS });
  assert.equal(ids.includes('p3'), false, 'портал без caseId не се вижда');
  assert.equal(ids.includes('p4'), false, 'портал без поле caseId не се вижда');
  ok('портал без дело е невидим за съда (не знаем кое дело е)');
}

// ── 4. `*` дава всички дела съзнателно ────────────────────────────────────
{
  const ids = access.allowedPortalIds({ role: 'judge', assignments: ['*'], portals: PORTALS });
  assert.deepEqual(ids.sort(), ['p1', 'p2'], 'звездата дава всички СВЪРЗАНИ с дело портали');
  ok('`*` = всички дела (но пак без несвързаните с дело)');
}

// ── 5. Не-съдебните роли НЕ се ограничават ────────────────────────────────
{
  for (const role of ['admin', 'operator', 'viewer']) {
    assert.equal(access.allowedPortalIds({ role, assignments: [], portals: PORTALS }), null,
      role + ' не се ограничава (null = без ограничение, не празен списък)');
    assert.equal(access.explain({ role, assignments: [], portals: PORTALS }).restricted, false);
  }
  ok('admin/operator/viewer: без ограничение (null, а не празен списък)');
}

// ── 6. `canSee` за един портал ────────────────────────────────────────────
{
  assert.equal(access.canSee({ role: 'judge', assignments: ['C-1'], portal: PORTALS[0] }), true);
  assert.equal(access.canSee({ role: 'judge', assignments: ['C-1'], portal: PORTALS[1] }), false);
  assert.equal(access.canSee({ role: 'admin', assignments: [], portal: PORTALS[1] }), true, 'admin вижда всичко');
  ok('canSee: съдията вижда своето дело и не вижда чуждото; admin вижда всичко');
}

// ── 7. Назначенията се пазят в базата и се ЗАМЕСТВАТ ──────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-cases-'));
  const store = openStore(path.join(dir, 'metadata.json'));
  store.save({ portals: [], users: [] });
  assert.deepEqual(store.getUserCases('Съдия Иванов'), [], 'преди назначаване няма нищо');
  assert.deepEqual(store.setUserCases('Съдия Иванов', ['C-1', 'C-2']), ['C-1', 'C-2']);
  // Заместване, не трупане: иначе отнетият достъп остава завинаги.
  assert.deepEqual(store.setUserCases('Съдия Иванов', ['C-2']), ['C-2'], 'назначаването ЗАМЕСТВА');
  assert.deepEqual(store.getUserCases('Съдия Иванов'), ['C-2']);
  // Празен списък = нищо, не „всички“.
  assert.deepEqual(store.setUserCases('Съдия Иванов', []), [], 'празен списък изчиства');
  assert.deepEqual(store.getUserCases('Съдия Иванов'), []);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
  ok('база: назначаването се замества и празният списък изчиства (не дава „всички“)');
}

console.log('PASS case-access: ' + cases.length + ' проверки — ' + cases.join('; '));
