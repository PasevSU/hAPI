'use strict';
// АРХИВЪТ НА ИЗДАНИЕТО СЪДЪРЖА САМО ТОВА, КОЕТО Е В ХРАНИЛИЩЕТО (0.69.213).
//
// Защо има тест: `build-release.cjs` събира файловете от ФАЙЛОВАТА СИСТЕМА. Затова всеки
// локален, игнориран файл в `hapi_enterprise/` влизаше в архива — и само на машината, където
// съществува. Измерено при 0.69.212: локалният `hapi_enterprise/generator.7z` даде
// **212** файла в `dist/RELEASE.json`, а CI (където файлът го няма) — **211**. Отчетът
// `reports/RELEASE-STATUS.md` цитира точно тази бройка, затова CI го обяви за остарял и
// изданието падна, без нито един ред код да е сгрешен.
//
// Правилото: „в изданието влиза само това, което git проследява“. Пази го `archiveEntries`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const lib = require('../scripts/release-lib.cjs');

const ROOT = path.join(__dirname, '..');

// ── 1. В хранилище: игнорираният файл не е в списъка за изданието ─────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-ignored-'));
try {
  fs.mkdirSync(path.join(tmp, 'mod'));
  fs.writeFileSync(path.join(tmp, '.gitignore'), '*.7z\n');
  fs.writeFileSync(path.join(tmp, 'mod', 'a.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(tmp, 'mod', 'x.7z'), 'ignored binary\n');

  const git = spawnSync('git', ['init', '-q'], { cwd: tmp, encoding: 'utf8' });
  assert.equal(git.status, 0, 'git init минава: ' + (git.stderr || git.error));

  const ignored = lib.ignoredPaths(tmp);
  assert.ok(ignored.has('mod/x.7z'), 'git казва, че mod/x.7z е игнориран: ' + [...ignored]);

  const entries = lib.archiveEntries(tmp, path.join(tmp, 'mod'), 'mod').map((e) => e.path);
  assert.deepEqual(entries, ['mod/a.js'], 'в изданието влиза само проследяемият файл: ' + entries.join(', '));

  // Обратното също се проверява: `walk` (суровото обхождане) файла ГО вижда. Иначе тестът
  // щеше да минава и ако някой просто беше спрял да обхожда папката.
  const raw = lib.walk(path.join(tmp, 'mod'), 'mod').map((e) => e.path);
  assert.deepEqual(raw, ['mod/a.js', 'mod/x.7z'], 'суровото обхождане вижда и игнорирания файл: ' + raw.join(', '));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 2. В това хранилище: нито един запис на изданието не е игнориран от git ───
const ignoredReal = lib.ignoredPaths(ROOT);
for (const [dirAbs, prefix, atLeast] of [
  [path.join(ROOT, lib.ADDON_DIR), lib.ADDON_DIR, 200],
  [path.join(ROOT, lib.INTEGRATION_DIR), 'custom_components/hapi_enterprise', 20],
]) {
  const entries = lib.archiveEntries(ROOT, dirAbs, prefix);
  assert.ok(entries.length >= atLeast, `изданието не е празно (${prefix}: ${entries.length} записа, очаквани ≥ ${atLeast})`);
  const leaked = entries.map((e) => e.path).filter((p) => ignoredReal.has(p));
  assert.deepEqual(leaked, [], `в ${prefix} влиза игнориран файл: ${leaked.join(', ')}`);
}

console.log(
  `PASS release-archive-ignored: ${ignoredReal.size} игнорирани пътя в хранилището · ` +
    'нито един не влиза в изданието · игнориран файл се хваща и се изключва',
);
