'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {create}=require('../portal_enterprise/job-manager');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const tmpdirs=[];
 const tmp=p=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),p));tmpdirs.push(d);return d};
 // Crash recovery: a job left `running` across a restart is marked `interrupted`;
 // a `queued` job is rebuilt via resolveHandler and resumed automatically.
 const dir=tmp('portal-jobpersist-');
 let release;const gate=new Promise(r=>release=r);
 const resolver=(type,params)=>type==='slow'?async ctx=>{ctx.setTotal(1);await gate;ctx.advance();return 'slow-done'}
   :type==='quick'?async()=>'quick-done':(()=>{throw Error('unknown')})();
 try{
  const m1=create({dir,concurrency:1,resolveHandler:resolver});
  const running=m1.submit('slow',{});   // starts running, blocks on gate
  const queued=m1.submit('quick',{});   // stays queued (concurrency 1)
  assert.equal(m1.get(running.id).status,'running');
  assert.equal(m1.get(queued.id).status,'queued');
  // Simulate a restart with the same persistence dir, before releasing the gate.
  const m2=create({dir,concurrency:1,resolveHandler:resolver});
  assert.equal(m2.get(running.id).status,'interrupted');
  assert.equal(m2.get(queued.id).status,'queued');
  m2.recover();
  await wait(40);
  assert.equal(m2.get(queued.id).status,'succeeded');
  assert.equal(m2.get(queued.id).result,'quick-done');
  release(); // let the abandoned m1 job settle

  // Pause / resume of a queued job.
  const dir2=tmp('portal-jobpause-');
  let r2;const gate2=new Promise(r=>r2=r);
  const m3=create({dir:dir2,concurrency:1,resolveHandler:resolver});
  const block=m3.submit('slow',{});      // running, blocks
  const q=m3.submit('quick',{});         // queued
  assert.equal(m3.pause(q.id).status,'paused');
  assert.equal(m3.stats().paused,1);
  assert.equal(m3.resume(q.id).status,'queued');
  assert.equal(m3.get(q.id).status,'queued'); // still queued: one job is running
  r2();await wait(40);
  assert.equal(m3.get(block.id).status,'succeeded');
  assert.equal(m3.get(q.id).status,'succeeded');

  // Cooperative pause of a running job via ctx.throwIfPaused().
  const dir3=tmp('portal-jobcoop-');
  const m4=create({dir:dir3,concurrency:1,resolveHandler:()=>async ctx=>{
   ctx.setTotal(3);
   for(let i=0;i<3;i++){if(ctx.throwIfPaused)ctx.throwIfPaused();await wait(8);ctx.advance()}
   return 'looped';
  }});
  const j=m4.submit('loop',{});
  await wait(15);          // let one iteration run
  m4.pause(j.id);          // request pause
  await wait(40);          // handler hits throwIfPaused on the next iteration
  assert.equal(m4.get(j.id).status,'paused');
  m4.resume(j.id);
  await wait(120);
  assert.equal(m4.get(j.id).status,'succeeded');
  assert.equal(m4.get(j.id).progress.done,3);
  console.log('PASS job persistence: restart recovery, interrupted marker, pause/resume, cooperative pause');
 }finally{
  for(const d of tmpdirs)try{fs.rmSync(d,{recursive:true,force:true})}catch{}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
