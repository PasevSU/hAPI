'use strict';
// Регистър на панелите (план 18 §7: „панел като модул“ — `render/mount/unmount/permissions/capabilities`
// на едно място).
//
// ЗАЩО СЪЩЕСТВУВА
// Днес панелите са глобални обекти, а `app.js` ги вика с верига от `if`-ове. Две последствия:
//   1. `unmount` се викаше САМО за таблото. Всеки друг панел, който отвори слушател или поток,
//      оставаше монтиран след напускане — точно класата теч, който беше намерен при живите
//      събития (`live-stream-lifecycle`).
//   2. Няма къде да се каже кои способности иска панелът — ролята на потребителя се проверява
//      чак в заявките, а панел, който не му е позволен, все пак се показва.
//
// КАК РАБОТИ (и защо е ленив)
// `app.js` се зарежда ПРЕДИ панелните модули в `index.html`, тоест по време на регистрацията
// глобалните обекти още ги няма. Затова регистърът помни ИМЕ на глобалния обект и го търси в
// момента на монтиране. Регистрацията не пипа `window`.
//
// Чист JS (UMD) — работи в браузъра и в тестовете; `scope` е вход, за да не се разчита на
// `window` в Node.
(function () {
  const METHOD = /^[A-Za-z_$][\w$]*$/;
  const ID = /^[a-z][a-z0-9_-]{0,31}$/;

  function create(scope) {
    const root = scope || (typeof globalThis !== 'undefined' ? globalThis : null);
    const order = [];
    const byId = new Map();
    let active = null;

    function fail(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    }

    /**
     * Регистрира панел. `mount` е или функция, или име на глобален обект
     * (`global: 'HapiDashboardPanel'`), в който се вика `method` (по подразбиране `mount`).
     * Вторият вид е нужен заради реда на зареждане: по време на регистрацията обектът още
     * не съществува.
     */
    function register(def) {
      if (!def || typeof def !== 'object') throw fail('INVALID_PANEL', 'Панелът трябва да е обект');
      const id = String(def.id || '');
      if (!ID.test(id)) throw fail('INVALID_PANEL_ID', 'id трябва да е [a-z][a-z0-9_-]{0,31}, получено: ' + id);
      if (byId.has(id)) throw fail('DUPLICATE_PANEL', 'Панел „' + id + '“ вече е регистриран');
      const mounts = [];
      if (typeof def.mount === 'function') {
        mounts.push({ fn: def.mount });
      } else if (def.global) {
        const list = Array.isArray(def.global) ? def.global : [def.global];
        const method = String(def.method || 'mount');
        if (!METHOD.test(method)) throw fail('INVALID_PANEL_METHOD', 'Невалиден метод: ' + method);
        for (const name of list) {
          if (!METHOD.test(String(name))) throw fail('INVALID_PANEL_GLOBAL', 'Невалидно име на глобален обект: ' + name);
          mounts.push({ global: String(name), method });
        }
      } else {
        throw fail('INVALID_PANEL', 'Панел „' + id + '“ няма нито `mount`, нито `global`');
      }
      const entry = {
        id,
        title: String(def.title || id),
        capabilities: Array.isArray(def.capabilities) ? def.capabilities.map(String) : [],
        mounts,
        unmount: typeof def.unmount === 'function' ? def.unmount : null,
      };
      byId.set(id, entry);
      order.push(id);
      return { id: entry.id, title: entry.title, capabilities: entry.capabilities.slice() };
    }

    function registerAll(list) {
      const out = [];
      for (const def of Array.isArray(list) ? list : []) out.push(register(def));
      return out;
    }

    /** Живият панел за id — търси се в момента на монтиране, не при регистрация. */
    function resolve(id) {
      const entry = byId.get(id);
      if (!entry || !root) return null;
      for (const target of entry.mounts) {
        if (target.global) {
          const host = root[target.global];
          if (host && typeof host[target.method] === 'function') return { host, method: target.method };
          continue;
        }
        return { host: null, method: 'mount', fn: target.fn };
      }
      return null;
    }

    function has(id) {
      return byId.has(String(id));
    }

    function available(id) {
      return Boolean(resolve(id));
    }

    function list() {
      return order.map((id) => {
        const entry = byId.get(id);
        return {
          id,
          title: entry.title,
          capabilities: entry.capabilities.slice(),
          available: available(id),
          hasUnmount: Boolean(entry.unmount || (resolve(id) && resolve(id).host && typeof resolve(id).host.unmount === 'function')),
        };
      });
    }

    /**
     * Монтира панела в `host`. Връща `false`, когато панелът не е наличен — викащият решава
     * какво да покаже, вместо да получи празен екран без обяснение.
     */
    function mount(id, host, ctx) {
      const entry = byId.get(String(id));
      const target = resolve(id);
      if (!entry || !target) return false;
      try {
        if (target.fn) target.fn(host, ctx);
        else target.host[target.method](host, ctx);
      } catch (error) {
        // Счупен панел не бива да оставя `active` да сочи към него.
        active = null;
        throw error;
      }
      active = String(id);
      return true;
    }

    /**
     * Освобождава ресурсите на панела. Извиква се и когато панелът НЕ е бил активен —
     * `unmount` трябва да е идемпотентен, защото навигацията не помни кой какво е отворил.
     * Грешка в един панел не спира останалите.
     */
    function unmount(id) {
      const entry = byId.get(String(id));
      if (!entry) return false;
      let called = false;
      try {
        if (entry.unmount) {
          entry.unmount();
          called = true;
        } else {
          const target = resolve(id);
          const host = target && (target.host || null);
          if (host && typeof host.unmount === 'function') {
            host.unmount();
            called = true;
          }
        }
      } catch {
        // Освобождаването не бива да чупи навигацията — но и не се премълчава, че не е станало.
        called = false;
      }
      if (active === String(id)) active = null;
      return called;
    }

    function unmountAll() {
      let called = 0;
      for (const id of order) if (unmount(id)) called += 1;
      active = null;
      return called;
    }

    function activeId() {
      return active;
    }

    return { register, registerAll, get: (id) => byId.get(String(id)) || null, resolve, has, available, list, mount, unmount, unmountAll, activeId };
  }

  const API = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof globalThis !== 'undefined') globalThis.HapiPanelRegistry = API;
})();
