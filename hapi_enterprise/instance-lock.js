'use strict';
// Заключване на data директорията: една жива инстанция на add-on-а, един собственик.
//
// Два контейнера върху един и същ `DATA_DIR` (например два add-on-а на една
// споделена папка) биха писали едновременно в едни и същи метаданни, файлове, одит
// верига и TSA архив. Затова стартът взима заключване `<DATA_DIR>/.hapi-instance.json`
// с id, pid, host и heartbeat:
//   • жив собственик (същият host + жив pid, или друг host с пресен heartbeat) →
//     новият старт се отказва (код 1), вместо да корумпира данните;
//   • мъртъв pid или стар heartbeat → заключването е изоставено и се поема (tookOver);
//   • `release()` трие само своето заключване, така че чужда инстанция не се разваля.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FILE = '.hapi-instance.json';
const DEFAULT_STALE_MS = 120000;

function lockPath(dir) {
  return path.join(dir, FILE);
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM значи, че процесът съществува, но е на друг потребител.
    return e.code === 'EPERM';
  }
}

function inspect(dir) {
  try {
    return JSON.parse(fs.readFileSync(lockPath(dir), 'utf8'));
  } catch {
    return null;
  }
}

function writeAtomic(dir, payload) {
  const target = lockPath(dir);
  const tmp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, target);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
}

/**
 * Взима заключването.
 * @returns {{ok:true, file:string, payload:object, tookOver:boolean, previous:object|null}
 *          |{ok:false, reason:string, file:string, holder:object|null, payload:object}}
 */
function acquire({ dir, id, host = os.hostname(), now = Date.now(), staleMs = DEFAULT_STALE_MS } = {}) {
  if (!dir) throw Error('instance-lock: dir is required');
  fs.mkdirSync(dir, { recursive: true });
  const file = lockPath(dir);
  const payload = {
    id: String(id || ''),
    pid: process.pid,
    host: String(host || ''),
    startedAt: new Date(now).toISOString(),
    heartbeatAt: new Date(now).toISOString(),
  };

  // Първи опит: атомарно създаване (O_EXCL), за да няма две едновременни стартирания.
  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(payload, null, 2)}\n`);
    } finally {
      fs.closeSync(fd);
    }
    return { ok: true, file, payload, tookOver: false, previous: null };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }

  const previous = inspect(dir);
  if (!previous) {
    // Нечетим/повреден файл: не блокираме старта, но оставяме следа в payload-а.
    writeAtomic(dir, payload);
    return { ok: true, file, payload, tookOver: true, previous: null };
  }

  const sameHost = String(previous.host || '') === String(host || '');
  const heartbeatAge = previous.heartbeatAt ? now - Date.parse(previous.heartbeatAt) : Infinity;
  const fresh = Number.isFinite(heartbeatAge) && heartbeatAge < staleMs;
  // На същия host решава живият pid; на друг host — пресният heartbeat.
  const live = sameHost ? alive(Number(previous.pid)) : fresh;
  if (live) {
    return { ok: false, reason: 'INSTANCE_LOCKED', file, holder: previous, payload };
  }
  writeAtomic(dir, payload);
  return { ok: true, file, payload, tookOver: true, previous };
}

/** Обновява heartbeat-а, но само ако заключването е наше. */
function heartbeat(dir, { id, now = Date.now() } = {}) {
  const current = inspect(dir);
  if (!current || String(current.id) !== String(id)) return false;
  writeAtomic(dir, { ...current, heartbeatAt: new Date(now).toISOString() });
  return true;
}

/** Трие заключването, но само ако е наше. */
function release(dir, id) {
  const current = inspect(dir);
  if (!current || String(current.id) !== String(id)) return false;
  try {
    fs.unlinkSync(lockPath(dir));
    return true;
  } catch (e) {
    return e.code === 'ENOENT';
  }
}

module.exports = { acquire, heartbeat, release, inspect, lockPath, FILE, DEFAULT_STALE_MS };
