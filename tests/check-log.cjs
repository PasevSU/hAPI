'use strict';
// ДНЕВНИК НА ПРОВЕРКИТЕ: всяка проверка оставя следа, а проблемът влиза в error-log.
//
// Какво пази този тест: `check-log` е единственият вход, през който проверките (цялост,
// фонова проверка, токени, QR архив) казват какво са намерили. Договорът има три свойства,
// които иначе се губят: успехът НЕ цапа журнала на грешките, провалът ВИНАГИ влиза в него с
// причина, а счупен дневник не чупи проверката.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { create } = require(path.join(__dirname, '..', 'hapi_enterprise', 'check-log.js'));

// ── 1. Договорът: имена, нива, съдържание ─────────────────────────────────────
{
  const logged = [];
  const journalled = [];
  const checks = create({
    log: {
      info: (event, ctx) => logged.push({ level: 'info', event, ctx }),
      warn: (event, ctx) => logged.push({ level: 'warn', event, ctx }),
      error: (event, ctx) => logged.push({ level: 'error', event, ctx }),
    },
    errorLog: { append: (level, source, message, details) => journalled.push({ level, source, message, details }) },
  });

  checks.start('integrity', { portalId: 'p1' });
  checks.ok('integrity', { portalId: 'p1', files: 3, ms: 12 });
  assert.equal(logged.length, 2, 'началото и успехът се записват');
  assert.equal(logged[0].event, 'check.integrity', 'името е `check.<проверка>`');
  assert.equal(logged[0].ctx.ns, 'check', 'има собствен namespace');
  assert.equal(logged[0].ctx.event, 'start', 'началото е белязано');
  assert.equal(logged[1].ctx.event, 'ok', 'успехът е белязан');
  assert.equal(logged[1].ctx.files, 3, 'измереното влиза в записа');
  assert.deepEqual(journalled, [], 'успешната проверка НЕ влиза в журнала на грешките');

  checks.fail('integrity', 'SHA-256 не съвпада', { portalId: 'p1', file: '/a.pdf' });
  const failLine = logged.find((l) => l.ctx.event === 'fail');
  assert.ok(failLine, 'провалът се записва');
  assert.equal(failLine.level, 'warn', 'провалът е warn, не error: това е находка, не срив');
  assert.equal(failLine.ctx.reason, 'SHA-256 не съвпада', 'причината е в дневника');
  assert.equal(journalled.length, 1, 'провалът ВЛИЗА в журнала на грешките');
  assert.equal(journalled[0].source, 'check.integrity', 'източникът е търсим');
  assert.equal(journalled[0].level, 'warn', 'нивото е същото като в дневника');

  checks.crash('qr-verify', Object.assign(new Error('EACCES: denied'), { code: 'EACCES' }), { portalId: 'p1' });
  const crashLine = logged.find((l) => l.ctx.event === 'crash');
  assert.equal(crashLine.level, 'error', 'сривът е error');
  assert.equal(crashLine.ctx.err, 'EACCES: denied', 'съобщението е запазено');
  assert.equal(crashLine.ctx.code, 'EACCES', 'кодът също');
  assert.equal(journalled.length, 2, 'сривът също влиза в журнала');
  assert.equal(journalled[1].level, 'error', 'и е с ниво error');
}

// ── 2б. Списъкът с имена е ЗАТВОРЕН ─────────────────────────────────────────
{
  const logged = [];
  const checks = create({ log: { info: (event, ctx) => logged.push({ event, ctx }), warn: (event, ctx) => logged.push({ event, ctx }) }, errorLog: { append: () => {} } });
  assert.deepEqual(Object.keys(checks.names).sort(), ['config', 'integrity', 'integrityJob', 'key', 'qr', 'token'], 'договорът изброява имената');
  checks.ok(checks.names.token, { op: 'issue' });
  assert.equal(logged[0].event, 'check.token', 'име от договора минава както е');
  // Име извън договора НЕ изчезва: записва се като `check.unknown`, за да се види, че някой е
  // подал име, което документацията и търсенето по `source=` не познават.
  checks.fail('qr-verify', 'причина', {});
  assert.equal(logged[1].event, 'check.unknown', 'име извън договора става check.unknown');
}

// ── 3. Счупен дневник не чупи проверката ─────────────────────────────────────
{
  const checks = create({
    log: {
      info: () => { throw new Error('sink down') },
      warn: () => { throw new Error('sink down') },
      error: () => { throw new Error('sink down') },
    },
    errorLog: { append: () => { throw new Error('journal down') } },
  });
  assert.doesNotThrow(() => checks.start('x', {}), 'счупен log не хвърля');
  assert.doesNotThrow(() => checks.fail('x', 'причина', {}), 'счупен error-log не хвърля');
  assert.doesNotThrow(() => checks.crash('x', new Error('e'), {}), 'срив при счупен дневник не хвърля');

  // Без дневници изобщо (тестове, CLI) модулът е тих, но работи.
  const bare = create();
  assert.doesNotThrow(() => { bare.start('y'); bare.ok('y'); bare.fail('y', 'r'); bare.crash('y', new Error('e')) }, 'без аргументи не хвърля');
}

// ── 3. Край до край: истинският error-log приема записа ───────────────────────
(async () => {
  const errorLogModule = require(path.join(__dirname, '..', 'hapi_enterprise', 'error-log.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-log-'));
  try {
    const errorLog = errorLogModule.create(dir);
    const checks = create({ errorLog });
    checks.fail('integrity', 'несъответствие', { portalId: 'p9', files: 2 });
    await checks.flush();
    const listed = await errorLog.list({ source: 'check.integrity' });
    assert.equal(listed.length, 1, 'записът се чете по източник: ' + JSON.stringify(listed));
    assert.equal(listed[0].message, 'несъответствие', 'съобщението е причината');
    assert.equal(listed[0].details.portalId, 'p9', 'подробностите стигат до журнала');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(
    'PASS check-log: `check.<име>` с ns · успехът не цапа журнала · провалът влиза с причина (warn) · ' +
      'сривът е error · счупен дневник не хвърля · записът се чете по `source=check.integrity`',
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
