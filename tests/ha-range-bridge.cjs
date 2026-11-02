'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const py=fs.readFileSync(path.join(__dirname,'../custom_components/hapi_enterprise/__init__.py'),'utf8');
for(const header of ['Range','If-Range','Content-Length','Content-Range','Accept-Ranges','ETag'])assert.ok(py.includes('"'+header+'"'),'missing '+header);
assert.match(py,/_ALLOWED.fullmatch\(tail\)/);
// Публичните изгледи подават и пренасочване, и бисквитка: `/t/<токен>` отговаря с двете, а
// `POST /api/v1/p/…/package` е POST. Без тях частният портал остава затворен, а ZIP-ът — 405.
for(const header of ['Location','Set-Cookie'])assert.ok(py.includes('"'+header+'"'),'мостът подава '+header);
assert.match(py,/session\.request\(\s*\n?\s*method,/, 'мостът подава метода (POST за package/rating)');
assert.match(py,/async def post\(self, request/, 'публичните изгледи приемат POST');
console.log('PASS static bridge Range forwarding contract (HA runtime not verified)');
