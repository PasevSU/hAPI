'use strict';
// КЛАС НА ДОКУМЕНТА — нормата D-01 от `DOCS_AND_OPTIONS_STRUCTURE.md` (0.69.228).
//
// Защо съществува: 149 документа в `documentation/` не казваха КАКВИ са — живи (факт за днес),
// нормативни (какво трябва да бъде) или исторически (замразени). Затова никой не знаеше кой
// документ е меродавен, а версията се проверяваше само в 3 от 125 живи документа. Тук класът се
// СМЯТА от мястото и името (едно правило за всички), пише се като един ред под заглавието и се
// проверява от `tests/docs-class.cjs`.
//
//   node scripts/docs-class.cjs                # само проверява (код 1 при разлика)
//   node scripts/docs-class.cjs --write        # дописва/поправя реда във всеки документ
//   node scripts/docs-class.cjs --root=<път>   # друг корен (за теста)
//
// Генераторите ползват `lineFor(rel)`, за да сложат СЪЩИЯ ред в генерираните документи — иначе
// всеки генератор щеше да има своя версия на нормата.
const fs = require('node:fs');
const path = require('node:path');

const args = new Set(process.argv.slice(2));
const rootArg = [...args].find((a) => a.startsWith('--root='));
const root = rootArg ? path.resolve(rootArg.slice('--root='.length)) : path.join(__dirname, '..');
const write = args.has('--write');
const docsDir = path.join(root, 'documentation');

/** Живият номер на изданието — единствен източник (никога не се пише на ръка). */
function currentVersion() {
  const cfg = fs.readFileSync(path.join(root, 'hapi_enterprise', 'config.yaml'), 'utf8');
  return (/^version:\s*"([^"]+)"/m.exec(cfg) || [])[1] || '';
}
const VERSION = currentVersion();
/** Сравнява две издания като числа (9.99.9 е след 0.69.227) — не по дължина на низа. */
const partsOf = (v) => String(v || '0.0.0').split('.').map((n) => Number(n) || 0);
const newer = (a, b) => {
  const x = partsOf(a);
  const y = partsOf(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

// Собственик на факта — за документите, които са ЕДИНСТВЕНИЯТ дом на нещо (картата от §5 на
// нормативния документ). Останалите наследяват собственика на папката си.
const OWNER = {
  'README.md': 'индекс на документацията',
  '01_AS_IS_ARCHITECTURE/SYSTEM_STATE.md': 'състояние днес',
  '01_AS_IS_ARCHITECTURE/KNOWN_DEFECTS.md': 'дефекти и защити',
  '01_AS_IS_ARCHITECTURE/SOURCE_INVENTORY.md': 'брой модули и функции',
  '01_AS_IS_ARCHITECTURE/MODULE_CATALOG.md': 'описание на модулите',
  '02_TO_BE_ARCHITECTURE/API_ENDPOINT_REFERENCE.md': 'HTTP договор',
  '02_TO_BE_ARCHITECTURE/DOCS_AND_OPTIONS_STRUCTURE.md': 'структура на документацията и норми за опциите',
  '04_FUNCTION_SPECIFICATIONS/ERROR_CODES.md': 'кодове на грешки',
  '04_FUNCTION_SPECIFICATIONS/AUDIT_EVENTS.md': 'одитни събития',
  '07_RELEASE/FEATURE_PARITY.md': 'съответствие add-on ↔ интеграция',
};
const FOLDER_OWNER = {
  '00_GOVERNANCE': 'процес и управление',
  '01_AS_IS_ARCHITECTURE': 'състояние днес',
  '02_TO_BE_ARCHITECTURE': 'целева архитектура',
  '03_ADR': 'архитектурно решение',
  '04_FUNCTION_SPECIFICATIONS': 'договор на функция',
  '05_MIGRATION': 'история на миграция',
  '06_TESTING': 'тестове',
  '07_RELEASE': 'издаване',
  '08_USER_GUIDES': 'упътване за потребителя',
  '09_COMPLETE_MANUAL': 'ръководство',
};
// Документи, чието име носи версия — те са ЗАПИС за минало издание (или план за бъдещо).
const VERSIONED = /(?:^|[-_])(\d+\.\d+\.\d+)(?:\.md)?$/;

/** Класът се смята от мястото и името — едно правило, без ръчни изключения. */
function classOf(rel) {
  const folder = rel.split('/')[0];
  if (folder === '03_ADR' || folder === '05_MIGRATION') return 'исторически';
  const base = path.basename(rel, '.md');
  const stamped = VERSIONED.exec(base);
  if (folder === '07_RELEASE' && stamped) {
    return newer(stamped[1], VERSION) ? 'нормативен' : 'исторически';
  }
  if (folder === '01_AS_IS_ARCHITECTURE' || folder === '08_USER_GUIDES') return 'жив';
  return 'нормативен';
}

/** Редът, който стои под заглавието. Един и същ за ръчно писаните и за генерираните. */
function lineFor(rel) {
  const klass = classOf(rel);
  const owner = OWNER[rel] || FOLDER_OWNER[rel.split('/')[0]] || 'документация';
  if (klass === 'исторически') return `> **Клас:** исторически · **Замразен към:** ${VERSION}`;
  if (klass === 'жив') return `> **Клас:** жив · **Собственик на факта:** ${owner} · **Проверен към:** ${VERSION}`;
  return `> **Клас:** нормативен · **Собственик на факта:** ${owner}`;
}

/** Всички документи под `documentation/`, с относителен път от нея. */
function documents() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.md')) out.push(path.relative(docsDir, abs).split(path.sep).join('/'));
    }
  };
  walk(docsDir);
  return out;
}

