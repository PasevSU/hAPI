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
 *
 * ВАЖНО (Windows): `listen(0)` може да върне порт от динамичния диапазон, който после е
 * ИЗКЛЮЧЕН от системна резервация (Hyper-V / WinNAT: `netsh int ipv4 show excludedportrange`).
 * Тогава детето пада с `EACCES` при `listen`, макар портът да изглежда свободен. Затова
 * всеки кандидат се проверява с изрично връзване и се подменя, ако не става.
 */
async function canBind(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (e) => resolve({ ok: false, code: e.code }));
    server.listen(port, host, () => server.close(() => resolve({ ok: true })));
  });
}

async function freePort(host = '127.0.0.1', { tries = 25 } = {}) {
  for (let i = 0; i < tries; i++) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, host, () => {
        const { port } = server.address();
        server.close(() => resolve(port));
      });
    });
    const probe = await canBind(host, port);
    if (probe.ok) return port;
    if (!['EACCES', 'EADDRINUSE'].includes(probe.code)) return port; // друга причина — не е наш проблем
  }
  throw new Error('няма порт, който може да се върже изрично (изключени диапазони на Windows?)');
}

/**
 * Чака `/health`. Ако процесът е умрял, казва ЗАЩО (код на изхода + последните редове
 * от stderr, ако са събрани), вместо да чака 8 секунди и да съобщи само, че портът мълчи.
 */
async function waitHealthy(child, base, { attempts = 160, delay = 50, stderr = null } = {}) {
  const tail = () => {
    const text = String(stderr && stderr() ? stderr() : '').trim();
    if (!text) return '';
    return '\n' + text.split('\n').slice(-12).join('\n');
  };
  for (let i = 0; i < attempts; i++) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`сървърът приключи преждевременно (код ${child.exitCode ?? child.signalCode}) — ${base}${tail()}`);
    }
    try {
      if ((await fetch(base + '/health')).ok) return true;
    }
    catch { /* още не слуша */ }
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(`сървърът не стартира на ${base} (изчакани ${attempts} опита)${tail()}`);
}

module.exports = { stopChild, freePort, waitHealthy };
