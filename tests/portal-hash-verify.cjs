'use strict';
// Публичната страница ПОКАЗВАШЕ SHA-256 на файла, но никога не го сверяваше — тоест обещание
// без проверка (DEF-03 в регистъра на дефектите). Сега сверката е върху СЪЩИТЕ байтове, които се
// записват: при разминаване файлът НЕ се запазва.
//
// Проверява се ВРЪЗКАТА, а не текстът, и в ДВЕТЕ копия на страницата (add-on и интеграция):
//   1. има `sha256Hex`, който смята с `crypto.subtle.digest("SHA-256", …)`;
//   2. хешът се смята върху `blob.arrayBuffer()` — същите байтове, които се записват;
//   3. сверява се с `file.sha256` и при разминаване има `return` ПРЕДИ `URL.createObjectURL`,
//      тоест файлът не се записва;
//   4. когато `crypto.subtle` липсва (страница по HTTP), свалянето продължава, но казва, че
//      сверка няма — вместо тихо да се представи за проверено.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const COPIES = [
  ['add-on', path.join(root, 'hapi_enterprise', 'portal', 'portal.js')],
  ['интеграция', path.join(root, 'custom_components', 'hapi_enterprise', 'portal.js')],
];

for (const [label, file] of COPIES) {
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf('async function downloadFile(');
  assert.ok(start > 0, `${label}: има downloadFile`);
  const end = text.indexOf('const downloadUrlFor', start) > 0 ? text.indexOf('const downloadUrlFor', start) : text.length;
  const block = text.slice(start, end);

  // 1. Помощната функция смята SHA-256 през WebCrypto.
  assert.match(text, /async function sha256Hex\(buffer\) \{[\s\S]{0,200}crypto\.subtle\.digest\("SHA-256"/, `${label}: sha256Hex смята SHA-256 през crypto.subtle`);

  // 2. Хешът е върху байтовете на самия blob.
  assert.ok(block.includes('await blob.arrayBuffer()'), `${label}: сверката е върху blob.arrayBuffer()`);

  // 3. Сверява се с file.sha256 и разминаването спира ПРЕДИ записа.
  const compareAt = block.indexOf('file.sha256');
  const saveAt = block.indexOf('URL.createObjectURL');
  assert.ok(compareAt > 0, `${label}: сравнява се с file.sha256`);
  assert.ok(saveAt > compareAt, `${label}: сверката е преди създаването на файла за сваляне`);
  const guard = block.slice(compareAt, saveAt);
  assert.ok(/!==\s*expected[\s\S]{0,200}return;/.test(guard), `${label}: при разминаване има return преди записа`);

  // 4. Липсата на WebCrypto не се представя за успешна сверка.
  assert.ok(block.includes('crypto.subtle') && /verdict\s*=\s*"noVerify"/.test(block), `${label}: липсващият crypto.subtle се отчита като „без сверка“`);
  assert.match(block, /noVerify[\s\S]{0,400}(HTTPS|noVerify)/, `${label}: казва защо няма сверка`);
}

// Българските текстове трябва да са налични и в двата свята: add-on-ът ги взима от речника,
// интеграцията ги носи литерално (тя не зарежда `portal-i18n.js`).
const dict = fs.readFileSync(path.join(root, 'hapi_enterprise', 'portal', 'portal-i18n.js'), 'utf8');
for (const key of ['file.status.verified', 'file.status.mismatch', 'file.status.noVerify']) {
  assert.ok(dict.includes(`'${key}'`), `речникът има ${key}`);
}
const addon = fs.readFileSync(COPIES[0][1], 'utf8');
for (const key of ['file.status.verified', 'file.status.mismatch', 'file.status.noVerify']) {
  assert.ok(addon.includes(`T("${key}")`), `add-on страницата ползва ${key}`);
}
const integration = fs.readFileSync(COPIES[1][1], 'utf8');
assert.ok(integration.includes('SHA-256 НЕ съвпада'), 'интеграцията казва за разминаване');
assert.ok(integration.includes('SHA-256 съвпада'), 'интеграцията казва за съвпадение');
assert.ok(integration.includes('без сверка'), 'интеграцията казва, че сверка няма');

console.log('portal-hash-verify: 2 копия · сверка преди запис · разминаване спира свалянето · без WebCrypto → „без сверка“ — наред');
