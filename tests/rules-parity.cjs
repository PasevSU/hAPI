'use strict';
// Вградените правила пътуват с add-on-а. Авторското копие е config/rules,
// а hapi_enterprise/rules е това, което реално влиза в образа — двете трябва да са еднакви.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const configDir = path.join(root, 'config', 'rules');
const bundledDir = path.join(root, 'hapi_enterprise', 'rules');

const configFiles = fs.readdirSync(configDir).filter((name) => name.endsWith('.json')).sort();
const bundledFiles = fs.readdirSync(bundledDir).filter((name) => name.endsWith('.json')).sort();
assert.deepEqual(bundledFiles, configFiles, 'hapi_enterprise/rules трябва да съдържа същите файлове като config/rules');

for (const name of configFiles) {
  const authoring = fs.readFileSync(path.join(configDir, name), 'utf8');
  const bundled = fs.readFileSync(path.join(bundledDir, name), 'utf8');
  assert.equal(bundled, authoring, `правилото ${name} се разминава с авторското копие`);
  assert.doesNotThrow(() => JSON.parse(bundled), `${name} не е валиден JSON`);
}

const required = [
  'download_rules.json',
  'public_gateway.json',
  'download_access.json',
  'file_permissions.json',
  'token_policies.json',
  'rate_limits.json',
  'export_profiles.json',
  'export_permissions.json',
];
for (const name of required) {
  assert.ok(bundledFiles.includes(name), 'липсва вградено правило ' + name);
}

console.log(`PASS bundled rules: ${required.length} файла, идентични с config/rules`);
