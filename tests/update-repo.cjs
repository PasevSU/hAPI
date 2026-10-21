'use strict';
// `scripts/update-repo.ps1` качва работното копие в GitHub, затова тук се пази СТРУКТУРАТА
// на защитите, а не изходът:
//  - dry run-ът стои преди всяко писане и е зад `-Execute`;
//  - файловете минават през `export-tracked.cjs` (спазва .gitignore) и през одита;
//  - всяка git команда стартира от локален диск — на SMB дял (H:) дори `git config` виси;
//  - няма force push и няма триене на клонове;
//  - изтриване на файлове от хранилището иска изрично потвърждение;
//  - скриптът се парсва от PowerShell, ако `pwsh` е наличен.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const file = path.join(__dirname, '..', 'scripts', 'update-repo.ps1');
assert.ok(fs.existsSync(file), 'липсва scripts/update-repo.ps1');
const text = fs.readFileSync(file, 'utf8');

// 1. Заглавни изисквания и параметри.
assert.ok(text.startsWith('#requires -Version 7.0'), 'скриптът изисква PowerShell 7');
for (const parameter of ['[string]$Repo', '[string]$Branch', '[string]$Message', '[switch]$Execute', '[switch]$Yes', '[switch]$AllowDelete', '[switch]$Reuse', '[int]$Retries', '[string]$LogFile']) {
  assert.ok(text.includes(parameter), 'липсва параметър ' + parameter);
}

// 2. Dry run е преди писането и е зад -Execute.
const dryRun = text.indexOf('Dry run — нищо не се качва');
const pushCall = text.lastIndexOf('Invoke-Push');
assert.ok(dryRun > 0, 'има секция за dry run');
assert.ok(pushCall > dryRun, 'dry run секцията върви преди качването');
assert.ok(text.includes('if (-not $Execute)'), 'качването е зад -Execute');

// 3. Слоевете са налице.
for (const layer of ['Слой 0 · Среда', 'Слой 0б · Кое хранилище', 'Слой 1 · Какво влиза', 'Слой 1б · Одит', 'Слой 2 · Локално копие', 'Слой 3 · Разлики', 'Слой 4 · Съобщение', 'Слой 5 · Какво ще се качи', 'Слой 6 · Качване', 'Слой 7 · Проверка']) {
  assert.ok(text.includes(layer), 'липсва ' + layer);
}

// 4. Обхватът идва от експорта по .gitignore, не от сляпо копиране.
assert.ok(text.includes('export-tracked.cjs'), 'ползва export-tracked за обхвата');
assert.ok(text.includes('pre-push-audit.cjs'), 'пуска одита преди качване');
assert.ok(text.includes('Convert-ExportToLf'), 'нормализира CRLF към LF (изискване на .gitattributes)');

// 5. Git работи само от локален диск — H: е SMB и виси.
assert.ok(text.includes("$script:GitCwd = $env:TEMP"), 'задава локална работна папка за git');
assert.ok(text.includes("@('-C', $script:GitCwd) + $Arguments"), 'всяка git команда получава -C');
assert.ok(text.includes('git clone'), 'клонира в %TEMP%, вместо да работи на H:');

// 6. Никакви разрушителни операции по подразбиране.
assert.ok(!text.includes("'push', '--force'"), 'не прави force push');
assert.ok(!text.includes('--force-with-lease'), 'не ползва force-with-lease');
assert.ok(!text.includes("'push', '-f'"), 'не ползва -f при push');
assert.ok(text.includes('Тагът не е създаден') === false, 'този скрипт не създава тагове');
assert.ok((text.match(/Confirm-Strict/g) || []).length >= 3, 'опасните действия искат Confirm-Strict');
assert.ok(text.includes('изтрий ги и от хранилището'), 'изтриването е изричен избор');
assert.ok(text.includes('$script:DeleteApproved'), 'изтриването минава през флаг');

// 7. -Yes не изтрива файлове без -AllowDelete.
assert.ok(text.includes('if ($AllowDelete)'), '-AllowDelete управлява изтриването в неинтерактивен режим');
assert.ok(text.includes('оставям ги в хранилището (за изтриване: -AllowDelete)'), 'по подразбиране пази файловете');

// 8. При отхвърлен push предлага rebase, не force.
assert.ok(text.includes('pull --rebase'), 'сливането е през rebase');
assert.ok(text.includes('rebase --abort'), 'при конфликт rebase-ът се отменя');

// 9. Синтаксис: парсваме с истинския PowerShell, ако е наличен.
const pwsh = process.env.PWSH || 'pwsh';
const probe = spawnSync(pwsh, ['-NoProfile', '-NoLogo', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
let parsed = false;
if (probe.status === 0) {
  const escaped = file.replace(/'/g, "''");
  const command = `$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${escaped}',[ref]$t,[ref]$e); if($e.Count){ $e[0].Message } else { 'OK' }`;
  const result = spawnSync(pwsh, ['-NoProfile', '-NoLogo', '-Command', command], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'PowerShell парсерът се провали: ' + (result.stderr || '').trim());
  const verdict = (result.stdout || '').trim();
  assert.equal(verdict, 'OK', 'синтактична грешка в update-repo.ps1: ' + verdict);
  parsed = true;
}
else {
  console.log('update-repo: pwsh липсва — проверката на синтаксиса е пропусната');
}

const lines = text.split('\n').length;
console.log(
  `update-repo OK: 10 слоя, експорт по .gitignore, без force push, ${lines} реда` +
  (parsed ? ', синтаксисът е проверен от pwsh' : '')
);
