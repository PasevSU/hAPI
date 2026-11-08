'use strict';
// ПАКЕТИРАНАТА ДОКУМЕНТАЦИЯ НЕ ОПИСВА ЕЛЕМЕНТИ, КОИТО ГИ НЯМА.
//
// Защо този тест: `hapi_enterprise/**/*.md` влиза в издадения архив (`verify-release` S22 брои
// файловете байт по байт), тоест е част от това, което човек получава. В 0.69.200 картата на
// портала беше преправена и махнатият блок „Достъп и QR код“ остана описан в
// `hapi_enterprise/ui/README.md` — изданието излезе с документация за бутони, които вече не
// съществуват, и се наложи отделно издание 0.69.201 само за един файл. Нито един тест не
// хвана това, защото документацията не се сравняваше с кода.
//
// Правилото: всеки селектор от вида `pf-…` / `data-…`, споменат в пакетиран документ, трябва
// да съществува в `hapi_enterprise/ui/` — ИЛИ споменаването му да е изрично като махнато
// (в същия абзац има „махнат“/„премахнат“). Тестът пада, ако:
//   • документ обещава бутон или селектор, който кодът не съдържа (документът лъже);
//   • историческата бележка за махнатия блок загуби думичката, че е махнат (тогава тя става
//     описание на живо състояние);
//   • описанието на картата на портала не споменава новия вход `data-qr-portal`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const uiDir = path.join(root, 'hapi_enterprise', 'ui');

const walk = (dir, filter, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(entry.name)) out.push(full);
  }
  return out;
};

const uiSources = walk(uiDir, (n) => n.endsWith('.js') || n.endsWith('.css'))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');
const shippedDocs = walk(path.join(root, 'hapi_enterprise'), (n) => n.endsWith('.md'));

assert.ok(shippedDocs.length >= 5, 'пакетираните документи са налице, намерени: ' + shippedDocs.length);
assert.ok(uiSources.length > 10000, 'източниците на панела са прочетени');

// Изключение: абзацът ИЗРИЧНО казва, че елементът е махнат. Датата „до 0.69.x“ САМА по себе
// си не е такова изявление — иначе историческата бележка минава за описание на живо.
const REMOVED = /махнат|премахнат|removed|вече не/i;
const UI_DOC = path.join(uiDir, 'README.md');
// Селектор може да е записан като `data-qr-portal`, `[data-qr-portal]` или `.pf-qr-pop-link` —
// затова се търси ВЪТРЕ в обратните кавички, а не „от началото на кавичката“.
const tokensOf = (text, withData) => {
  const out = [];
  for (const span of text.matchAll(/`([^`]+)`/g)) {
    const re = withData ? /(?:^|[\s[.>+])((?:pf|data)-[a-z0-9-]+)/g : /(?:^|[\s[.>+])(pf-[a-z0-9-]+)/g;
    for (const m of span[1].matchAll(re)) out.push(m[1]);
  }
  return out;
};

let checked = 0;
const problems = [];
for (const file of shippedDocs) {
  const rel = path.relative(root, file);
  const isUiDoc = file === UI_DOC;
  // `pf-` е селектор само на панела, затова се проверява във ВСЕКИ пакетиран документ;
  // `data-` се среща и в сървърни документи, затова се проверява само в описанието на панела.
  const paragraphs = fs.readFileSync(file, 'utf8').split(/\n\s*\n/);
  for (const para of paragraphs) {
    const tokens = tokensOf(para, isUiDoc);
    if (!tokens.length) continue;
    const declaredRemoved = REMOVED.test(para);
    for (const token of tokens) {
      checked += 1;
      if (uiSources.includes(token)) continue;
      if (declaredRemoved) continue;
      problems.push(rel + ': „' + token + '“ не съществува в hapi_enterprise/ui/ и не е отбелязан като махнат');
    }
  }
}

assert.deepEqual(problems, [], 'пакетираната документация описва несъществуващи елементи:\n  ' + problems.join('\n  '));
assert.ok(checked >= 10, 'проверени са поне 10 селектора в пакетираните документи, а са ' + checked);

// Положителната страна: описанието на картата трябва да сочи ИСТИНСКИЯ вход към кода.
// Сравнява се ТОЧНИЯТ селектор, не подниз: `data-qr-portall` не е `data-qr-portal` и не
// трябва да минава за описание на бутона.
const uiDoc = fs.readFileSync(UI_DOC, 'utf8');
const uiTokens = new Set(tokensOf(uiDoc, true));
assert.ok(uiTokens.has('data-qr-portal'), 'ui/README.md описва QR бутона, който кодът има (`data-qr-portal`), а споменава: ' + [...uiTokens].join(', '));
assert.ok(uiTokens.has('pf-qr-pop-link'), 'ui/README.md казва, че кодът е връзка (`pf-qr-pop-link`)');
// …и не обещава отделен блок, който е махнат, освен ако не пише, че е махнат.
for (const para of uiDoc.split(/\n\s*\n/)) {
  if (!para.includes('Достъп и QR код')) continue;
  assert.ok(REMOVED.test(para), 'споменаването на „Достъп и QR код“ трябва да е изрично като махнато');
}

// ── 3. Документ, който сочи тест, трябва да сочи СЪЩЕСТВУВАЩ тест ────────────
// Същото правило вече пази `KNOWN_DEFECTS.md`; каталогът на тестовете не се проверяваше,
// тоест можеше да изпрати човек към файл, който е преименуван или изтрит.
const catalogPath = path.join(root, 'documentation', '06_TESTING', 'TEST_CASE_CATALOG.md');
const testFiles = new Set(fs.readdirSync(path.join(root, 'tests')));
const catalog = fs.readFileSync(catalogPath, 'utf8');
const cited = [...catalog.matchAll(/`tests\/([a-z0-9.-]+\.cjs)`/g)].map((m) => m[1]);
assert.ok(cited.length >= 20, 'каталогът на тестовете е налице, цитирани: ' + cited.length);
const deadRefs = cited.filter((n) => !testFiles.has(n));
assert.deepEqual(deadRefs, [], 'TEST_CASE_CATALOG.md сочи несъществуващи тестове: ' + deadRefs.join(', '));

console.log(
  'PASS packaged-docs: ' + shippedDocs.length + ' пакетирани документа · ' + checked +
  ' селектора сверени с hapi_enterprise/ui/ · историческата бележка е отбелязана като махната · ' +
  cited.length + ' препратки в TEST_CASE_CATALOG.md сочат съществуващ тест',
);
