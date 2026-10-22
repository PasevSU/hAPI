'use strict';
// hAPI Enterprise — edge/standalone runtime.
//
// Runs the SAME backend (server.js) that ships as the Home Assistant add-on,
// but outside Home Assistant — on a Windows/macOS/Linux desktop. A local data
// directory is used and an admin token is generated (and reused) on first run.
// The full admin GUI is served at http://127.0.0.1:<ADMIN_PORT>/admin so the
// package works "on the edge between Home Assistant and Windows" with one code
// base. Nothing from the add-on is removed; this is an additional run mode.
//
// Usage:  node standalone.js           (any Node 14+; the server child is
//                                       launched with a node:sqlite runtime)
// Env:    HAPI_DATA_DIR    (absolute data dir; default %LOCALAPPDATA%/hAPI_enterprise)
//         HAPI_PORT        (public API port; default 8099)
//         HAPI_ADMIN_PORT  (admin GUI port; default 8098)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const SERVER = path.join(__dirname, 'server.js');

function hasSqlite(bin) {
  try { return spawnSync(bin, ['-e', 'require("node:sqlite")'], { stdio: 'ignore' }).status === 0; }
  catch { return false; }
}

// server.js uses node:sqlite, so the child must run under Node 22.13+.
function resolveRuntime() {
  if (hasSqlite(process.execPath)) return process.execPath;
  // Embedded portable runtime shipped with the Windows release: <root>/runtime/node.exe
  const embedded = path.join(__dirname, '..', 'runtime', 'node.exe');
  if (fs.existsSync(embedded) && hasSqlite(embedded)) return embedded;
  const alt = path.join(os.tmpdir(), 'portal-node-2216', 'node_modules', 'node', 'bin', 'node.exe');
  if (fs.existsSync(alt) && hasSqlite(alt)) return alt;
  const onPath = process.platform === 'win32' ? 'node.exe' : 'node';
  if (hasSqlite(onPath)) return onPath;
  throw new Error('No node:sqlite-capable runtime found (Node 22.13+ required).');
}

function resolveDataDir() {
  const env = process.env.HAPI_DATA_DIR;
  if (env && path.isAbsolute(env)) return env;
  const base = process.env.LOCALAPPDATA || os.homedir() || os.tmpdir();
  return path.join(base, 'hAPI_enterprise');
}

function tokenPath(dataDir) { return path.join(dataDir, 'admin-token'); }

function resolveToken(dataDir) {
  const file = tokenPath(dataDir);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing && existing.length >= 24 && existing !== 'CHANGE_TO_RANDOM_SECRET_AT_LEAST_24_CHARACTERS') return existing;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const token = crypto.randomBytes(24).toString('hex'); // 48 hex chars, unique
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, token + '\n', { mode: 0o600 });
  return token;
}

function buildEnv({ dataDir, token, publicPort, adminPort } = {}) {
  return {
    DATA_DIR: dataDir,
    PORT: String(publicPort || 8099),
    ADMIN_TOKEN: token,
    ADMIN_PORT: String(adminPort || 8098),
    INGRESS_MODE: 'true',
    ADMIN_BIND_HOST: '127.0.0.1',   // loopback-only admin for desktop use
    PUBLIC_BIND_HOST: '127.0.0.1',
    CORS_ORIGIN: '*'                // allow the native desktop GUI (origin null) to call the admin API
  };
}

function spawnServer(env, opts = {}) {
  const node = resolveRuntime();
  return spawn(node, [SERVER], { env: { ...process.env, ...env }, stdio: opts.stdio || 'inherit' });
}

function probeHealth(port, timeoutMs) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 500 }, res => {
      res.resume(); resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    setTimeout(() => { try { req.destroy(); } catch { /* унищожаването на вече затворена заявка не е грешка */ } resolve(false); }, timeoutMs);
  });
}

async function waitForHealth(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await probeHealth(port, 500)) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  const dataDir = resolveDataDir();
  const token = resolveToken(dataDir);
  const env = { ...buildEnv({ dataDir, token, publicPort: process.env.HAPI_PORT, adminPort: process.env.HAPI_ADMIN_PORT }), HAPI_FIRST_RUN_SEED: '1', HAPI_LOCAL_OPEN: '1' };
  console.log('hAPI Enterprise · edge/standalone runtime');
  console.log('Data directory:  ' + dataDir);
  console.log('Admin token file:' + tokenPath(dataDir));
  console.log('Admin GUI:       http://127.0.0.1:' + env.ADMIN_PORT + '/admin');
  const child = spawnServer(env);
  child.on('exit', code => process.exit(code == null ? 0 : code));
  const shutdown = () => { try { child.kill(); } catch { /* процесът може вече да е спрял — kill хвърля */ } process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (!(await waitForHealth(env.PORT))) {
    console.error('Server did not become healthy in time.');
    try { child.kill(); } catch { /* процесът може вече да е спрял — kill хвърля */ }
    process.exit(1);
  }
  console.log('Backend ready · public API http://127.0.0.1:' + env.PORT + ' · admin GUI http://127.0.0.1:' + env.ADMIN_PORT + '/admin');
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });

module.exports = { SERVER, hasSqlite, resolveRuntime, resolveDataDir, tokenPath, resolveToken, buildEnv, spawnServer, waitForHealth };
