'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const sh=fs.readFileSync(path.join(__dirname,'../portal_enterprise/run.sh'),'utf8');
assert.match(sh,/major<22/);assert.match(sh,/minor<13/);assert.match(sh,/node:sqlite/);
console.log('PASS startup Node SQLite compatibility gate contract');
