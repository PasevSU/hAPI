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

module.exports = { stopChild };
