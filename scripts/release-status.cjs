'use strict';
// Генерира `reports/RELEASE-STATUS.md` от РЕАЛНИТЕ артефакти, вместо да се пише на ръка.
//
// Защо: отчетът за състоянието на изданието беше ръчен и на два пъти изоставаше от
// кода (стигна до 0.69.19, докато изданието беше 0.69.25). Ръчно поддържан „доказателствен“
// документ е по-лош от никакъв: изглежда като факт, а е спомен.
//
// Правилото: числата в отчета идват само от отчети на инструментите
// (`reports/test-matrix.json`, `dist/RELEASE.json`, JSON изходите на двата скенера),
// а не от ръка. Датите също идват от артефактите, за да е възпроизводим резултатът.
//
//   node scripts/release-status.cjs            # презаписва отчета
//   node scripts/release-status.cjs --check    # не пише; код 1 при разминаване
//   node scripts/release-status.cjs --out <f>  # пише на друго място (за тестове)
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const TARGET = path.join(root, 'reports', 'RELEASE-STATUS.md');

const args = new Set(process.argv.slice(2));
const outIndex = process.argv.indexOf('--out');
const target = outIndex > 0 && process.argv[outIndex + 1] ? path.resolve(process.argv[outIndex + 1]) : TARGET;
const check = args.has('--check');

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const exists = (rel) => fs.existsSync(path.join(root, rel));

