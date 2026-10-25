'use strict';
// КАТАЛОГЪТ НА КОДОВЕТЕ ЗА ГРЕШКА Е ГЕНЕРИРАН, АКТУАЛЕН И ПЪЛЕН.
//
// Причината да съществува: кодът излъчва десетки машинни кодове, а документите обясняваха само
// част от тях — одитът на 0.69.87 намери 23 кода без нито едно обяснение. Код без описание е
// просто низ: клиентът го проверява, а човекът няма къде да го прочете.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'error-codes.cjs');
const DOC = path.join(ROOT, 'documentation', '04_FUNCTION_SPECIFICATIONS', 'ERROR_CODES.md');
let step = 'старт';

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });
const rows = (text) => text.split('\n').filter((l) => l.startsWith('| `'));

try {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-error-codes-'));
  try {
    // ── 1. Документът е актуален ──────────────────────────────────────────────
    step = 'актуален';
    const check = run(['--check']);
    assert.equal(check.status, 0, '--check трябва да мине: ' + (check.stderr || '').trim());

    const doc = fs.readFileSync(DOC, 'utf8');
    const table = rows(doc);
    assert.ok(table.length >= 30, 'очакват се поне 30 кода, намерени: ' + table.length);

    // ── 2. Всеки ред сочи съществуващ файл и има код ──────────────────────────
    step = 'редове';
    for (const row of table) {
      const cells = row.split('|').map((c) => c.trim());
      const code = (cells[1] || '').replace(/`/g, '');
      assert.match(code, /^[A-Z][A-Z0-9_]{3,}$/, 'невалиден код в ред: ' + row.slice(0, 60));
      const files = (cells[3] || '').match(/`([^`]+)`/g) || [];
      assert.ok(files.length > 0, code + ': липсва файл на излъчване');
      for (const f of files) {
        const rel = f.replace(/`/g, '');
        assert.ok(fs.existsSync(path.join(ROOT, rel)), code + ': сочи липсващ файл ' + rel);
      }
    }

    // ── 3. Кодовете от това издание са в каталога ─────────────────────────────
    step = 'кодове от изданието';
    for (const code of ['SECRET_NOT_EXPANDED', 'SECRET_NAME_HAS_SPACE', 'SECRET_PATH_RELATIVE', 'S2K_AEAD_UNSUPPORTED', 'ADMIN_TOKEN_REQUIRED']) {
      assert.ok(doc.includes('`' + code + '`'), 'липсва код в каталога: ' + code);
    }

    // ── 4. Остарял документ се хваща; `--out` пише същото ────────────────────
    step = 'остарял документ';
    const stale = path.join(dir, 'ERROR_CODES.md');
    fs.writeFileSync(stale, doc.replace(/^\| `[^`]+` \|.*$/m, '| `IZMISLEN_KOD` | измислен | `никъде.js` |'));
    assert.notEqual(fs.readFileSync(stale, 'utf8'), doc, 'мутацията трябва да промени файла');
    const staleCheck = run(['--check', '--out=' + stale]);
    assert.equal(staleCheck.status, 1, 'мутиран документ трябва да върне код 1');
    assert.match(staleCheck.stderr, /остарял/, 'съобщението казва какво да се направи');

    step = '--out';
    const out = path.join(dir, 'out.md');
    assert.equal(run(['--out=' + out]).status, 0, '--out трябва да успее');
    assert.equal(fs.readFileSync(out, 'utf8'), doc, '--out пише същото като документа');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('PASS error-codes: каталогът е генериран от кода · всеки ред сочи съществуващ файл · кодовете от изданието са в него · хваща остарял документ');
} catch (e) {
  console.error('FAIL error-codes (' + step + '):', e && e.message);
  process.exitCode = 1;
}
