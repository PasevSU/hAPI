'use strict';

// Waits for a spawned server to answer /health. Startup can be slow under
// load (DB load, directory setup, audit-chain init), so allow a generous
// window and poll at a low rate instead of a tight, load-sensitive loop.
// When `child` is supplied, the wait also fails fast (instead of hanging the
// full window) if the process exits before becoming ready.
async function waitForHealth(port, timeoutMs = 30000, child = null) {
  const deadline = Date.now() + timeoutMs;
  const exited = { code: child ? child.exitCode : null, signal: child ? child.signalCode : null };
  if (child && exited.code === null && exited.signal === null) {
    child.once('exit', (code, signal) => {
      exited.code = code;
      exited.signal = signal;
    });
  }
  while (Date.now() < deadline) {
    if (exited.code !== null || exited.signal !== null) {
      throw new Error(`Server process exited before /health (code=${exited.code}, signal=${exited.signal})`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server on port ${port} did not start within ${timeoutMs}ms`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', () => resolve(true)));
  child.kill();
  let timer;
  const stopped = await Promise.race([
    exited,
    new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })
  ]);
  clearTimeout(timer);
  if (!stopped) throw new Error(`Child process ${child.pid} did not stop`);
}

// Binds an ephemeral port and returns it, avoiding fixed-range collisions with
// orphaned servers or other processes on shared hosts.
function findFreePort() {
  const net = require('node:net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(err => (err ? reject(err) : resolve(port)));
    });
  });
}

// Spawns the portal server on a free port with stderr captured. Resolves once
// /health responds; on failure it kills the child and attaches its stderr to
// the thrown error so startup crashes are no longer silent.
async function spawnServer({ dir, adminToken, env: extraEnv = {} } = {}) {
  const { spawn } = require('node:child_process');
  const path = require('node:path');
  const port = await findFreePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'portal_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_TOKEN: adminToken, ...extraEnv },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  try {
    await waitForHealth(port, 30000, child);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    if (stderr) error.message += `\nServer stderr:\n${stderr.trim()}`;
    throw error;
  }
  return { child, port, stderr, stop: () => stopChild(child) };
}

function symlinkSupported() {
  try {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-symlink-probe-'));
    const target = path.join(dir, 'target');
    const link = path.join(dir, 'link');
    fs.writeFileSync(target, 'probe');
    fs.symlinkSync(target, link);
    const ok = fs.lstatSync(link).isSymbolicLink();
    fs.rmSync(dir, { recursive: true, force: true });
    return ok;
  } catch {
    return false;
  }
}

module.exports = { findFreePort, spawnServer, stopChild, symlinkSupported, waitForHealth };
