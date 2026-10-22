'use strict';
// Заключване на data директорията: една жива инстанция на add-on-а, един собственик.
//
// Два контейнера върху един и същ `DATA_DIR` (например два add-on-а на една
// споделена папка) биха писали едновременно в едни и същи метаданни, файлове, одит
// верига и TSA архив. Затова стартът взима заключване `<DATA_DIR>/.hapi-instance.json`
// с id, pid, pidStart, host и heartbeat:
//   • жив собственик (същият host + същият процес, или друг host с пресен heartbeat) →
//     новият старт се отказва (код 1), вместо да корумпира данните;
//   • мъртъв pid, преизползван pid или стар heartbeat → заключването е изоставено и се
//     поема (tookOver);
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

// PID се ПРЕИЗПОЛЗВА. В контейнер новият процес често получава същия номер (напр. 14)
// като предишната инстанция, затова „pid е жив“ само по себе си не е доказателство,
// че собственикът на заключването е жив — това беше причината add-on-ът да не тръгне
// след рестарт („locked by instance … pid 14“, където 14 е самият нов процес).
// starttime (поле 22 в /proc/<pid>/stat) различава две различни „въплъщения“ на един PID.
function pidStart(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const tail = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return tail[19] || '';
  } catch {
    return '';
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
    pidStart: pidStart(process.pid),
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
  const previousPid = Number(previous.pid);
  const heartbeatAge = previous.heartbeatAt ? now - Date.parse(previous.heartbeatAt) : Infinity;
  const fresh = Number.isFinite(heartbeatAge) && heartbeatAge < staleMs;
  // На същия host решава собственикът; на друг host — пресният heartbeat.
  let live;
  if (!sameHost) {
    live = fresh;
  } else if (previousPid === process.pid) {
    // Същият номер pid: или сме ние (повторно взимане), или нов контейнер с преизползван
    // номер. Решава starttime, а когато /proc липсва — кой е стартирал по-късно.
    const prevStart = String(previous.pidStart || '');
    const ourStart = payload.pidStart;
    if (prevStart && ourStart) {
      live = prevStart === ourStart;
    } else {
      const holderStarted = Date.parse(String(previous.startedAt || ''));
      const ourStartedAt = now - process.uptime() * 1000;
      live = Number.isFinite(holderStarted) ? holderStarted >= ourStartedAt : fresh;
    }
  } else {
    // Различен pid на същия host: жив е само ако процесът съществува И сърцето му бие.
    // Двете заедно пазят от двата вида лъжливи отговори: мъртъв pid (след рестарт) и
    // pid, който в новия контейнер принадлежи на нещо съвсем друго.
    live = alive(previousPid) && fresh;
  }
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

// ── Споделен режим (HAPI_SHARED_DATA=1) ────────────────────────────────────────
// Няколко процеса върху ЕДНИ И СЪЩИ данни (многослоен цикъл: втори слой, CLI процес,
// втори контейнер по избор). Тук няма „собственик“ — всеки процес се регистрира във
// `<DATA_DIR>/.hapi-peers/` със сърцебиене, а записите се пазят от shared-data.js чрез
// сравнение-и-размяна. Файловете на мъртвите процеси се чистят, за да не расте папката.
const PEERS_DIR = '.hapi-peers';
const peersDir = (dir) => path.join(dir, PEERS_DIR);
const peerName = (id) => `${process.pid}-${String(id || 'instance').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}.json`;

function writePeer(file, payload) {
  const tmp = `${file}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
}

/** Регистрира този процес като участник върху данните (без изключителност). */
function joinShared({ dir, id, host = os.hostname(), now = Date.now(), staleMs = DEFAULT_STALE_MS } = {}) {
  if (!dir) throw Error('instance-lock: dir is required');
  const folder = peersDir(dir);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, peerName(id));
  const payload = { id: String(id || ''), pid: process.pid, pidStart: pidStart(process.pid), host: String(host || ''), joinedAt: new Date(now).toISOString(), heartbeatAt: new Date(now).toISOString() };
  writePeer(file, payload);
  pruneShared({ dir, host, now, staleMs });
  return { ok: true, file, payload, peers: listShared({ dir, host, now, staleMs }) };
}

function heartbeatShared({ dir, file, id, now = Date.now() } = {}) {
  if (!file || !fs.existsSync(file)) return false;
  let current;
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Нечетимият файл се пренаписва — това е нашият собствен запис, не чужда собственост.
    current = { id: String(id || '') };
  }
  writePeer(file, { ...current, id: String(id || current.id || ''), pid: process.pid, pidStart: pidStart(process.pid), heartbeatAt: new Date(now).toISOString() });
  return true;
}

/** Сваля регистрацията на процеса (само своя файл). */
function leaveShared({ file } = {}) {
  if (!file) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch (e) {
    return e.code === 'ENOENT';
  }
}

/** Живите участници върху данните към момента (мъртвите не се броят). */
function listShared({ dir, host = os.hostname(), now = Date.now(), staleMs = DEFAULT_STALE_MS } = {}) {
  const folder = peersDir(dir);
  let names;
  try {
    names = fs.readdirSync(folder).filter((name) => name.endsWith('.json'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const live = [];
  for (const name of names) {
    const file = path.join(folder, name);
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // Полузаписан/повреден файл не бива да чупи списъка — следващият prune го маха.
    }
    const sameHost = String(entry.host || '') === String(host || '');
    const beatAge = entry.heartbeatAt ? now - Date.parse(entry.heartbeatAt) : Infinity;
    const fresh = Number.isFinite(beatAge) && beatAge < staleMs;
    const isSelf = Number(entry.pid) === process.pid && String(entry.pidStart || '') === pidStart(process.pid);
    // На друг host решава само сърцебиенето (процесите не се виждат един друг).
    const aliveHere = sameHost ? alive(Number(entry.pid)) || isSelf : true;
    if (aliveHere && fresh) live.push({ ...entry, file, self: isSelf });
  }
  return live;
}

/** Изтрива регистрациите на мъртви/застояли процеси. */
function pruneShared({ dir, host = os.hostname(), now = Date.now(), staleMs = DEFAULT_STALE_MS } = {}) {
  const folder = peersDir(dir);
  let names;
  try {
    names = fs.readdirSync(folder).filter((name) => name.endsWith('.json'));
  } catch (e) {
    if (e.code === 'ENOENT') return 0;
    throw e;
  }
  const live = new Set(listShared({ dir, host, now, staleMs }).map((entry) => entry.file));
  let removed = 0;
  for (const name of names) {
    const file = path.join(folder, name);
    if (live.has(file)) continue;
    try {
      fs.unlinkSync(file);
      removed++;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return removed;
}

module.exports = {
  acquire,
  heartbeat,
  release,
  inspect,
  lockPath,
  joinShared,
  heartbeatShared,
  leaveShared,
  listShared,
  pruneShared,
  peersDir,
  FILE,
  PEERS_DIR,
  DEFAULT_STALE_MS,
};
