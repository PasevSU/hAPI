'use strict';
// Каталог на функциите: какво ВСЕКИ модул изнася и кой тест го покрива.
//
// Защо генератор, а не ръчен списък: списъкът се мени с всяка промяна и ръчният започва
// да лъже. Тук източникът е самият код (`module.exports = { ... }` и `return { ... }` на
// `create()`), а „покрит“ значи „името се среща в тест“. Това е ПРОКСИ за покритие, не
// доказателство за поведение — затова `tests/function-catalog.cjs` държи тежестта:
// непокрита функция трябва да е в изричен списък с причина.
//
//   node scripts/function-catalog.cjs           # презаписва reports/FUNCTION-CATALOG.{md,json}
//   node scripts/function-catalog.cjs --check   # само проверка
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'hapi_enterprise');
const TESTS = path.join(ROOT, 'tests');
const OUT_MD = path.join(ROOT, 'reports', 'FUNCTION-CATALOG.md');
const OUT_JSON = path.join(ROOT, 'reports', 'FUNCTION-CATALOG.json');

const reserved = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof', 'new', 'await', 'async', 'else', 'do', 'try', 'throw', 'const', 'let', 'var']);

function exportedNames(source) {
  const names = new Set();
  // module.exports = { a, b: c, 'd': e, ... }
  const blocks = [...source.matchAll(/module\.exports\s*=\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  for (const block of blocks) {
    for (const part of block.split(',')) {
      const key = part.split(':')[0].trim().replace(/['"]/g, '');
      if (/^[A-Za-z_$][\w$]*$/.test(key) && !reserved.has(key)) names.add(key);
    }
  }
  // return { a, b, ... } вътре в create() — това е публичната повърхност на модула
  const returns = [...source.matchAll(/return \{([^{}]*)\}/g)].map((m) => m[1]);
  for (const block of returns) {
    for (const part of block.split(',')) {
      const key = part.split(':')[0].trim().replace(/['"]/g, '');
      if (/^[a-z][\w$]*$/.test(key) && !reserved.has(key)) names.add(key);
    }
  }
  // Само имената, които наистина имат дефиниция на функция в модула, са функции.
  // Иначе `return { destination: dir }` брои поле на DTO като функция (1188 „функции“).
  const isFunction = (name) => {
    const n = name.replace(/[$]/g, '\\$');
    const patterns = [
      'function\\s+' + n + '\\s*\\(',                                    // function name(
      '(const|let|var)\\s+' + n + '\\s*=\\s*(async\\s*)?(function|\\()',  // const name = (…) / async (…
      '(^|[^\\w$.])' + n + '\\s*\\([^)]*\\)\\s*\\{',                     // name(…) {  — метод/декларация
    ];
    return patterns.some((p) => new RegExp(p, 'm').test(source));
  };
  const isConstant = (name) => /^[A-Z][A-Z0-9_]*$/.test(name) && new RegExp('(const|let|var)\\s+' + name + '\\s*=').test(source);
  return [...names]
    .filter((name) => isFunction(name) || isConstant(name))
    .map((name) => ({ name, kind: isFunction(name) ? 'функция' : 'константа' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function testCorpus() {
  return fs.readdirSync(TESTS)
    .filter((f) => f.endsWith('.cjs'))
    .map((f) => fs.readFileSync(path.join(TESTS, f), 'utf8'))
    .join('\n');
}

function collect() {
  const corpus = testCorpus();
  const modules = [];
  for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort()) {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    const names = exportedNames(source);
    if (!names.length) continue;
    const functions = names.map(({ name, kind }) => ({
      name,
      kind,
      // „Покрита“ = името се среща в някой тест (или като `модул.име`, или в низ).
      tested: new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\b').test(corpus),
    }));
    modules.push({ module: 'hapi_enterprise/' + file, functions });
  }
  return modules;
}

/** Непокритите ФУНКЦИИ във вида „hapi_enterprise/x.js:име“ — това е входът за портата. */
function untested() {
  const out = [];
  for (const m of collect()) for (const f of m.functions) if (!f.tested && f.kind === 'функция') out.push(m.module + ':' + f.name);
  return out.sort();
}

function main() {
  const modules = collect();
  const total = modules.reduce((n, m) => n + m.functions.length, 0);
  const tested = modules.reduce((n, m) => n + m.functions.filter((f) => f.tested).length, 0);
  const fnTotal = modules.reduce((n, m) => n + m.functions.filter((f) => f.kind === 'функция').length, 0);
  const fnTested = modules.reduce((n, m) => n + m.functions.filter((f) => f.kind === 'функция' && f.tested).length, 0);
  const data = { generatedFor: 'hapi_enterprise', total, tested, untested: total - tested, fnTotal, fnTested, modules };

  const md = [
    '# Каталог на функциите и покритието им с тестове',
    '',
    '> **Генериран документ.** Пише се от `node scripts/function-catalog.cjs`; не се редактира на ръка.',
    '> „Покрита“ значи, че името на функцията се среща в тест — това е прокси, а не доказателство',
    '> за поведение. Затова `tests/function-catalog.cjs` изисква всяка непокрита функция да е в',
    '> изричен списък с причина и този списък може само да се свива.',
    '',
    '| Показател | Стойност |',
    '| --- | --- |',
    '| Модули с изнесени символи | ' + modules.length + ' |',
    '| Изнасяни символи (функции + константи) | **' + total + '** |',
    '| От тях функции | **' + fnTotal + '** |',
    '| Покрити функции | **' + fnTested + '** |',
    '| Непокрити функции | **' + (fnTotal - fnTested) + '** |',
    '',
  ];
  for (const m of modules) {
    md.push('## ' + m.module, '');
    md.push('| Символ | Вид | Тест |', '| --- | --- | --- |');
    for (const f of m.functions) md.push('| `' + f.name + '` | ' + f.kind + ' | ' + (f.tested ? 'да' : '**не**') + ' |');
    md.push('');
  }
  const outPad = md.join('\n') + '\n';
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT_MD) ? fs.readFileSync(OUT_MD, 'utf8') : '';
    if (current !== outPad) { console.error('function-catalog: документът е остарял — пусни node scripts/function-catalog.cjs'); process.exit(1) }
    console.log('function-catalog OK: ' + fnTotal + ' функции · ' + fnTested + ' покрити · ' + (fnTotal - fnTested) + ' непокрити');
    return;
  }
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_MD, outPad);
  fs.writeFileSync(OUT_JSON, JSON.stringify(data, null, 2) + '\n');
  console.log('function-catalog: ' + modules.length + ' модула · ' + fnTotal + ' функции (' + fnTested + ' покрити, ' + (fnTotal - fnTested) + ' непокрити) · ' + (total - fnTotal) + ' константи');
}

module.exports = { collect, untested };

if (require.main === module) main();
