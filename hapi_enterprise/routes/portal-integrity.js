'use strict';
// ПРОВЕРКИ НА ЦЯЛОСТТА НА ПОРТАЛА — HTTP договорът, изнесен от `server.js`.
//
//   GET  /admin/api/portals/{id}/integrity        — сверка на всички файлове (синхронно)
//   POST /admin/api/portals/{id}/integrity-jobs   — същата сверка като фонова задача (202)
//
// Защо е отделен модул: `server.js` има твърд таван на редовете, а тук проверката расте
// (следа в дневника при успех и при провал, време, брой). Логиката на самата сверка остава
// в `portal-integrity.js` и `verifyPortalFiles` на сървъра — компонентът само я обвива.
//
// Дневникът е част от договора: всяка проверка оставя `check.integrity` (или
// `check.integrity-job`), а провалът влиза и в централизирания журнал с причина. Без това
// резултатът се виждаше само в одита и проблемът не се ЗАСИЧАШЕ (вж. `check-log.js`).
function create(deps) {
  const { json, checks, verify, submitJob, audit } = deps;
  const { verdict } = require('../verify-verdict');
  // Имената идват от договора (`check-log.js`), за да не се разминава търсенето в журнала.
  const NAME_SYNC = (checks && checks.names && checks.names.integrity) || 'integrity';
  const NAME_JOB = (checks && checks.names && checks.names.integrityJob) || 'integrity-job';

  /** Обвивка на една сверка: следа, време и резултат по един начин за двата входа. */
  async function run(name, portal, work) {
    const startedAt = Date.now();
    checks.start(name, { portalId: portal.id });
    let out;
    try {
      out = await work();
    } catch (error) {
      checks.crash(name, error, { portalId: portal.id });
      throw error;
    }
    // Броят на проблемните файлове идва от ОБОБЩЕНИЕТО на сверката (VERIFIED/MISMATCH/…), не от
    // поле `failed`: то не съществува и точно затова провалът мълчеше (хванато от
    // `check-log-integration`). Присъдата се смята на едно място — `verify-verdict.js`.
    const judged = verdict(out && out.summary);
    const context = { portalId: portal.id, files: judged.verified, failed: judged.failed, ms: Date.now() - startedAt };
    if (!judged.ok) checks.fail(name, 'INTEGRITY_MISMATCH', context);
    else checks.ok(name, context);
    return out;
  }

  async function handle({ _req, res, parts, method, portal }) {
    if (!portal) return false;
    if (parts[4] === 'integrity' && parts.length === 5 && method === 'GET') {
      const out = await run(NAME_SYNC, portal, () =>
        verify(portal, { signal: new AbortController().signal, setTotal() { }, advance() { } }),
      );
      void audit('integrity.verify', { portalId: portal.id, summary: out.summary });
      // `verdict` пътува в отговора: панелът показва числата от СЪЩАТА присъда, а не ги смята
      // сам от ключове с главни букви (виж `verify-verdict.js`).
      json(res, 200, { ...out, verdict: verdict(out.summary) });
      return true;
    }
    // Фоновата задача връща 202 веднага; резултатът се вижда в `/admin/api/jobs/{id}`, а
    // следата в дневника се пише при завършването (в самия обработчик на задачата).
    if (parts[4] === 'integrity-jobs' && parts.length === 5 && method === 'POST') {
      const job = submitJob('integrity-scan', { portalId: portal.id });
      checks.start(NAME_JOB, { portalId: portal.id, jobId: job.id });
      json(res, 202, job);
      return true;
    }
    return false;
  }

  return { handle, run };
}

module.exports = { create };
