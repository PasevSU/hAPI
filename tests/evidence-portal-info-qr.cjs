'use strict';
// Evidence View портал — информация за файловете и QR.
//
// Тестът пази договора, който лесно се губи:
//   • QR енкодерът е част от пакета и се зарежда преди модула;
//   • QR кодът кодира САМО навигация (адрес + folder [+ file]) — никога парола или токен;
//   • съдържание от манифеста не минава през innerHTML;
//   • демо манифестите носят информацията, която панелът показва.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const pkg = path.join(root, 'hapi_enterprise', 'evidence-portal');
const portal = require(path.join(root, 'hapi_enterprise', 'evidence-portal.js'));
const read = (rel) => fs.readFileSync(path.join(pkg, rel), 'utf8');

// 1. QR енкодерът е в пакета и се публикува.
assert.ok(portal.FILES.includes('assets/qrcode.js'), 'assets/qrcode.js трябва да е в FILES, иначе QR-ът липсва в публикуваното');
assert.deepEqual(portal.missingSourceFiles(), [], 'всички файлове на пакета съществуват');
assert.ok(fs.existsSync(path.join(pkg, 'assets', 'qrcode.js')), 'qrcode.js е в пакета');

// 2. Страницата зарежда енкодера ПРЕДИ модула, без inline скрипт.
const html = read('portal.html');
const qrAt = html.indexOf('src="./assets/qrcode.js"');
const appAt = html.indexOf('src="./assets/app.js"');
assert.ok(qrAt > 0, 'portal.html трябва да зарежда ./assets/qrcode.js');
assert.ok(appAt > qrAt, 'енкодерът се зарежда преди app.js — иначе window.qrcode липсва при първия рендер');
assert.equal(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html), false, 'portal.html не бива да има inline скрипт (CSP)');

// 3. Енкодерът наистина работи: в изолиран контекст слага window.qrcode и дава матрица.
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(read('assets/qrcode.js'), sandbox, { filename: 'qrcode.js' });
assert.equal(typeof sandbox.window.qrcode, 'function', 'qrcode.js дефинира window.qrcode');
const link = 'https://example.test/local/hapi/data/portal.html?folder=demo-evidence#file=f1';
const qr = sandbox.window.qrcode(0, 'M');
qr.addData(link);
qr.make();
assert.ok(qr.getModuleCount() >= 21, 'QR матрицата има поне един размер на версия 1: ' + qr.getModuleCount());
assert.equal(typeof qr.isDark(0, 0), 'boolean', 'матрицата се чете през isDark');

// 4. app.js строи само навигационни връзки и не ползва innerHTML.
const app = read('assets/app.js');
assert.match(app, /const fileLink = \(fileId\) => baseUrl\(\) \+ '#file=' \+ encodeURIComponent\(fileId\)/, 'файловата връзка е база + #file=');
assert.match(app, /const packageLink = \(\) => baseUrl\(\)/, 'връзката на пакета е само базата');
assert.match(app, /function qrSvg\(/, 'има DOM изграждане на QR');
assert.match(app, /function downloadPng\(/, 'има PNG изход');
assert.match(app, /'#file=' \+ encodeURIComponent\(fileId\)/, 'дълбоката връзка ползва #file=');
assert.equal(/\.innerHTML\s*=/.test(app), false, 'app.js не бива да присвоява innerHTML (съдържание от манифеста)');
assert.equal(/document\.write\s*\(/.test(app), false, 'app.js не бива да ползва document.write');

// 5. QR блокът се вика само с навигационните връзки — никога с парола/токен.
const qrCalls = [...app.matchAll(/(?<!function )qrBlock\(([^,]+),/g)].map((m) => m[1].trim());
assert.ok(qrCalls.length >= 2, 'има поне два QR блока (пакет и файл): ' + qrCalls.join(' '));
for (const call of qrCalls) {
  assert.ok(/^(fileLink|packageLink)\(/.test(call), 'QR се строи само от fileLink()/packageLink(): ' + call);
}
assert.equal(/password[^\n]*qrBlock|qrBlock[^\n]*password/i.test(app), false, 'парола не бива да влиза в QR');

// 6. Демо манифестите носят информацията, която панелът показва.
const flatten = (nodes) => (nodes || []).flatMap((n) => (n.type === 'folder' ? flatten(n.children) : [n]));
for (const rel of ['data/demo-evidence.json', 'sample-evidence.json']) {
  const manifest = JSON.parse(read(rel));
  assert.equal(manifest.schema, 'hapi-evidence/2', rel + ' е манифест v2');
  assert.ok(manifest.package && manifest.package.id, rel + ' има блок package');
  assert.ok(manifest.package.description, rel + ' описва пакета');
  const files = flatten(manifest.items);
  assert.ok(files.length > 0, rel + ' съдържа файлове');
  const counted = manifest.totals && manifest.totals.files;
  assert.equal(counted, files.length, rel + ': totals.files съвпада с реалния брой файлове');
  for (const file of files) {
    assert.ok(file.mime, rel + ': ' + file.id + ' има mime');
    assert.ok(Array.isArray(file.tags) && file.tags.length > 0, rel + ': ' + file.id + ' има етикети');
    assert.ok(typeof file.sha256 === 'string' && file.sha256.length === 64, rel + ': ' + file.id + ' има 64-символен sha256');
  }
}

console.log('PASS evidence-portal info+QR: енкодер в пакета · навигационни QR връзки · без innerHTML · манифести v2');
