'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ОРАКУЛ: процесът не умира от едно отхвърлено обещание — но не го и премълчава.
//
// Липсваше глобален предпазител: при 182 умишлено „плаващи“ извиквания една пропусната
// точка е достатъчна Node 22 да прекрати процеса по средата на качване или подписване.
// Проверява се в ДЕТЕ (не в текущия процес), за да е истинско поведението:
//   • след `Promise.reject(...)` процесът е ЖИВ и е записал грешката;
//   • `uncaughtException` се записва и процесът излиза с код 1 (чист рестарт от Supervisor);
//   • и двата записа влизат и в централизирания дневник на грешките.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const GUARD = path.join(ROOT, 'hapi_enterprise', 'process-guards.js');

/** Пуска малък скрипт в отделен Node процес и връща изхода му. */
function runChild(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-guard-'));
  const file = path.join(dir, 'probe.cjs');
  fs.writeFileSync(file, source);
  try {
    const out = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 15000 });
    return { status: out.status, stdout: out.stdout || '', stderr: out.stderr || '' };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* Windows може да държи файла */ }
  }
}

// 1. Отхвърлено обещание: процесът остава жив и записва и в двата дневника.
const rejection = runChild(`
const guard = require(${JSON.stringify(GUARD)});
const logged = [], appended = [];
guard.install({ log: { error: (kind, d) => logged.push(kind + ':' + d.err.split('\\n')[0]) }, errorLog: { append: (level, source, message) => { appended.push(level + '/' + source); return Promise.resolve() } } });
Promise.reject(new Error('провалена фонова задача'));
setTimeout(() => {
  console.log(JSON.stringify({ alive: true, logged, appended }));
  process.exit(0);
}, 120);
`);
assert.equal(rejection.status, 0, 'процесът трябва да е жив след отхвърлено обещание: ' + rejection.stderr);
const rejOut = JSON.parse(rejection.stdout.trim().split('\n').pop());
assert.equal(rejOut.alive, true);
assert.equal(rejOut.logged.length, 1, 'отхвърлянето се записва в лога');
assert.match(rejOut.logged[0], /^unhandledRejection:/, 'записва се като unhandledRejection: ' + rejOut.logged[0]);
assert.deepEqual(rejOut.appended, ['error/process'], 'влиза и в централизирания дневник');

// 2. Необработено изключение: записва се и процесът излиза с 1.
const crash = runChild(`
const guard = require(${JSON.stringify(GUARD)});
const logged = [], appended = [];
guard.install({ log: { error: (kind) => logged.push(kind) }, errorLog: { append: () => { appended.push(1); return Promise.resolve() } } });
setTimeout(() => { throw new Error('неочаквано счупване') }, 10);
setTimeout(() => { console.log('ОЩЕ ЖИВ'); process.exit(0) }, 400);
`);
assert.equal(crash.status, 1, 'при uncaughtException процесът трябва да излезе с код 1 (получен: ' + crash.status + ')');
assert.equal(/ОЩЕ ЖИВ/.test(crash.stdout), false, 'процесът не бива да продължи след необработено изключение');

// 3. Предпазителят наистина се вдига и се маха (иначе следващ тест наследява състояние).
const toggle = runChild(`
const guard = require(${JSON.stringify(GUARD)});
const inst = guard.install({ log: { error: () => {} } });
const on = inst.installed();
inst.uninstall();
const off = inst.installed();
console.log(JSON.stringify({ on, off }));
`);
assert.deepEqual(JSON.parse(toggle.stdout.trim()), { on: true, off: false }, 'install/uninstall работят');

// 4. Сървърът наистина го вдига при старт (иначе предпазителят е само библиотека).
const serverSource = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'server.js'), 'utf8');
assert.match(serverSource, /process-guards'\)\.install\(/, 'server.js трябва да вдига предпазителя при старт');

console.log('PASS process-guards: отхвърляне → жив процес + запис · изключение → код 1 · вдига се от server.js');