// Команда, чийто stdout е JSON — пускаме я и четем резултата, за да не разчитаме на
// стар записан отчет. Гейтовете са под секунда, затова е приемливо.
function runJson(script, extra = []) {
  const res = spawnSync(process.execPath, [path.join(root, script), ...extra], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  let data = null;
  try { data = JSON.parse(res.stdout) } catch { data = null }
  return { ok: res.status === 0, status: res.status, data, stderr: String(res.stderr || '').trim() };
}

// Гейт без JSON: важен е само изходният код и последният смислен ред.
function runGate(script, extra = []) {
  const res = spawnSync(process.execPath, [path.join(root, script), ...extra], { cwd: root, encoding: 'utf8' });
  const lines = String(res.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return { ok: res.status === 0, status: res.status, last: lines[lines.length - 1] || '', out: lines };
}

const version = (/^version:\s*"([^"]+)"/m.exec(read('hapi_enterprise/config.yaml')) || [])[1] || '';
const day = (iso) => String(iso || '').slice(0, 10);

// ── 1. Тестове ────────────────────────────────────────────────────────────────
const matrix = exists('reports/test-matrix.json') ? readJson('reports/test-matrix.json') : null;
// Времетраенето, опитите и датата на пускането нарочно НЕ влизат в отчета: те се менят при
// всяко пускане и биха направили проверката „отчетът е актуален“ невъзможна. Броят тестове
// идва от дървото (`tests/*.cjs`), а „минават“ се твърди само ако последният отчет го показва.
const testFiles = fs.readdirSync(path.join(root, 'tests')).filter((f) => /\.cjs$/.test(f) && f !== 'helpers.cjs').length;
const testsGreen = Boolean(matrix && (matrix.failed || []).length === 0 && matrix.passed === testFiles);
const testRow = matrix
  ? testsGreen
    ? `**${testFiles}/${testFiles}** — всички тестове от \`tests/\` минават`
    : `**${matrix.passed}/${testFiles}** — последното пускане НЕ е зелено, виж \`reports/test-matrix.json\``
  : 'няма отчет — пусни `node scripts/test-matrix.cjs`';

// ── 2. Издание ────────────────────────────────────────────────────────────────
const release = exists('dist/RELEASE.json') ? readJson('dist/RELEASE.json') : null;
const releaseFresh = Boolean(release && release.version === version);
const releaseRow = release
  ? (releaseFresh ? `\`dist/RELEASE.json\` за ${release.version}, изградено ${day(release.builtAt)}` : `**остаряло**: архивът е ${release.version}, а кодът е ${version} — пусни \`node scripts/build-release.cjs\``)
  : 'няма `dist/` — пусни `node scripts/build-release.cjs`';

// ── 3. Скенерите ──────────────────────────────────────────────────────────────
// Четем само `--json`: с `--gate` след JSON-а следва човешки текст и файлът не се парсва.
const logic = runJson('scripts/logic-audit.cjs', ['--json']);
const bad = runJson('scripts/bad-code-scan.cjs', ['--json']);
const logicCounts = logic.data ? { files: logic.data.files, lines: logic.data.scannedLines, open: (logic.data.open || []).length, accepted: (logic.data.accepted || []).length } : null;
const badCounts = bad.data ? { files: bad.data.scanned, lines: bad.data.totalLines, sev: bad.data.bySev || {} } : null;

// ── 4. Бързи гейтове ──────────────────────────────────────────────────────────
const docs = runGate('tests/docs-consistency.cjs');
const changelog = runGate('scripts/sync-addon-changelog.cjs', ['--check']);
const scenario = runGate('tests/scenario-matrix.cjs');

// ── 5. Какво влезе — първият запис в CHANGELOG ────────────────────────────────
function changelogSection(wanted) {
  const lines = read('CHANGELOG.md').split('\n');
  const start = lines.findIndex((l) => l.trim() === '## ' + wanted);
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  return body;
}
const entry = changelogSection(version);

const rows = [];
rows.push(['Тестове', '`node scripts/test-matrix.cjs`', testRow]);
rows.push(['Издание', '`node scripts/build-release.cjs` + `verify-release.cjs`', releaseRow]);
rows.push([
  'Логически одит',
  '`node scripts/logic-audit.cjs --gate`',
  logicCounts
    ? `${logicCounts.files} файла · ${logicCounts.lines} реда · ${logicCounts.open === 0 ? '**0** отворени' : '**' + logicCounts.open + '** отворени'} · ${logicCounts.accepted} с обосновка`
    : 'не се изпълни',
]);
rows.push([
  'Скенер за лош код',
  '`node scripts/bad-code-scan.cjs --gate`',
  badCounts
    ? `${badCounts.files} файла · ${badCounts.lines} реда · ` +
    ['critical', 'high', 'medium', 'low'].map((k) => `${k}: ${badCounts.sev[k] || 0}`).join(' · ') +
    ((badCounts.sev.critical || 0) + (badCounts.sev.high || 0) + (badCounts.sev.medium || 0) === 0 ? ' — чисто' : ' — **има необяснени**')
    : 'не се изпълни',
]);
rows.push(['Документация', '`node tests/docs-consistency.cjs`', docs.ok ? '✔ версията е еднаква в документите, няма счупени връзки' : '✘ ' + docs.last]);
rows.push(['Changelog на add-on-а', '`node scripts/sync-addon-changelog.cjs --check`', changelog.ok ? '✔ актуален' : '✘ ' + changelog.last]);
rows.push(['Сценарии', '`node tests/scenario-matrix.cjs`', scenario.ok ? '✔ ' + scenario.last.replace(/^PASS[^:]*:\s*/, '') : '✘ ' + scenario.last]);

const mb = (b) => (Number(b) / 1048576).toFixed(2) + ' MB';
const artifactRows = release
  ? [
    ['`' + release.addon.archive + '`', release.addon.fileCount != null ? `${release.addon.fileCount} файла · ${mb(release.addon.bytes)}` : '—', '`' + String(release.addon.sha256 || '').slice(0, 12) + '`'],
    ['`' + release.integration.archive + '`', release.integration.fileCount != null ? `${release.integration.fileCount} файла · ${mb(release.integration.bytes)}` : '—', '`' + String(release.integration.sha256 || '').slice(0, 12) + '`'],
    ['`repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt`', '4 артефакта', 'сумите вътре'],
  ]
  : [['—', '—', 'няма `dist/`']];

const md = [
  `# Състояние на изданието — hAPI Enterprise ${version}`,
  '',
  `Версия: **${version}** · клон \`main\`` + (release ? ` · архив изграден ${day(release.builtAt)}` : ''),
  '',
  'Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,',
  'а не от памет. Проверка: `node scripts/release-status.cjs --check`.',
  '',
  '## 1. Проверки',
  '',
  '| Проверка | Команда | Резултат |',
  '| --- | --- | --- |',
  ...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`),
  '',
  '## 2. Артефакти (`dist/`)',
  '',
  '| Файл | Обем | sha256 |',
  '| --- | --- | --- |',
  ...artifactRows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`),
  '',
  `## 3. Какво влезе във ${version}`,
  '',
  entry || '_Няма запис в `CHANGELOG.md` за тази версия._',
  '',
  '## 4. Как се проверява наново',
  '',
  '```',
  'node scripts/test-matrix.cjs          # пълният набор, от начало, до 5 опита',
  'node scripts/build-release.cjs        # dist/',
  'node scripts/verify-release.cjs       # S01–S21 върху готовия архив',
  'npm run audit:gui                     # GUI + съвместимост + изданието',
  'node scripts/release-status.cjs       # този отчет',
  '```',
  '',
  '## 5. Извън локалните гейтове',
  '',
  'CI, CodeQL, Release workflow и HACS проверките се виждат с `gh run list` — те не се',
  'записват тук, за да не се представя чужд резултат за свой.',
  '',
].join('\n');

if (check) {
  const current = exists(path.relative(root, target)) ? fs.readFileSync(target, 'utf8') : null;
  if (current === md) {
    console.log('release-status: отчетът е актуален (' + version + ')');
    process.exit(0);
  }
  const firstDiff = (() => {
    const a = (current || '').split('\n');
    const b = md.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return { line: i + 1, have: a[i] === undefined ? '(край)' : a[i], want: b[i] === undefined ? '(край)' : b[i] };
    return null;
  })();
  console.error('release-status: отчетът е остарял — ' + path.relative(root, target));
  if (firstDiff) console.error(`  ред ${firstDiff.line}\n  в файла: ${firstDiff.have}\n  очаквано: ${firstDiff.want}`);
  console.error('  поправка: node scripts/release-status.cjs');
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, md);
console.log('release-status: записан ' + path.relative(root, target) + ' за ' + version);
