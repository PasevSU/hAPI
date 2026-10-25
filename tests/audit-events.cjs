'use strict';
// КАТАЛОГЪТ НА ОДИТНИТЕ СЪБИТИЯ СЕ ГЕНЕРИРА — И ТРЯБВА ДА Е АКТУАЛЕН.
//
// Одитът е доказателството „кой какво е правил“. Досега списъкът на събитията съществуваше
// само в grep: разминаване в име (`file.delete` срещу `file.delete.refused`) не се хващаше от
// нищо. Тук се проверява, че документът съвпада с кода, че „хващането на остаряло“ наистина
// работи, че всяко име от таблицата сочи съществуващ файл и че разделът с наследството не
// противоречи на основния списък.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'audit-events.cjs');
const doc = path.join(ROOT, 'documentation', '04_FUNCTION_SPECIFICATIONS', 'AUDIT_EVENTS.md');
const run = (args) => execFileSync(process.execPath, [script, ...args], { stdio: 'pipe' });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-events-'));
try {
  // 1. Актуален ли е спрямо кода?
  run(['--check']);
  const original = fs.readFileSync(doc, 'utf8');

  // 2. Хваща ли остарял документ? (иначе „проверката“ е декорация)
  const tampered = path.join(dir, 'tampered.md');
  fs.writeFileSync(tampered, original.replace('## 1. Събития по име', '## 1. Събития по име (старо)'));
  assert.throws(() => run(['--check', `--out=${tampered}`]), /Command failed|status 1/, 'проверката трябва да хване остарял документ');
  // 3. Липсващ документ също е провал, не тишина.
  assert.throws(() => run(['--check', `--out=${path.join(dir, 'nyama.md')}`]), /Command failed|status 1/, 'липсващ документ е провал');

  // 4. Всяко събитие от §1 е с уникален ред и сочи съществуващ файл.
  const section1 = original.slice(original.indexOf('## 1.'), original.indexOf('## 2.'));
  const rows = [...section1.matchAll(/^\| `([a-z0-9_.-]+)` \| (.+) \|$/gm)].map((m) => ({ name: m[1], files: [...m[2].matchAll(/`([^`]+)`/g)].map((x) => x[1]) }));
  assert.ok(rows.length > 100, 'каталогът изброява събитията: ' + rows.length);
  assert.equal(new Set(rows.map((r) => r.name)).size, rows.length, 'нито едно събитие не е изброено два пъти');
  for (const row of rows) {
    assert.ok(row.files.length >= 1, 'събитието ' + row.name + ' има поне един източник');
    for (const rel of row.files) assert.ok(fs.existsSync(path.join(ROOT, rel)), 'липсва файл от каталога: ' + rel);
  }

  // 5. Разделът с наследството не противоречи на §1: всяко legacy име е в §1 и обратно.
  const section3 = original.slice(original.indexOf('## 3.'));
  const legacy = [...section3.matchAll(/^\| `([a-z0-9_.-]+)` \|/gm)].map((m) => m[1]);
  const convention = /^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$/;
  const fromMain = rows.filter((r) => !convention.test(r.name)).map((r) => r.name);
  assert.deepEqual(legacy.slice().sort(), fromMain.slice().sort(), '§3 изброява точно имената извън конвенцията');

  // 6. Събитията, добавени в това издание, са в каталога (иначе „документирахме“ е пожелание).
  for (const name of ['file.delete.refused', 'file.copy', 'file.move', 'portal.delete.refused']) {
    assert.ok(rows.some((r) => r.name === name), 'каталогът съдържа ' + name);
  }

  // 7. Документът носи текущата версия и не е пипан от теста.
  const cfg = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'config.yaml'), 'utf8');
  const version = (cfg.match(/^version: "([^"]+)"/m) || [])[1];
  assert.ok(original.includes(`**${version}**`), 'каталогът носи версия ' + version);
  assert.equal(fs.readFileSync(doc, 'utf8'), original, 'тестът не бива да променя репото');

  // 8. Документите, които НАЗОВАВАТ одитни събития, назовават съществуващи такива.
  //    Точно това беше счупено: спецификацията казваше `file.imported`, ADR — `qr.revoke`,
  //    а кодът излъчва `file.upload` и `qr.blocked`. Проверката е точкова (по документа и по
  //    изречението), за да не дава фалшиви тревоги за имена на файлове като `audit.jsonl`.
  const names = new Set(rows.map((r) => r.name));
  const readDoc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const spec = readDoc('documentation/02_TO_BE_ARCHITECTURE/API_ARCHITECTURE_SPEC.md');
  const specEvent = (spec.match(/Създава се събитие `([a-z0-9_.-]+)`/) || [])[1];
  assert.ok(specEvent, 'спецификацията назовава събитие при импорт');
  assert.ok(names.has(specEvent), 'спецификацията назовава съществуващо събитие: ' + specEvent);
  const adr = readDoc('documentation/03_ADR/ADR-0023-phase-4-features.md');
  const adrEvents = [...(adr.match(/`(cabinet\.upload|cabinet\.[a-z.]+|file\.upload|qr\.[a-z.]+)`/g) || [])].map((s) => s.replace(/`/g, ''));
  assert.ok(adrEvents.length >= 2, 'ADR-0023 изрежда събития');
  for (const name of adrEvents) assert.ok(names.has(name), 'ADR-0023 назовава съществуващо събитие: ' + name);
  const contracts = readDoc('documentation/02_TO_BE_ARCHITECTURE/INTEGRATION_CONTRACTS.md');
  // Договорът се промени в 0.69.87: webhook-ът с HMAC вече СЪЩЕСТВУВА. Тестът пази
  // новото твърдение, за да не остане документът да казва „няма“, когато има.
  assert.match(contracts, /Events \/ webhooks \(от 0\.69\.87\)/, 'договорът е отбелязан като реализиран');
  assert.match(contracts, /X-HAPI-Signature/, 'договорът казва как се подписва');
  assert.ok(!/webhook с HMAC \*\*още не е реализиран\*\*/.test(contracts), 'документът НЕ твърди, че webhook липсва');

  console.log(`audit-events OK: ${rows.length} събития · ${legacy.length} наследствени · актуален · хваща остарял и липсващ документ`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
