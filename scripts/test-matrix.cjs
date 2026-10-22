'use strict';
// Цялостен тестов пакет: изпълнява ВСИЧКИ тестове от `tests/` и при каквато и да е
// грешка рестартира цялата серия ОТ НАЧАЛО, докато не се стигне 100% успех.
//
// Употреба:
//   node scripts/test-matrix.cjs                  # до 5 пълни опита, после провал
//   node scripts/test-matrix.cjs --attempts=8     # повече опити
//   node scripts/test-matrix.cjs --only=rbac      # само тестове, чието име съдържа "rbac"
//   node scripts/test-matrix.cjs --skip=release-status # без тест, който чете отчета на самата серия
//   node scripts/test-matrix.cjs --timeout=60000  # таймаут на отделен тест (ms)
//   node scripts/test-matrix.cjs --verbose        # показва изхода и на успешните тестове
//
// Резултат: `reports/test-matrix.json` (опити, времена, нестабилни тестове) + код 0
// само при 100% успех. Никога не "закръгля" успех — при остатъчни грешки връща 1.
const { readdirSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const testsDir = path.join(root, 'tests');
const reportsDir = path.join(root, 'reports');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  if (hit === `--${name}`) return 'true';
  return hit.slice(hit.indexOf('=') + 1);
};
const verbose = opt('verbose', 'false') === 'true';
const attempts = Math.max(1, Number(opt('attempts', '5')) || 5);
const perTestTimeout = Math.max(1000, Number(opt('timeout', '180000')) || 180000);
const only = String(opt('only', '')).trim().toLowerCase();
// `--skip` съществува за точно един случай: `tests/release-status.cjs` чете
// `reports/test-matrix.json`, който САМАТА серия пише едва накрая. Когато се добави нов
// тестов файл, отчетът още описва стария набор и тестът пада по определение. Затова
// bootstrap-ът се прави с `--skip=release-status`, отчетът се регенерира и след това
// пълната серия (без пропуски) го проверява. Това не е отслабване: тестът се пуска в
// следващата пълна серия и в CI, където се изпълнява направо.
const skip = String(opt('skip', ''))
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Env, който add-on-ът чете. Ако е изтекъл от родителската сесия, тестовете
// получават чужди настройки (DATA_DIR, INGRESS_MODE, ADMIN_PORT…) и падат с
// подвеждащи 404/401. Затова всяка серия стартира с изчистен env.
const LEAKY_ENV = [
  'DATA_DIR',
  'PORT',
  'ADMIN_PORT',
  'ADMIN_BIND_HOST',
  'PUBLIC_BIND_HOST',
  'PUBLIC_BASE_URL',
  'INGRESS_MODE',
  'LOG_LEVEL',
  'STORAGE_CHECK_INTERVAL_MS',
  'STORAGE_LOCATION',
  'STORAGE_SUBDIRECTORY',
  'STORAGE_MODE',
  'MIN_FREE_MB',
  'ADMIN_TOKEN',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'OPERATOR_TOKEN',
  'VIEWER_TOKEN',
  'USER_ROLES',
  'GROUP_ROLES',
  'DEFAULT_ROLE',
  'OPTIONS_PATH',
  'HAPI_CONFIG_DIR',
  'CONFIG_DIR',
  'BACKUP_DIR',
  'BACKUP_FOLDER',
  'DB_ID',
  'PROFILES',
  'RETENTION_DAYS',
  'TSA_ENABLED',
  'TSA_START_URL',
  'TSA_STOP_URL',
  'SIGN_PACKAGES',
  'SIGNING_KEY',
  'ENCRYPT_FILES',
  'TLS_CERT',
  'TLS_KEY',
  'REQUIRE_PORTAL_TOKEN',
  'PUBLIC_GATEWAY',
  'PUBLIC_SAME_ORIGIN',
  'PUBLIC_DOMAIN',
  'HAPI_FIRST_RUN_SEED',
  'NODE_ENV',
];

function baseEnv() {
  const env = { ...process.env };
  for (const key of LEAKY_ENV) delete env[key];
  return env;
}

function allTests() {
  return readdirSync(testsDir)
    .filter((f) => /\.cjs$/.test(f) && f !== 'helpers.cjs')
    .sort();
}

function testFiles() {
  const all = allTests();
  const picked = only ? all.filter((f) => f.toLowerCase().includes(only)) : all;
  const kept = picked.filter((f) => !skip.some((s) => f.toLowerCase().includes(s)));
  if (!kept.length) throw new Error(`Няма тест за пускане след филтрите (only="${only}", skip="${skip.join(',')}")`);
  return kept;
}

