'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../hapi_enterprise');
const docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
const run=fs.readFileSync(path.join(root,'run.sh'),'utf8');
assert.match(docker,/^FROM node:22\.16\.0-alpine3\.21$/m);
assert.match(docker,/node:sqlite/);
assert.match(run,/node:sqlite/);
assert.doesNotMatch(docker,/apk add.*nodejs/);
const copyLine=(docker.match(/^COPY\s+(.+?)\s+\/app\/\s*$/m)||[])[1]||'';
const copied=new Set(copyLine.split(/\s+/));
for (const mod of ['sqlite-store.js','qrcode.js','ooxml.js','pdf-writer.js','cabinet.js','directory.js','job-manager.js','server.js','runtime-config.js','audit-chain.js','rbac.js','error-log.js','config-profiles.js','storage-check.js','load-control.js','storage-preflight.js','storage-migrate.js','admin.js','admin.html','portal.html','portal.js','portal.css','run.sh']) {
  assert.ok(copied.has(mod), 'Dockerfile must COPY '+mod);
}
// Пълен манифест: всички локални модули, които се изискват (транзитивно) от server.js,
// трябва да са в COPY — иначе add-on-ът стартира с MODULE_NOT_FOUND.
const seen=new Set();
const queue=[path.join(root,'server.js')];
while(queue.length){
  const file=queue.pop();
  let text;
  try{text=fs.readFileSync(file,'utf8')}catch{continue}
  for(const m of text.matchAll(/require\('\.\/([a-z0-9-]+)(?:\.js)?'\)/g)){
    const name=m[1]+'.js';
    if(seen.has(name))continue;
    seen.add(name);
    assert.ok(copied.has(name), 'Dockerfile COPY липсва '+name);
    queue.push(path.join(root,name));
  }
}
assert.ok(seen.size>=25, 'трябва да има поне 25 локални модула');
for(const module of ['pgp.js','packager.js']) assert.ok(copied.has(module), 'Dockerfile COPY липсва '+module);
console.log('PASS pinned SQLite-compatible Node runtime + complete module manifest');
