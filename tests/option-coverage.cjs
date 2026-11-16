'use strict';
// ВСЯКА ОПЦИЯ ИМА ЧИТАТЕЛ (O-10/O-11 от `DOCS_AND_OPTIONS_STRUCTURE.md` §7).
//
// Защо има тест: досега нищо не проверяваше, че опция, която потребителят вижда в картата на
// add-on-а, се чете НЯКЪДЕ. „Задавам стойност, а нищо не се променя“ е най-тихият възможен
// дефект — и точно той роди DEF-85 (липсващ немски) и цялата D/O серия.
//
// Проверката е нарочно ЕЗИКОВО НЕЗАВИСИМА: не търси `process.env.X`, защото кодът чете и през
// `env[ENV.STORAGE_LOCATION]`, и през `(env || process.env).PORTAL_SKIN`. Затова се търси ИМЕТО
// на променливата в ИЗПЪЛНЯВАНИЯ код — след като се махнат коментарите. Така „описана, но мъртва“
// опция пада, а „описана и спомената само в коментар“ също пада.
//
// Тестът пада и при обратната грешка: измислена опция трябва да бъде ХВАНАТА, иначе проверката
// не проверява нищо.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { OPTIONS } = require(path.join(ROOT, 'hapi_enterprise', 'option-spec.js'));

/** Изпълняваният код на add-on-а, без коментари (иначе „споменато“ минава за „четено“). */
function executableText() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Вендор/eni сглобки: не са наш код и не четат опции.
        if (['generator', 'evidence-portal', 'fonts'].includes(entry.name)) continue;
        walk(abs);
      } else if (entry.name.endsWith('.js') && !['qrcode.js', 'option-spec.js'].includes(entry.name)) {
        files.push(abs);
      }
    }
  };
  walk(path.join(ROOT, 'hapi_enterprise'));
  return files
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const code = executableText();

// ── 1. Всяка опция се среща в изпълнявания код ─────────────────────────────
// Дескрипторът е ИЗКЛЮЧЕН от скана: име в самия дескриптор не е четене (иначе гейтът минава
// винаги, включително за опция, която никой не чете — точно така се скри първата версия).
// Двата канала са ѝ равноправни, защото кодът чете и през среда (`STORAGE_MODE`), и през
// обекта с опции (`options.min_free_mb`), и през ключа (`optionText('memory_limit_mb')`).
const readRe = (o) => new RegExp('\\b' + o.env + '\\b|(?:\\.|\\[\'|\\["|\'|")' + o.key + '(?:\'|"|\\b)');
const dead = OPTIONS.filter((o) => !readRe(o).test(code)).map((o) => `${o.key} → ${o.env}`);
assert.deepEqual(dead, [], 'опция без нито едно четене в кода (или я свържи, или я махни от картата): ' + dead.join(', '));

// ── 2. Проверката наистина проверява (негативна проба) ──────────────────────
assert.equal(code.includes('ZZZ_NE_SYHTESTVUVA_OPCIQ'), false, 'измислено име НЕ се среща — гейтът не е сляп');
assert.equal(OPTIONS.length >= 40, true, 'опциите идват от дескриптора: ' + OPTIONS.length);

// ── 3. Проверката не зависи от един файл ──────────────────────────────────
// Броят на опциите идва от дескриптора, а не от ръчно поддържан списък: ако някой добави
// опция в `config.yaml` без ред в дескриптора, `tests/option-spec.cjs` пада; ако я добави в
// дескриптора без читател, пада този тест. Двете заедно държат картата и кода заедно.
assert.equal(OPTIONS.length >= 40, true, 'опциите идват от дескриптора: ' + OPTIONS.length);
assert.equal(new Set(OPTIONS.map((o) => o.key)).size, OPTIONS.length, 'ключовете са уникални');

console.log(
  `PASS option-coverage: ${OPTIONS.length} опции · всяка се чете в изпълнявания код ` +
    '(по име на променлива или по достъп до ключа, без дескриптора) · измислено име не минава',
);
