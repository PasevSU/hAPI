'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { probe, createJournal } = require('../hapi_enterprise/guardian/monitor.js');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-compat-'));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type','application/json');
    if(req.url === '/ready') return res.end(JSON.stringify({ready:true,checks:{storage:true,db:true,rules:true}}));
    res.statusCode=404;res.end('{}');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const ok = await probe({port:server.address().port});
    assert.equal(ok.state,'healthy');
    assert.equal(ok.code,'READY');
    const journal=createJournal(dir);
    const entry=journal.record(ok);
    assert.equal(entry.state,'healthy');
    assert.match(entry.id,/^[a-f0-9]{24}$/);
    assert.deepEqual(JSON.parse(fs.readFileSync(journal.file,'utf8').trim()),entry);
    assert.equal(fs.existsSync(path.join(dir,'package.json')),false);
    const config=fs.readFileSync(path.join(__dirname,'../hapi_enterprise/config.yaml'),'utf8');
    assert.match(config,/  stability_guardian_enabled: false/);
    assert.match(config,/  stability_guardian_enabled: bool\?/);
    const docker=fs.readFileSync(path.join(__dirname,'../hapi_enterprise/Dockerfile'),'utf8');
    assert.match(docker,/COPY guardian \/app\/guardian\//);
    const start=fs.readFileSync(path.join(__dirname,'../hapi_enterprise/start.js'),'utf8');
    assert.match(start,/options\.stability_guardian_enabled === true/);
    assert.match(start,/if \(guardianEnabled\)/);
    console.log('guardian optional add-on compatibility: OK');
  } finally {
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1});
