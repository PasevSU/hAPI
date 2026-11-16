'use strict';
// МАТРИЦАТА СЕ ВЯРВА САМО КОГАТО Е ОТ ТОВА ДЪРВО И Е ПРОВЕРИЛА НЕЩО (0.69.224).
//
// Защо има тест: до 0.69.223 `release-status` броеше само `passed + skipped == брой тестове`.
// Затова отчет от преди поправка минаваше за „зелен“, ако броят съвпадне — точно класът на
// DEF-58/DEF-65, но за най-важния артефакт. Освен това тест, който сам казва „SKIP“ (липсва
// gpg/pwsh/артефакт), се броеше за минал и отчетът казваше „100% успех“, без част от
// проверките да са се случили.
//
// Пази се поведението на генератора, не текстът му:
//   1. отчетът носи отпечатък на дървото и той е от ТОВА дърво;
//   2. чужд отпечатък → редът в отчета казва „остарява“ (не „минават“);
//   3. тестове, пропуснати по липса на среда, се ИЗБРОЯВАТ, а не се сливат в 100%;
//   4. броят тестове идва от дървото, не от константа в скрипта.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fingerprint } = require(path.join(__dirname, '..', 'scripts', 'tree-fingerprint.cjs'));

const root = path.join(__dirname, '..');
const MATRIX = path.join(root, 'reports', 'test-matrix.json');
const STATUS = path.join(root, 'scripts', 'release-status.cjs');
const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
const testFiles = fs.readdirSync(path.join(root, 'tests')).filter((f) => /\.cjs$/.test(f) && f !== 'helpers.cjs').length;

// ── 1. Отчетът носи отпечатък и той е от ТОВА дърво ─────────────────────────
assert.ok(matrix.treeHash, 'матрицата носи `treeHash` — иначе не може да се разбере от кога е');
assert.match(matrix.treeHash, /^[0-9a-f]{64}$/, 'отпечатъкът е sha256');
assert.equal(matrix.treeHash, fingerprint().hash, 'матрицата е пусната върху ТОВА дърво (пусни я пак, ако падне)');
assert.ok(Number(matrix.treeFiles) > 100, 'отпечатъкът покрива цялото дърво, не един файл: ' + matrix.treeFiles);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-matrix-'));
const copy = fs.readFileSync(MATRIX, 'utf8');
const runStatus = () => {
  const out = path.join(tmp, 'status.md');
  const res = spawnSync(process.execPath, [STATUS, '--out', out], { cwd: root, encoding: 'utf8' });
  assert.equal(res.status, 0, 'release-status минава: ' + (res.stderr || ''));
  return fs.readFileSync(out, 'utf8');
};
const rowOf = (doc) => (doc.split('\n').find((l) => l.includes('node scripts/test-matrix.cjs')) || '');

try {
  // ── 2. С чужд отпечатък отчетът НЕ казва „минават“ ─────────────────────────
  // Копията е ЗЕЛЕНА по строеж: тестът проверява свежестта, не списъка с провали. Иначе
  // един провален тест в дървото събаря и този — и причината се губи.
  fs.writeFileSync(MATRIX, `${JSON.stringify({ ...matrix, failed: [], treeHash: 'f'.repeat(64) }, null, 2)}\n`, 'utf8');
  const staleRow = rowOf(runStatus());
  assert.match(staleRow, /остарял/, 'чужд отпечатък → редът казва, че матрицата е от преди промяна в кода: ' + staleRow);
  assert.doesNotMatch(staleRow, /всички тестове от/, 'и НЕ твърди, че всички тестове минават');

  // ── 3. Пропуснатите по липса на среда се ИЗБРОЯВАТ ────────────────────────
  // Копието е ЗЕЛЕНО ПО СТРОЕЖ: `passed` се смята от БРОЯ ТЕСТОВЕ, не от предния пуск.
  // Иначе един провален тест в дървото (примерно този) правеше реда „429/432“ и събаряше
  // проверката за броя — тоест тестът за свежест падаше заради чужд провал, а не заради
  // свежест. Точно това заключваше матрицата в цикъл: пуск N не е зелен → пуск N+1 пада.
  const matrixSkipped = Array.isArray(matrix.skipped) ? matrix.skipped.length : 0;
  const withSkip = {
    ...matrix,
    failed: [],
    passed: testFiles - matrixSkipped - 1,
    skippedByEnv: ['pgp-gpg-interop.cjs'],
  };
  fs.writeFileSync(MATRIX, `${JSON.stringify(withSkip, null, 2)}\n`, 'utf8');
  const skipRow = rowOf(runStatus());
  assert.match(skipRow, /⊘ 1 не провериха нищо \(pgp-gpg-interop\.cjs\)/, 'пропуснатият по среда тест се вижда в реда: ' + skipRow);

  // ── 4. Броят тестове идва от дървото ──────────────────────────────────────
  assert.ok(skipRow.includes(`**${testFiles}/${testFiles}**`), 'броят идва от tests/*.cjs, не от константа: ' + testFiles);
} finally {
  fs.writeFileSync(MATRIX, copy, 'utf8');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 5. Матрицата записва отпечатъка ПРЕДИ серията, не след нея ──────────────
// След серията дървото може вече да е променено — тогава отпечатъкът би описал нещо, което
// не е проверено.
const matrixSrc = fs.readFileSync(path.join(root, 'scripts', 'test-matrix.cjs'), 'utf8');
const takeAt = matrixSrc.indexOf('const tree = fingerprint();');
const runAt = matrixSrc.indexOf('const run = runSuite(files, env);');
assert.ok(takeAt > 0, 'test-matrix взема отпечатък');
assert.ok(runAt > 0, 'test-matrix пуска серията');
assert.ok(takeAt < runAt, 'отпечатъкът се взема ПРЕДИ серията — иначе описва нещо друго');
assert.match(matrixSrc, /skippedByEnv/, 'матрицата отделя пропуснатите по среда от миналите');

console.log(
  `PASS matrix-freshness: отпечатък от ТОВА дърво (${matrix.treeFiles} файла) · чужд отпечатък → „остарява“ · ` +
    'пропуснатите по среда се изброяват (⊘) · отчетът не твърди „минават“ без свежест',
);
