'use strict';
// Инструментът за публикуване `release/publish-release.ps1` сам решава дали нещо да се качи,
// затова тук се пази не живописът на изхода, а СТРУКТУРАТА на защитите. Причината е конкретна:
// скриптът се разрастваше на слоеве и е достатъчно един ред да се премести, за да тръгне
// публикуване преди dry run-а или изтриване без потвърждение.
//
// Проверява се, че:
//  - dry run-ът стои ПРЕДИ всяко извикване на публикуване и е зад `-Execute`;
//  - всички десет слоя присъстват (среда, хранилище, източник, цялост, съгласуваност,
//    контролни суми, текст, отдалечено състояние, преглед, публикуване, проверка);
//  - пита за хранилището и тегли списък от `gh repo list`;
//  - сверява контролни суми и версия, преди да качи нещо;
//  - изтриване/презапис минава през изрично потвърждение;
//  - качването е на две стъпки (създаване, после upload с --clobber);
//  - `-Yes` има реален ефект (неинтерактивен режим);
//  - скриптът се парсва от PowerShell, ако `pwsh` е наличен.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const file = path.join(__dirname, '..', 'release', 'publish-release.ps1');
assert.ok(fs.existsSync(file), 'липсва release/publish-release.ps1');
const text = fs.readFileSync(file, 'utf8');

// 1. Заглавни изисквания и публичен интерфейс.
assert.ok(text.startsWith('#requires -Version 7.0'), 'скриптът изисква PowerShell 7');
const parameters = [
  '[string]$Repo',
  '[string]$Source',
  '[string]$NotesFile',
  '[string]$TagName',
  '[string]$Title',
  '[string]$Target',
  '[switch]$Execute',
  '[switch]$Force',
  '[switch]$Yes',
  '[switch]$Draft',
  '[switch]$Prerelease',
  '[switch]$Latest',
  '[int]$Retries',
  '[string]$LogFile',
];
for (const parameter of parameters) {
  assert.ok(text.includes(parameter), 'липсва параметър ' + parameter);
}

// 2. Dry run е ПРЕДИ публикуването в главния поток, а не след него.
const dryRun = text.indexOf('Dry run — нищо не се качва');
const publishCall = text.lastIndexOf('Invoke-Publish');
assert.ok(dryRun > 0, 'има секция за dry run');
assert.ok(publishCall > dryRun, 'dry run секцията трябва да върви преди реалното публикуване');
assert.ok(text.includes('if (-not $Execute)'), 'публикуването е зад -Execute');

// 3. Слоевете са налице — редът им е това, което прави скрипта предпазлив.
const layers = [
  'Слой 0 · Среда',
  'Слой 0б · В кое хранилище',
  'Слой 0в · Достъп до хранилището',
  'Слой 1 · Къде се намира',
  'Слой 2 · Цялост',
  'Слой 3 · Съгласуваност',
  'Слой 4 · Контролни суми',
  'Слой 5 · Текст',
  'Слой 6 · Състояние в GitHub',
  'Слой 6б · Тагът пуска CI',
  'Слой 7 · Какво ще се публикува',
  'Слой 8 · Публикуване',
  'Слой 9 · Проверка',
];
for (const layer of layers) {
  assert.ok(text.includes(layer), 'липсва ' + layer);
}

// 4. Пита в кое хранилище и предлага реален списък.
const repoDefinition = text.indexOf('function Select-Repo');
assert.ok(repoDefinition > 0, 'има функция Select-Repo');
assert.ok(text.indexOf('Select-Repo', repoDefinition + 10) > 0, 'Select-Repo се извиква, не само дефинира');
assert.ok(text.includes("'repo', 'list'"), 'списъкът с хранилища идва от gh repo list');
assert.ok(text.includes("'--json', 'nameWithOwner,description,visibility,pushedAt'"), 'списъкът носи видимост и дата, за да е смислен избор');

// 5. Проверки преди качване: източник, версия, контролни суми.
assert.ok(text.includes('е невалиден'), 'невалиден -Source се отхвърля с обяснение');
assert.ok(text.includes('Несъответствие на версиите'), 'хваща разминаване между източника и работното копие');
assert.ok(text.includes('SHA256SUMS.txt'), 'познава SHA256SUMS.txt');
assert.ok(text.includes('Get-FileHash'), 'сверява контролни суми локално');

