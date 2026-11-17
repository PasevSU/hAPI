'use strict';
// ГЛОБАЛНО МАРКИРАНЕ НА ФАЙЛОВЕ (ADR-0028, D8).
//
// Защо е отделен обект: „кое е маркирано“ се ползва от три места (отчет за избраните, ZIP,
// прехвърляне) и дотук всяко панелно парче държеше свой масив — тоест три истини за едно и
// също нещо. Тук има ЕДИН списък, а панелите се абонират за промяната (`onChange`).
//
// Правилата, които обектът налага:
//   • ключът е низът, с който панелът адресира файла (за дървото — относителният път), а
//     стойността е свободен обект (`{ path, name, fileId }`), за да не знае слоят за екрана;
//   • `list()` връща КОПИЕ — никой не може да пипа вътрешния ред;
//   • `onChange` връща функция за отписване, а грешка в абонат не спира останалите;
//   • обектът не пипа DOM и не вика сървър: тества се без браузър.
(function (root) {
  const items = new Map();
  const listeners = new Set();

  const snapshot = () => Array.from(items.values()).map((item) => ({ ...item }));

  function emit() {
    const list = snapshot();
    for (const fn of Array.from(listeners)) {
      try {
        fn(list);
      } catch {
        /* абонатът не бива да чупи маркирането */
      }
    }
  }

  function add(key, item) {
    const k = String(key == null ? '' : key);
    if (!k) return false;
    const next = { key: k, ...(item && typeof item === 'object' ? item : {}) };
    items.set(k, next);
    emit();
    return true;
  }

  function remove(key) {
    if (!items.delete(String(key == null ? '' : key))) return false;
    emit();
    return true;
  }

  function has(key) {
    return items.has(String(key == null ? '' : key));
  }

  /** Маркира/отмаркира; връща новото състояние (`true` = маркиран). */
  function toggle(key, item) {
    if (has(key)) {
      remove(key);
      return false;
    }
    add(key, item);
    return true;
  }

  function clear() {
    if (!items.size) return 0;
    const n = items.size;
    items.clear();
    emit();
    return n;
  }

  /** Подменя целия набор (напр. „маркирай всичко в папката“) с ЕДНО съобщение. */
  function replace(entries) {
    items.clear();
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry) continue;
      const key = String(entry.key == null ? entry.path || '' : entry.key);
      if (key) items.set(key, { ...entry, key });
    }
    emit();
    return items.size;
  }

  const API = {
    add,
    remove,
    has,
    toggle,
    clear,
    replace,
    list: snapshot,
    count: () => items.size,
    keys: () => Array.from(items.keys()),
    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  if (root && typeof root === 'object') root.HapiSelection = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
