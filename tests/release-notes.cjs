'use strict';
// 0.69.98 — Бележките на изданието не бива да излизат празни.
//
// Тагването създаваше release с тяло с дължина 0 (случи се с 0.69.95 и 0.69.96): текстът се
// слагаше после на ръка. Тук се проверява и самият извлекател, и че workflow-ът го ползва —
// иначе „поправката“ може да изчезне при следващо редактиране на YAML-а и никой да не разбере.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const lib = require('../scripts/release-notes.cjs');

const root = path.join(__dirname, '..');
const script = path.join(root, 'scripts', 'release-notes.cjs');

(async () => {
  const changelog = [
    '# Changelog',
    '',
    '## 9.9.9',
    '',
    '- първа точка',
    '- втора точка',
    '',
    '### Подзаглавие',
    '',
    'текст',
    '',
    '## 9.9.8',
    '',
    '- стара точка',
  ].join('\n');

  // 1. Секцията се взема точно, без да глътне следващата.
  const taken = lib.extract(changelog, '9.9.9');
  assert.equal(taken.found, true, 'секцията се намира');
  assert.match(taken.body, /първа точка/);
  assert.match(taken.body, /Подзаглавие/);
  assert.equal(/стара точка/.test(taken.body), false, 'следващата секция НЕ се включва');
  assert.equal(/^## /m.test(taken.body), false, 'собственото заглавие не влиза в тялото');

  // 2. Липсваща или празна секция е ГРЕШКА, не празен release.
  assert.equal(lib.buildNotes(changelog, '7.7.7').ok, false, 'липсваща версия → грешка');
  assert.equal(lib.buildNotes('## 1.0.0\n\n## 0.9.0\n', '1.0.0').ok, false, 'празна секция → грешка');

  // 3. Истинският CHANGELOG съдържа секция за ТЕКУЩАТА версия — иначе следващият таг щеше
  //    да създаде release без описание.
  const version = lib.currentVersion();
  const real = lib.buildNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version);
  assert.equal(real.ok, true, 'CHANGELOG-ът има секция за ' + version + ': ' + (real.reason || ''));
  assert.ok(real.notes.length > 80, 'бележките са съдържателни, не един ред');

  // 4. CLI-ят пише файла и връща 0; при липсваща версия връща 1.
  const okRun = spawnSync(process.execPath, [script, '--version', version, '--check'], { encoding: 'utf8' });
  assert.equal(okRun.status, 0, '--check минава за текущата версия: ' + (okRun.stderr || ''));
  const badRun = spawnSync(process.execPath, [script, '--version', '0.0.1-nope', '--check'], { encoding: 'utf8' });
  assert.equal(badRun.status, 1, 'липсваща версия връща 1');
  assert.match(String(badRun.stderr), /няма секция/, 'и казва защо');

  // 5. Workflow-ът наистина ползва скрипта и слага body_path — иначе бележките пак ще са празни.
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(workflow, /node scripts\/release-notes\.cjs/, 'release.yml пуска скрипта');
  assert.match(workflow, /body_path:\s*dist\/RELEASE-NOTES\.md/, 'release.yml подава бележките като тяло');

  console.log('PASS release-notes: секцията се извлича без следващата · липсваща/празна → грешка · CHANGELOG-ът има секция за ' + version + ' · release.yml подава body_path');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
