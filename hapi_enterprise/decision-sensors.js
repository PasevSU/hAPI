'use strict';
// От измерване към РЕШЕНИЕ: кой компонент, какъв проблем, от кога и какво да проверим.
//
// Защо съществува: `/admin/api/sensors` (observer.js + visitor-intel.js) дава числа —
// заявки, p95, откази, размер на базата. Числото само по себе си не казва какво да
// направим, а „0 грешки“ не значи „здраво“: при 4 заявки процентът е шум, не сигнал.
// Затова праговете и правилата живеят ТУК, а не в интерфейса или в интеграцията —
// един източник за панела, за Home Assistant и за API-то.
//
// Три правила, които модулът нарочно налага:
//   • Текущо срещу историческо: щом има предишно измерване, процентите се смятат от
//     РАЗЛИКАТА (прозорец), а не от натрупаните от старта броячи. Иначе стара грешка
//     изглежда като нов инцидент, а поправеният проблем „виси“ вечно.
//   • Праг И продължителност: предупреждението става `active` само след като сигналът
//     се задържи `sustainMs`. Досега е `pending` — вижда се, но не вдига статуса.
//   • Конкретно действие: всеки сигнал носи `component`, `measured`, `action`, за да
//     може човекът (или автоматизацията) да знае какво да провери, не само че „има проблем“.
//
// Модулът е чист: не чете файлове, не вика мрежа и не пази тайни. Състоянието между
// извикванията е само baseline за прозореца и брояч за „задържа ли се“.
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

