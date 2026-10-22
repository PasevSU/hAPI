'use strict';
// ЕДНИ И СЪЩИ ДАННИ — ОТ РАЗЛИЧНИ ПРОЦЕСИ (многослоен цикъл върху един източник на истина).
//
// Досега `server.js` пазеше `db` в паметта си и го записваше с `metadataStore.save(db)`.
// Това е вярно само докато има ЕДИН процес. Втори процес върху същата data директория
// (втори контейнер, CLI инструмент, възстановяване от архив, тестов процес) четеше своята
// снимка от старта и после я записваше отгоре — тоест чуждата промяна се губеше, без нито
// една грешка. „Зелено“ и „вярно“ не са едно и също.
//
// Този слой затваря цикъла:
//   • `sync()`   — преди всяка заявка: една подготвена заявка `SELECT revision`; ако ревизията
//                  в SQLite е друга, снимката се презарежда. Така ВСЯКА функция вижда
//                  текущите данни, а не тези от старта на процеса.
//   • `data()`   — същото, но връща ЦЕЛИЯ набор данни (не отрязък), за да има достъп до
//                  всичко всеки, който го поиска: `topics`, `tags`, `directory`, `portals`…
//   • `keys()`   — имената на всички слоеве в данните (за проверка, че нищо не е отрязано).
//   • `transaction(fn)` — запис ПОД МЕЖДУПРОЦЕСНА КЛЮЧАЛКА: взима ключалката на данните,
//                  чете ПРЯСНО състояние под нея, дава ЖИВИЯ обект на `fn` и записва.
//                  Докато ключалката е наша, никой друг процес не пише — значи няма нужда от
//                  сливане на чужди промени и няма как да се загуби нечий запис.
//                  Ключалката е папка с `owner.json`; мъртва или застояла се поема принудително.
//   • `onChange(cb)` — абонати, които трябва да разберат, че снимката е сменена (кешове).
//
// Инварианти:
//   1. `bind(payload, revision)` се вика при ВСЯКА смяна на съдържанието, но обектът НЕ се
//      подменя — съдържанието му се привежда на място (`reconcile`). Затова препратките,
//      които кодът пази (`const p = db.portals.find(...)`), остават валидни.
//   2. Записът е само през `transaction`; директният `store.save(data)` остава за
//      възстановяване от архив, където безусловното презаписване е целта.
//   3. Многослойният цикъл е сериен: всички процеси пишат един след друг, не едновременно.
//      Изчакването на ключалката е ограничено (по подразбиране 15 s) и след това е ясна
//      грешка `503 STORE_LOCKED`, а не безкрайно чакане.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_LOCK_TIMEOUT_MS = 15000;
const DEFAULT_STALE_LOCK_MS = 30000;
const DEFAULT_POLL_MS = 5;
// Колко пъти се повтаря транзакция, която е получила CAS отказ (STORE_CONFLICT).
const CONFLICT_RETRIES = 3;

const clone = (value) => structuredClone(value);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Списък, който може да се разпознава по `id`. ПРАЗНИЯТ списък също е такъв (вакуумно).
const keyedList = (list) => Array.isArray(list) && list.every((item) => isPlainObject(item) && typeof item.id === 'string');
const byId = (list) => new Map(list.map((item) => [item.id, item]));

/**
 * Обновяване НА МЯСТО: съдържанието на `live` става като `next`, но обектът остава СЪЩИЯ.
 *
 * Защо не просто „смени снимката“: кодът в сървъра пази препратки (`const p = db.portals.find(...)`)
 * и после пише в тях. Ако снимката се подмени с нов обект, тези препратки сочат откачен обект
 * и записът им се губи, без нито една грешка. Затова обектът на данните се създава веднъж и
 * само съдържанието му се привежда към новото състояние; елементите на списъците се разпознават
 * по `id` и се обновяват като СЪЩИТЕ обекти.
 */
