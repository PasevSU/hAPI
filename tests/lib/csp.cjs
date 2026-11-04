'use strict';
// ТЕСТЕР ЗА ПОЛИТИКАТА (CSP) — защо съществува:
//
// Тестовете на панела вървят в `vm` + DOM без браузър, тоест БЕЗ Content-Security-Policy.
// Затова заявка към чужд произход минаваше в теста и се проваляше едва при човека:
//
//   files-manager.js:2781 Connecting to 'https://pasev.asuscomm.com/api/v1/p/newportal2c'
//   violates the following Content-Security-Policy directive: "connect-src 'self'".
//
// Тук политиката се НАЛАГА върху `fetch` така, както го прави браузърът: заявка извън
// произхода на документа се записва като нарушение и се ОТКАЗВА с грешка от типа, който
// страницата вижда. Така същият дефект се хваща от теста, а не от човека.
//
// Политиката не се измисля: `tests/gui-csp-guard.cjs` сравнява стойността по подразбиране
// с ИСТИНСКИЯ заглавка, която add-on-ът изпраща за `/ui/index.html`.
const DEFAULT_CONNECT_SRC = ["'self'"];

/** Стойността на дадена директива от заглавка `Content-Security-Policy`. */
function directive(header, name) {
  const parts = String(header || '').split(';').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const [key, ...values] = part.split(/\s+/);
    if (key.toLowerCase() === String(name).toLowerCase()) return values;
  }
  return null;
}

/** `connect-src` от заглавката — или `null`, когато липсва. */
function connectSrcOf(header) {
  return directive(header, 'connect-src');
}

/** Същият произход ли е адресът (празен/относителен/blob/data са „същият“)? */
function isSameOrigin(url, origin) {
  const raw = String(url == null ? '' : url);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return true; // относителен → произходът на документа
  let u;
  try {
    u = new URL(raw);
  } catch {
    return true;
  }
  if (u.protocol === 'blob:' || u.protocol === 'data:' || u.protocol === 'about:') return true;
  return u.origin === origin;
}

/**
 * Обвивка около `fetch`, която налага `connect-src`.
 * Връща `{ wrapFetch, violations }`; нарушенията се трупат, за да ги провери тестът.
 */
function createCspGuard({ origin, connectSrc = DEFAULT_CONNECT_SRC, label = "connect-src" } = {}) {
  const violations = [];
  const allowed = Array.isArray(connectSrc) ? connectSrc : DEFAULT_CONNECT_SRC;
  const wrapFetch = (inner) => (url, init) => {
    if (allowed.includes("'self'") && !isSameOrigin(url, origin)) {
      const href = (() => { try { return new URL(String(url)).href } catch { return String(url) } })();
      violations.push({ url: href, origin, directive: label + " 'self'", at: new Date().toISOString() });
      const error = new TypeError(
        "Refused to connect to '" + href + "' because it violates the following Content " +
        'Security Policy directive: "' + label + " 'self'\".",
      );
      error.csp = true;
      return Promise.reject(error);
    }
    return inner(url, init);
  };
  return { wrapFetch, violations, allowed };
}

module.exports = { createCspGuard, connectSrcOf, directive, isSameOrigin, DEFAULT_CONNECT_SRC };
