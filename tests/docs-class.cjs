'use strict';
// ВСЕКИ ДОКУМЕНТ НОСИ КЛАСА СИ (D-01 от DOCS_AND_OPTIONS_STRUCTURE.md, 0.69.228).
//
// Защо има тест: 149 документа в `documentation/` не казваха какви са — живи (факт за днес),
// нормативни (какво трябва да бъде) или исторически (замразени). Затова никой не знаеше кой
// документ е меродавен, а версията се проверяваше само в 3 от 125 живи (кореновите README/BG/DE).
//
// Тестът пази три неща, не едно:
//   1. всеки документ има ТОЧНО един ред за клас и той съвпада с мястото му (класът се смята,
//      не се пише на ръка — `scripts/docs-class.cjs`);
//   2. „жив“ документ носи ТЕКУЩАТА версия, тоест не може да остарее тихо;
//   3. генерираните документи също го носят (иначе първото прегенериране го изтрива и нормата
//      изчезва без нито един червен тест).
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'docs-class.cjs');
const { lineFor, classOf, documents, VERSION } = require(SCRIPT);

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });

// ── 1. Дървото е наред ───────────────────────────────────────────────────────
const check = run([]);
assert.equal(check.status, 0, 'проверката на класовете минава: ' + (check.stdout || '') + (check.stderr || ''));
assert.match(check.stdout, new RegExp(`\\b${documents().length}\\b`), 'проверката изброява всички документи');
assert.ok(documents().length > 100, 'документите се броят от диска, не от константа: ' + documents().length);

// ── 2. Класът се смята от мястото, не се пише на ръка ───────────────────────
assert.equal(classOf('01_AS_IS_ARCHITECTURE/SYSTEM_STATE.md'), 'жив', 'състоянието днес е жив документ');
assert.equal(classOf('08_USER_GUIDES/operations.md'), 'жив', 'ръководството за потребителя е живо');
assert.equal(classOf('03_ADR/ADR-0001-x.md'), 'исторически', 'ADR е решение, не се пипа');
assert.equal(classOf('05_MIGRATION/PLAN-0.69.67-LINKS.md'), 'исторически', 'миграцията е история');
assert.equal(classOf('02_TO_BE_ARCHITECTURE/SECURITY_MODEL.md'), 'нормативен', 'моделът е нормативен');
assert.equal(classOf('07_RELEASE/RELEASE_0.69.204.md'), 'исторически', 'излязло издание е запис');
assert.equal(classOf('07_RELEASE/PLAN_DOCS_9.99.9.md'), 'нормативен', 'план за БЪДЕЩА версия е нормативен');

// „жив“ носи текущата версия — това е проверката, която днес липсва за 122 документа.
const live = lineFor('01_AS_IS_ARCHITECTURE/SYSTEM_STATE.md');
assert.match(live, /^> \*\*Клас:\*\* жив ·/, 'живият ред започва с класа');
assert.ok(live.includes(VERSION), `живият ред носи текущата версия ${VERSION}: ` + live);

// ── 3. Чужд корен: липсващ ред и сгрешена версия падат ──────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-class-'));
try {
  fs.mkdirSync(path.join(tmp, 'documentation', '01_AS_IS_ARCHITECTURE'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'hapi_enterprise'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'hapi_enterprise', 'config.yaml'), 'name: "hAPI"\nversion: "9.99.9"\n', 'utf8');
  const doc = path.join(tmp, 'documentation', '01_AS_IS_ARCHITECTURE', 'STATE.md');
  fs.writeFileSync(doc, '# Състояние\n\n> Жив документ без ред за клас.\n', 'utf8');

  const missing = run(['--root=' + tmp]);
  assert.equal(missing.status, 1, 'липсващ ред за клас → код 1');
  assert.match(missing.stdout, /1 документа без верен ред за клас/, 'съобщението казва колко липсват');

  const written = run(['--root=' + tmp, '--write']);
  assert.equal(written.status, 0, '--write поправя');
  const after = fs.readFileSync(doc, 'utf8');
  assert.match(after, /^> \*\*Клас:\*\* жив · .*· \*\*Проверен към:\*\* 9\.99\.9$/m, 'версията идва от config.yaml, не от константа');

  // Сгрешена версия (документ от предишно издание) също пада.
  fs.writeFileSync(doc, after.replace('9.99.9', '0.0.1'), 'utf8');
  const stale = run(['--root=' + tmp]);
  assert.equal(stale.status, 1, 'остаряла версия в „жив“ документ → код 1');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`PASS docs-class: ${documents().length} документа · клас от мястото · „жив“ носи ${VERSION} · генерираните също`);