const KLASS_LINE = /^> \*\*Клас:\*\* (жив|нормативен|исторически) ·/;

/** Намира реда за клас (в първите 15 реда) и връща индекса му, или -1. */
function findLine(lines) {
  for (let i = 0; i < Math.min(lines.length, 15); i++) if (KLASS_LINE.test(lines[i])) return i;
  return -1;
}

/** Връща новото съдържание с поставен/поправен ред за клас. */
function apply(content, rel) {
  const expected = lineFor(rel);
  const lines = content.split('\n');
  const at = findLine(lines);
  if (at >= 0) {
    if (lines[at] === expected) return null; // вече е вярно
    lines[at] = expected;
    return lines.join('\n');
  }
  // Поставя се след заглавието (# …) и евентуалния празен ред след него.
  const h1 = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (h1 < 0) throw new Error(rel + ': липсва заглавие „# …“ — няма къде да застане класът');
  const insertAt = h1 + 1;
  lines.splice(insertAt, 0, '', expected);
  return lines.join('\n');
}

function run() {
  const problems = [];
  let changed = 0;
  for (const rel of documents()) {
    const file = path.join(docsDir, rel);
    const before = fs.readFileSync(file, 'utf8');
    const after = apply(before, rel);
    if (after === null) continue;
    if (write) {
      fs.writeFileSync(file, after, 'utf8');
      changed += 1;
    } else {
      problems.push(rel + ' → очаква се: ' + lineFor(rel));
    }
  }
  if (write) {
    console.log(`docs-class: ${documents().length} документа · поправени ${changed} (версия ${VERSION})`);
    return 0;
  }
  if (problems.length) {
    console.log(`docs-class: ${problems.length} документа без верен ред за клас (версия ${VERSION}):`);
    for (const p of problems.slice(0, 20)) console.log('  ' + p);
    if (problems.length > 20) console.log(`  … и още ${problems.length - 20}`);
    return 1;
  }
  console.log(`docs-class: ${documents().length} документа с верен клас (версия ${VERSION})`);
  return 0;
}

if (require.main === module) process.exitCode = run();

module.exports = { lineFor, classOf, documents, VERSION, KLASS_LINE };
