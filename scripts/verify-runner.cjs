'use strict';
// ДНЕВНИК НА ВСИЧКИ ТЕСТОВЕ — пуска ВСЕКИ тест и запазва ПЪЛНИЯ му изход (0.69.232).
//
// Защо съществува: матрицата (`scripts/test-matrix.cjs`) е портата на изданието. Тя пуска
// всичко, но пази само присъда и последен ред на теста. За ежедневната работа трябва същият
// ПЪЛЕН обхват, но с доказателство: какво точно е казал всеки тест, кога и върху какво
// съдържание. Затова този скрипт пуска ВСИЧКИ тестове от `tests/` и пише за всеки от тях
// собствен лог файл с целия stdout + stderr.
//
// Правилото е просто: тест, който не е стартиран, не е минал. Затова тук НЯМА пропускане по
// зависимост, по време или по име — единственото, което скриптът прави с файл, е да го пусне
// и да запише какво е станало. `--only` е частичен пуск и не подменя присъдата на пълния.
//
// Употреба:
//   node scripts/verify-runner.cjs                # всички тестове + пълен лог
//   node scripts/verify-runner.cjs --status       # какво казва последният пълен пуск (нищо не пуска)
//   node scripts/verify-runner.cjs --tail=qr      # последният лог на тест, чието име съдържа „qr“
//   node scripts/verify-runner.cjs --only=qr      # ЧАСТИЧЕН пуск (само съвпадащите имена)
//   node scripts/verify-runner.cjs --keep=20      # колко пуска да пази на диска (по подразбиране 10)
//   node scripts/verify-runner.cjs --timeout=300000 --json --quiet
//
// Какво се пише:
//   reports/test-logs/<пуск>/<тест>.log   пълният изход (stdout + stderr) на един тест
//   reports/test-log-state.json           последният ПЪЛЕН пуск: всеки тест, присъда, време, лог
//   reports/test-log.jsonl                един ред на пуск (час, отпечатък, бройки, паднали)
//   reports/TEST-LOG.md                   човешкият показалец към последния пълен пуск
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (name, def = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

const ROOT = path.resolve(valueOf('root', path.join(__dirname, '..')));
const TESTS_DIR = path.join(ROOT, 'tests');
const REPORTS = path.join(ROOT, 'reports');
const LOG_ROOT = path.join(REPORTS, 'test-logs');
const STATE_FILE = path.join(REPORTS, 'test-log-state.json');
const INDEX_FILE = path.join(REPORTS, 'TEST-LOG.md');
const JSONL_FILE = path.join(REPORTS, 'test-log.jsonl');
const PER_TEST_TIMEOUT = Math.max(1000, Number(valueOf('timeout', '180000')) || 180000);
const KEEP_RUNS = Math.max(1, Number(valueOf('keep', '10')) || 10);
const MAX_BUFFER = 64 * 1024 * 1024;

const only = valueOf('only', '').trim().toLowerCase();
const tailOf = valueOf('tail', '').trim().toLowerCase();
const statusOnly = has('--status');
const jsonOut = has('--json');
const quiet = has('--quiet');
const partial = Boolean(only);

/**
 * Тестове, които не проверяват кода, а АРТЕФАКТИТЕ на изданието (`reports/test-matrix.json`,
 * `reports/RELEASE-STATUS.md`). Те се пускат ВИНАГИ като всички останали — но когато паднат,
 * дневникът ги назовава отделно с обяснение: „матрицата е от преди промяната“, не „кодът е
 * счупен“. Това е етикет, не пропуск.
 */
const ARTIFACT_TESTS = new Set(['matrix-freshness.cjs', 'release-status.cjs']);

/** Env, който add-on-ът чете. Изтекъл от родителската сесия, той дава чужди настройки. */
const LEAKY_ENV = [
  'DATA_DIR', 'PORT', 'ADMIN_PORT', 'ADMIN_BIND_HOST', 'PUBLIC_BIND_HOST', 'PUBLIC_BASE_URL',
  'INGRESS_MODE', 'LOG_LEVEL', 'STORAGE_CHECK_INTERVAL_MS', 'STORAGE_LOCATION',
  'STORAGE_SUBDIRECTORY', 'STORAGE_MODE', 'MIN_FREE_MB', 'ADMIN_TOKEN', 'ADMIN_USERNAME',
  'ADMIN_PASSWORD', 'OPERATOR_TOKEN', 'VIEWER_TOKEN', 'USER_ROLES', 'GROUP_ROLES', 'DEFAULT_ROLE',
  'OPTIONS_PATH', 'HAPI_CONFIG_DIR', 'CONFIG_DIR', 'BACKUP_DIR', 'BACKUP_FOLDER', 'DB_ID',
  'PROFILES', 'RETENTION_DAYS', 'TSA_ENABLED', 'TSA_START_URL', 'TSA_STOP_URL', 'SIGN_PACKAGES',
  'SIGNING_KEY', 'ENCRYPT_FILES', 'TLS_CERT', 'TLS_KEY', 'REQUIRE_PORTAL_TOKEN', 'PUBLIC_GATEWAY',
  'PUBLIC_SAME_ORIGIN', 'PUBLIC_DOMAIN', 'HAPI_FIRST_RUN_SEED', 'NODE_ENV',
];

const nowIso = () => new Date().toISOString();
const readIf = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

/** Име на пуск, подредено по време: `20261116-193015`. */
function newRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function allTests() {
  return fs
    .readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.cjs') && f !== 'helpers.cjs')
    .sort();
}

function baseEnv() {
  const env = { ...process.env };
  for (const key of LEAKY_ENV) delete env[key];
  return env;
}

/** Отпечатък на кода, върху който е пуснат тестът (същото правило като матрицата). */
function treeFingerprint() {
  try {
    return require('./tree-fingerprint.cjs').fingerprint(ROOT).hash;
  } catch (err) {
    return `неизвестен (${err.code || err.message})`;
  }
}

function loadState() {
  try {
    const parsed = JSON.parse(readIf(STATE_FILE));
    if (parsed && typeof parsed === 'object' && parsed.tests) return parsed;
  } catch (err) {
    // Счупен дневник не бива да спира пускането: той е памет, не порта.
    if (err instanceof SyntaxError) return null;
  }
  return null;
}

/** Първият ред, който обяснява провала — за показалеца; пълният текст е в лога. */
function errorLineOf(output) {
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => /AssertionError|Error:|FAIL|✘/.test(l));
  return String(hit || lines[lines.length - 1] || '').slice(0, 300);
}