function reconcile(live, next) {
  if (!live || !next || typeof live !== 'object' || typeof next !== 'object') return next;
  if (isPlainObject(live) && isPlainObject(next)) {
    for (const key of Object.keys(live)) if (!Object.hasOwn(next, key)) delete live[key];
    for (const key of Object.keys(next)) live[key] = Object.hasOwn(live, key) ? reconcile(live[key], next[key]) : clone(next[key]);
    return live;
  }
  if (Array.isArray(live) && Array.isArray(next) && keyedList(live) && keyedList(next)) {
    const nextById = byId(next);
    for (let i = live.length - 1; i >= 0; i--) if (!nextById.has(live[i].id)) live.splice(i, 1);
    const liveById = byId(live);
    const ordered = next.map((item) => {
      const existing = liveById.get(item.id);
      if (existing) return reconcile(existing, item);
      return clone(item);
    });
    live.length = 0;
    for (const item of ordered) live.push(item);
    return live;
  }
  return next;
}

// ── Междупроцесна ключалка на записа ───────────────────────────────────────────
// ЕДИН файл с `owner.json` вътре (pid + host + време), създаден с O_EXCL (`flag: 'wx'`).
// Създаването е атомарно: или файлът е наш, или вече съществува — няма междинно състояние
// „папка без собственик“, което два процеса да приемат за изоставено (точно това състезание
// караше два процеса да пишат едновременно).
// Изоставена ключалка (мъртъв pid на същия host или запис, по-стар от `staleMs`) се поема,
// за да не блокира add-on-а след срив.
function ownerAlive(owner) {
  if (!owner || !Number.isInteger(Number(owner.pid)) || Number(owner.pid) <= 0) return false;
  if (String(owner.host || '') !== os.hostname()) return true; // друг host — решава времето
  try {
    process.kill(Number(owner.pid), 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function createLock(lockPath, { timeoutMs, staleMs, pollMs, sleep }) {
  // Ключалката се създава АТОМАРНО ЗАЕДНО СЪС СЪДЪРЖАНИЕТО СИ: собственикът се записва в
  // временен файл и се свързва към името на ключалката с hard link. `writeFileSync(..., 'wx')`
  // създава файла и ПОСЛЕ пише в него — между двете има прозорец, в който файлът е празен.
  // Друг процес го четеше, не можеше да го парсне, смяташе го за изоставен и го изтриваше;
  // след това двамата пишеха едновременно. На бърза машина прозорецът е невидим, на
  // натоварен CI се виждаше като „не всички 20 едновременни записа са приети“.
  const writeOwner = (payload) => {
    const tmp = lockPath + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
    fs.writeFileSync(tmp, payload, { flag: 'wx', mode: 0o600 });
    try {
      fs.linkSync(tmp, lockPath);
      return true;
    } catch (e) {
      if (e.code === 'EEXIST') return false;
      // Файлова система без hard links (част от SMB/exFAT): остава O_EXCL. Тогава
      // „нечетима, но прясна“ ключалка НЕ се смята за изоставена (виж acquire).
      try {
        fs.writeFileSync(lockPath, payload, { flag: 'wx', mode: 0o600 });
        return true;
      } catch (e2) {
        if (e2.code === 'EEXIST') return false;
        throw e2;
      }
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* временният файл вече не е нужен */ }
    }
  };
  // Възрастта се съди ПО mtime на файла, не по съдържанието: полузаписан или повреден файл
  // също има възраст и не бива да минава за „без собственик“ (това беше кражбата на ключалка).
  const read = () => {
    let mtime;
    try {
      mtime = fs.statSync(lockPath).mtimeMs;
    } catch (e) {
      if (e.code === 'ENOENT') return { owner: null, age: Infinity, gone: true };
      throw e;
    }
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { owner = null; }
    return { owner, age: Date.now() - mtime };
  };
  const drop = () => {
    try {
      fs.unlinkSync(lockPath);
      return true;
    } catch (e) {
      if (e.code === 'ENOENT') return true;
      throw e;
    }
  };
  async function acquire() {
    const startedAt = Date.now();
    const payload = JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString() });
    for (; ;) {
      if (writeOwner(payload)) return true;
      const seen = read();
      if (seen.gone) continue;
      const deadOwner = seen.owner ? !ownerAlive(seen.owner) : false;
      // „Изоставена“ значи СТАРА (или с мъртъв собственик). Прясна ключалка не се пипа,
      // дори когато съдържанието ѝ още не може да се прочете.
      const tooOld = seen.age > staleMs;
      if (deadOwner || tooOld) {
        drop();
        continue;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw Object.assign(new Error('Данните се пишат от друг процес и ключалката не се освободи за ' + Math.round(timeoutMs / 1000) + ' s. Опитай отново.'), { status: 503, code: 'STORE_LOCKED' });
      }
      await sleep(pollMs);
    }
  }
  function release() {
    const seen = read();
    if (seen.owner && Number(seen.owner.pid) !== process.pid) return false; // не пипаме чужда ключалка
    if (!seen.owner && !seen.gone) return false; // нечетима ключалка не е задължително наша
    return drop();
  }
  return { acquire, release, path: lockPath };
}

