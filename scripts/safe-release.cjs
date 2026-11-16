'use strict';
// ЕДНА КОМАНДА ЗА ЦЕЛИЯ БЕЗОПАСЕН ПЪТ ДО ИЗДАНИЕ (0.69.225).
//
// Защо съществува: редът на портите е част от знанието на това хранилище и се сгрешва
// тихо — генераторите трябва да минат ПРЕДИ матрицата (иначе тя описва старо дърво), а
// `release-status` се пише СЛЕД нея (иначе отчита стар отчет). Тук редът е в код, с
// изрични имена и спиране на първата грешка, за да не се налага да се помни.
//
//   node scripts/safe-release.cjs              # целият път, включително матрицата (~7 мин)
//   node scripts/safe-release.cjs --fast       # без матрицата (за бърза итерация)
//   node scripts/safe-release.cjs --with-tests # verify-release със S20 (пуска тестове)
//
// Скриптът НЕ публикува, НЕ тагва и НЕ бута. Публикуването е отделно решение.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const args = new Set(process.argv.slice(2));
const fast = args.has('--fast');
const withTests = args.has('--with-tests');

// `verify-release` S06 търси python3/python в PATH; на тази машина Python е във `.venv`.
const env = { ...process.env };
if (process.platform === 'win32') {
  const venv = path.join(root, '.venv', 'Scripts');
  if (fs.existsSync(venv)) env.PATH = `${venv}${path.delimiter}${env.PATH || ''}`;
}

const steps = [];
const run = (label, file, argv = []) => {
  const started = Date.now();
  const res = spawnSync(process.execPath, [path.join(root, file), ...argv], {
    cwd: root,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  const output = `${res.stdout || ''}${res.stderr || ''}`.trim();
  const last = output.split('\n').filter(Boolean).pop() || '';
  const ok = res.status === 0;
  steps.push({ label, ok, ms, last: last.slice(0, 150), output });
  // При провал „виж по-горе“ е задънена улица: стъпките се пускат със затворен изход и
  // човек не вижда КОЯ проверка е паднала. Затова тук се извеждат последните редове на
  // падналата стъпка — с тях причината се вижда без втори пуск (0.69.225).
  if (!ok) {
    const tail = output.split('\n').filter(Boolean).slice(-18);
    process.stdout.write('\n─── изход на „' + label + '“ (последни редове) ───\n');
    for (const line of tail) process.stdout.write('  ' + line.slice(0, 240) + '\n');
    process.stdout.write('\n');
  }
  return ok;
};

const plan = [
  // 1. Генераторите ПРЕДИ матрицата: те променят дървото (test-rules, docs, манифест).
  ['Генератори · CHANGELOG', 'scripts/sync-addon-changelog.cjs'],
  ['Генератори · правила', 'scripts/gen-test-rules.cjs'],
  ['Генератори · документация', 'scripts/docs-index.cjs'],
  // `tests/source-inventory.cjs` пуска `--check` в матрицата; без тази стъпка отчетът
  // изостава от дървото при всяка промяна в `hapi_enterprise/` и матрицата пада.
  ['Генератори · инвентар', 'scripts/source-inventory.cjs'],
  // `options:`/`schema:` в `config.yaml` се строят от дескриптора (`option-spec.js`). Върви
  // ПРЕДИ справочника: той чете точно тези две секции, а и двете са вход за `build-release`.
  ['Генератори · схема', 'scripts/option-schema.cjs', ['--check']],
  // Справочникът на опциите се строи от `config.yaml` + преводите (D3) и трябва да е преди
  // класовете: той самият носи ред за клас, а `docs-class` е последният, който го проверява.
  ['Генератори · опции', 'scripts/options-reference.cjs'],
  ['Генератори · класове', 'scripts/docs-class.cjs', ['--write']],
  ['Генератори · цялост', 'scripts/integrity-manifest.cjs'],
  // 2. Артефактът и неговата проверка.
  ['Изграждане', 'scripts/build-release.cjs'],
  ['Проверка на изданието', 'scripts/verify-release.cjs', withTests ? ['--with-tests'] : []],
  // 3. Матрицата — последна от „писащите“ стъпки.
  ...(fast ? [] : [['Тестове (матрица)', 'scripts/test-matrix.cjs', ['--skip=release-status', '--attempts=1']]]),
  // 4. Отчетът се пише СЛЕД матрицата, за да е за ТОВА дърво.
  ['Отчет за изданието', 'scripts/release-status.cjs'],
  ['Отчетът е актуален', 'tests/release-status.cjs'],
  // 5. Независимите порти.
  ['ГУИ и съвместимост', 'scripts/audit-gui-compat.cjs'],
  ['Логически одит', 'scripts/logic-audit.cjs', ['--gate']],
  ['Скенер за код', 'scripts/bad-code-scan.cjs', ['--gate']],
];

process.stdout.write(`\n═══ Безопасен път до издание${fast ? ' (без матрица)' : ''}${withTests ? ' · verify със S20' : ''} ═══\n`);
let failed = null;
for (const [label, file, argv] of plan) {
  process.stdout.write(`  → ${label} … `);
  const ok = run(label, file, argv);
  process.stdout.write(`${ok ? '✔' : '✘'}\n`);
  if (!ok) {
    failed = steps[steps.length - 1];
    break;
  }
}

// Линтът не е код на Node — пуска се през eslint директно (БЕЗ `shell`: шелът в
// `spawnSync` е находка „command injection“ за `bad-code-scan`, и то с основание).
const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
if (!failed) {
  if (!fs.existsSync(eslintBin)) {
    steps.push({ label: 'Линт (eslint)', ok: false, ms: 0, last: 'липсва node_modules — пусни `npm ci`' });
    failed = steps[steps.length - 1];
  } else {
    const started = Date.now();
    const res = spawnSync(process.execPath, [eslintBin, '.', '--max-warnings=0'], { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const output = `${res.stdout || ''}${res.stderr || ''}`.trim();
    const ok = res.status === 0;
    steps.push({ label: 'Линт (eslint)', ok, ms: Date.now() - started, last: (output.split('\n').filter(Boolean).pop() || '0 находки').slice(0, 150) });
    process.stdout.write(`  → Линт (eslint) … ${ok ? '✔' : '✘'}\n`);
    if (!ok) failed = steps[steps.length - 1];
  }
}

process.stdout.write('\n═══ Обобщение ═══\n');
for (const step of steps) {
  const secs = (step.ms / 1000).toFixed(1).padStart(6);
  process.stdout.write(`  ${step.ok ? '✔' : '✘'} ${step.label.padEnd(24)} ${secs}s  ${step.last}\n`);
}
if (failed) {
  process.stdout.write(`\n✘ спря на „${failed.label}“. Причината е в изхода по-горе; поправи я и пусни пак.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    '\n✔ Всичко е зелено' +
      (fast ? ' (без матрицата — пусни я преди издание)' : '') +
      '. Следващата стъпка е тагът: `git tag -a v<версия>` и `scripts/check-tag-version.cjs`.\n',
  );
}