function headerFor(file, runId, tree) {
  return [
    `# тест: ${file}`,
    `# пуск: ${runId}`,
    `# отпечатък на дървото: ${tree}`,
    '# съдържание: пълният stdout + stderr на теста, без съкращаване',
    `# започнат: ${nowIso()}`,
    '',
  ].join('\n');
}

/** Пуска ЕДИН тест и пише лога му. Връща записа за показалеца. */
function runOne(file, runId, tree, env, logsDir) {
  const abs = path.join(TESTS_DIR, file);
  const t0 = Date.now();
  const res = spawnSync(process.execPath, [abs], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: PER_TEST_TIMEOUT,
    maxBuffer: MAX_BUFFER,
  });
  const ms = Date.now() - t0;
  const timedOut = Boolean(res.error && res.error.code === 'ETIMEDOUT');
  const overflow = Boolean(res.error && res.error.code === 'ENOBUFS');
  const output = `${res.stdout || ''}${res.stderr || ''}`;
  const ok = !timedOut && !overflow && res.status === 0;
  const envSkip = ok && /(^|\n)\s*[\w.-]+ SKIP(PED)?[: (]/.test(output);
  const status = timedOut ? 'timeout' : overflow ? 'overflow' : ok ? (envSkip ? 'env-skip' : 'pass') : 'fail';
  const error = status === 'pass'
    ? ''
    : timedOut
      ? `таймаут след ${PER_TEST_TIMEOUT} ms`
      : overflow
        ? 'изходът надхвърли 64 MB — тестът не бива да говори толкова'
        : errorLineOf(output);

  const logFile = path.join(logsDir, `${file}.log`);
  const body = output || '(тестът не написа нищо)\n';
  fs.writeFileSync(logFile, headerFor(file, runId, tree) + body + (body.endsWith('\n') ? '' : '\n'), 'utf8');

  return {
    file,
    status,
    ms,
    exit: res.status,
    bytes: Buffer.byteLength(output),
    sha256: crypto.createHash('sha256').update(output).digest('hex'),
    error,
    log: path.relative(ROOT, logFile).split(path.sep).join('/'),
  };
}

const MARKS = { pass: '✔', fail: '✘', timeout: '⏱', overflow: '✘', 'env-skip': '⊘' };