// Праговете са НАЧАЛНИ и са тук, за да могат да се проверяват и обясняват. Всяко число
// има мерна единица в `measured.unit`, за да не се сравнява ябълка с круша.
const THRESHOLDS = {
  minSamples: 30, // под това процентът е шум → `insufficient_samples`
  minDownloadSamples: 20,
  http5xxWarn: 0.01,
  http5xxCritical: 0.05,
  latencyP95WarnMs: 2000,
  latencyP95CriticalMs: 5000,
  downloadDenialWarn: 0.2,
  databaseWarnBytes: GIB,
  databaseCriticalBytes: 5 * GIB,
  telemetryWarnBytes: 256 * MIB,
  mirrorAnyFailure: 1,
  sustainMs: 60_000, // колко трябва да се задържи, преди да вдигне статуса
};

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const rate = (part, total) => (total > 0 ? part / total : 0);
const round = (value, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const SEVERITY_RANK = { ok: 0, info: 1, warning: 2, critical: 3 };

// Действията са написани като „провери X в Y“, а не като „има проблем“: те се показват
// в Home Assistant като стойност на сензор, значи трябва да са кратки и изпълними.
const ACTIONS = {
  http_5xx: 'Провери проблемните маршрути и последните грешки (GET /admin/api/errors)',
  http_latency: 'Провери бавните маршрути (routes в /admin/api/sensors) и натоварването (GET /admin/api/load)',
  mirror_failures: 'Провери второто хранилище (storage_mirror): права за запис и SHA-256 сверката',
  download_denials: 'Провери правата на файловете (ключове, политика) и отказаните достъпи в сензорите',
  database_size: 'Провери размера на базата и направи backup, после retention (GET /admin/api/retention)',
  telemetry_size: 'Провери retention на телеметрията и одитния дневник',
  insufficient_samples: 'Събирай измервания: под прага за статистически смисъл няма какво да се заключи',
};

/**
 * Един сигнал: стойност, праг, откога и какво да се направи.
 * `basis` казва върху какво е смятан процентът — `window` (последните N секунди) или
 * `cumulative` (от старта на процеса). Това е разликата между „нов инцидент“ и
 * „стара следа“, затова се показва, вместо да се премълчава.
 */
function signal({ id, severity, component, value, unit, threshold, basis, reason, active, sinceMs }) {
  return {
    id,
    severity,
    component,
    measured: { value, unit, threshold, basis },
    reason,
    action: ACTIONS[id] || '',
    active: Boolean(active),
    pendingMs: active ? 0 : Math.max(0, Math.round(sinceMs || 0)),
  };
}

function create({ thresholds = {}, now = () => Date.now() } = {}) {
  const limits = { ...THRESHOLDS, ...thresholds };
  // Състояние между извикванията: предишно измерване (за прозореца) и откога всеки
  // сигнал е видим (за „праг И продължителност“).
  let previous = null;
  const seen = new Map();

  /**
   * Оценява една снимка на измерванията.
   * `facts` е това, което add-on-ът наистина знае:
   *   http: { total, byStatus: { '5xx' }, latencyMs: { p95, count } },
   *   downloads: { ok, denied }, files: { mirrorFailed },
   *   databaseBytes, telemetryBytes
   * Липсващо поле е `0`/`null`, не измислена стойност.
   */
  function evaluate(facts = {}) {
    const at = now();
    const http = facts.http || {};
    const latency = http.latencyMs || {};
    const downloads = facts.downloads || {};
    const files = facts.files || {};
    const totalRequests = num(http.total);
    const errors5xx = num((http.byStatus || {})['5xx']);
    const okDownloads = num(downloads.ok);
    const deniedDownloads = num(downloads.denied);
    const mirrorFailed = num(files.mirrorFailed);

    // Прозорец: разликата спрямо предишното извикване. Първото извикване няма база за
    // сравнение — тогава се смята натрупаното и се отбелязва честно (`cumulative`).
    const window = previous
      ? {
        seconds: Math.max(1, Math.round((at - previous.at) / 1000)),
        requests: Math.max(0, totalRequests - previous.requests),
        errors: Math.max(0, errors5xx - previous.errors),
        downloadsOk: Math.max(0, okDownloads - previous.okDownloads),
        downloadsDenied: Math.max(0, deniedDownloads - previous.downloadsDenied),
        mirrorFailures: Math.max(0, mirrorFailed - previous.mirrorFailed),
      }
      : null;
    const basis = window && window.requests >= limits.minSamples ? 'window' : 'cumulative';

    const requests = basis === 'window' ? window.requests : totalRequests;
    const errors = basis === 'window' ? window.errors : errors5xx;
    const errorRate = rate(errors, requests);
    const downloadSamples = basis === 'window'
      ? window.downloadsOk + window.downloadsDenied
      : okDownloads + deniedDownloads;
    const denialRate = rate(
      basis === 'window' ? window.downloadsDenied : deniedDownloads,
      downloadSamples,
    );
    const p95 = num(latency.p95);
    const latencySamples = num(latency.count);
    const dbBytes = facts.databaseBytes === null || facts.databaseBytes === undefined
      ? null
      : num(facts.databaseBytes);
    const telemetryBytes = facts.telemetryBytes === null || facts.telemetryBytes === undefined
      ? null
      : num(facts.telemetryBytes);
    // Огледалото е БРОЯЧ на събития: важно е дали е имало нови откази в прозореца,
    // а натрупаните се показват отделно, за да не изчезне стар проблем безследно.
    const mirrorRecent = basis === 'window' ? window.mirrorFailures : mirrorFailed;

    const signals = [];
    const add = (id, severity, component, value, unit, threshold, reason, condition) => {
      if (!condition) {
        seen.delete(id);
        return;
      }
      const previousSeen = seen.get(id);
      const since = previousSeen && previousSeen.severity === severity ? previousSeen.since : at;
      seen.set(id, { since, severity });
      // Критичното не чака: то е за „вече чупи“. Предупреждението изчаква `sustainMs`,
      // за да не плаши при един бавн отговор или един отказ.
      const active = severity === 'critical' || at - since >= limits.sustainMs;
      signals.push(signal({
        id, severity, component, value, unit, threshold, basis, reason, active, sinceMs: at - since,
      }));
    };

    add(
      'http_5xx',
      errorRate >= limits.http5xxCritical ? 'critical' : 'warning',
      'http',
      round(errorRate * 100, 2),
      '%',
      `${round(limits.http5xxWarn * 100, 1)}% / ${round(limits.http5xxCritical * 100, 1)}%`,
      `${errors} от ${requests} заявки са с грешка 5xx (${basis === 'window' ? 'прозорец' : 'от старта'})`,
      requests >= limits.minSamples && errorRate >= limits.http5xxWarn,
    );
    add(
      'http_latency',
      p95 >= limits.latencyP95CriticalMs ? 'critical' : 'warning',
      'http',
      Math.round(p95),
      'ms',
      `${limits.latencyP95WarnMs} ms / ${limits.latencyP95CriticalMs} ms`,
      `p95 на последните ${latencySamples} заявки е ${Math.round(p95)} ms`,
      latencySamples >= limits.minSamples && p95 >= limits.latencyP95WarnMs,
    );
    add(
      'mirror_failures',
      'critical',
      'storage',
      mirrorRecent,
      'бр.',
      `${limits.mirrorAnyFailure} в прозореца`,
      mirrorRecent > 0
        ? `${mirrorRecent} неуспешни записа в огледалото (общо ${mirrorFailed} от старта)`
        : '',
      mirrorRecent >= limits.mirrorAnyFailure,
    );
    add(
      'download_denials',
      denialRate >= limits.downloadDenialWarn * 2 ? 'critical' : 'warning',
      'downloads',
      round(denialRate * 100, 2),
      '%',
      `${round(limits.downloadDenialWarn * 100, 1)}% / ${round(limits.downloadDenialWarn * 200, 1)}%`,
      `${basis === 'window' ? window.downloadsDenied : deniedDownloads} отказа от ${downloadSamples} изтегляния`,
      downloadSamples >= limits.minDownloadSamples && denialRate >= limits.downloadDenialWarn,
    );
    add(
      'database_size',
      dbBytes !== null && dbBytes >= limits.databaseCriticalBytes ? 'critical' : 'warning',
      'database',
      dbBytes === null ? null : Math.round(dbBytes / MIB),
      'MiB',
      `${Math.round(limits.databaseWarnBytes / MIB)} MiB / ${Math.round(limits.databaseCriticalBytes / MIB)} MiB`,
      dbBytes === null ? 'размерът на базата не е известен' : `базата е ${Math.round(dbBytes / MIB)} MiB`,
      dbBytes !== null && dbBytes >= limits.databaseWarnBytes,
    );
    add(
      'telemetry_size',
      'warning',
      'storage',
      telemetryBytes === null ? null : Math.round(telemetryBytes / MIB),
      'MiB',
      `${Math.round(limits.telemetryWarnBytes / MIB)} MiB`,
      telemetryBytes === null ? 'размерът на телеметрията не е известен' : `телеметрията е ${Math.round(telemetryBytes / MIB)} MiB`,
      telemetryBytes !== null && telemetryBytes >= limits.telemetryWarnBytes,
    );

    // „Няма достатъчно измервания“ не е здраве, а липса на знание: показва се като
    // информационен сигнал, за да не се приема „0 грешки“ за доказателство.
    if (totalRequests < limits.minSamples) {
      signals.push(signal({
        id: 'insufficient_samples',
        severity: 'info',
        component: 'http',
        value: totalRequests,
        unit: 'бр.',
        threshold: `${limits.minSamples} заявки`,
        basis: 'cumulative',
        reason: `само ${totalRequests} заявки: процентът за грешки е шум, не измерване`,
        active: false,
      }));
    }

    // Статусът е най-тежкият АКТИВЕН сигнал; `pending` изчаква продължителност.
    const activeSignals = signals.filter((item) => item.active);
    const status = activeSignals.reduce(
      (worst, item) => (SEVERITY_RANK[item.severity] > SEVERITY_RANK[worst] ? item.severity : worst),
      'ok',
    );
    const worst = activeSignals
      .slice()
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0] || null;

    previous = {
      at,
      requests: totalRequests,
      errors: errors5xx,
      okDownloads,
      downloadsDenied: deniedDownloads,
      mirrorFailed,
    };

    return {
      status: totalRequests < limits.minSamples && !worst ? 'unknown' : status,
      evaluatedAt: new Date(at).toISOString(),
      basis,
      minSamples: limits.minSamples,
      sustainMs: limits.sustainMs,
      window,
      signals,
      // Точно едно нещо за показване в Home Assistant: най-важната проверка сега.
      recommended: worst
        ? { id: worst.id, severity: worst.severity, component: worst.component, reason: worst.reason, action: worst.action, measured: worst.measured }
        : null,
      // Компактни стойности за отделните HA сензори — без повторно смятане отвън.
      checks: {
        http_error_rate: round(errorRate * 100, 2),
        latency_p95: Math.round(p95),
        download_denial_rate: round(denialRate * 100, 2),
        mirror_problem: mirrorRecent >= limits.mirrorAnyFailure,
        database_bytes: dbBytes,
        telemetry_bytes: telemetryBytes,
      },
    };
  }

  return { evaluate, thresholds: limits };
}

module.exports = { create, THRESHOLDS, ACTIONS };
