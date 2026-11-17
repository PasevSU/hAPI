'use strict';
// ДНЕВНИКЪТ ПУСКА ВСИЧКИ ТЕСТОВЕ И ПАЗИ ПЪЛНИЯ ИМ ИЗХОД (0.69.232).
//
// Защо има тест: `scripts/verify-runner.cjs` е доказателството какво са казали тестовете.
// Ако „пести“ пускания или съкращава изхода, човек остава с фалшиво спокойствие — точно
// класът на DEF-58. Затова поведението се проверява върху ВРЕМЕННО дърво, не върху истинското:
//   1. пуска ВСЕКИ тест и пише отделен лог с ЦЕЛИЯ му изход (включително втори ред);
//   2. второто пускане пак пуска всички — нищо не се пропуска „защото е същото“;
//   3. падането стига до показалеца с реда на грешката и до лога с целия текст;
//   4. тест, който сам казва SKIP, се брои отделно като „не е проверил нищо“, не като минал;
//   5. `--status` не стартира нищо; `--tail` показва лога; `--only` е частичен и не подменя
//      присъдата; старите пускове се изтриват според `--keep`.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const runner = path.join(__dirname, '..', 'scripts', 'verify-runner.cjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-verify-'));

const write = (rel, text) => {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
};
const reportPath = (rel) => path.join(tmp, 'reports', rel);
const readState = () => JSON.parse(fs.readFileSync(reportPath('test-log-state.json'), 'utf8'));
const readJsonl = () =>
  fs
    .readFileSync(reportPath('test-log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const logOf = (file) => fs.readFileSync(path.join(tmp, readState().tests[file].log), 'utf8');
const runsOnDisk = () => fs.readdirSync(reportPath('test-logs'));

/** Пуска дневника върху временното дърво и връща { code, out }. */
const run = (...flags) => {
  try {
    const out = execFileSync(process.execPath, [runner, `--root=${tmp}`, ...flags], { encoding: 'utf8', cwd: tmp });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status == null ? 1 : err.status, out: String(err.stdout || '') + String(err.stderr || '') };
  }
};

try {
  // ── Временно дърво: четири теста с различно поведение ───────────────────
  write('tests/alfa.cjs', "console.log('PASS alfa');\nconsole.log('alfa стъпка две');\n");
  write('tests/beta.cjs', "console.log('PASS beta');\n");
  write('tests/gamma.cjs', "console.log('gamma SKIP: липсва gpg');\n");
  write('tests/delta.cjs', "console.error('AssertionError: счупено нарочно');\nprocess.exitCode = 1;\n");

  // ── 1. Първи пуск: ВСИЧКИ тестове, всеки със свой лог ──────────────────
  const first = run();
  assert.equal(first.code, 1, 'паднал тест дава код 1: ' + first.out);
  assert.match(first.out, /Дневник: 4 теста/, 'пуска всичките четири: ' + first.out);
  assert.match(first.out, /✔ alfa\.cjs/, 'alfa е минал');
  assert.match(first.out, /⊘ gamma\.cjs/, 'gamma е отчетен като непроверил нищо');
  assert.match(first.out, /✘ delta\.cjs/, 'delta е отчетен като паднал');

  const state1 = readState();
  assert.equal(Object.keys(state1.tests).length, 4, 'показалецът пази и четирите теста');
  assert.equal(state1.tests['delta.cjs'].status, 'fail', 'падането е записано');
  assert.match(state1.tests['delta.cjs'].error, /AssertionError: счупено нарочно/, 'записан е редът на грешката');
  assert.equal(state1.tests['gamma.cjs'].status, 'env-skip', 'SKIP не се брои за минал');
  assert.equal(state1.files, 4, 'броят тестове е записан');

  const runDir = path.join(tmp, 'reports', 'test-logs', state1.runId);
  assert.equal(fs.readdirSync(runDir).length, 4, 'всеки тест има собствен лог файл');
  assert.match(logOf('alfa.cjs'), /PASS alfa/, 'логът носи първия ред');
  assert.match(logOf('alfa.cjs'), /alfa стъпка две/, 'логът носи ЦЕЛИЯ изход, не само последния ред');
  assert.match(logOf('delta.cjs'), /счупено нарочно/, 'логът на падналия тест пази причината');

  const index1 = fs.readFileSync(reportPath('TEST-LOG.md'), 'utf8');
  assert.match(index1, /Дневник на всички тестове/, 'показалецът има заглавие');
  assert.match(index1, /Проблеми в кода \(1\)/, 'показалецът брои падналия тест');
  assert.match(index1, /delta\.cjs/, 'показалецът назовава падналия тест');
  assert.match(index1, /test-logs\//, 'показалецът сочи пълния лог');
  assert.match(index1, /Не провериха нищо \(1\)/, 'показалецът изброява непроверените отделно');

  // ── 2. Второ пускане: пак ВСИЧКИ, нищо не се пропуска ──────────────────
  const second = run();
  assert.match(second.out, /Дневник: 4 теста/, 'второто пускане не „пести“ тестове: ' + second.out);
  assert.equal(readJsonl().length, 2, 'всеки пуск оставя ред в машинния дневник');
  assert.equal(readJsonl()[1].files, 4, 'вторият ред описва четирите теста');

  // ── 3. `--status` не стартира нищо ─────────────────────────────────────
  const before = readJsonl().length;
  const status = run('--status');
  assert.equal(status.code, 1, 'статусът връща 1 при паднал тест: ' + status.out);
  assert.match(status.out, /Проблеми \(1\)/, 'статусът изброява проблема: ' + status.out);
  assert.match(status.out, /delta\.cjs/, 'статусът назовава падналия тест');
  assert.equal(readJsonl().length, before, 'статусът не стартира тест');

  // ── 4. `--tail` показва пълния лог на теста ────────────────────────────
  const tail = run('--tail=alfa');
  assert.equal(tail.code, 0, 'tail намира теста: ' + tail.out);
  assert.match(tail.out, /alfa стъпка две/, 'tail показва целия изход от лога');

  // ── 5. Поправка: падналият минава, непровереният остава отчетен ────────
  write('tests/delta.cjs', "console.log('PASS delta');\n");
  const fixed = run();
  assert.equal(fixed.code, 0, 'след поправката пускът е зелен: ' + fixed.out);
  assert.match(fixed.out, /1 непроверени/, 'непровереният тест се вижда и в присъдата: ' + fixed.out);
  const index2 = fs.readFileSync(reportPath('TEST-LOG.md'), 'utf8');
  assert.match(index2, /Няма — всеки тест е минал и е оставил лог/, 'показалецът вече не показва проблеми');
  assert.match(index2, /gamma\.cjs/, 'непровереният тест остава изброен');

  // ── 6. `--only` е частичен пуск и не подменя присъдата ─────────────────
  const fullRunId = readState().runId;
  const partial = run('--only=beta');
  assert.equal(partial.code, 0, 'частичният пуск минава: ' + partial.out);
  assert.match(partial.out, /ЧАСТИЧЕН пуск/, 'казва, че е частичен: ' + partial.out);
  assert.equal(readState().runId, fullRunId, 'частичният пуск не подменя последния пълен');
  assert.equal(readJsonl().at(-1).partial, true, 'машинният дневник отбелязва частичния пуск');

  // ── 7. Старите пускове се изтриват според `--keep` ─────────────────────
  write('reports/test-logs/20200101-000000/star.log', 'стар пуск\n');
  write('reports/test-logs/20200102-000000/star.log', 'стар пуск\n');
  const kept = run('--keep=1');
  assert.equal(kept.code, 0, 'пускът с --keep минава: ' + kept.out);
  const dirs = runsOnDisk().sort();
  assert.equal(dirs.length, 1, 'пази се само последният пуск: ' + dirs.join(', '));
  assert.equal(dirs[0], readState().runId, 'останалият пуск е последният');

  console.log(
    'PASS verify-runner: всички тестове се пускат всеки път · всеки има пълен лог · падането и SKIP-ът се виждат · ' +
      '--status/--tail четат без пуск · --only е частичен · старите пускове се чистят',
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