/** Човешкият показалец към последния ПЪЛЕН пуск. */
function writeIndex(state) {
  const rows = Object.keys(state.tests)
    .sort()
    .map((file) => {
      const t = state.tests[file];
      const note = (t.error || '').replace(/\|/g, '\\|').slice(0, 120);
      return `| ${MARKS[t.status] || '?'} | \`${file}\` | ${t.status} | ${t.ms} ms | \`${t.log}\` | ${note} |`;
    });
  const failed = Object.entries(state.tests).filter(([, t]) => t.status === 'fail' || t.status === 'timeout' || t.status === 'overflow');
  const artifact = failed.filter(([file]) => ARTIFACT_TESTS.has(file));
  const code = failed.filter(([file]) => !ARTIFACT_TESTS.has(file));
  const envSkipped = Object.entries(state.tests).filter(([, t]) => t.status === 'env-skip');
  const lines = [
    '# Дневник на всички тестове — hAPI Enterprise',
    '',
    `> **Клас:** жив · **Собственик на факта:** тестове и проверки · **Проверен към:** ${state.at.slice(0, 10)}`,
    '',
    '> Пише се от `scripts/verify-runner.cjs`. Скриптът пуска **ВСЕКИ** тест от `tests/` — не',
    '> пропуска нищо по зависимост, по време или по име — и запазва пълния изход на всеки тест в',
    '> `reports/test-logs/<пуск>/<тест>.log`. Затова този файл е доказателството, а не обещание:',
    '> редът на падането и целият разговор на теста се четат, без да се пуска нищо наново.',
    '',
    `## Последен пълен пуск · ${state.at.replace('T', ' ').slice(0, 19)}`,
    '',
    `- пуск: \`${state.runId}\` · отпечатък на дървото: \`${state.tree.slice(0, 16)}…\``,
    `- тестове: **${state.files}** · минали **${state.counts.pass}** · паднали **${failed.length}** · не проверили нищо **${envSkipped.length}**`,
    `- време: **${(state.ms / 1000).toFixed(1)} s** · пълни логове: \`reports/test-logs/${state.runId}/\``,
    `- присъда: **${state.verdict}**`,
    '',
    code.length ? `## Проблеми в кода (${code.length})` : '## Проблеми в кода\n\nНяма — всеки тест е минал и е оставил лог.',
    '',
    ...code.map(([file, t]) => `- **${file}** · ${t.status} · ${t.error || 'без ред за грешка'} → \`${t.log}\``),
    '',
    artifact.length ? `## Артефакти на изданието (${artifact.length})` : '',
    '',
    ...(artifact.length
      ? [
          '> Тези тестове проверяват `reports/test-matrix.json` / `reports/RELEASE-STATUS.md`, не кода.',
          '> Паднал ред тук значи „матрицата е от преди промяната“: пусни `node scripts/test-matrix.cjs`,',
          '> после пак дневника. Това не е пропуск — тестът е стартиран и е казал какво вижда.',
          '',
          ...artifact.map(([file, t]) => `- **${file}** · ${t.status} · ${t.error || 'без ред за грешка'} → \`${t.log}\``),
        ]
      : []),
    '',
    envSkipped.length ? `## Не провериха нищо (${envSkipped.length})` : '',
    '',
    ...(envSkipped.length
      ? [
          '> Тестът сам е казал `SKIP` (липсва инструмент или артефакт). Изходът му е запазен в лога;',
          '> такъв ред НЕ се брои за минал — вдигни средата, ако пускът трябва да брои за пълен.',
          '',
          ...envSkipped.map(([file, t]) => `- \`${file}\` → \`${t.log}\``),
        ]
      : []),
    '',
    '## Всички тестове',
    '',
    '| | тест | състояние | време | пълен лог | бележка |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].filter((line) => line !== '');
  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  fs.writeFileSync(INDEX_FILE, lines.join('\n') + '\n', 'utf8');
}

/** Пази само последните N пуска — логовете са големи, а старите не носят нищо ново. */
function pruneRuns(keep) {
  let entries;
  try {
    entries = fs.readdirSync(LOG_ROOT, { withFileTypes: true });
  } catch {
    return 0;
  }
  const runs = entries
    .filter((e) => e.isDirectory() && /^\d{8}-\d{6}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
  let removed = 0;
  for (const name of runs.slice(keep)) {
    fs.rmSync(path.join(LOG_ROOT, name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

function countsOf(tests) {
  const counts = { pass: 0, fail: 0, timeout: 0, overflow: 0, 'env-skip': 0 };
  for (const t of Object.values(tests)) counts[t.status] = (counts[t.status] || 0) + 1;
  return counts;
}

function verdictOf(counts) {
  const bad = counts.fail + counts.timeout + counts.overflow;
  return bad ? `паднали ${bad}` : counts['env-skip'] ? 'минали, но с непроверени' : 'всички минаха';
}

function printStatus(state) {
  if (!state) {
    process.stdout.write('Дневник: още няма пълен пуск (пусни `node scripts/verify-runner.cjs`).\n');
    return 0;
  }
  const counts = state.counts || countsOf(state.tests);
  const failed = Object.entries(state.tests).filter(([, t]) => ['fail', 'timeout', 'overflow'].includes(t.status));
  process.stdout.write(`Дневник: ${state.files} теста · пуск ${state.runId} · ${state.at.replace('T', ' ').slice(0, 16)}\n`);
  process.stdout.write(`Присъда: ${state.verdict} · минали ${counts.pass} · паднали ${counts.fail + counts.timeout + counts.overflow} · не проверили нищо ${counts['env-skip']}\n`);
  process.stdout.write(`Логове: reports/test-logs/${state.runId}/\n`);
  if (failed.length) {
    process.stdout.write(`Проблеми (${failed.length}):\n`);
    for (const [file, t] of failed) process.stdout.write(`  ✘ ${file} · ${t.error || t.status} → ${t.log}\n`);
    return 1;
  }
  process.stdout.write('Проблеми няма.\n');
  return 0;
}

function printTail(state) {
  if (!state) {
    process.stdout.write('Дневник: още няма пълен пуск.\n');
    return 1;
  }
  const hits = Object.keys(state.tests).filter((file) => file.toLowerCase().includes(tailOf));
  if (!hits.length) {
    process.stdout.write(`Няма тест с „${tailOf}“ в името.\n`);
    return 1;
  }
  for (const file of hits) {
    const t = state.tests[file];
    process.stdout.write(`═══ ${file} · ${t.status} · ${t.ms} ms · ${t.log}\n`);
    process.stdout.write(readIf(path.join(ROOT, t.log)) || '(логът липсва на диска)\n');
  }
  return 0;
}

function main() {
  const state = loadState();
  if (statusOnly) {
    if (jsonOut) {
      process.stdout.write(`${JSON.stringify(state || { tests: {} }, null, 2)}\n`);
      return state ? (verdictOf(countsOf(state.tests)) === 'всички минаха' ? 0 : 1) : 0;
    }
    return printStatus(state);
  }
  if (tailOf) return printTail(state);

  const files = allTests().filter((f) => (only ? f.toLowerCase().includes(only) : true));
  if (!files.length) {
    process.stdout.write(`Няма тест за пускане (only="${only}").\n`);
    return 1;
  }

  const runId = newRunId();
  const tree = treeFingerprint();
  const logsDir = path.join(LOG_ROOT, runId);
  fs.mkdirSync(logsDir, { recursive: true });
  const env = baseEnv();
  const t0 = Date.now();
  if (!quiet) {
    process.stdout.write(
      `\n═══ Дневник: ${files.length} ${files.length === 1 ? 'тест' : 'теста'}` +
      `${partial ? ' (ЧАСТИЧЕН пуск)' : ''} · пуск ${runId}\n`,
    );
    process.stdout.write(`    логове: reports/test-logs/${runId}/\n\n`);
  }

  const tests = {};
  for (const file of files) {
    const record = runOne(file, runId, tree, env, logsDir);
    tests[file] = record;
    if (quiet) continue;
    const note = record.status === 'pass' ? '' : ` ${record.error}`;
    process.stdout.write(`  ${MARKS[record.status]} ${file} (${record.ms}ms)${note.slice(0, 160)}\n`);
  }

  const ms = Date.now() - t0;
  const counts = countsOf(tests);
  const verdict = verdictOf(counts);
  const at = nowIso();
  const summary = { runId, at, tree, files: files.length, partial, ms, counts, verdict };

  fs.mkdirSync(REPORTS, { recursive: true });
  fs.appendFileSync(
    JSONL_FILE,
    `${JSON.stringify({
      ...summary,
      failed: Object.keys(tests).filter((f) => ['fail', 'timeout', 'overflow'].includes(tests[f].status)),
      envSkipped: Object.keys(tests).filter((f) => tests[f].status === 'env-skip'),
    })}\n`,
    'utf8',
  );

  if (!partial) {
    const stateOut = { version: 1, ...summary, tests };
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(stateOut, null, 2)}\n`, 'utf8');
    writeIndex(stateOut);
    const pruned = pruneRuns(KEEP_RUNS);
    if (pruned && !quiet) process.stdout.write(`  (изтрити ${pruned} стари пуска — пазим последните ${KEEP_RUNS})\n`);
  }

  if (!quiet) {
    process.stdout.write(
      `\n${verdict} · ${files.length} пуснати · ${counts.pass} минали · ` +
      `${counts.fail + counts.timeout + counts.overflow} паднали · ${counts['env-skip']} непроверени · ` +
      `${(ms / 1000).toFixed(1)} s\n`,
    );
    process.stdout.write(
      partial
        ? 'Частичен пуск: присъдата на последния пълен пуск не е подменена.\n'
        : `Показалец: ${path.relative(ROOT, INDEX_FILE)} · състояние: ${path.relative(ROOT, STATE_FILE)}\n`,
    );
  }
  if (jsonOut) process.stdout.write(`${JSON.stringify(summary)}\n`);
  return counts.fail + counts.timeout + counts.overflow ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (err) {
  process.stderr.write(`verify-runner: ${err.message}\n`);
  process.exitCode = 1;
}
