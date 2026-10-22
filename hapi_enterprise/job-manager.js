'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Persistent, bounded FIFO job queue with cooperative pause/resume and crash
// recovery. Job records are stored as atomic JSON files under `dir`. Handlers
// are intentionally NOT serialized: on recovery the caller supplies
// `resolveHandler(type, params)` so work can be rebuilt after a restart.
class PauseRequestedError extends Error { constructor(){ super('Job paused'); this.name='PauseRequestedError'; } }

function create({ dir, concurrency = 1, maxQueued = 50, maxHistory = 100, resolveHandler } = {}) {
  const hasDir = typeof dir === 'string' && dir.length > 0;
  if (hasDir) {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.lstatSync(dir).isSymbolicLink()) throw Error('Unsafe job directory');
  }
  if (typeof resolveHandler !== 'function') resolveHandler = () => { throw Error('No job handler resolver'); };

  const jobs = new Map();
  const queue = [];
  let running = 0;

  const fileFor = id => path.join(dir, id + '.json');
  function persist(j) {
    if (!hasDir) return;
    const data = { id:j.id, type:j.type, params:j.params, status:j.status, createdAt:j.createdAt,
      startedAt:j.startedAt, finishedAt:j.finishedAt, done:j.done, total:j.total, result:j.result,
      error:j.error, errorCode:j.errorCode };
    const tmp = fileFor(j.id) + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, fileFor(j.id));
  }
  function record(j, patch) {
    Object.assign(j, patch);
    try { persist(j); } catch (e) { console.error('job persist failed', e.code || e.message); }
  }

  const view = j => ({
    id: j.id, type: j.type, status: j.status, createdAt: j.createdAt, startedAt: j.startedAt,
    finishedAt: j.finishedAt, progress: { done: j.done, total: j.total }, result: j.result, error: j.error
  });

  function trim() {
    const finished = [...jobs.values()].filter(j => ['succeeded','failed','cancelled','interrupted'].includes(j.status));
    for (const j of finished.slice(0, Math.max(0, finished.length - maxHistory))) {
      jobs.delete(j.id);
      try { if (hasDir) fs.unlinkSync(fileFor(j.id)); } catch (e) { if (e.code !== 'ENOENT') console.error('job record cleanup failed', e.code || e.message); }
    }
  }

  function pump() {
    while (running < concurrency && queue.length) {
      const job = queue.shift();
      if (job.status !== 'queued') continue;
      running++;
      startJob(job);
    }
  }

  async function startJob(job) {
    record(job, { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, error: null, errorCode: null });
    const ctx = {
      signal: job.controller.signal,
      setTotal: n => { job.total = n; },
      advance: (n = 1) => { job.done += n; },
      shouldPause: () => job.pauseRequested === true,
      throwIfPaused: () => { if (job.pauseRequested) throw new PauseRequestedError(); }
    };
    let terminal = false;
    try {
      const result = await job.handler(ctx);
      if (job.controller.signal.aborted) { record(job, { status: 'cancelled' }); terminal = true; }
      else if (job.pauseRequested) record(job, { status: 'paused', pauseRequested: false });
      else { record(job, { status: 'succeeded', result }); terminal = true; }
    } catch (e) {
      if (e instanceof PauseRequestedError) record(job, { status: 'paused', pauseRequested: false });
      else if (job.controller.signal.aborted) { record(job, { status: 'cancelled' }); terminal = true; }
      else { record(job, { status: 'failed', error: 'Job failed', errorCode: (e && e.code) || '' }); console.error('Job error', job.type, e && e.code || ''); terminal = true; }
    } finally {
      if (terminal) record(job, { finishedAt: new Date().toISOString() });
      running--;
      trim();
      pump();
    }
  }

  // Load persisted jobs. A job left `running` across a crash/restart cannot be
  // resumed in place, so it is marked `interrupted`. `queued` jobs are recovered
  // automatically on the next `recover()`; `paused` jobs stay paused.
  (function load() {
    if (!hasDir) return;
    let entries = [];
    try { entries = fs.readdirSync(dir).filter(n => n.endsWith('.json') && !n.includes('.tmp')); } catch { /* липсваща папка значи „няма запазени задачи“ */ }
    for (const name of entries) {
      let data;
      try { data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { console.error('Skipping corrupt job record', name); continue; }
      if (!data || typeof data.id !== 'string' || typeof data.type !== 'string') continue;
      const job = { ...data, handler: null, controller: new AbortController(), pauseRequested: false };
      if (job.status === 'running') record(job, { status: 'interrupted', error: 'Interrupted by restart', finishedAt: new Date().toISOString() });
      jobs.set(job.id, job);
    }
  })();

  return {
    submit(type, handlerOrParams) {
      if (queue.length >= maxQueued) { const e = new Error('Job queue is full'); e.status = 503; throw e; }
      let handler, params;
      if (typeof handlerOrParams === 'function') { handler = handlerOrParams; params = null; }
      else {
        params = handlerOrParams;
        try { handler = resolveHandler(type, params); } catch { const e = new Error('Unknown job type'); e.status = 400; throw e; }
      }
      const job = {
        id: crypto.randomUUID(), type, params, handler, status: 'queued', createdAt: new Date().toISOString(),
        startedAt: null, finishedAt: null, done: 0, total: 0, result: null, error: null, errorCode: null,
        controller: new AbortController(), pauseRequested: false
      };
      jobs.set(job.id, job);
      persist(job);
      queue.push(job);
      pump();
      return view(job);
    },
    recover() {
      for (const j of jobs.values()) {
        if (j.status === 'queued') {
          try { j.handler = resolveHandler(j.type, j.params); queue.push(j); }
          catch { record(j, { status: 'failed', error: 'Unresolvable job after restart', finishedAt: new Date().toISOString() }); }
        }
      }
      pump();
    },
    get(id) { const j = jobs.get(id); return j ? view(j) : null; },
    list() { return [...jobs.values()].map(view).reverse(); },
    cancel(id) {
      const j = jobs.get(id);
      if (!j) return null;
      if (j.status === 'queued' || j.status === 'paused') record(j, { status: 'cancelled', finishedAt: new Date().toISOString() });
      else if (j.status === 'running') j.controller.abort();
      return view(j);
    },
    pause(id) {
      const j = jobs.get(id);
      if (!j) return null;
      if (j.status === 'queued') record(j, { status: 'paused' });
      else if (j.status === 'running') record(j, { pauseRequested: true });
      return view(j);
    },
    resume(id) {
      const j = jobs.get(id);
      if (!j) return null;
      if (j.status === 'paused') {
        record(j, { status: 'queued', done: 0, total: 0, pauseRequested: false, error: null, errorCode: null });
        queue.push(j);
        pump();
      }
      return view(j);
    },
    stats() {
      return { running, queued: queue.filter(j => j.status === 'queued').length,
        paused: [...jobs.values()].filter(j => j.status === 'paused').length, concurrency };
    }
  };
}

module.exports = { create, PauseRequestedError };
