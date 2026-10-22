'use strict';
// Отчетът за състоянието на изданието не бива да лъже.
//
// Правилото, което този тест пази:
//   • `reports/RELEASE-STATUS.md` съвпада байт по байт с това, което генераторът
//     произвежда от НАСТОЯЩИТЕ отчети — тоест не е остарял спрямо кода;
//   • числата в него идват от артефактите (`reports/test-matrix.json`, `dist/RELEASE.json`),
//     а не от ръка;
//   • `--check` наистина хваща разминаване (проверено с умишлено повредено копие),
//     иначе „проверката“ е украшение.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const script = path.join(root, 'scripts', 'release-status.cjs');
const committed = path.join(root, 'reports', 'RELEASE-STATUS.md');
const run = (args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });

const version = (/^version:\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(root, 'hapi_enterprise', 'config.yaml'), 'utf8')) || [])[1];
const matrix = JSON.parse(fs.readFileSync(path.join(root, 'reports', 'test-matrix.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-status-'));

try {
  // ── 1. Генераторът дава същото, което е в дървото ────────────────────────────
  const fresh = path.join(tmp, 'RELEASE-STATUS.md');
  const generated = run(['--out', fresh]);
  assert.equal(generated.status, 0, 'генераторът минава: ' + generated.stderr);
  assert.ok(fs.existsSync(fresh), 'генерираният файл съществува');
  const expected = fs.readFileSync(fresh, 'utf8');
  const actual = fs.readFileSync(committed, 'utf8');
  assert.equal(actual, expected, 'reports/RELEASE-STATUS.md е остарял — пусни `node scripts/release-status.cjs`');

  // ── 2. Съдържанието не е шаблон, а числа от отчетите ──────────────────────────
  const testFiles = fs.readdirSync(path.join(root, 'tests')).filter((f) => /\.cjs$/.test(f) && f !== 'helpers.cjs').length;
  assert.match(actual, new RegExp('^# Състояние на изданието — hAPI Enterprise ' + version.replace(/\./g, '\\.') + '$', 'm'), 'заглавието носи текущата версия');
  assert.ok(actual.includes(`**${testFiles}/${testFiles}**`), 'броят тестове идва от дървото: ' + testFiles);
  const skipped = Array.isArray(matrix.skipped) ? matrix.skipped.length : 0;
  assert.equal(
    matrix.passed + skipped,
    testFiles,
    'последното пускане е покрило всички тестове (' + matrix.passed + ' минали + ' + skipped + ' пропуснати от ' + testFiles + ')',
  );
  assert.deepEqual(matrix.failed || [], [], 'последното пускане е зелено — иначе отчетът не бива да казва „минават“');
  assert.equal(/\*\*\d+\/undefined\*\*|\[object Object\]/.test(actual), false, 'няма счупени интерполации');
  // Остаряла версия се търси само в заглавната част и таблиците: в §3 стои текстът на
  // CHANGELOG, който по право споменава стари версии.
  const head = actual.slice(0, actual.indexOf('## 3.'));
  assert.equal(/0\.69\.(?:1[0-9]|2[0-4])(?!\d)/.test(head), false, 'няма остаряла версия в заглавната част на отчета');

  // ── 3. Артефактите са описани с реалните си бройки ────────────────────────────
  const release = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'RELEASE.json'), 'utf8'));
  assert.ok(actual.includes(release.addon.archive), 'архивът на add-on-а е посочен');
  assert.equal(release.version, version, 'изданието в dist/ е за същата версия (иначе отчетът го казва черно на бяло)');

  // ── 4. `--check` минава на актуален файл ──────────────────────────────────────
  const green = run(['--check']);
  assert.equal(green.status, 0, '--check е зелен на актуалния отчет: ' + green.stderr);

  // ── 5. `--check` хваща разминаване ────────────────────────────────────────────
  const broken = path.join(tmp, 'broken.md');
  fs.writeFileSync(broken, expected.replace(/\*\*\d+\/\d+\*\*/, '**1/1**'));
  const red = run(['--check', '--out', broken]);
  assert.equal(red.status, 1, '--check връща код 1 при разминаване');
  assert.match(red.stderr, /остарял/, 'казва какво е: ' + red.stderr);
  const missing = run(['--check', '--out', path.join(tmp, 'няма-такъв.md')]);
  assert.equal(missing.status, 1, 'липсащ отчет също е разминаване');

  // ── 6. Отчетът не зависи от самоличността на артефакта ────────────────────────
  // sha256, обемът и датата на архива се сменят при друго сглобяване, при друг checkout
  // (CRLF срещу LF) и дори сами в полунощ. Ако влязат в отчета, проверката „отчетът е
  // актуален“ пада на друг компютър или на следващия ден — точно това чупеше CI.
  const releasePath = path.join(root, 'dist', 'RELEASE.json');
  const originalRelease = fs.readFileSync(releasePath, 'utf8');
  try {
    const other = JSON.parse(originalRelease);
    other.builtAt = '2001-01-01T00:00:00.000Z';
    other.addon.sha256 = 'f'.repeat(64);
    other.addon.bytes = 1;
    other.integration.sha256 = 'e'.repeat(64);
    other.integration.bytes = 2;
    fs.writeFileSync(releasePath, JSON.stringify(other, null, 2));
    const again = path.join(tmp, 'again.md');
    const regenerated = run(['--out', again]);
    assert.equal(regenerated.status, 0, 'генераторът минава и с други отпечатъци: ' + regenerated.stderr);
    assert.equal(
      fs.readFileSync(again, 'utf8'),
      actual,
      'отчетът не зависи от sha256/обем/дата на архива — иначе пада на друга платформа или на следващия ден',
    );
  } finally {
    fs.writeFileSync(releasePath, originalRelease);
  }

  console.log('PASS release-status: отчетът съвпада с артефактите (' + version + ' · ' + testFiles + ' теста) · независим е от платформа и дата · --check хваща остарял и липсващ');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
