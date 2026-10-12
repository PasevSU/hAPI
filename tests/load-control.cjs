'use strict';
const assert=require('node:assert/strict');
const {create}=require('../portal_enterprise/load-control');
(async()=>{
 // Heap watermark set high so the level is driven deterministically by error rate.
 const lc=create({base:100,min:2,heapWatermark:1e9});
 assert.equal(lc.effective,100);
 let s=lc.recalc(1000);assert.equal(s.level,'LOW');assert.equal(lc.effective,100);
 for(let i=0;i<5;i++)lc.recordError();s=lc.recalc(100);assert.equal(s.level,'MEDIUM');assert.equal(lc.effective,75);
 for(let i=0;i<10;i++)lc.recordError();s=lc.recalc(100);assert.equal(s.level,'HIGH');assert.equal(lc.effective,50);
 for(let i=0;i<20;i++)lc.recordError();s=lc.recalc(100);assert.equal(s.level,'CRITICAL');assert.equal(lc.effective,25);
 // Concurrency never drops below the configured minimum
 const small=create({base:4,min:2,heapWatermark:1e9});for(let i=0;i<50;i++)small.recordError();small.recalc(10);assert.equal(small.effective,2);
 console.log('PASS load control: adaptive levels, effective concurrency, minimum floor');
})().catch(e=>{console.error(e);process.exitCode=1});
