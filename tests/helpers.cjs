'use strict';

const net = require('node:net');

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

/**
 * Свободен порт от ядрото.
 *
 * Тестовете взимаха `31000 + Math.random() * 2000` и диапазоните им се застъпваха, затова
 * в CI от време на време два теста искаха един и същ порт: сървърът излизаше веднага и
 * оставаше само „сървърът не стартира на N“. Ядрото дава порт, който в момента е свободен.
 */
async function freePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Чака `/health`. Ако процесът е умрял, казва ЗАЩО (код на изхода), вместо да чака 8 секунди
 * и да съобщи само, че портът мълчи.
 */
async function waitHealthy(child, base, { attempts = 160, delay = 50 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`сървърът приключи преждевременно (код ${child.exitCode ?? child.signalCode}) — ${base}`);
    }
    try {
      if ((await fetch(base + '/health')).ok) return true;
    }
    catch { /* още не слуша */ }
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(`сървърът не стартира на ${base} (изчакани ${attempts} опита)`);
}

module.exports = { stopChild, freePort, waitHealthy };
