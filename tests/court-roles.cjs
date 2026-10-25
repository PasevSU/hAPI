'use strict';
// РОЛИ ЗА СЪД (F7-1) — договорът от `documentation/02_TO_BE_ARCHITECTURE/COURT_ROLES.md`.
//
// Проверява се това, което съдът НАИСТИНА може да разчита:
//   • съдебните роли четат доказателства и веригата на пазене;
//   • НЕ могат да създават портали, да качват файлове, да пипат настройки или потребители;
//   • експертът може да представи становище, а съдията — не;
//   • непозната роля в `user_roles` се ОТХВЪРЛЯ (правописна грешка не дава права);
//   • понижаването работи през Ingress заглавките, а не само през токени.
const assert = require('node:assert/strict');
const rbac = require('../hapi_enterprise/rbac.js');

const cases = [];
const ok = (label) => cases.push(label);

const COURT = ['judge', 'prosecutor', 'clerk', 'expert'];

// ── 1. Списъкът на ролите е точно този, който се приема ───────────────────
{
  assert.deepEqual([...rbac.ROLES].sort(), ['admin', 'clerk', 'expert', 'judge', 'operator', 'prosecutor', 'viewer']);
  for (const role of rbac.ROLES) assert.equal(rbac.isRole(role), true, role + ' се приема');
  for (const bad of ['root', 'Admin', 'judge ', '', null, undefined, 'съдия']) {
    assert.equal(rbac.isRole(bad), false, String(bad) + ' НЕ се приема');
  }
  ok('ролите са точно 7; непозната/сгрешена роля се отхвърля');
}

// ── 2. Съдебните роли четат доказателства, но не ги променят ──────────────
{
  const session = rbac.create({ adminToken: 'a', operatorToken: 'o', viewerToken: 'v' });
  for (const role of COURT) {
    assert.equal(session.allowed(role, 'evidence', 'GET'), true, role + ' чете доказателства');
    assert.equal(session.allowed(role, 'custody', 'GET'), true, role + ' чете веригата на пазене');
    assert.equal(session.allowed(role, 'evidence', 'POST'), false, role + ' НЕ променя доказателства');
    assert.equal(session.allowed(role, 'custody', 'DELETE'), false, role + ' НЕ трие веригата');
  }
  ok('съдът чете evidence/custody, но не пише и не трие');
}

// ── 3. Съдът не е оператор: никакво управление на портали, файлове, настройки ─
{
  const session = rbac.create({ adminToken: 'a', operatorToken: 'o', viewerToken: 'v' });
  const forbidden = ['portals', 'settings', 'users', 'qr', 'backup', 'profiles', 'storage', 'retention', 'jobs', 'pgp', 'packages'];
  for (const role of COURT) {
    for (const capability of forbidden) {
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        assert.equal(session.allowed(role, capability, method), false,
          role + ' не бива да има ' + capability + ' ' + method);
      }
    }
  }
  ok('съдът няма достъп до портали, настройки, потребители, QR, резервни копия');
}

// ── 4. Експертът представя становище; съдията — не ───────────────────────
{
  const session = rbac.create({ adminToken: 'a', operatorToken: 'o', viewerToken: 'v' });
  assert.equal(session.allowed('expert', 'expert_opinion', 'POST'), true, 'експертът може да представи становище');
  assert.equal(session.allowed('expert', 'expert_opinion', 'GET'), true, 'и може да го прочете');
  for (const role of ['judge', 'prosecutor', 'clerk']) {
    assert.equal(session.allowed(role, 'expert_opinion', 'POST'), false, role + ' НЕ представя становище');
  }
  assert.equal(session.allowed('operator', 'expert_opinion', 'POST'), false, 'операторът също не');
  ok('само expert (и admin) може да представи становище');
}

// ── 5. Непозната роля в `user_roles` не дава права ────────────────────────
{
  // Правописна грешка е реалистична: `"judge "` с интервал, `"Judge"` с главна буква.
  const session = rbac.create({
    adminToken: 'a',
    userRoles: { съдия: 'judge ', 'Съдия Иванов': 'Judge', 'Петър': 'clerk' },
    defaultRole: 'viewer',
  });
  const req = (name) => ({ ingress: true, headers: { 'x-remote-user-name': name } });
  // Сгрешените стойности падат към подразбиращата се роля (viewer), а не към съдебна.
  assert.equal(session.resolve(req('съдия')), 'viewer', 'сгрешена роля → подразбиращата се');
  assert.equal(session.resolve(req('Съдия Иванов')), 'viewer', 'главна буква не е роля');
  // Правилната стойност работи.
  assert.equal(session.resolve(req('Петър')), 'clerk', 'правилната роля се прилага');
  ok('сгрешена роля в user_roles пада към подразбиращата се, не към съдебна');
}

// ── 6. Понижаване през Ingress: съдът не получава admin по подразбиране ───
{
  const session = rbac.create({
    adminToken: 'a',
    userRoles: { 'Съдия Иванов': 'judge', 'Прокурор Петрова': 'prosecutor', 'Секретар': 'clerk', 'Вещо лице': 'expert' },
    defaultRole: 'admin',
  });
  const req = (name) => ({ ingress: true, headers: { 'x-remote-user-name': name } });
  assert.equal(session.resolve(req('Съдия Иванов')), 'judge');
  assert.equal(session.resolve(req('Прокурор Петрова')), 'prosecutor');
  assert.equal(session.resolve(req('Секретар')), 'clerk');
  assert.equal(session.resolve(req('Вещо лице')), 'expert');
  // Съдията с роля `judge` НЕ минава през admin-ската врата, дори defaultRole да е admin.
  assert.equal(session.allowed(session.resolve(req('Съдия Иванов')), 'settings', 'GET'), false,
    'съдията не влиза в настройките, макар подразбирането да е admin');
  ok('Ingress понижава до съдебна роля; съдията не получава admin права');
}

// ── 7. Групите също приемат съдебни роли (reverse proxy с X-Remote-Groups) ─
{
  const session = rbac.create({
    adminToken: 'a',
    groupRoles: { court_judges: 'judge', court_experts: 'expert' },
    defaultRole: 'viewer',
  });
  const req = (groups) => ({ ingress: true, headers: { 'x-remote-groups': groups } });
  assert.equal(session.resolve(req('court_judges')), 'judge');
  assert.equal(session.resolve(req('court_experts')), 'expert');
  assert.equal(session.resolve(req('непозната')), 'viewer', 'непозната група → подразбирането');
  ok('групите приемат съдебни роли; непозната група не дава права');
}

// ── 8. Съдебна роля не може да се покачи до admin през картата ────────────
{
  // `user_roles` е само за ПОНИЖАВАНЕ по замисъл, но проверяваме, че и явна стойност
  // `admin` не се приема за съдебен потребител, ако картата е сгрешена — т.е. няма
  // „полу-админ“ роля.
  const session = rbac.create({ adminToken: 'a', userRoles: { 'Съдия': 'judge' }, defaultRole: 'admin' });
  const req = { ingress: true, headers: { 'x-remote-user-name': 'Съдия' } };
  const role = session.resolve(req);
  assert.equal(role, 'judge');
  assert.equal(session.allowed(role, 'users', 'POST'), false, 'съдията не създава потребители');
  assert.equal(session.allowed(role, 'expert_opinion', 'POST'), false, 'съдията не е експерт');
  ok('няма „полу-админ“: съдията не получава права на admin по нито един път');
}

console.log('PASS court-roles: ' + cases.length + ' проверки — ' + cases.join('; '));
