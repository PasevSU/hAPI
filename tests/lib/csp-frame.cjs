'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Оценител на `frame-ancestors` — правилото, по което БРАУЗЪРЪТ решава дали да
// покаже един документ в рамка.
//
// Защо съществува: дефектът от 0.69.40 мина през всички тестове, защото те
// проверяваха само „документът се връща 200“ и „ресурсите се зареждат“. Никой не
// проверяваше РЕШЕНИЕТО на браузъра: при `frame-ancestors 'none'` документът е
// валиден, ресурсите му са налични, а панелът е празен екран.
//
// Тук правилото се прилага, а не се търси като текст:
//   • `'none'` — нищо не се вгражда;
//   • `'self'` — само същият origin като защитавания документ;
//   • `*` — всеки мрежов origin;
//   • `https:` / `http:` — по схема;
//   • `host`, `*.host`, `host:port`, `scheme://host:port` — по origin (пътят се игнорира,
//     както в CSP3: `frame-ancestors` не сравнява пътища);
//   • няколко политики (повтаряща се заглавка) се налагат ЗАЕДНО — всички трябва да
//     разрешат, иначе браузърът блокира.
// ─────────────────────────────────────────────────────────────────────────────

const NETWORK = new Set(['http:', 'https:', 'ws:', 'wss:']);

function toUrl(value) {
  try {
    return new URL(String(value));
  } catch {
    return null;
  }
}

/** Порт по подразбиране за схемата (за сравнение на origin). */
function defaultPort(scheme) {
  return scheme === 'https:' || scheme === 'wss:' ? '443' : '80';
}

/** Нормализиран origin `scheme://host:port`; `null` за непрозрачен origin (data:, file:, blob:). */
function originOf(value) {
  const url = toUrl(value);
  if (!url) return null;
  if (!NETWORK.has(url.protocol)) return null;
  return url.protocol + '//' + url.hostname.toLowerCase() + ':' + (url.port || defaultPort(url.protocol));
}

/** Разделя заглавката на отделни политики (браузърът ги налага поотделно). */
function splitPolicies(headers) {
  const raw = Array.isArray(headers) ? headers : [headers];
  return raw
    .filter((h) => typeof h === 'string' && h.trim())
    .flatMap((h) => h.split(',').map((p) => p.trim()))
    .filter(Boolean);
}

/**
 * Извлича директивите на една политика.
 * @returns {{ enforce: boolean, sources: string[] }}
 */
function parsePolicy(policy) {
  const map = new Map();
  for (const part of String(policy).split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    map.set(tokens[0].toLowerCase(), tokens.slice(1));
  }
  // Директива без стойности = `frame-ancestors` с празен списък → нищо не се вгражда.
  if (!map.has('frame-ancestors')) return { enforce: false, sources: [] };
  return { enforce: true, sources: map.get('frame-ancestors') };
}

/** Съвпада ли един източник от списъка с адреса на родителската рамка? */
function sourceMatches(source, ancestorUrl, ancestorOrigin, selfOrigin) {
  const s = String(source).trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower === "'none'") return false;
  if (lower === "'self'") return selfOrigin !== null && ancestorOrigin === selfOrigin;
  if (s === '*') return ancestorOrigin !== null;

  // Схема-източник: `https:` (без host).
  if (/^[a-z][a-z0-9+.-]*:$/.test(lower)) return ancestorUrl.protocol === lower;

  // `'unsafe-inline'`, nonce/hash и подобни не важат за frame-ancestors → не съвпадат.
  if (lower.startsWith("'")) return false;

  // host-source: [scheme://]host[:port]  (пътят се игнорира)
  const withScheme = /^([a-z][a-z0-9+.-]*):\/\/([^/:]+)(?::(\d+|\*))?/i.exec(s);
  const withoutScheme = /^([^/:*]+|\*\.?[^/:]+)(?::(\d+|\*))?$/.exec(s);
  let scheme = null;
  let host = null;
  let port = null;
  if (withScheme) {
    scheme = withScheme[1].toLowerCase() + ':';
    host = withScheme[2].toLowerCase();
    port = withScheme[3] || null;
  } else if (withoutScheme) {
    host = withoutScheme[1].toLowerCase();
    port = withoutScheme[2] || null;
  } else {
    return false;
  }

  if (scheme && ancestorUrl.protocol !== scheme) return false;

  const ancestorHost = ancestorUrl.hostname.toLowerCase();
  if (host.startsWith('*.')) {
    const suffix = host.slice(1); // ".example.com"
    if (!ancestorHost.endsWith(suffix) || ancestorHost === suffix.slice(1)) return false;
  } else if (host !== '*') {
    if (ancestorHost !== host) return false;
  } else {
    // `*` като host значи „всеки host на тази схема“.
    return true;
  }

  if (port && port !== '*') {
    const ancestorPort = ancestorUrl.port || defaultPort(ancestorUrl.protocol);
    if (ancestorPort !== port) return false;
  }
  // Без порт в източника: иска се портът по подразбиране на схемата (CSP3).
  if (!port) {
    const ancestorPort = ancestorUrl.port || defaultPort(ancestorUrl.protocol);
    if (ancestorPort !== defaultPort(ancestorUrl.protocol)) return false;
  }
  return true;
}

/**
 * Решението на браузъра за един документ в една родителска рамка.
 *
 * @param {string|string[]|null|undefined} policies  стойност(и) на `Content-Security-Policy`
 * @param {string} ancestorUrl  адресът на родителския документ
 * @param {string} documentUrl  адресът на документа, който се вгражда
 * @returns {{ allowed: boolean, reason: string }}
 */
function frameAllowed(policies, ancestorUrl, documentUrl) {
  const ancestor = toUrl(ancestorUrl);
  const document = toUrl(documentUrl);
  if (!ancestor) return { allowed: false, reason: 'невалиден адрес на рамката' };
  if (!document) return { allowed: false, reason: 'невалиден адрес на документа' };

  const selfOrigin = originOf(documentUrl);
  const ancestorOrigin = originOf(ancestorUrl);
  const list = splitPolicies(policies);
  if (!list.length) return { allowed: true, reason: 'няма Content-Security-Policy — вграждането не е ограничено' };

  let reason = 'разрешено';
  for (const policy of list) {
    const { enforce, sources } = parsePolicy(policy);
    if (!enforce) continue;
    if (!sources.length) return { allowed: false, reason: 'frame-ancestors е празен — нищо не се вгражда' };
    const hit = sources.some((s) => sourceMatches(s, ancestor, ancestorOrigin, selfOrigin));
    if (!hit) {
      return { allowed: false, reason: `frame-ancestors не покрива ${ancestorOrigin || 'непрозрачен origin'} (${sources.join(' ')})` };
    }
    reason = 'разрешено от frame-ancestors';
  }
  return { allowed: true, reason };
}

/** Извлича стойностите на `frame-ancestors` за отчет (без оценка). */
function frameSources(policies) {
  const out = [];
  for (const policy of splitPolicies(policies)) {
    const { enforce, sources } = parsePolicy(policy);
    if (enforce) out.push(sources.join(' ') || '(празен)');
  }
  return out;
}

module.exports = { frameAllowed, frameSources, parsePolicy, originOf, sourceMatches, splitPolicies };
