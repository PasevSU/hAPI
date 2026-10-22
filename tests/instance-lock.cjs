'use strict';
// Сценарий: една жива инстанция върху една data директория.
//
//   • unit: второ заключване от жив процес се отказва (INSTANCE_LOCKED), release го пуска;
//   • unit: изоставено заключване (мъртъв pid) се поема, а чужд host с пресен heartbeat
//     не се пипа; heartbeat/release не пипат чуждо заключване;
//   • API: втори сървър върху същата директория излиза с код 1 и ясно съобщение, първият
//     остава здрав и /ready показва неговия instance id;
//   • след SIGTERM заключването се освобождава и рестартът минава.
const { stopChild, freePort } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const lock = require('../hapi_enterprise/instance-lock');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(base, attempts = 160) {
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await fetch(base + '/health')).ok) return true;
    } catch { }
    await sleep(50);
  }
  return false;
}

function boot(dir, port, extraEnv = {}) {
  return spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      OPTIONS_PATH: path.join(dir, 'missing-options.json'),
      PORT: String(port),
      ADMIN_TOKEN: 'instance-lock-admin-token-0123456789',
      ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function waitExit(child, ms = 8000) {
  return new Promise((resolve) => {
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, stderr, timedOut: true });
    }, ms);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, timedOut: false });
    });
  });
}

