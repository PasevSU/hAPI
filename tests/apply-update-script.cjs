'use strict';
// Договор на `scripts/apply-update.ps1` — скриптът, който прилага изданието върху жива HA
// инстанция. Проверява се СЪДЪРЖАНИЕТО, а не изпълнението: скриптът пипа чуждa машина през
// SMB, затова тестът гарантира, че опасните неща са оградени (dry run по подразбиране,
// проверка на всеки файл, никакво триене), а обяснението за „Обнови“ съществува.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const scriptPath = path.join(root, 'scripts', 'apply-update.ps1');
const script = fs.readFileSync(scriptPath, 'utf8');
const auditPath = path.join(root, 'documentation', '07_RELEASE', 'UPDATE_PATH_AUDIT.md');
const audit = fs.readFileSync(auditPath, 'utf8');

// A. Скриптът съществува и има справка за какво служи (иначе човек не го пуска).
assert.match(script, /^<#\r?\n\.SYNOPSIS/m, 'A01 има .SYNOPSIS в началото');
assert.match(script, /\.PARAMETER Execute/, 'A02 описан е превключвателят -Execute');
assert.match(script, /\.DESCRIPTION[\s\S]*Обнови/, 'A03 описанието казва защо съществува (проблемът с „Обнови“)');

// B. Безопасност: по подразбиране НИЩО не се променя.
assert.match(script, /\[ValidateSet\('Verify', 'Integration', 'Addon', 'Both'\)\]/, 'B01 режимите са изброени явно');
assert.match(script, /\[string\]\$Mode = 'Verify'/, 'B02 подразбиращият се режим е ПРОВЕРКА, не прилагане');
assert.match(script, /if \(-not \$Execute\)/, 'B03 има изрична проверка за липсващ -Execute');
assert.equal(/Remove-Item[^\n]*-Recurse[^\n]*-Force/i.test(script), false, 'B04 скриптът не трие рекурсивно (папки се преименуват, не се махат)');
assert.match(script, /Rename-Item/, 'B05 локалните add-on папки се ПРЕИМЕНУВАТ, за да се върнат при нужда');
assert.match(script, /local-\{1\}/, 'B06 името на резервата съдържа версията');

// C. Проверка на резултата: всеки файл по SHA-256, а не „копирахме“.
assert.match(script, /Get-FileHash -Algorithm SHA256/, 'C01 сверката е по SHA-256');
assert.match(script, /function Assert-Identical/, 'C02 има отделна функция за сверка');
assert.match(script, /Resolve-Path \$Source/, 'C03 пътят се нормализира преди изчисляване на относителни имена');
assert.match(script, /__pycache__/, 'C04 кешът на Python не се копира');
assert.match(script, /robocopy[\s\S]{0,80}\/MIR/, 'C05 копирането е огледално (/MIR), за да не остават стари модули');

// D. Проверява ТОВА, което Supervisor ще направи: образите в GHCR за всяка архитектура.
for (const arch of ['amd64', 'aarch64', 'armv7']) {
  assert.ok(script.includes(`'${arch}'`), 'D01 архитектурата ' + arch + ' се проверява');
}
assert.match(script, /ghcr\.io\/token\?scope=repository/, 'D02 проверката е с анонимен pull токен, както при Supervisor');
assert.match(script, /manifests\/\$version/, 'D03 търси се точно тагът на версията');

// E. Проверява изданието, а не само локалния диск.
assert.match(script, /gh release view "v\$version" -R \$Repo/, 'E01 изданието в основното хранилище се проверява');
assert.match(script, /repository\.yaml/, 'E02 проверява се, че хранилището е add-on хранилище');
assert.match(script, /hapi-enterprise-integration/, 'E03 проверява се и HACS хранилището');

// F. Одитът съществува и носи измерените факти (иначе „документация“ е обещание).
for (const fact of ['0.69.197', 'SHA256SUMS.txt', 'amd64', 'aarch64', 'armv7', 'repository.yaml', 'hacs.data']) {
  assert.ok(audit.includes(fact), 'F01 одитът споменава ' + fact);
}
assert.match(audit, /HACS е маркетплейс за \*\*интеграции/, 'F02 одитът обяснява защо HACS не обновява add-on');
assert.match(audit, /локална папка/, 'F03 одитът назовава причината: локална папка вместо хранилище');
assert.match(audit, /Custom repositories/, 'F04 одитът дава стъпките за HACS');
assert.match(audit, /Repositories/, 'F05 одитът дава стъпките за Supervisor');

// G. Скриптът е споменат в одита, за да се намира от документа.
assert.match(audit, /scripts\/apply-update\.ps1/, 'G01 одитът сочи скрипта');

console.log('PASS apply-update-script: договорът на apply-update.ps1 (dry run, SHA-256 сверка, GHCR за 3 архитектури) и на одита UPDATE_PATH_AUDIT.md');
