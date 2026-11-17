'use strict';
// РАТЧЕТ: потиснатите eslint находки не се връщат.
//
// DEF-66 (отворен от 0.69.221): `npm run lint` даваше 0, но това беше 0 СЛЕД потисканията —
// `eslint-suppressions.json` пазеше 217 находки в 135 файла (no-empty 93, no-useless-assignment
// 52, no-unused-vars 38, no-control-regex 16, no-useless-escape 12, друго 6). Базата не беше
// дълг, който някой плаща: тя тихо разрешаваше ТОЧНО ТОЛКОВА нови нарушения на същите файлове
// и правила, а `tests/eslint-baseline.cjs` я сверява само с измереното — тоест „точна“, но
// пълна. Затова тук се проверява ТАВАНЪТ, не съдържанието.
//
//   1. Базата е ПРАЗНА. Всяко ново потискане е регресия, независимо от причината: находката се
//      оправя в кода или (само за `no-empty` в тестовете) се обосновава в конфигурацията.
//   2. Продуктовият код е под ПЪЛНОТО правило `no-empty` — празен `catch` там пак е грешка.
//   3. Разрешението за празен `catch` важи САМО за `tests/**/*.cjs` и само за `no-empty`:
//      изчакване на `/health` в цикъл и почистване във `finally`. Ако някой го разшири до `**`
//      или до продуктова папка, тестът пада — иначе едно „allow“ изяжда цялото правило.
//   4. Файлът остава валиден JSON дори празен (`{}`), защото ESLint 10 го чете по подразбиране
//      и липсващ файл би сменил поведението на гейта.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const baselinePath = path.join(root, 'eslint-suppressions.json');
const config = fs.readFileSync(path.join(root, 'eslint.config.mjs'), 'utf8');

// ── 4. Базата съществува и е валиден JSON ─────────────────────────────────
assert.ok(fs.existsSync(baselinePath), 'липсва eslint-suppressions.json — ESLint 10 го чете по подразбиране');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
assert.equal(typeof baseline, 'object', 'базата е обект „файл → правила“');

// ── 1. Базата е празна: няма наследен дълг ────────────────────────────────
const suppressed = Object.entries(baseline)
  .map(([file, rules]) => `${file} → ${Object.keys(rules).join(', ')}`);
assert.deepEqual(
  suppressed,
  [],
  'базата не бива да съдържа потискания (DEF-66): оправи находката в кода; '
  + 'единственото изключение е обосновано в `eslint.config.mjs` и не влиза в базата',
);

// ── 3. Разрешението е обявено за ТЕСТОВЕТЕ, не за всичко ───────────────────
assert.match(
  config,
  /files:\s*\['tests\/\*\*\/\*\.cjs'\][\s\S]{0,200}allowEmptyCatch:\s*true/,
  'празният `catch` се разрешава само в блок за `tests/**/*.cjs` (не глобално)',
);

const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
if (!fs.existsSync(eslintBin)) {
  console.log('eslint-ratchet: базата е празна · конфигурацията е scoped (eslint не е инсталиран — живите проверки са пропуснати)');
  process.exit(0);
}

const ruleOf = (file) => {
  const printed = JSON.parse(
    execFileSync(process.execPath, [eslintBin, '--print-config', file], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  const value = printed.rules['no-empty'];
  const [severity, options] = Array.isArray(value) ? value : [value, {}];
  return { severity, allow: options && options.allowEmptyCatch === true };
};

// ── 2. Продуктовият код е под пълното правило ─────────────────────────────
for (const prod of ['hapi_enterprise/server.js', 'hapi_enterprise/ui/files-manager.js', 'scripts/test-matrix.cjs']) {
  const { severity, allow } = ruleOf(prod);
  assert.equal(severity, 2, `${prod}: no-empty е грешка`);
  assert.equal(allow, false, `${prod}: празен catch НЕ се разрешава извън тестовете`);
}

// ── 3б. Тестовете наистина имат разрешението (иначе то е мъртва настройка) ─
const inTests = ruleOf('tests/eslint-baseline.cjs');
assert.equal(inTests.severity, 2, 'tests: no-empty остава грешка');
assert.equal(inTests.allow, true, 'tests: празният catch е разрешен с обосновка в конфигурацията');

console.log('eslint-ratchet: базата е празна · продуктът е под пълното правило · празният catch е разрешен само в тестовете');
