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
//   • `transaction(fn)` — сравнение-и-размяна: чете прясна снимка, дава РАБОТНО копие на
//                  `fn`, записва САМО ако ревизията не е мръднала. При конфликт (друг процес
//                  е писал) повтаря с нова снимка вместо да презапише чуждото.
//   • `onChange(cb)` — абонати, които трябва да разберат, че снимката е сменена (кешове).
//
// Инварианти:
//   1. `bind(payload, revision)` се вика при ВСЯКА смяна на снимката — така `db` в сървъра
//      винаги сочи към това, което е в базата, а не към копие отпреди чуждия запис.
//   2. Записът е само през `transaction`; директният `store.save(data)` остава за
//      възстановяване от архив, където безусловното презаписване е целта.
//   3. Конфликтът не е грешка за потребителя: той се слива и записът се повтаря. Изчерпването
//      на опитите е `503 STORE_CONFLICT` с точен брой опити, за да не изглежда като счупен
//      сървър.
//   4. По време на транзакция `sync()` не подменя снимката: иначе `await fn()` би продължил
//      върху вече откачен обект и промяната тихо би се загубила.

const DEFAULT_RETRY = 12;
const DEFAULT_BASE_DELAY_MS = 4;
const DEFAULT_MAX_DELAY_MS = 120;

const clone = (value) => structuredClone(value);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Дълбоко равенство на JSON стойности (редът на ключовете не значи нищо). */
function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (!a || !b || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
    return true;
  }
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const key of keysA) if (!Object.hasOwn(b, key) || !equal(a[key], b[key])) return false;
  return true;
}

const keyedList = (list) => Array.isArray(list) && list.length > 0 && list.every((item) => isPlainObject(item) && typeof item.id === 'string');
const byId = (list) => new Map(list.map((item) => [item.id, item]));

// Сливане на списъци по идентификатор: добавеното от нас отива при тях, изтритото от нас
// остава изтрито, а общото се слива поле по поле. Без идентификатори не гадаем — печели
// нашето намерение (това е изрично документирано, а не случайно).
function mergeLists(base, ours, theirs) {
  if (!keyedList(base) || !keyedList(ours) || !keyedList(theirs)) return ours;
  const before = byId(base);
  const mine = byId(ours);
  const other = byId(theirs);
  const out = [];
  for (const item of theirs) {
    if (!mine.has(item.id)) {
      if (!before.has(item.id)) out.push(item);
      continue;
    }
    if (!before.has(item.id)) {
      out.push(mine.get(item.id));
      continue;
    }
    out.push(merge(before.get(item.id), mine.get(item.id), item));
  }
  for (const item of ours) if (!before.has(item.id) && !other.has(item.id)) out.push(item);
  return out;
}

/**
 * Тристранно сливане: `base` — какво сме прочели, `ours` — какво сме направили,
 * `theirs` — какво е на диска сега. Връща новото състояние.
 */
function merge(base, ours, theirs) {
  if (equal(ours, base)) return theirs;
  if (equal(theirs, base)) return ours;
  if (isPlainObject(ours) && isPlainObject(theirs) && isPlainObject(base)) {
    const out = { ...theirs };
    for (const key of Object.keys(ours)) {
      if (!Object.hasOwn(base, key)) out[key] = ours[key];
      else out[key] = merge(base[key], ours[key], Object.hasOwn(theirs, key) ? theirs[key] : undefined);
    }
    for (const key of Object.keys(base)) {
      // Изтрито от нас: не се връща, дори другият да го е променил.
      if (!Object.hasOwn(ours, key) && Object.hasOwn(theirs, key)) delete out[key];
    }
    return out;
  }
  if (Array.isArray(ours) && Array.isArray(theirs) && Array.isArray(base)) return mergeLists(base, ours, theirs);
  return ours;
}

function create(options = {}) {
  const store = options.store;
  if (!store || typeof store.snapshot !== 'function' || typeof store.save !== 'function' || typeof store.revision !== 'function') {
    throw Error('shared-data: необходим е store с snapshot(), revision() и save()');
  }
  const bind = typeof options.bind === 'function' ? options.bind : null;
  const retry = Math.max(1, Number(options.retry) || DEFAULT_RETRY);
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs) === 0 ? 0 : Number(options.baseDelayMs) || DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, Number(options.maxDelayMs) || DEFAULT_MAX_DELAY_MS);
  const sleep = typeof options.sleep === 'function' ? options.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    conflicts: 0,
    merges: 0,
    retries: 0,
    lastSyncAt: null,
    lastRefreshAt: null,
    lastConflictAt: null,
    startedAt: new Date().toISOString(),
  };

  // Публикува снимката: подменя я, казва на `bind` и уведомява абонатите. `reason` е
  // `null` за „това е работно копие/връщане назад“, за да не се брои като презареждане.
  function publish(payload, nextRevision, reason) {
    current = payload;
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
    return { revision, ...stats, subscribers: subscribers.size };
  }

  /** Абонат за презареждане; връща функция за отписване. */
  function onChange(listener) {
    if (typeof listener !== 'function') throw Error('shared-data: onChange(listener) иска функция');
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  function giveUp(attempts) {
    return Object.assign(
      new Error('Данните се променят от друг процес непрекъснато — прекратих след ' + attempts + ' опита. Опитай отново.'),
      { status: 503, code: 'STORE_CONFLICT', attempts },
    );
  }

  // Запис: `fn` работи върху ЖИВИЯ обект (за да работят запазените препратки), записът е
  // сравнение-и-размяна. При конфликт (друг процес е писал) нашият замисъл се слива с
  // неговото състояние и записът се повтаря — без повторно изпълнение на `fn`, за да не се
  // удвоят файловите ефекти.
  function transaction(fn) {
    if (typeof fn !== 'function') throw Error('shared-data: transaction(fn) иска функция');
    const run = queue.then(async () => {
      stats.transactions++;
      active++;
      try {
        // Прясно състояние само ако друг процес е писал след последната ни синхронизация.
        if (current === null) load(null);
        else if ((Number(store.revision()) || 0) !== revision) load('sync');
        const base = clone(current);
        let live = current;
        let attempt = 1;
        let result;
        try {
          result = await fn(live, { revision, attempt });
        } catch (e) {
          // Провалът на самата операция НЕ е конфликт: връщаме състоянието отпреди нея
          // (иначе полунаправената промяна остава в паметта и следващото четене я вижда).
          publish(base, revision, null);
          throw e;
        }
        for (; ;) {
          try {
            const nextRevision = store.save(live, revision);
            revision = nextRevision === undefined ? revision + 1 : Number(nextRevision);
            if (bind) bind(live, revision);
            return result;
          } catch (e) {
            if (!e || e.code !== 'STORE_CONFLICT') {
              publish(base, revision, null);
              throw e;
            }
            stats.conflicts++;
            stats.lastConflictAt = new Date().toISOString();
            if (attempt >= retry) {
              publish(base, revision, null);
              throw giveUp(attempt);
            }
            attempt++;
            stats.retries++;
            // Тристранно сливане: нашето намерение (base → live) върху тяхното състояние.
            const fresh = store.snapshot();
            live = merge(base, live, fresh.payload);
            stats.merges++;
            publish(live, fresh.revision, null);
            const wait = Math.min(maxDelayMs, baseDelayMs * attempt + Math.floor(Math.random() * baseDelayMs));
            await sleep(wait);
          }
        }
      } finally {
        active--;
      }
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return { sync, refresh, data, keys, peek, state, onChange, transaction, merge, clone, equal };
}

module.exports = { create, merge, equal, DEFAULT_RETRY, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_DELAY_MS };
