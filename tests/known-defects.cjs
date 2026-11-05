'use strict';
// Регистърът на дефектите (`documentation/01_AS_IS_ARCHITECTURE/KNOWN_DEFECTS.md`) е документ,
// по който се решава дали издание излиза: по собствените му правила ред с тежест „Висока“
// БЛОКИРА изданието. До 0.69.87 там стояха два такива реда за липси, които кодът отдавна
// имаше (RFC 3161 и PKCS#7) — тоест регистърът или блокираше всичко, или се игнорираше.
//
// Затова тук се проверява не текстът, а ВРЪЗКАТА с кода:
//   1. документът е за ТЕКУЩАТА версия (иначе говори за свят, който не съществува);
//   2. всеки затворен ред сочи поне един съществуващ файл — затваряне без доказателство не
//      се приема;
//   3. никой отворен/приет ред не е с тежест „Висока“ без изрична причина защо не блокира;
//   4. затварянията, които регистърът твърди, се проверяват срещу кода в ДВЕТЕ посоки:
//      DEF-04 (RFC 3161 + PKCS#7) и DEF-05 (SHA-512) трябва да са затворени И кодът да ги има.
//      Ако кодът изчезне, тестът пада — регистърът не може да твърди затваряне на несъществуващо.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const doc = path.join(root, 'documentation', '01_AS_IS_ARCHITECTURE', 'KNOWN_DEFECTS.md');
const text = fs.readFileSync(doc, 'utf8');

// ── 1. Версията е текущата ──────────────────────────────────────────────────
const version = (fs.readFileSync(path.join(root, 'hapi_enterprise', 'config.yaml'), 'utf8').match(/^version:\s*"?([0-9.]+)"?/m) || [])[1];
assert.ok(version, 'config.yaml носи версия');
assert.match(
  text,
  new RegExp('Проверен срещу кода при \\*\\*' + version.replace(/[.]/g, '\\.') + '\\*\\*'),
  `заглавието на регистъра трябва да е проверено за ${version}`,
);

// ── 2. Редовете се разчитат ────────────────────────────────────────────────
const rows = [...text.matchAll(/^\| (DEF-\d+) \|([\s\S]*?)\|$/gm)].map((m) => {
  const cells = m[2].split('|').map((c) => c.trim());
  return { id: m[1], area: cells[0], description: cells[1], severity: cells[2], status: cells[3], raw: m[0] };
});
assert.ok(rows.length >= 6, 'очакват се поне 6 реда, намерени: ' + rows.length);
const ids = rows.map((r) => r.id);
assert.equal(new Set(ids).size, ids.length, 'ID-тата са уникални');

const isClosed = (row) => /Затворен/i.test(row.status);
const isOpen = (row) => /Отворен|Приет/i.test(row.status);

// ── 3. Затваряне срещу съществуващ файл ────────────────────────────────────
// Всяка отметка от вида `име.js` в затворен ред трябва да сочи реален файл в репото.
// Така „затворено“ значи „има код, който може да се отвори“, не „някой е написал затворено“.
const findFile = (name) => {
  const direct = [path.join(root, 'hapi_enterprise', name), path.join(root, 'tests', name), path.join(root, name)];
  if (direct.some((p) => fs.existsSync(p))) return true;
  const stack = [path.join(root, 'hapi_enterprise'), path.join(root, 'scripts'), path.join(root, 'tests')];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue }
      if (entry.name === name) return true;
    }
  }
  return false;
};
let closedRows = 0;
for (const row of rows.filter(isClosed)) {
  closedRows += 1;
  // `.cjs` също е файл с код: тестовете в това репо са `.cjs`, а дотук правилото виждаше само
  // `.js` — тоест ред, доказан с тест, не можеше да бъде затворен честно (DEF-16).
  const files = [...row.description.matchAll(/`([a-z0-9-]+\.(?:js|cjs))`/g)].map((m) => m[1]);
  // „Затворен (не е дефект)“ описва твърдение за средата, не липса в кода — там файл не се
  // изисква, но ако редът все пак сочи файл, той трябва да съществува.
  if (!/не е дефект/i.test(row.status)) {
    assert.ok(files.length > 0, `${row.id}: затворен ред трябва да изрежда файловете (в обратни кавички), които го доказват`);
  }
  const missing = files.filter((f) => !findFile(f));
  assert.deepEqual(missing, [], `${row.id}: сочи несъществуващ файл: ${missing.join(', ')}`);
}
assert.ok(closedRows >= 2, 'поне два реда трябва да са затворени с доказателство');

// ── 4. Отворен ред с висока тежест иска причина ────────────────────────────
for (const row of rows.filter(isOpen)) {
  if (/Висока/i.test(row.severity)) {
    assert.match(row.status, /не блокира[^)]*/, `${row.id}: отворен ред с тежест „Висока“ трябва да каже защо не блокира изданието`);
  }
  // „Планиран (Фаза N)“ беше точно формулировката, която остаря: фазата мина, а редът стоеше.
  assert.doesNotMatch(row.status, /Планиран/i, `${row.id}: не се приема статус „Планиран“ — или е отворен, или е затворен с код`);
}

// ── 5. Затварянията се проверяват срещу кода в двете посоки ─────────────────
const byId = new Map(rows.map((r) => [r.id, r]));

// DEF-04: RFC 3161 и PKCS#7. Затворен ред + кодът съществува и се използва.
assert.ok(isClosed(byId.get('DEF-04')), 'DEF-04 (RFC 3161 + PKCS#7) е затворен');
for (const file of ['tsa-client.js', 'cms-sign.js', 'report-stamp.js']) {
  assert.ok(fs.existsSync(path.join(root, 'hapi_enterprise', file)), 'DEF-04: липсва ' + file + ' — значи редът пак е отворен');
}
const tsaSrc = fs.readFileSync(path.join(root, 'hapi_enterprise', 'tsa-client.js'), 'utf8');
assert.match(tsaSrc, /3161/, 'DEF-04: tsa-client.js говори RFC 3161');
const cmsSrc = fs.readFileSync(path.join(root, 'hapi_enterprise', 'cms-sign.js'), 'utf8');
assert.match(cmsSrc, /pkcs7|signedData|SignedData/i, 'DEF-04: cms-sign.js подписва PKCS#7');

// DEF-05: SHA-512 в манифеста. Затворен ред + алгоритъмът е наличен.
assert.ok(isClosed(byId.get('DEF-05')), 'DEF-05 (SHA-512) е затворен');
const manifest = require(path.join(root, 'hapi_enterprise', 'report-manifest.js'));
assert.ok(manifest.HASH_ALGORITHMS.includes('SHA512'), 'DEF-05: HASH_ALGORITHMS трябва да съдържа SHA512');

// DEF-06 остава отворен с причина, която не е „ще го направим“: иска външна възможност.
const def06 = byId.get('DEF-06');
assert.ok(isOpen(def06), 'DEF-06 (WORM) е отворен');
assert.match(def06.status, /chattr|Object Lock/, 'DEF-06 казва какво точно липсва (chattr/Object Lock)');

console.log(
  `PASS known-defects: ${rows.length} реда за ${version} · ${closedRows} затворени с доказателство · ` +
  'DEF-04/DEF-05 сверени с кода (RFC 3161, PKCS#7, SHA-512) · DEF-06 отворен с причина (chattr/Object Lock)',
);
