'use strict';
// Документацията цитира файлове по име — понякога с папка (`ui/app.js`), понякога само с
// базова име (`files-manager.js`). Когато цитираният файл бъде преименуван или изтрит,
// текстът продължава да го сочи и читателят го търси напразно. Тук се проверява ВРЪЗКАТА:
//   1. всяко `нещо.js` в обратни кавички в `documentation/**` и в кореновите документи
//      съществува някъде в дървото (по път или по базова име);
//   2. ако НЕ съществува, редът (или документът) трябва изрично да казва, че липсва, че е
//      премахнат или че тепърва ще се създава — така „документиран дълг“, „липсва нарочно“
//      и план за бъдещ модул остават възможни, а „файлът еди-кой си прави X“ за
//      несъществуващ файл — не;
//   3. `tests/<име>.cjs` във всеки документ сочи съществуващ тест.
//
// Извън обхвата, с причина: `docs/plan/**` (исторически планове — класифицират чужди дървета и
// планират модули, никога не написани под тези имена) и `CHANGELOG.md` (записва какво е било
// опитано, включително измислени пътища за отрицателни проверки).
//
// Днес това хвана два реда, които описваха `admin.js` като жив монолит, при положение че
// `GUI_INVENTORY.md` казва, че е премахнат в 0.69.8 — тоест две документации твърдяха
// противоположни неща за един и същ файл.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const SKIP_DIR = /[\\/](node_modules|dist|release|build|archive|\.git|coverage)[\\/]/;

// ── Индекс на реалните файлове: по път и по базова име ───────────────────────
const byPath = new Set();
const byName = new Set();
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (SKIP_DIR.test(full)) continue;
    if (entry.isDirectory()) walk(full);
    else {
      byName.add(entry.name);
      byPath.add(path.relative(root, full).replace(/\\/g, '/'));
    }
  }
};
walk(root);

// ── Документите ─────────────────────────────────────────────────────────────
// Обхождат се авторитетните документи: `documentation/**`, кореновите `*.md` и — за цитатите
// на тестове — `CHANGELOG.md`. `docs/plan/**` е ИЗВЪН обхвата с причина: тези документи са
// исторически планове, които планират модули и тестове, никога не написани под тези имена, и
// класифицират ЧУЖДИ дървета (донорски `gui/`, PyWebView `ui/`) — името там не е твърдение
// „този файл е в хранилището“.
const docs = [];
const collectDocs = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (SKIP_DIR.test(full)) continue;
    if (entry.isDirectory()) collectDocs(full);
    else if (/\.md$/i.test(entry.name)) docs.push(full);
  }
};
collectDocs(path.join(root, 'documentation'));
for (const name of ['README.md', 'BG.md', 'DE.md', 'SECURITY.md', 'CONTRIBUTING.md', 'RELEASE_QUALIFICATION.md']) {
  const full = path.join(root, name);
  if (fs.existsSync(full)) docs.push(full);
}
// CHANGELOG-ът е ИЗВЪН обхвата: той записва какво е било опитано, включително измислени
// пътища и премахнати файлове, използвани като отрицателни проверки на самите тези гардове —
// тоест изключването не е удобство, а следствие от съдържанието. Инструкциите (документацията)
// се проверяват.
assert.ok(docs.length >= 100, `обходът намери само ${docs.length} документа — счупен обход`);

// Редът има право да назове липсващ файл, ако казва, че липсва, че е премахнат или че тепърва
// ще бъде създаден (планът описва бъдещи модули). Границите на думите са с `\p{L}` при `u`
// флаг: с `\b` кирилицата не се брои за буква и „— нов“ не се хващаше.
const ABSENT_MARK =
  /липсва|премахнат|изтрит|removed|deleted|absent|not present|no longer|(?<!\p{L})нов(?:а|и|ият)?(?!\p{L})|(?<!\p{L})ще(?!\p{L})|planned|to be created/iu;
// Само РЕАЛНИ имена на файлове: с малка буква (иначе `Node.js` и `Vue.js` се броят за файлове)
// и без воден наклон (водният наклон е маршрут, а не файл: `/admin.js`, `/ui/app.js`).
const FILE_MENTION = /`([a-z0-9][a-z0-9._/-]*\.js)`/g;

const unresolved = [];
const testCitations = new Set();
let mentions = 0;
for (const doc of docs) {
  const rel = path.relative(root, doc).replace(/\\/g, '/');
  const lines = fs.readFileSync(doc, 'utf8').split(/\r?\n/);

  // Ред, който изрично обявява файл за липсващ, важи за ЦЕЛИЯ документ: след като веднъж е
  // казано „`assets/audit-client.js` — липсва нарочно“, по-нататъшно изброяване на същия файл
  // не е ново твърдение, а продължение на същото.
  const declaredAbsent = new Set();
  for (const line of lines) {
    if (!ABSENT_MARK.test(line)) continue;
    for (const m of line.matchAll(FILE_MENTION)) declaredAbsent.add(path.basename(m[1]));
  }

  lines.forEach((line, i) => {
    for (const m of line.matchAll(FILE_MENTION)) {
      const cited = m[1];
      mentions += 1;
      if (byPath.has(cited) || byName.has(path.basename(cited))) continue;
      if (declaredAbsent.has(path.basename(cited))) continue;
      if (ABSENT_MARK.test(line)) continue;
      unresolved.push(`${rel}:${i + 1} → ${cited}`);
    }
    for (const m of line.matchAll(/tests\/([\w-]+\.cjs)/g)) testCitations.add(`${m[1]} ← ${rel}:${i + 1}`);
  });
}
assert.ok(mentions >= 200, `намерени са само ${mentions} цитата на .js файлове — счупен обход`);
assert.deepEqual(unresolved, [], 'документацията не бива да сочи несъществуващ файл, освен ако редът не казва, че липсва');

// ── Цитираните тестове съществуват ──────────────────────────────────────────
const missingTests = [...testCitations].filter((where) => {
  const name = where.split(' ← ')[0];
  return !fs.existsSync(path.join(root, 'tests', name));
});
assert.deepEqual(missingTests, [], 'документацията не бива да цитира несъществуващ тест');

console.log(`doc-citations: ${docs.length} документа · ${mentions} цитата на .js · ${testCitations.size} теста — наред`);