(async () => {
  // ── 1. Unit: жив собственик блокира втори ────────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-instance-unit-'));
  const first = lock.acquire({ dir, id: 'first' });
  assert.equal(first.ok, true);
  assert.equal(first.tookOver, false);
  const file = lock.lockPath(dir);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(stored.id, 'first');
  assert.equal(stored.pid, process.pid);
  assert.ok(fs.statSync(file).size > 0);

  const second = lock.acquire({ dir, id: 'second' });
  assert.equal(second.ok, false, 'втори жив собственик не се допуска');
  assert.equal(second.reason, 'INSTANCE_LOCKED');
  assert.equal(second.holder.id, 'first');

  // heartbeat/release не пипат чуждо заключване.
  assert.equal(lock.heartbeat(dir, { id: 'someone-else' }), false);
  assert.equal(lock.release(dir, 'someone-else'), false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).id, 'first');

  assert.equal(lock.heartbeat(dir, { id: 'first' }), true);
  assert.equal(lock.release(dir, 'first'), true);
  assert.equal(lock.inspect(dir), null);

  // ── 2. Unit: изоставено заключване се поема ─────────────────────────────
  fs.writeFileSync(
    file,
    JSON.stringify({
      id: 'dead',
      pid: 999999,
      host: os.hostname(),
      startedAt: new Date(Date.now() - 600000).toISOString(),
      heartbeatAt: new Date(Date.now() - 600000).toISOString(),
    }),
  );
  const takeover = lock.acquire({ dir, id: 'third' });
  assert.equal(takeover.ok, true);
  assert.equal(takeover.tookOver, true);
  assert.equal(takeover.previous.id, 'dead');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).id, 'third');
  lock.release(dir, 'third');

  // Чуждият host с пресен heartbeat е жив собственик, колкото и да е странен pid-ът.
  fs.writeFileSync(
    file,
    JSON.stringify({
      id: 'remote',
      pid: 1,
      host: 'another-container',
      heartbeatAt: new Date().toISOString(),
    }),
  );
  const remote = lock.acquire({ dir, id: 'fourth' });
  assert.equal(remote.ok, false, 'чужд host с пресен heartbeat не се поема');
  assert.equal(remote.holder.id, 'remote');
  // ...но след като heartbeat-ът остарее, заключването се поема.
  const stale = lock.acquire({ dir, id: 'fifth', now: Date.now() + 10 * 60 * 1000 });
  assert.equal(stale.ok, true);
  assert.equal(stale.tookOver, true);
  lock.release(dir, 'fifth');

  // ── 2б. Unit: преизползван PID не е жив собственик ───────────────────────
  // В контейнер новият процес получава същия номер (напр. 14) като предишната
  // инстанция. Ако това минеше за „жив собственик“, add-on-ът щеше да не тръгне
  // никога след рестарт — точно това се виждаше в логовете (pid 14 = самият нов процес).
  fs.writeFileSync(
    file,
    JSON.stringify({
      id: 'reused-pid',
      pid: process.pid,
      pidStart: 'not-our-starttime',
      host: os.hostname(),
      startedAt: new Date(Date.now() - 600000).toISOString(),
      heartbeatAt: new Date().toISOString(),
    }),
  );
  const reused = lock.acquire({ dir, id: 'seventh' });
  assert.equal(reused.ok, true, 'същият pid от предишна инстанция не блокира');
  assert.equal(reused.tookOver, true);
  assert.equal(reused.previous.id, 'reused-pid');
  lock.release(dir, 'seventh');

  // Същото, но със заключване от версия, която още не пише pidStart; решава startedAt.
  fs.writeFileSync(
    file,
    JSON.stringify({
      id: 'legacy-lock',
      pid: process.pid,
      host: os.hostname(),
      startedAt: new Date(Date.now() - 600000).toISOString(),
      heartbeatAt: new Date().toISOString(),
    }),
  );
  const legacy = lock.acquire({ dir, id: 'eighth' });
  assert.equal(legacy.ok, true, 'старо заключване с нашия pid и стар startedAt се поема');
  assert.equal(legacy.previous.id, 'legacy-lock');
  lock.release(dir, 'eighth');

  // …но съвсем прясно заключване със същия pid остава в сила (текущият процес).
  fs.writeFileSync(
    file,
    JSON.stringify({
      id: 'self',
      pid: process.pid,
      host: os.hostname(),
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    }),
  );
  const selfLock = lock.acquire({ dir, id: 'ninth' });
  assert.equal(selfLock.ok, false, 'собственикът е този процес, значи е жив');
  assert.equal(selfLock.holder.id, 'self');
  lock.release(dir, 'self');
  fs.rmSync(dir, { recursive: true, force: true });

  // ── 3. API: втори сървър върху същите данни не стартира ─────────────────
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-instance-api-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const primary = boot(dataDir, port, { INSTANCE_ID: 'primary' });
  try {
    assert.ok(await waitHealthy(base), 'първият сървър стартира');

    const ready = await (await fetch(base + '/ready')).json();
    assert.equal(ready.ready, true);
    assert.equal(ready.instance.id, 'primary', 'instance id-то е видимо в /ready');
    assert.equal(ready.instance.sid === undefined, true);

    // Вторият сървър взима СВОЙ свободен порт: `port + 300` може да попадне в
    // изключен диапазон на Windows (Hyper-V/WinNAT) и тогава пада с EACCES вместо
    // с очакваната грешка за ключалката.
    const duplicatePort = await freePort();
    const duplicate = boot(dataDir, duplicatePort, { INSTANCE_ID: 'duplicate' });
    const exited = await waitExit(duplicate);
    assert.equal(exited.timedOut, false, 'вторият сървър не остава да работи');
    assert.equal(exited.code, 1, `очаквам код 1, получих ${exited.code}`);
    assert.match(exited.stderr, /instance lock/, `stderr: ${exited.stderr.slice(0, 200)}`);
    assert.match(exited.stderr, /locked by instance primary/, 'съобщението казва кой държи ключа');

    // Първият е необезпокояван.
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await (await fetch(base + '/ready')).json()).ready, true);

    // ── 4. Спиране → рестарт минава ──────────────────────────────────────
    // На Linux (реалният add-on) SIGTERM върви през shutdown() и заключването се
    // трие; на Windows child.kill() прекратява процеса без handler. И в двата случая
    // рестартът трябва да мине: жив pid не остава, значи заключването е изоставено.
    await stopChild(primary);
    const lockAfterStop = lock.inspect(dataDir);
    if (lockAfterStop) {
      assert.equal(lockAfterStop.id, 'primary');
      assert.throws(() => process.kill(lockAfterStop.pid, 0));
    }

    const restartPort = await freePort();
    const restarted = boot(dataDir, restartPort, { INSTANCE_ID: 'restarted' });
    try {
      assert.ok(await waitHealthy(`http://127.0.0.1:${restartPort}`), 'рестартът минава след освобождаване');
      const again = await (await fetch(`http://127.0.0.1:${restartPort}/ready`)).json();
      assert.equal(again.instance.id, 'restarted');
    } finally {
      await stopChild(restarted);
    }

    console.log(
      'PASS instance lock: жив собственик блокира, изоставено се поема, втори сървър излиза с 1, рестарт след SIGTERM',
    );
  } finally {
    if (primary.exitCode === null && primary.signalCode === null) await stopChild(primary);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
