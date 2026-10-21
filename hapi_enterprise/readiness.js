'use strict';
// Решение за readiness — чиста функция, без I/O.
//
// Отделено е от server.js, за да може всяко състояние (ok / degraded / failed) да се
// провери детерминирано в тест, вместо да се разчита на случайно повредена база.
// `checks` остава стабилен договор за probe-овете (boolean полета); детайлите за
// базата отиват в отделен обект `db`, за да не се чупят външни монитори.
//
//   storageOk  — записът в хранилището мина (реален probe файл)
//   metadata   — заредените метаданни (db) — трябва да е обект с масив `portals`
//   quickCheck — функция, връщаща {ok:boolean,result:string} (PRAGMA quick_check)
//
// Правило: ready само при записваемо хранилище И здрава база. Повредена база
// (degraded) връща 503 — по-добре probe-ът да спре трафика, отколкото да се пише
// върху повредени страници.
function evaluate({ storageOk = false, metadata = null, quickCheck = null } = {}) {
  let dbState = 'failed';
  let dbDetail = 'metadata unavailable';
  if (metadata && Array.isArray(metadata.portals)) {
    try {
      const quick =
        typeof quickCheck === 'function' ? quickCheck() : { ok: true, result: 'skipped' };
      dbState = quick && quick.ok ? 'ok' : 'degraded';
      dbDetail = String((quick && quick.result) || '');
    } catch (e) {
      dbState = 'degraded';
      dbDetail = e && e.message ? e.message : 'quick_check threw';
    }
  } else if (metadata) {
    dbState = 'degraded';
    dbDetail = 'metadata payload invalid';
  }
  const checks = { storage: Boolean(storageOk), db: dbState !== 'failed', rules: false };
  return {
    ready: Boolean(storageOk) && dbState === 'ok',
    dbState,
    dbDetail,
    checks,
  };
}

module.exports = { evaluate };
