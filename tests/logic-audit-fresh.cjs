'use strict';
// ОТЧЕТЪТ НА ЛОГИЧЕСКИЯ ОДИТ НЕ БИВА ДА Е ПО-СТАР ОТ СКАНИРАНЕТО (DEF-65, 0.69.221).
//
// Намерено при критичния анализ на 0.69.220: `reports/logic-audit.md` и `.json` бяха от
// 2026-10-25 и твърдяха „482 файла · 82 177 реда“, докато същият скрипт в същия момент
// сканираше 664 файла · 121 639 реда. Причината: отчетът се пишеше само с `--save`, а
// `release-status` и портите викат само `--gate` — тоест документът, който се чете от човек,
// изоставаше с месец и никой не го виждаше. Това е същият клас като DEF-58 (архивът не
// съвпадаше с дървото): проверката минава, а артефактът лъже.
//
// Тестът пази две неща:
//   1. `--gate` ПИШЕ отчета (иначе пак може да замръзне);
//   2. бройките в отчета съвпадат с ЖИВОТО сканиране в момента на пускането.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const script = path.join(root, 'scripts', 'logic-audit.cjs');
const source = fs.readFileSync(script, 'utf8');
const jsonPath = path.join(root, 'reports', 'logic-audit.json');
const mdPath = path.join(root, 'reports', 'logic-audit.md');

// ── 1. Гейтът обновява отчета ───────────────────────────────────────────────
// Правилото, което тестът пази, в чист вид: if (save || gate) — гейтът ПИШЕ отчета.
assert.match(
  source,
  /if \(save \|\| gate\) \{/,
  '`--gate` трябва да пише отчета като `--save` — иначе документът замръзва (точно DEF-65)',
);
assert.doesNotMatch(source, /if \(save\) \{/, 'условието е само `save || gate`; отделен клон за `--gate` не е нужен');

// ── 2. Бройките в отчета са бройките от ЖИВОТО сканиране ────────────────────
// Първо се ПУСКА гейтът, както го пуска изданието — иначе тестът сравнява отчета с бройка,
// в която влиза и самият той (тестовете се сканират), тоест винаги щеше да „пада“ с 1 файл.
const { spawnSync } = require('node:child_process');
const gate = spawnSync(process.execPath, [script, '--gate'], { cwd: root, encoding: 'utf8' });
assert.equal(gate.status, 0, 'гейтът минава: ' + (gate.stderr || gate.stdout));

const { scan } = require(script);
const live = scan();
const saved = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
assert.equal(
  saved.files,
  live.files,
  `отчетът твърди ${saved.files} файла, а сканирането вижда ${live.files} — пусни \`node scripts/logic-audit.cjs --gate\``,
);
assert.equal(
  saved.scannedLines,
  live.scannedLines,
  `отчетът твърди ${saved.scannedLines} реда, а сканирането вижда ${live.scannedLines} — отчетът е остарял`,
);
assert.ok(Array.isArray(saved.open), 'отчетът пази отворените находки в списък');
assert.equal(saved.open.length, 0, 'отворени находки в логическия одит: ' + saved.open.length);

// ── 3. Четеният от човек документ носи същите числа ────────────────────────
const md = fs.readFileSync(mdPath, 'utf8');
assert.ok(
  md.includes(`**${live.files} файла · ${live.scannedLines} реда**`),
  `logic-audit.md трябва да казва „${live.files} файла · ${live.scannedLines} реда“ — днес казва друго`,
);

// ── 4. Приетата с обосновка находка не изчезва тихо ────────────────────────
// Тя е `off-by-one-loop` в `lockedAncestor` — нарочна инклузивна итерация. Ако изчезне от
// кода, обосновката става мъртва и трябва да се махне, вместо да пази нищо.
assert.equal(saved.accepted.length, 1, 'очаква се точно една приета находка (off-by-one в lockedAncestor)');
assert.match(md, /Приети с обосновка/, 'документът има раздел за приетите находки');

console.log(
  `PASS logic-audit-fresh: ${live.files} файла · ${live.scannedLines} реда · отворени 0 · приета 1 · ` +
    'гейтът пише отчета, а числата в него съвпадат с живoто сканиране',
);
