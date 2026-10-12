'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const py=fs.readFileSync(path.join(__dirname,'../custom_components/hapi_enterprise/__init__.py'),'utf8');
for(const header of ['Range','If-Range','Content-Length','Content-Range','Accept-Ranges','ETag'])assert.ok(py.includes('"'+header+'"'),'missing '+header);
assert.match(py,/_ALLOWED.fullmatch\(tail\)/);
console.log('PASS static bridge Range forwarding contract (HA runtime not verified)');
