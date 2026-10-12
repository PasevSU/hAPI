'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create } = require('../hapi_enterprise/notification-center');
const eventBus = require('../hapi_enterprise/event-bus').create();

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-notif-'));
  try {
    // record + list (newest-first) + since cursor + level filter
    const nc = create({ dir, max: 50 });
    const a = nc.record({ level: 'info', kind: 'settings', status: 'done', title: 'S', message: 'one' });
    const b = nc.record({ level: 'error', kind: 'job', status: 'failed', title: 'J', message: 'two' });
    const c = nc.record({ level: 'success', kind: 'backup', status: 'done', title: 'B', message: 'three' });
    assert.equal(a.seq, 1); assert.equal(b.seq, 2); assert.equal(c.seq, 3);
    let list = nc.list();
    assert.equal(list.length, 3);
    assert.equal(list[0].seq, 3); // newest first
    assert.equal(nc.list({ since: 1 }).length, 2);
    assert.equal(nc.list({ level: 'error' }).length, 1);
    assert.equal(nc.list({ level: 'error' })[0].message, 'two');
    assert.equal(nc.list({ kind: 'backup' }).length, 1);
    assert.equal(nc.list({ status: 'done' }).length, 2);
    assert.equal(nc.list({ limit: 1 }).length, 1);

    // stats
    const st = nc.stats();
    assert.equal(st.total, 3); assert.equal(st.failed, 1); assert.equal(st.lastSeq, 3);
    assert.equal(st.byLevel.error, 1); assert.equal(st.byLevel.success, 1);

    // upsert lifecycle: running -> succeeded collapses to one entry
    nc.upsert('job:J1', { level: 'info', kind: 'job', status: 'running', title: 'Job', message: 'In progress', progress: { done: 1, total: 10 } });
    const during = nc.list({ status: 'running' });
    assert.equal(during.length, 1); assert.equal(during[0].progress.done, 1);
    nc.upsert('job:J1', { level: 'success', status: 'succeeded', message: 'Done', progress: { done: 10, total: 10 } });
    assert.equal(nc.list({ status: 'running' }).length, 0);
    const done = nc.list({ status: 'succeeded' });
    assert.equal(done.length, 1); assert.equal(done[0].message, 'Done'); assert.equal(done[0].progress.done, 10);
    assert.equal(nc.list().filter(e => e.key === 'job:J1').length, 1); // still one entry total

    // clear finished (keeps running entries only)
    const cleared = nc.clear({ finishedOnly: true });
    assert.equal(cleared, 4); // a, b, c, job done were all terminal
    assert.equal(nc.list().length, 0);

    // persistence across recreation
    nc.record({ level: 'warn', kind: 'storage', status: 'warn', title: 'W', message: 'keep me' });
    const nc2 = create({ dir, max: 50 });
    assert.equal(nc2.list().length, 1);
    assert.equal(nc2.list()[0].message, 'keep me');

    // subscribe maps job + operational events
    const nc3 = create({ dir: path.join(dir, 'sub'), max: 50 });
    const bus = eventBus;
    nc3.subscribe(bus);
    bus.emit('job.running', { job: { id: 'x', type: 'integrity-scan', progress: { done: 0, total: 5 } } });
    bus.emit('job.succeeded', { job: { id: 'x', type: 'integrity-scan', progress: { done: 5, total: 5 } } });
    bus.emit('settings_changed', { keys: ['organization'] });
    const sub = nc3.list();
    assert.equal(sub.filter(e => e.kind === 'job' && e.key === 'job:x').length, 1);
    assert.equal(sub.find(e => e.kind === 'job').status, 'succeeded');
    assert.equal(sub.find(e => e.kind === 'settings').status, 'done');
    assert.equal(nc3.stats().active, 0);

    console.log('PASS notification center: record/list/filters, stats, upsert lifecycle, clear, persistence, event-bus subscribe');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1 });
