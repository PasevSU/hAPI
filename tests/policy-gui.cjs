'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');const ui=fs.readFileSync(path.join(root,'portal_enterprise/admin.js'),'utf8');const server=fs.readFileSync(path.join(root,'portal_enterprise/server.js'),'utf8');
for(const x of ['FREE','KEY_REQUIRED','DISABLED','Без срок','Създай файлов ключ','Отнеми','access-keys','/access'])assert(ui.includes(x),x);
assert(server.includes('accessKeys:(f.accessKeys||[]).map'), 'admin key inventory missing');
assert(!/localStorage\.setItem\s*\(\s*['"](?:token|secret|key|password|pass|auth|credential|session|signing|api-?key)/i.test(ui),'secret must not persist in localStorage');
console.log('PASS: GUI policy controls, expiry options, key creation/revocation bindings and admin key metadata');