function create(options = {}) {
  const store = options.store;
  if (!store || typeof store.snapshot !== 'function' || typeof store.save !== 'function' || typeof store.revision !== 'function') {
    throw Error('shared-data: необходим е store с snapshot(), revision() и save()');
  }
  const bind = typeof options.bind === 'function' ? options.bind : null;
  const sleep = typeof options.sleep === 'function' ? options.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pollMs = Number(options.pollMs) || DEFAULT_POLL_MS;
  const lock = options.lockPath
    ? createLock(options.lockPath, {
      timeoutMs: Number(options.lockTimeoutMs) || DEFAULT_LOCK_TIMEOUT_MS,
      staleMs: Number(options.staleLockMs) || DEFAULT_STALE_LOCK_MS,
      pollMs,
      sleep,
    })
    : null;

  let current = null;
  let revision = -1;
  let queue = Promise.resolve();
  // Колко транзакции текат в момента. Докато тече дори една, `sync()` НЕ бива да подменя
  // работното копие: транзакцията пише в него, а подмяната по средата на `await fn()` би
  // оставила записа върху стара снимка (т.е. промяната тихо се губи).
  let active = 0;
  const subscribers = new Set();
  const stats = {
    process: process.pid,
    syncs: 0,
    refreshes: 0,
    transactions: 0,
    lockWaits: 0,
    lockTimeouts: 0,
    conflicts: 0,
    lastSyncAt: null,
    lastRefreshAt: null,
    lastLockWaitAt: null,
    startedAt: new Date().toISOString(),
  };

  // Публикува снимката: привежда ЖИВИЯ обект към новото състояние (без да го подменя),
  // казва на `bind` и уведомява абонатите. `reason` е `null` за „това е работното
  // състояние/връщане назад“, за да не се брои като презареждане.
  function publish(payload, nextRevision, reason) {
    if (current === null) current = payload;
    else if (current !== payload) reconcile(current, payload);
    revision = Number(nextRevision) || 0;
    if (bind) bind(current, revision);
    if (reason) {
      stats.refreshes++;
      stats.lastRefreshAt = new Date().toISOString();
      for (const listener of [...subscribers]) {
        try {
          listener(current, { revision, reason });
        } catch (e) {
          console.error('shared-data: абонатът гръмна при презареждане — ' + (e && e.message ? e.message : e));
        }
      }
    }
    return current;
  }

  function load(reason) {
    const snap = store.snapshot();
    return publish(snap.payload, snap.revision, reason);
  }

  // Преди всяка заявка: проверява само ревизията (евтина подготвена заявка) и презарежда
  // само ако някой друг процес е писал. Без четене на целия JSON при всеки отговор.
  function sync() {
    stats.syncs++;
    stats.lastSyncAt = new Date().toISOString();
    // В средата на наша собствена транзакция снимката е работното копие — не се пипа.
    if (active > 0) return current;
    const seen = Number(store.revision()) || 0;
    if (current === null || seen !== revision) return load('sync');
    return current;
  }

  /** Принудително презареждане (след възстановяване от архив или ръчна промяна). */
  function refresh() {
    return load('refresh');
  }

  /** Целият набор данни — за всяка функция, която има нужда от всичко, не от отрязък. */
  function data() {
    return sync();
  }

  /** Имената на всички слоеве в данните (портал, картотека, дела, променливи, настройки…). */
  function keys() {
    const payload = sync();
    return isPlainObject(payload) ? Object.keys(payload).sort() : [];
  }

  /** Текущата снимка БЕЗ проверка на ревизията (само за вътрешни изчисления). */
  function peek() {
    return current;
  }

  function state() {
    return { revision, lock: lock ? lock.path : 'in-process', ...stats, subscribers: subscribers.size };
  }

  /** Абонат за презареждане; връща функция за отписване. */
  function onChange(listener) {
    if (typeof listener !== 'function') throw Error('shared-data: onChange(listener) иска функция');
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  // Запис: `fn` работи върху ЖИВИЯ обект (за да работят запазените препратки). Целият запис
  // е под междупроцесна ключалка: чете се прясно състояние, прилага се намерението и се
  // записва. Докато ключалката е наша, никой друг процес не пише — затова няма сливане на
  // чужди промени и няма как да се загуби нечий запис.
  function transaction(fn) {
    if (typeof fn !== 'function') throw Error('shared-data: transaction(fn) иска функция');
    const run = queue.then(async () => {
      stats.transactions++;
      active++;
      let holding = false;
      try {
        if (lock) {
          holding = await lock.acquire();
          stats.lockWaits++;
          stats.lastLockWaitAt = new Date().toISOString();
        }
        // Прясно състояние ПОД ключалката, но САМО ако друг процес е писал след последната
        // ни синхронизация. Безусловното презареждане би изтрило и стойности по подразбиране,
        // които манипулаторите слагат на живия обект преди самата транзакция.
        //
        // CAS отказът на store (STORE_CONFLICT) не се очаква, докато ключалката е наша, но
        // може да дойде от процес, който пише, без да минава през този слой. Тогава отказът
        // НЕ се предава на клиента веднага: презарежда се прясното състояние и намерението
        // се повтаря — иначе запис, който никой не е загубил, изглежда като 409.
        for (let attempt = 0; ; attempt++) {
          if (current === null || (Number(store.revision()) || 0) !== revision) {
            const snap = store.snapshot();
            publish(snap.payload, snap.revision, null);
          }
          const base = clone(current);
          let result;
          try {
            result = await fn(current, { revision });
          } catch (e) {
            // Провалът на самата операция: връщаме състоянието отпреди нея (иначе
            // полунаправената промяна остава в паметта и следващото четене я вижда).
            publish(base, revision, null);
            throw e;
          }
          try {
            const nextRevision = store.save(current, revision);
            revision = nextRevision === undefined ? revision + 1 : Number(nextRevision);
            if (bind) bind(current, revision);
            return result;
          } catch (e) {
            publish(base, revision, null);
            if (!e || e.code !== 'STORE_CONFLICT' || attempt >= CONFLICT_RETRIES) throw e;
            stats.conflicts++;
            await sleep(pollMs);
          }
        }
      } catch (e) {
        if (e && e.code === 'STORE_LOCKED') stats.lockTimeouts++;
        throw e;
      } finally {
        if (holding && lock) lock.release();
        active--;
      }
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return { sync, refresh, data, keys, peek, state, onChange, transaction, clone, reconcile, lockPath: () => (lock ? lock.path : null) };
}

module.exports = { create, reconcile, DEFAULT_LOCK_TIMEOUT_MS, DEFAULT_STALE_LOCK_MS };