// 6. Нищо разрушително не минава без изрично потвърждение.
const strictConfirmations = (text.match(/Confirm-Strict/g) || []).length;
assert.ok(strictConfirmations >= 2, 'опасните действия искат Confirm-Strict, намерени: ' + strictConfirmations);
assert.ok(text.includes('--cleanup-tag'), 'изтриването на изданието маха и тага');
assert.ok(text.includes('gh release delete') || text.includes("'release', 'delete'"), 'изтриването минава през изрично меню');

// 7. Публикуването е на две стъпки, за да може частичен провал да се продължи.
assert.ok(text.includes("'release', 'create'"), 'създава изданието');
assert.ok(text.includes("'release', 'upload'"), 'качва файловете отделно');
assert.ok(text.includes('--clobber'), 'презаписва по име при повторно качване');
assert.ok(text.includes("'--target'"), 'подава --target само когато тагът още го няма');
assert.ok(text.includes('размерът на качения файл е различен'), 'сверява и размера, не само името на качения файл');

// 8. -Yes наистина изключва въпросите, вместо да е само обявен.
const nonInteractiveUses = (text.match(/NonInteractive/g) || []).length;
assert.ok(nonInteractiveUses >= 5, '-Yes има реален ефект, срещания: ' + nonInteractiveUses);
assert.ok(text.includes('$script:NonInteractive = [bool]$Yes'), 'флагът се вдига от -Yes');

// 8б. Новият таг е действие: CI се пуска от него и може да смени текста на изданието.
assert.ok(text.includes('generate_release_notes'), 'познава generate_release_notes на release.yml');
assert.ok(text.includes('refs/tags/'), 'създава тага през API, без git');
assert.ok(text.includes('Тагът трябва да съдържа версията'), 'таг без версия се отхвърля (иначе „c“ става таг)');
assert.ok(text.includes('не започва с'), 'предлага „v“ отпред — release.yml чака само v*');
assert.ok(text.includes('не съвпада с шаблоните на workflow-а'), 'таг извън шаблона не получава грешен съвет „остави го на CI“');
assert.ok(text.includes('dry run: няма да създам таг'), 'dry run не пипа нищо отдалечено, вкл. таг');
assert.ok(text.includes('ref=refs/tags/'), 'ref-ът се подава явно при създаване на тага');
assert.ok(text.includes('Тагът не е създаден'), 'създаването на отдалечен таг иска изписано потвърждение');

// 9. Всеки gh разговор минава през общата функция с повторни опити.
const directCalls = (text.match(/& gh /g) || []).length;
assert.ok(directCalls <= 6, 'директните извиквания на gh остават малко (среда + обвивка), намерени: ' + directCalls);
assert.ok(text.includes('function Invoke-Gh'), 'има обвивка Invoke-Gh');
assert.ok((text.match(/Invoke-Gh/g) || []).length >= 10, 'всички останали разговори минават през Invoke-Gh');
assert.ok(text.includes('$script:RetryLimit'), 'повторните опити са ограничени от -Retries');

// 10. Синтаксис: парсваме с истинския PowerShell, ако е наличен.
const pwsh = process.env.PWSH || 'pwsh';
const probe = spawnSync(pwsh, ['-NoProfile', '-NoLogo', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
let parsed = false;
if (probe.status === 0) {
  const escaped = file.replace(/'/g, "''");
  const command = `$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${escaped}',[ref]$t,[ref]$e); if($e.Count){ $e[0].Message } else { 'OK' }`;
  const result = spawnSync(pwsh, ['-NoProfile', '-NoLogo', '-Command', command], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'PowerShell парсерът се провали: ' + (result.stderr || '').trim());
  const verdict = (result.stdout || '').trim();
  assert.equal(verdict, 'OK', 'синтактична грешка в publish-release.ps1: ' + verdict);
  parsed = true;
}
else {
  console.log('publish-script: pwsh липсва — проверката на синтаксиса е пропусната');
}

const lines = text.split('\n').length;
console.log(
  `publish-script OK: ${layers.length} слоя, ${parameters.length} параметъра, ${strictConfirmations} потвърждения` +
  `, ${lines} реда${parsed ? ', синтаксисът е проверен от pwsh' : ''}`
);
