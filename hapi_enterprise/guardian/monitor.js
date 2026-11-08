'use strict';
// Optional hAPI Stability Guardian. Independent supervisor probe; no outbound traffic,
// no AI calls, no credentials, no side effects on hAPI core. OFF by default.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const performance = require('./performance');
const {writeStatus}=require('./status');

const DEFAULT_INTERVAL_MS = 30_000;
const MAX_JOURNAL_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 5000;
const VALID_STATES = new Set(['healthy', 'unready', 'unreachable', 'malformed']);

function fingerprint(code) {
  return crypto.createHash('sha256').update('hapi-guardian:' + code).digest('hex').slice(0, 24);
}
function probe({ host = '127.0.0.1', port = 8099, timeoutMs = 3000 } = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = result => { if (!done) { done = true; resolve(result); } };
    const req = http.get({ hostname: host, port, path: '/ready', timeout: timeoutMs, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 4096) req.destroy(new Error('response too large'));
      });
      res.on('end', () => {
        try {
          const doc = JSON.parse(body);
          const ready = doc && doc.ready === true && res.statusCode === 200;
          const checks = doc && doc.checks && typeof doc.checks === 'object' ? doc.checks : {};
          const failing = ['storage', 'db', 'rules'].filter(key => checks[key] !== true);
          finish({ state: ready ? 'healthy' : 'unready', code: ready ? 'READY' : 'NOT_READY',
            checks: failing, status: Number(res.statusCode) || 0 });
        } catch {
          finish({ state: 'malformed', code: 'READY_MALFORMED', checks: [], status: Number(res.statusCode) || 0 });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('probe timeout')));
    req.on('error', () => finish({ state: 'unreachable', code: 'READY_UNREACHABLE', checks: [], status: 0 }));
  });
}
function createJournal(directory) {
  const dir = path.resolve(directory);
  const file = path.join(dir, 'events.jsonl');
  // Only allow known diagnostic fields; never persist response bodies, paths, tokens or IPs.
  function record(event) {
    if (!event || !VALID_STATES.has(event.state)) throw Error('Invalid guardian event');
    const safe = { type: 'probe', at: new Date().toISOString(), state: event.state,
      code: String(event.code || 'UNKNOWN').slice(0, 64),
      checks: Array.isArray(event.checks) ? event.checks.filter(x => ['db', 'storage', 'rules'].includes(x)) : [],
      status: Number(event.status) || 0 };
    safe.id = fingerprint(safe.code + ':' + safe.checks.join(','));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      if (fs.statSync(file).size >= MAX_JOURNAL_BYTES) {
        // Keep a bounded tail instead of allowing a full disk to destabilize hAPI.
        const records = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-MAX_RECORDS / 2);
        fs.writeFileSync(file + '.tmp', records.join('\n') + '\n', { mode: 0o600 });
        fs.renameSync(file + '.tmp', file);
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    fs.appendFileSync(file, JSON.stringify(safe) + '\n', { mode: 0o600 });
    return safe;
  }
  return { file, record };
}
async function run({ intervalMs = DEFAULT_INTERVAL_MS, dir = process.env.HAPI_GUARDIAN_DIR || '/data/stability-guardian',
  port = Number(process.env.PORT || 8099), onProbe = probe, stop = () => false } = {}) {
  const journal = createJournal(dir);
  let previous = null;
  let failures = 0;
  let previousSensors = null;
  let totalFindings = 0;
  while (!stop()) {
    const result = await onProbe({ port });
    const signature = result.state + ':' + result.code + ':' + (result.checks || []).join(',');
    // Record transitions and persistent failures once every 20 checks, not every second.
    if (signature !== previous || result.state !== 'healthy' && failures % 20 === 0) {
      try { journal.record(result); } catch (error) {
        console.error('GUARDIAN_JOURNAL_ERROR:', error.code || error.message);
      }
    }
    // Reuse the existing privacy-preserving observer.json telemetry. Caching is NEVER activated.
    try {
      const currentSensors = performance.loadSnapshot(process.env.DATA_DIR || '/data');
      if (previousSensors) totalFindings += performance.recordFindings(dir, performance.evaluate(previousSensors, currentSensors));
      previousSensors = currentSensors;
    } catch (error) {
      // Observer metrics can be absent on the first start. Diagnostics must not disturb hAPI.
      if (error.code !== 'ENOENT') console.error('GUARDIAN_PERFORMANCE_READ_FAILED:', error.code || error.message);
    }
    previous = signature;
    failures = result.state === 'healthy' ? 0 : failures + 1;
    try { writeStatus(dir,result,{failureCount:failures,cacheCandidates:totalFindings}); }
    catch(error){console.error('GUARDIAN_STATUS_WRITE_FAILED:',error.code||error.message)}
    await delay(intervalMs);
  }
}
if (require.main === module) {
  let stopped = false;
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { stopped = true; });
  run({stop: () => stopped}).catch(error => {
    console.error('GUARDIAN_MONITOR_ERROR:', error.code || error.message);
    process.exitCode = 1;
  });
}
module.exports = { probe, createJournal, fingerprint, run };
