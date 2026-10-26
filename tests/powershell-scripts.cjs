'use strict';
// Публикуването и синхронизирането минават през PowerShell скриптове, а те се пускат на ръка —
// тоест синтактична грешка в тях се открива едва когато човекът вече е на път да публикува.
// До 0.69.87 `tests/publish-script.cjs` проверяваше само два от петте скрипта
// (`release/publish-release.ps1` и `scripts/publish-haoss.ps1`); `sync-local-addon.ps1`,
// `update-repo.ps1` и `publish-addon-repo.ps1` не бяха проверявани с нищо.
//
// Затова тук ВСЕКИ скрипт в `scripts/` и `release/` се подава на самия PowerShell парсер
// (без изпълнение) и се иска нула грешки. Правилото важи и за бъдещи скриптове: нов файл се
// хваща автоматично, защото списъкът се чете от диска, а не се поддържа на ръка.
//
// Когато `pwsh` липсва (напр. в Ubuntu контейнера на CI), тестът се прескача с ясно
// съобщение — същият подход като при `pgp-gpg-interop.cjs`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const scripts = [];
for (const dir of ['scripts', 'release']) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  for (const name of fs.readdirSync(full)) if (/\.ps1$/i.test(name)) scripts.push(path.join(full, name));
}
assert.ok(scripts.length >= 5, `намерени са само ${scripts.length} PowerShell скрипта — счупен обход`);

const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
if (pwsh.status !== 0) {
  console.log('powershell-scripts SKIPPED (pwsh не е инсталиран)');
  process.exit(0);
}

// Парсерът на PowerShell връща грешките си в `$errors`; нищо не се изпълнява.
const parse = (file) => {
  const command = [
    '$errors = $null',
    `[void][System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$null, [ref]$errors)`,
    'if ($errors) { $errors | ForEach-Object { $_.ToString() } } else { "OK" }',
  ].join('; ');
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
  const out = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return result.status === 0 ? out : `pwsh излезе с код ${result.status}: ${out}`;
};

const broken = [];
for (const file of scripts) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const verdict = parse(file);
  if (verdict !== 'OK') broken.push(`${rel}: ${verdict.split(/\r?\n/)[0]}`);
}
assert.deepEqual(broken, [], 'всеки PowerShell скрипт трябва да се парсва без грешки (иначе се разбира при публикуване)');

console.log(`powershell-scripts: ${scripts.length} скрипта се парсват без грешки — наред`);
