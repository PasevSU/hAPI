'use strict';

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

module.exports = { stopChild, symlinkSupported };
