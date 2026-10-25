'use strict';
// ПЪЛНИЯТ ИНДЕКС НА ДОКУМЕНТАЦИЯТА Е ГЕНЕРИРАН И ПЪЛЕН.
//
// Договорът, който се проверява:
//   1. `documentation/README.md` съдържа блок, който съвпада с диска (`--check`);
//   2. НИТО ЕДИН документ в `documentation/` не остава без входяща препратка — това е
//      причината инструментът да съществува (36 документа бяха недостъпни от индекса);
//   3. заглавието във всеки ред идва от самия файл, не е измислено;
//   4. `--check` хваща остарял блок (мутиран ред → код 1), а `--out` пише същото съдържание.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'docs-index.cjs');
const README = path.join(ROOT, 'documentation', 'README.md');
let step = 'старт';

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });

function docsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...docsFiles(abs));
    else if (entry.name.endsWith('.md')) out.push(abs);
  }
  return out;
}

try {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-docs-index-'));
  try {
    // ── 1. Документът е актуален ──────────────────────────────────────────────
    step = 'актуален';
    const check = run(['--check']);
    assert.equal(check.status, 0, '--check трябва да мине: ' + (check.stderr || '').trim());

    const readme = fs.readFileSync(README, 'utf8');
    const block = (readme.split('<!-- doc-index:begin -->')[1] || '').split('<!-- doc-index:end -->')[0];
    assert.ok(block.trim().length > 0, 'блокът не бива да е празен');

    // ── 2. Нито един документ не е забравен ───────────────────────────────────
    step = 'пълнота';
    const files = docsFiles(path.join(ROOT, 'documentation'))
      .map((abs) => path.relative(path.join(ROOT, 'documentation'), abs).replace(/\\/g, '/'))
      .filter((rel) => rel !== 'README.md');
    const missing = files.filter((rel) => !block.includes('`' + rel + '`'));
    assert.deepEqual(missing, [], 'документи без входяща препратка: ' + missing.join(', '));

    // ── 3. Заглавието идва от файла ───────────────────────────────────────────
    step = 'заглавия';
    const sample = files.filter((rel) => /ADR-0001|PLAN_STATUS|AUDIT_0\.69\.87/.test(rel));
    assert.ok(sample.length >= 2, 'очакват се поне два примерни документа');
    for (const rel of sample) {
      const text = fs.readFileSync(path.join(ROOT, 'documentation', rel), 'utf8');
      const heading = text.split(/\r?\n/).find((l) => /^#\s+\S/.test(l));
      assert.ok(heading, rel + ': документът няма заглавие');
      const title = heading.replace(/^#\s+/, '').trim();
      assert.ok(block.includes(title), rel + ': заглавието „' + title + '“ липсва в индекса');
    }

    // ── 4. Остарял блок се хваща; `--out` пише същото ────────────────────────
    step = 'остарял блок';
    const stale = path.join(dir, 'README.md');
    // Мутира се РЕД ВЪТРЕ в генерирания блок, не в таблицата с акценти горе — иначе
    // проверката няма какво да види и тестът би „минал“ за грешната причина.
    const mutatedBlock = block.replace(/^\| `[^`]+` \|.*$/m, '| `izmislen.md` | Измислен документ |');
    assert.notEqual(mutatedBlock, block, 'мутацията трябва да промени генерирания блок');
    const broken = readme.replace(block, mutatedBlock);
    assert.notEqual(broken, readme, 'мутираният файл трябва да се различава');
    fs.writeFileSync(stale, broken);
    const staleCheck = run(['--check', '--file=' + stale]);
    assert.equal(staleCheck.status, 1, 'мутиран блок трябва да върне код 1');
    assert.match(staleCheck.stderr, /остарял/, 'съобщението казва какво да се направи');

    step = '--out';
    const out = path.join(dir, 'out.md');
    assert.equal(run(['--out=' + out]).status, 0, '--out трябва да успее');
    assert.equal(fs.readFileSync(out, 'utf8'), readme, '--out пише същото като README-то');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('PASS docs-index: индексът е генериран и актуален · нито един документ без входяща препратка · заглавия от файловете · хваща остарял блок');
} catch (e) {
  console.error('FAIL docs-index (' + step + '):', e && e.message);
  process.exitCode = 1;
}
