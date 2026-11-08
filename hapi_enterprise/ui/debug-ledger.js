'use strict';
// ДЕБЪГ ПРОТОКОЛ: записва ВСЯКА находка на дебъгинг системата заедно с ПРИЧИНАТА и
// РЕШЕНИЕТО, което вече е известно за нея.
//
// Защо съществува: `debug-objects.js` прилага законите и казва „това е нарушено“, но не
// помни нищо. При второ сканиране същата находка изглежда нова, а човекът, който я вижда
// за пръв път, пак трябва да търси как се поправя. Затова тук има един списък РЕШЕНИЯ
// (закон → причина → какво се прави → кой тест го пази) и един протокол: находките се
// записват по СТАБИЛЕН подпис (`закон@вид`), повтарящата се находка вдига брояч, а не
// отваря нов ред. Затварянето става с `resolve(подпис, бележка)`.
//
// Какво НЕ прави: не решава нищо автоматично, не праща нищо по мрежата и не пише на
// сървъра — протоколът е на панела (`localStorage`), за да стигне до доклад за дефект с
// едно копиране (`toJSON()`). Текстът на решенията е в речника (`i18n.js`), не тук, защото
// това е интерфейсен текст на три езика (DEF-49).
(function () {
  var STORAGE_KEY = 'hapi.debug.ledger';
  // Таванът пази панела: протоколът не бива да расте безкрайно от повтарящи се сканирания.
  var LIMIT = 200;

  // Решение за ВСЕКИ закон на дебъгинг системата. `guard` е тестът, който би паднал, ако
  // законът спре да хваща нарушението; `null` значи „такова нарушение не се пази отделно“ и
  // се вижда в протокола като липса, а не като тихо „наред“.
  var SOLUTIONS = {
    'spacing-grid': {
      cause: 'dbg.fix.spacing-grid.cause',
      fix: 'dbg.fix.spacing-grid.fix',
      guard: 'tests/ui-spacing.cjs',
    },
    symmetry: {
      cause: 'dbg.fix.symmetry.cause',
      fix: 'dbg.fix.symmetry.fix',
      guard: 'tests/ui-spacing.cjs',
    },
    named: {
      cause: 'dbg.fix.named.cause',
      fix: 'dbg.fix.named.fix',
      guard: 'tests/ui-field-labels.cjs',
    },
    'touch-target': {
      cause: 'dbg.fix.touch-target.cause',
      fix: 'dbg.fix.touch-target.fix',
      guard: 'tests/debug-ledger.cjs',
    },
    'no-inline-layout': {
      cause: 'dbg.fix.no-inline-layout.cause',
      fix: 'dbg.fix.no-inline-layout.fix',
      guard: 'tests/gui-debug-objects.cjs',
    },
    'one-qr': {
      cause: 'dbg.fix.one-qr.cause',
      fix: 'dbg.fix.one-qr.fix',
      guard: 'tests/debug-ledger.cjs',
    },
  };

  function t(key) {
    var dict = window.HapiI18n;
    if (dict && typeof dict.t === 'function') return dict.t(key);
    // Без речник ключът се вижда като ключ — по-добре от измислен текст на един език.
    return String(key);
  }

  /** Стабилният подпис на находка: същият закон при същия вид обект е СЪЩИЯТ проблем. */
  function signature(law, kind) {
    return String(law || '?') + '@' + String(kind || '?');
  }

  function solutionOf(law) {
    var s = SOLUTIONS[law];
    if (!s) return { cause: 'dbg.ledger.noSolution', fix: 'dbg.ledger.noSolution', guard: null };
    return { cause: t(s.cause), fix: t(s.fix), guard: s.guard };
  }

  function storage() {
    try {
      var ls = window.localStorage;
      if (ls && typeof ls.getItem === 'function') return ls;
    } catch {
      /* приватен режим или липсващ localStorage — протоколът остава в паметта */
    }
    return null;
  }

  var memory = [];

  function readAll() {
    var ls = storage();
    if (!ls) return memory.slice();
    try {
      var raw = ls.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(function (e) { return e && e.signature; }) : [];
    } catch {
      return [];
    }
  }

  function writeAll(entries) {
    var kept = entries.slice(-LIMIT);
    var ls = storage();
    if (!ls) { memory = kept; return kept; }
    try {
      ls.setItem(STORAGE_KEY, JSON.stringify(kept));
    } catch {
      memory = kept;
    }
    return kept;
  }

  /**
   * Записва находките от резултата на `HapiDebugObjects.scan()`.
   * Повтарящ се подпис НЕ отваря нов ред: вдига `count`, обновява `lastAt` и `detail`.
   * Връща `{ added, repeated }` — двете числа, които отчетът показва.
   */
  function open(result) {
    var violations = (result && result.violations) || [];
    var entries = readAll();
    var byKey = {};
    entries.forEach(function (e) { byKey[e.signature] = e; });
    var added = 0;
    var repeated = 0;
    var at = (result && result.at) || new Date().toISOString();
    violations.forEach(function (v) {
      var sig = signature(v.law, v.kind);
      var known = byKey[sig];
      if (known) {
        known.count = Number(known.count || 1) + 1;
        known.lastAt = at;
        known.detail = v.detail;
        known.object = v.object;
        if (known.status === 'resolved') {
          // Решено, но пак се появи: това е регресия, не нова находка.
          known.status = 'open';
          known.reopened = Number(known.reopened || 0) + 1;
        }
        repeated += 1;
        return;
      }
      var fresh = {
        signature: sig,
        law: String(v.law || ''),
        kind: String(v.kind || ''),
        object: String(v.object || ''),
        detail: String(v.detail || ''),
        remedy: solutionOf(v.law),
        status: 'open',
        count: 1,
        firstAt: at,
        lastAt: at,
      };
      entries.push(fresh);
      byKey[sig] = fresh;
      added += 1;
    });
    writeAll(entries);
    return { added: added, repeated: repeated };
  }

  function setStatus(sig, status, note) {
    var entries = readAll();
    var hit = null;
    entries.forEach(function (e) {
      if (e.signature !== sig) return;
      e.status = status;
      e.note = String(note || '').slice(0, 500);
      e[status === 'resolved' ? 'resolvedAt' : 'reopenedAt'] = new Date().toISOString();
      hit = e;
    });
    if (hit) writeAll(entries);
    return hit;
  }

  function resolve(sig, note) {
    return setStatus(sig, 'resolved', note);
  }

  function reopen(sig, note) {
    return setStatus(sig, 'open', note);
  }

  function list(filter) {
    var want = filter && filter.status;
    return readAll().filter(function (e) { return !want || e.status === want; });
  }

  function stats() {
    var entries = readAll();
    var out = { total: entries.length, open: 0, resolved: 0, recurring: 0, regressed: 0, byLaw: {} };
    entries.forEach(function (e) {
      if (e.status === 'resolved') out.resolved += 1;
      else out.open += 1;
      if (Number(e.count || 1) > 1) out.recurring += 1;
      if (Number(e.reopened || 0) > 0) out.regressed += 1;
      out.byLaw[e.law] = (out.byLaw[e.law] || 0) + 1;
    });
    return out;
  }

  function statsText(s) {
    var st = s || stats();
    return st.total + ' · ' + t('dbg.ledger.open') + ' ' + st.open + ' · ' + t('dbg.ledger.resolved') + ' ' + st.resolved + ' · ' + t('dbg.ledger.recurring') + ' ' + st.recurring;
  }

  /**
   * Редовете на протокола — един източник за конзолата и за екрана.
   * Всяка находка носи причина, решение и теста, който я пази: това е смисълът на протокола.
   */
  function reportLines(filter) {
    var entries = list(filter);
    if (!entries.length) return [t('dbg.ledger.empty')];
    var lines = [t('dbg.ledger.title') + ': ' + statsText()];
    entries.forEach(function (e) {
      lines.push((e.status === 'resolved' ? '✔ ' : '✘ ') + e.signature + ' ' + e.object + ' — ' + e.detail + (Number(e.count || 1) > 1 ? ' (×' + e.count + ')' : ''));
      lines.push('  ' + t('dbg.ledger.cause') + ': ' + (e.remedy && e.remedy.cause));
      lines.push('  ' + t('dbg.ledger.fix') + ': ' + (e.remedy && e.remedy.fix));
      lines.push('  ' + t('dbg.ledger.guard') + ': ' + ((e.remedy && e.remedy.guard) || t('dbg.ledger.noGuard')));
    });
    return lines;
  }

  function reportText(filter) {
    return reportLines(filter).join('\n');
  }

  /** Готов за прикачане към доклад за дефект: съдържанието на протокола, не обвивка. */
  function toJSON() {
    return { at: new Date().toISOString(), stats: stats(), entries: readAll() };
  }

  function reset() {
    writeAll([]);
    memory = [];
    return true;
  }

  window.HapiDebugLedger = {
    STORAGE_KEY: STORAGE_KEY,
    LIMIT: LIMIT,
    SOLUTIONS: SOLUTIONS,
    signature: signature,
    solutionOf: solutionOf,
    open: open,
    resolve: resolve,
    reopen: reopen,
    list: list,
    stats: stats,
    statsText: statsText,
    reportLines: reportLines,
    reportText: reportText,
    toJSON: toJSON,
    reset: reset,
  };
})();
