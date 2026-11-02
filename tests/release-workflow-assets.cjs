'use strict';
// Изданието се публикува от `.github/workflows/release.yml`, а `dist/SHA256SUMS.txt` изброява
// ПЕТ файла. Ако workflow-ът качи по-малко, човек, който сверява по манифеста, стига до файл,
// който липсва в изданието — точно това се случи с `hapi-enterprise-gui-0.69.87.zip`: манифестът
// го описваше, а изданието не го носеше.
//
// Тук се проверява договорът между строителя и workflow-а:
//   1. списъкът с артефакти идва от същото място като `SHA256SUMS.txt` (имената се строят от
//      версията в `config.yaml`), а не се поддържа на ръка;
//   2. всяко име се покрива от поне един шаблон в `files:` на стъпката „Attach to GitHub release“;
//   3. workflow-ът пуска `verify-release --with-tests` и `check-tag-version`, тоест не може да
//      публикува без проверките.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const workflowPath = path.join(root, '.github', 'workflows', 'release.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

const version = (/^version:\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(root, 'hapi_enterprise', 'config.yaml'), 'utf8')) || [])[1];
assert.ok(version, 'config.yaml има версия');

// ── 1. Какво строи `scripts/build-release.cjs` (същият списък, който пише SHA256SUMS.txt) ──
const artifacts = [
  `hapi_enterprise-${version}.tar.gz`,
  `hapi_enterprise-integration-${version}.zip`,
  `hapi-enterprise-gui-${version}.zip`,
  'repository.yaml',
  'RELEASE.json',
  'SHA256SUMS.txt',
];

// ── 2. Шаблоните, които workflow-ът качва към изданието ──
const lines = workflow.split(/\r?\n/);
const start = lines.findIndex((l) => /^\s*files:\s*\|\s*$/.test(l));
assert.ok(start >= 0, 'release.yml има стъпка с `files: |`');
const indent = (/^(\s*)/.exec(lines[start]) || [])[1].length;
const globs = [];
for (let i = start + 1; i < lines.length; i += 1) {
  if (!lines[i].trim()) continue;
  const own = (/^(\s*)/.exec(lines[i]) || [])[1].length;
  if (own <= indent) break;
  globs.push(lines[i].trim());
}
assert.ok(globs.length > 0, 'списъкът с файлове не е празен');

const toRegExp = (glob) => new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
const uncovered = artifacts.filter((name) => !globs.some((g) => toRegExp(g.replace(/^dist\//, '')).test(name)));
assert.deepEqual(uncovered, [], 'всеки артефакт от манифеста се качва към изданието');
for (const g of globs) assert.match(g, /^dist\//, `шаблонът „${g}“ сочи dist/`);

// ── 3. Без проверки не се публикува ──
assert.match(workflow, /node scripts\/verify-release\.cjs --with-tests/, 'workflow-ът пуска verify-release с тестовете');
assert.match(workflow, /node scripts\/check-tag-version\.cjs/, 'workflow-ът сверява тага с манифестите');

console.log(
  `release-workflow-assets: ${artifacts.length} артефакта от манифеста · ${globs.length} шаблона в release.yml · verify-release и check-tag-version в стъпките — наред`,
);