function runSuite(files, env) {
  const results = [];
  const started = Date.now();
  for (const file of files) {
    const abs = path.join(testsDir, file);
    const t0 = Date.now();
    const res = spawnSync(process.execPath, [abs], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: perTestTimeout,
      maxBuffer: 32 * 1024 * 1024,
    });
    const ms = Date.now() - t0;
    const timedOut = res.error && res.error.code === 'ETIMEDOUT';
    const ok = !timedOut && res.status === 0;
    const output = `${res.stdout || ''}${res.stderr || ''}`.trim();
    results.push({ file, ok, ms, exit: res.status, timedOut, output });
    if (ok && !verbose) {
      const lastLine = output.split('\n').filter(Boolean).pop() || 'PASS';
      process.stdout.write(`  ✔ ${file} (${ms}ms) ${lastLine.slice(0, 110)}\n`);
    } else if (!ok) {
      process.stdout.write(`  ✘ ${file} (${ms}ms) exit=${res.status}${timedOut ? ' TIMEOUT' : ''}\n`);
      const tail = output.split('\n').slice(-25).join('\n');
      if (tail) process.stdout.write(`${tail}\n`);
    } else {
      process.stdout.write(`${output}\n`);
    }
  }
  return { results, ms: Date.now() - started };
}

function summarize(history, files) {
  return files.map((file) => {
    const runs = history.map((h) => h.results.find((r) => r.file === file)).filter(Boolean);
    const fails = runs.filter((r) => !r.ok).length;
    const last = runs[runs.length - 1];
    return {
      file,
      ok: Boolean(last && last.ok),
      fails,
      attempts: runs.length,
      lastMs: last ? last.ms : 0,
      flaky: fails > 0 && Boolean(last && last.ok),
    };
  });
}

function writeReport(payload) {
  try {
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(path.join(reportsDir, 'test-matrix.json'), `${JSON.stringify(payload, null, 2)}\n`);
  } catch (e) {
    process.stdout.write(`  (report not written: ${e.code || e.message})\n`);
  }
}

function main() {
  const files = testFiles();
  // Пропуснатите се записват в отчета: при `--skip` те не са „минали“, а не са пускани.
  // Генераторът на `reports/RELEASE-STATUS.md` брои покритието като passed + skipped и
  // само тогава казва „всички тестове минават“ — иначе bootstrap пускът би се представял
  // за пълен. При `--only` не се записва нищо (това е частична серия по определение).
  const skipped = only ? [] : allTests().filter((f) => !files.includes(f));
  const env = baseEnv();
  process.stdout.write(
    `\n═══ Цялостен тестов пакет: ${files.length} теста · до ${attempts} пълни опита\n`,
  );
  if (only) process.stdout.write(`    филтър: *${only}*\n`);

  const history = [];
  const startedAll = Date.now();
  for (let attempt = 1; attempt <= attempts; attempt++) {
    process.stdout.write(`\n─── Опит ${attempt}/${attempts} (всички тестове от начало) ───\n`);
    const run = runSuite(files, env);
    history.push({ attempt, at: new Date().toISOString(), ms: run.ms, results: run.results });
    const failed = run.results.filter((r) => !r.ok);
    process.stdout.write(
      `    резултат: ${run.results.length - failed.length}/${run.results.length} за ${(run.ms / 1000).toFixed(1)}s\n`,
    );
    if (!failed.length) break;
    if (attempt < attempts) {
      process.stdout.write(
        `    ${failed.length} грешки → рестарт на ЦЯЛАТА серия от начало: ${failed
          .map((f) => f.file)
          .join(', ')}\n`,
      );
    }
  }

  const summary = summarize(history, files);
  const failed = summary.filter((s) => !s.ok);
  const flaky = summary.filter((s) => s.flaky);
  const totalMs = Date.now() - startedAll;
  writeReport({
    generatedAt: new Date().toISOString(),
    attemptsUsed: history.length,
    attemptsAllowed: attempts,
    totalMs,
    files: files.length,
    passed: files.length - failed.length,
    failed: failed.map((f) => f.file),
    flaky: flaky.map((f) => f.file),
    skipped,
    perTest: summary,
  });

  process.stdout.write('\n═══ Обобщение ═══\n');
  if (flaky.length) {
    process.stdout.write(`    нестабилни (минали след рестарт): ${flaky.map((f) => f.file).join(', ')}\n`);
  }
  if (failed.length) {
    process.stdout.write(
      `    ✘ ${failed.length} теста останаха с грешка след ${history.length} опита: ${failed
        .map((f) => f.file)
        .join(', ')}\n`,
    );
    process.stdout.write('    → поправи причината; пакетът не отчита успех при остатъчни грешки.\n');
    return 1;
  }
  process.stdout.write(
    `    ✔ 100% успех: ${files.length}/${files.length} теста за ${(totalMs / 1000).toFixed(1)}s ` +
    `(${history.length} ${history.length === 1 ? 'опит' : 'опита'})\n`,
  );
  process.stdout.write('    отчет: reports/test-matrix.json\n');
  return 0;
}

try {
  process.exitCode = main();
} catch (e) {
  process.stderr.write(`test-matrix: ${e.message}\n`);
  process.exitCode = 1;
}
