'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createMonitor}=require('../monitor');
test('safe independent monitor records transitions without user data',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hapi-devtools-monitor-'));
  const states=[{state:'ready',httpStatus:200},{state:'unreachable',httpStatus:0},{state:'ready',httpStatus:200}];
  const m=createMonitor(dir,{onProbe:async()=>states.shift()});
  try{
    await m.tick();assert.equal(m.snapshot().state,'ready');
    await m.tick();assert.equal(m.snapshot().consecutiveFailures,1);
    await m.tick();assert.equal(m.snapshot().consecutiveFailures,0);
    const log=fs.readFileSync(path.join(dir,'monitor.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(log.length,3);assert.equal(log[1].state,'unreachable');
    assert.deepEqual(Object.keys(log[0]).sort(),['at','consecutiveFailures','httpStatus','state'].sort());
  }finally{m.stop();fs.rmSync(dir,{recursive:true,force:true})}
});
