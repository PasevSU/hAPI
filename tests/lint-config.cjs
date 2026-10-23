'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ОРАКУЛ: lint гейтът е реален, не декоративен.
//
// Дефектът (намерен от одита, 0.69.44): `eslint.config.mjs` даваше Node среди на
// БРАУЗЪРНИТЕ файлове (`ui/*.js`, `portal.js`, генератора) → 406 фалшиви `no-undef`
// за `document`/`window`/`location`. Заради шума lint никога не е бил пускан, а в
// `ci.yml` изобщо нямаше стъпка за него: `npm run lint` беше мъртъв скрипт.
//
// Тук се проверяват не правилата на eslint, а договорът на гейта:
//   • конфигурацията обявява браузърните среди и ESM файловете;
//   • вендорският QR код не се съди по стилови правила;
//   • има базова линия за наследените находки и тя НЕ покрива новия код;
//   • `npm run lint` съществува и CI го пуска;
//   • ако зависимостите са налични — lint наистина минава с код 0.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const config = read('eslint.config.mjs');
const pkg = JSON.parse(read('package.json'));
const ci = read('.github/workflows/ci.yml');

// 1. Браузърните файлове не се съдят като Node.
assert.match(config, /hapi_enterprise\/ui\/\*\*\/\*\.js/, 'конфигът трябва да обявява UI файловете като браузърни');
assert.match(config, /globals\.browser/, 'липсват browser globals — document/window ще са „недефинирани“');
assert.match(config, /custom_components\/\*\*\/\*\.js/, 'порталът в интеграцията също е браузърен скрипт');

// 2. ESM файловете не се парсват като CommonJS.
assert.match(config, /\*\*\/\*\.mjs/, 'липсва блок за .mjs файловете');
assert.match(config, /sourceType:\s*'module'/, 'ESM файловете трябва да са sourceType module');

// 3. Вендорският код не се съди по стилови правила.
assert.match(config, /qrcode\.js/, 'вендорският QR енкодер трябва да е изключен от стиловите правила');

// 4. Гейтът съществува и е вързан към CI.
assert.ok(pkg.scripts && typeof pkg.scripts.lint === 'string', 'package.json: липсва `lint` скрипт');
assert.match(pkg.scripts.lint, /eslint/, 'lint скриптът трябва да вика eslint');
assert.match(ci, /npm ci/, 'CI трябва да инсталира dev зависимостите, иначе lint не може да тръгне');
assert.match(ci, /npm run lint/, 'CI трябва да пуска lint — иначе гейтът е декоративен');

// 5. Базовата линия пази само наследеното: новият код се съди по пълните правила.
const baselinePath = path.join(ROOT, 'eslint-suppressions.json');
assert.ok(fs.existsSync(baselinePath), 'липсва eslint-suppressions.json (базова линия за наследените находки)');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
for (const clean of ['hapi_enterprise/secret-lock.js', 'tests/secret-lock.cjs', 'tests/panel-framing.cjs', 'tests/api-input-errors.cjs']) {
  assert.equal(baseline[clean] !== undefined, false, 'новият файл ' + clean + ' не бива да е в базовата линия — трябва да е чист');
}

// 6. Ако зависимостите са налични — пускаме истинския lint.
const eslintInstalled = fs.existsSync(path.join(ROOT, 'node_modules', 'eslint'));
if (eslintInstalled) {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'),
    'hapi_enterprise', 'tests', 'custom_components', 'scripts', '--max-warnings=0'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, 'lint не минава:\n' + (run.stdout || '') + (run.stderr || ''));
  console.log('PASS lint-config: конфигурацията е вярна · базова линия ' + Object.keys(baseline).length + ' файла · eslint минава с 0');
} else {
  console.log('PASS lint-config: конфигурацията е вярна · базова линия ' + Object.keys(baseline).length + ' файла · (eslint не е инсталиран — живата проверка е пропусната)');
}
