'use strict';
// ДНЕВНИК НА ПРОВЕРКИТЕ — един вход за „проверих и ето какво излезе“.
//
// Защо съществува: проверките в панела (цялост на файловете, фонова проверка, издаване на
// токен, QR архив/възстановяване/прекратяване) записваха РЕШЕНИЕТО в одита, но не и в
// дневника. Последицата е видима при разследване: одитът казва „integrity.verify с обобщение“,
// а в `GET /admin/api/logs` и в error-log няма нито един ред за самата проверка — тоест
// проблемът се вижда само ако някой ръчно сравни обобщението, а не се ЗАСИЧА.
//
// Договорът е тесен и нарочно без състояние:
//   • `start` — проверката започва (info, за да се види в хронологията);
//   • `ok`    — мина (info, с измереното: брой, байтове, време);
//   • `fail`  — НЕ мина (warn + запис в централизирания error-log, с причина);
//   • `crash` — самата проверка се счупи (error + error-log) — това не е „проблем във файловете“,
//               а дефект, който иначе изчезва в 500-ица без следа.
//
// Имената са `check.<име>`, за да се търсят на едно място (`source=check.integrity` в
// `GET /admin/api/errors`). Нищо тук не хвърля: счупен дневник не бива да събаря проверката.
//
// Списъкът е ЗАТВОРЕН: име извън `NAMES` не влиза в дневника, за да не се разминат панелът,
// документацията и кодът (търсенето по `source=` иначе мълчи). Ново име → ред тук.
const NAMES = Object.freeze({
  integrity: 'integrity',
  integrityJob: 'integrity-job',
  token: 'token',
  qr: 'qr',
  config: 'config',
  key: 'key',
});
const KNOWN = new Set(Object.values(NAMES));

function create(deps) {
  const opts = deps || {};
  const log = opts.log || null;
  const errorLog = opts.errorLog || null;

  const emit = (level, name, ctx) => {
    try {
      // Непознато име се подменя със `unknown`, вместо да пропадне безследно: така записът
      // съществува и се вижда, че някой е подал име извън договора.
      const safe = KNOWN.has(name) ? name : 'unknown';
      if (log && typeof log[level] === 'function') log[level]('check.' + safe, { ns: 'check', ...ctx });
    } catch {
      /* дневникът не бива да чупи пътя на заявката */
    }
  };
  // Централизираният журнал пази само проблемите: той има таван на редовете и се чете от
  // конзолата за грешки, затова успешните проверки не влизат в него.
  // `last` пази последния запис, за да може `flush()` да го дочака (тест, спиране на add-on-а).
  let last = Promise.resolve();
  const journal = (level, name, message, ctx) => {
    try {
      const safe = KNOWN.has(name) ? name : 'unknown';
      if (errorLog && typeof errorLog.append === 'function') {
        // `append` може да върне обещание: `flush()` го дочаква, за да не изчезне записът при
        // спиране на add-on-а. Провалът на самия запис не се вдига нагоре — журналът е
        // наблюдаемост, а не част от пътя на заявката.
        last = Promise.resolve(errorLog.append(level, 'check.' + safe, String(message || 'failed'), ctx || {})).catch(() => {});
      }
    } catch {
      /* същото: журналът е наблюдаемост, не част от логиката */
    }
  };

  return {
    start(name, ctx) {
      emit('info', name, { event: 'start', ...(ctx || {}) });
    },
    ok(name, ctx) {
      emit('info', name, { event: 'ok', ...(ctx || {}) });
    },
    fail(name, reason, ctx) {
      const detail = { event: 'fail', reason: String(reason || 'failed'), ...(ctx || {}) };
      emit('warn', name, detail);
      journal('warn', name, detail.reason, ctx);
    },
    crash(name, error, ctx) {
      const message = (error && error.message) || 'check crashed';
      emit('error', name, { event: 'crash', err: message, code: error && error.code, ...(ctx || {}) });
      journal('error', name, message, ctx);
    },
    /** Изчаква последния запис в журнала (за тестове и за подредено спиране). */
    flush() {
      return last;
    },
    /** Имената от договора — за тестове и за документацията. */
    names: NAMES,
  };
}

module.exports = {
  create,
  NAMES,
};
