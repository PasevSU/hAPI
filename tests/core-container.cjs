'use strict';
const assert=require('node:assert/strict');
(async()=>{
  // --- DI container ---
  const container=require('../hapi_enterprise/container').create();
  let instantiations=0;
  container.register('clock',()=>({n:++instantiations}),{singleton:true});
  assert.equal(container.get('clock').n,1);
  assert.equal(container.get('clock').n,1,'singleton should cache');
  assert.equal(container.get('clock',{transient:true}).n,2,'transient should rebuild');
  container.registerValue('cfg',{a:1});
  assert.deepEqual(container.get('cfg'),{a:1});
  assert(container.has('clock')&&container.has('cfg')&&!container.has('nope'));
  assert.deepEqual(container.list().sort(),['cfg','clock']);
  assert.throws(()=>container.get('nope'),/not registered/);
  assert.throws(()=>container.register('bad',123),/must be a function/);
  container.clear();
  assert.equal(container.list().length,0);

  // --- Event bus ---
  const bus=require('../hapi_enterprise/event-bus').create();
  const seen=[];
  const off=bus.on('group.created',async p=>seen.push(p.id));
  bus.on('group.created',()=>{throw Error('listener bug')}); // must not propagate
  await bus.emit('group.created',{id:'g1'});
  assert.deepEqual(seen,['g1']);
  let onceCount=0;
  bus.once('x',()=>onceCount++);
  await bus.emit('x');await bus.emit('x');
  assert.equal(onceCount,1);
  assert.equal(bus.listenerCount('x'),0);
  off();
  assert.equal(bus.listenerCount('group.created'),1,'error listener remains');
  assert(bus.events().includes('group.created'));
  assert.equal((await bus.emit('unknown')).length,0);

  // --- Plugin registry ---
  const plugins=require('../hapi_enterprise/plugins').create();
  plugins.register('storage','local',{kind:'local'});
  plugins.register('renderer','pdf',{fmt:'pdf'});
  assert(plugins.has('storage','local'));
  assert.deepEqual(plugins.get('storage','local'),{kind:'local'});
  assert.deepEqual(plugins.list('storage'),['local']);
  assert.deepEqual(plugins.all(),{storage:['local'],renderer:['pdf']});
  assert.throws(()=>plugins.register('storage','bad'),/implementation required/);

  console.log('core-container OK');
})().catch(e=>{console.error(e);process.exit(1)});
