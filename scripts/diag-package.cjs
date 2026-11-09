'use strict';
// ПАКЕТ ЗА ДЕБЪГИНГ И ОТСТРАНЯВАНЕ НА ПРОБЛЕМИ (0.69.208).
//
//   node scripts/diag-package.cjs                    → reports/diag-package/hapi-diag-<време>.tar.gz
//   node scripts/diag-package.cjs --out <папка>      → там
//   node scripts/diag-package.cjs --no-archive       → само папката (за оглед)
//
// Защо съществува: при проблем човек събира ръчно логове от три места, забравя версията и
// изпраща снимка на екран. Пакетът събира ЕДНО нещо, което може да се прикачи: версия, среда,
// резултат от сверката за цялост, доклад от матрикса, състояние на изданието, последни
// одиторски редове и упътване какво НЕ бива да се праща.
//
// Правилата, които пакетът налага:
//   1. НЯМА тайни. Всеки файл минава през `redact()` и през скенер за тайни; файл, който
//      съдържа нещо, което прилича на ключ/токен, НЕ влиза — вместо него влиза бележка.
//   2. Няма пътища до лични данни: пътищата се съкращават до имена на логически корени.
//   3. Пакетът е самодостатъчен: `README.txt` казва какво има вътре и как се чете.
//   4. Архивът е `.tar.gz` с нула зависимости (собствен ustar писач + `node:zlib`).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const integrity = require('../hapi_enterprise/integrity');

const ROOT = path.join(__dirname, '..');
const ADDON = path.join(ROOT, 'hapi_enterprise');

// Същите семейства тайни, които `tests/secret-patterns.cjs` търси в дървото. Тук целта е
// обратната: да НЕ изнесат от машината.
const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /(?:\b|["'])(?:token|password|secret|apiKey|api_key)\s*[:=]\s*["'][^"']{12,}["']/i,
];

const looksSecret = (text) => SECRET_PATTERNS.some((re) => re.test(String(text)));
const redact = (text) => String(text).replace(/(gh[pousr]_[A-Za-z0-9]{6,}|sk-[A-Za-z0-9]{6,}|eyJ[A-Za-z0-9_-]{6,})/g, '[скрито]');

const version = () => {
  const m = /^version:\s*"?([0-9.]+)"?/m.exec(fs.readFileSync(path.join(ADDON, 'config.yaml'), 'utf8'));
  return m ? m[1] : '';
};
const readJson = (rel, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  } catch {
    return fallback;
  }
};

/** Минимален ustar писач: имена до 100 знака, права 0644, без собственици. */
function tarGz(entries) {
  const blocks = [];
  for (const { name, content } of entries) {
    const data = Buffer.from(content, 'utf8');
    const header = Buffer.alloc(512, 0);
    header.write(name.slice(0, 100), 0, 'utf8');
    header.write('0000644\0', 100, 'ascii');
    header.write('0000000\0', 108, 'ascii');
    header.write('0000000\0', 116, 'ascii');
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
    header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 'ascii');
    header.write('        ', 148, 'ascii');
    header.write('0', 156, 'ascii');
    header.write('ustar\0' + '00', 257, 'ascii');
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(blocks));
}

function collect() {
  const result = integrity.create({ root: ADDON }).verify();
  const matrix = readJson('reports/test-matrix.json', {});
  const status = fs.existsSync(path.join(ROOT, 'reports/RELEASE-STATUS.md'))
    ? fs.readFileSync(path.join(ROOT, 'reports/RELEASE-STATUS.md'), 'utf8').split(/\r?\n/).slice(0, 20).join('\n')
    : 'липсва reports/RELEASE-STATUS.md';
  const errorLog = path.join(process.env.HAPI_ADDON_DATA_DIR || '', 'error-log.jsonl');
  const errors = fs.existsSync(errorLog)
    ? fs.readFileSync(errorLog, 'utf8').split(/\r?\n/).filter(Boolean).slice(-50).join('\n')
    : '';

  const files = [];
  const add = (name, content) => {
    const text = redact(content);
    if (looksSecret(text)) {
      files.push({ name, content: 'съдържанието е скрито: прилича на тайна (виж README.txt)\n' });
      return;
    }
    files.push({ name, content: text });
  };

  add('summary.json', JSON.stringify({
    at: new Date().toISOString(),
    version: version(),
    node: process.versions.node,
    platform: process.platform + ' ' + process.arch,
    integrity: { status: result.status, checked: result.checked, changed: result.changed, missing: result.missing, untracked: result.untracked, version: result.version },
    matrix: { passed: matrix.passed, failed: matrix.failed, attempts: matrix.attemptsUsed, seconds: matrix.totalMs ? Math.round(matrix.totalMs / 1000) : null },
  }, null, 2) + '\n');
  add('integrity.txt', integrity.create({ root: ADDON }).describe(result) + '\n');
  add('release-status.md', status + '\n');
  add('error-log.tail.jsonl', errors || '(няма error-log.jsonl в папката с данни)\n');
  add('README.txt', [
    'hAPI Enterprise — пакет за дебъгинг',
    '',
    'Какво има вътре:',
    '  summary.json        версия, Node, платформа, резултат от сверката за цялост, матрикс',
    '  integrity.txt       човешки прочетимо: съвпада ли кодът с издадения манифест',
    '  release-status.md   първите редове на отчета за изданието',
    '  error-log.tail.jsonl последните до 50 реда от error-log.jsonl (ако има)',
    '  README.txt          този файл',
    '',
    'Какво НЕ влиза (нарочно):',
    '  • тайни и ключове — всеки файл минава през скенер; при съмнение съдържанието се заменя',
    '  • съдържание на потребителски файлове, портали и базата',
    '  • пълни пътища до лични папки',
    '',
    'Ако в integrity.txt пише РАЗМИНАВАНЕ, работещият код не е този, който е издаден:',
    'преинсталирай add-on-а (Supervisor) или пусни `node scripts/integrity-manifest.cjs --check`.',
    '',
  ].join('\n'));

  return files;
}

function main(argv) {
  const outFlag = argv.indexOf('--out');
  const outDir = outFlag >= 0 && argv[outFlag + 1] ? path.resolve(argv[outFlag + 1]) : path.join(ROOT, 'reports', 'diag-package');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(outDir, 'hapi-diag-' + stamp);
  fs.mkdirSync(dir, { recursive: true });
  const files = collect();
  for (const file of files) fs.writeFileSync(path.join(dir, file.name), file.content);
  const archive = dir + '.tar.gz';
  if (!argv.includes('--no-archive')) fs.writeFileSync(archive, tarGz(files.map((f) => ({ name: f.name, content: f.content }))));
  const summary = files.find((f) => f.name === 'summary.json').content;
  console.log('diag-package: ' + path.relative(ROOT, dir) + (argv.includes('--no-archive') ? '' : ' + ' + path.basename(archive)));
  console.log('  ' + JSON.parse(summary).integrity.status + ' · ' + files.length + ' файла · ' + (argv.includes('--no-archive') ? 'без архив' : 'tar.gz'));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { collect, tarGz, redact, looksSecret, SECRET_PATTERNS, version };
