'use strict';
// ДЕБЪГ ИНСТРУМЕНТ: автоматично разпознаване на обектите в панела и прилагане на
// законите на дизайн системата върху тях.
//
// Защо съществува: дотук всяка проверка на оформлението беше отделен тест, който гледа
// изходния код („има ли `var(--sp-3)` в този блок“). Това пази договора, но не казва НИЩО
// за ЖИВИЯ екран: кой обект какъв е, от какво е направен и кой закон е нарушил. Затова тук
// има два централизирани списъка — ОБЕКТИ (как се разпознава един обект) и ЗАКОНИ (какво
// трябва да е вярно за него) — и един `scan()`, който ги прилага върху DOM-а.
//
// Включва се САМО в дебъгинг: `window.HAPI_DEBUG = true`, `?debug=1` в адреса или
// `localStorage['hapi.debug'] = '1'`. В нормална сесия модулът не прави нищо (без сканиране,
// без заявки, без глобални слушатели), за да не тежи на панела.
//
// Не измисля числа: законът за отстоянията чете РЕШЕНИТЕ стойности (`getComputedStyle`), а
// когато ги няма (напр. в тестов DOM) — инлайн стила; липсващата стойност се ПРЕСКАЧА, а не
// се брои за нарушение. Така „0 нарушения“ значи „няма нарушение по това, което е измерено“.
(function () {
  // ── Обекти: подредбата е от по-специфично към по-общо ──────────────────────
  // Първото съвпадение печели, затова иконата-бутон и чекбоксът стоят преди „контрола“.
  var OBJECTS = [
    { kind: 'icon-button', select: '.fm-ico-btn', role: 'икона-бутон' },
    { kind: 'checkbox', select: 'input[type="checkbox"]', role: 'избор' },
    { kind: 'field-control', select: 'input, select, textarea', role: 'поле за въвеждане' },
    { kind: 'control', select: 'button, a[href], [role="button"]', role: 'контрола' },
    { kind: 'card', select: '.fm-file, .pf-portal', role: 'карта' },
    { kind: 'block', select: '.pf-block', role: 'блок на портал' },
    { kind: 'field', select: '.field', role: 'поле от форма' },
    { kind: 'table', select: 'table', role: 'таблица' },
    { kind: 'chip', select: '.chip, .state-chip, .badge', role: 'табелка' },
    { kind: 'panel', select: 'section.panel, .panel', role: 'контейнер' },
  ];

  // ── Закони: един списък за целия интерфейс ────────────────────────────────
  // Всеки закон казва ЗА КОИ обекти важи (`kinds`) и връща `null` (наред) или текст с
  // причината. Текстът влиза в отчета такъв, какъвто е — без „моля проверете“.
  var SPACING = [
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'row-gap', 'column-gap',
  ];
  var PX = /^(-?\d+(?:\.\d+)?)px$/;

  function px(value) {
    var m = PX.exec(String(value == null ? '' : value).trim());
    return m ? Number(m[1]) : null;
  }

  function spacingOf(el) {
    var out = {};
    var computed = null;
    try {
      computed = window.getComputedStyle ? window.getComputedStyle(el) : null;
    } catch {
      computed = null;
    }
    SPACING.forEach(function (prop) {
      var value = '';
      if (computed && computed.getPropertyValue) value = computed.getPropertyValue(prop);
      if (!String(value || '').trim()) {
        var camel = prop.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
        value = (el.style && el.style[camel]) || '';
      }
      out[prop] = String(value || '').trim();
    });
    return out;
  }

  function boxOf(el) {
    if (!el.getBoundingClientRect) return null;
    try {
      var box = el.getBoundingClientRect();
      if (!box || (!box.width && !box.height)) return null;
      return { width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10 };
    } catch {
      return null;
    }
  }

  function nameOf(el) {
    var aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria && String(aria).trim()) return String(aria).trim();
    var title = el.getAttribute && el.getAttribute('title');
    if (title && String(title).trim()) return String(title).trim();
    var text = String(el.textContent == null ? '' : el.textContent).replace(/\s+/g, ' ').trim();
    if (text) return text;
    var label = el.getAttribute && el.getAttribute('placeholder');
    return label && String(label).trim() ? String(label).trim() : '';
  }

  function describe(el) {
    if (el.id) return '#' + el.id;
    var attrs = ['data-file-listed', 'data-file-lock', 'data-pick', 'data-act', 'data-section', 'data-panel'];
    for (var i = 0; i < attrs.length; i += 1) {
      var value = el.getAttribute && el.getAttribute(attrs[i]);
      if (value) return attrs[i] + '=' + value;
    }
    var togs = String((el.className && el.className.baseVal) || el.className || '').split(/\s+/).filter(Boolean);
    return el.tagName.toLowerCase() + (togs.length ? '.' + togs.slice(0, 2).join('.') : '');
  }

  var LAWS = [
    {
      id: 'spacing-grid',
      title: 'отстоянията са на 2px решетката (--sp-*)',
      kinds: ['panel', 'block', 'card', 'field', 'control', 'icon-button', 'field-control', 'chip'],
      check: function (o) {
        var bad = [];
        SPACING.forEach(function (prop) {
          var n = px(o.spacing[prop]);
          if (n === null) return; // не е измерено → не е нарушение
          if (Math.abs(n % 2) > 0.01) bad.push(prop + ': ' + o.spacing[prop]);
        });
        return bad.length ? bad.join(' · ') : null;
      },
    },
    {
      id: 'symmetry',
      title: 'контейнерът е симетричен: ляво = дясно, горе = долу',
      kinds: ['panel', 'block', 'card'],
      check: function (o) {
        var s = o.spacing;
        var left = px(s['padding-left']);
        var right = px(s['padding-right']);
        var top = px(s['padding-top']);
        var bottom = px(s['padding-bottom']);
        var bad = [];
        if (left !== null && right !== null && Math.abs(left - right) > 0.5) bad.push('ляво ' + s['padding-left'] + ' ≠ дясно ' + s['padding-right']);
        if (top !== null && bottom !== null && Math.abs(top - bottom) > 0.5) bad.push('горе ' + s['padding-top'] + ' ≠ долу ' + s['padding-bottom']);
        return bad.length ? bad.join(' · ') : null;
      },
    },
    {
      id: 'named',
      title: 'всяка контрола има име за екранен четец',
      kinds: ['control', 'icon-button', 'field-control', 'checkbox'],
      check: function (o) {
        if (nameOf(o.el)) return null;
        if (o.el.getAttribute && o.el.getAttribute('aria-hidden') === 'true') return null;
        return 'без текст, aria-label, title или placeholder';
      },
    },
    {
      id: 'touch-target',
      title: 'контролата е поне 20px висока',
      kinds: ['control', 'icon-button'],
      check: function (o) {
        if (!o.box) return null; // без размери (тестов DOM) → не се съди
        return o.box.height < 20 ? 'височина ' + o.box.height + 'px' : null;
      },
    },
    {
      id: 'no-inline-layout',
      title: 'оформлението не се задава на място (инлайн стил)',
      kinds: ['panel', 'block', 'card', 'field'],
      check: function (o) {
        var style = o.el.style || {};
        // Проверяват се и късите, и дългите имена: `style.padding = '3px'` и
        // `style.paddingTop = '3px'` са едно и също нещо, но в DOM обекта се виждат различно.
        var keys = ['padding', 'margin', 'gap', 'width', 'height', 'display',
          'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
          'marginTop', 'marginRight', 'marginBottom', 'marginLeft'];
        var bad = keys.filter(function (key) { return style[key]; });
        return bad.length ? 'инлайн: ' + bad.join(', ') : null;
      },
    },
    {
      id: 'one-qr',
      title: 'QR кодът е един — този на портала (без собствени кодове по файлове)',
      kinds: ['panel', 'block', 'card'],
      check: function (o) {
        var svg = o.el.querySelectorAll ? o.el.querySelectorAll('svg.qf-svg, .qf-svg') : [];
        var insidePortal = o.el.closest ? o.el.closest('[data-block="access"]') : null;
        if (svg.length && !insidePortal) return svg.length + ' QR кода извън блока „Достъп и QR код“';
        return null;
      },
    },
  ];

  function isDebug() {
    try {
      if (window.HAPI_DEBUG === true) return true;
      if (window.localStorage && window.localStorage.getItem('hapi.debug') === '1') return true;
      var search = String((window.location && window.location.search) || '');
      return /(?:^|[?&])debug=1(?:&|$)/.test(search);
    } catch {
      return window.HAPI_DEBUG === true;
    }
  }

  /** Разпознава обектите в `root` и прилага всички закони, които важат за тях. */
  function scan(root) {
    var scope = root || (window.document && window.document.body);
    var objects = [];
    var violations = [];
    if (!scope || !scope.querySelectorAll) return { at: new Date().toISOString(), objects: objects, violations: violations, summary: { byKind: {}, byLaw: {} } };

    var selector = OBJECTS.map(function (o) { return o.select; }).join(', ');
    var nodes = scope.querySelectorAll(selector);
    Array.prototype.forEach.call(nodes, function (el) {
      var rule = null;
      for (var i = 0; i < OBJECTS.length; i += 1) {
        var candidate = OBJECTS[i];
        if (el.matches && el.matches(candidate.select)) { rule = candidate; break; }
      }
      if (!rule) return;
      var object = {
        kind: rule.kind,
        role: rule.role,
        el: el,
        id: describe(el),
        spacing: spacingOf(el),
        box: boxOf(el),
      };
      objects.push(object);
      LAWS.forEach(function (law) {
        if (law.kinds.indexOf(rule.kind) === -1) return;
        var detail;
        try {
          detail = law.check(object);
        } catch (e) {
          detail = 'законът не може да се приложи: ' + (e && e.message ? e.message : e);
        }
        if (!detail) return;
        violations.push({ law: law.id, title: law.title, kind: rule.kind, object: object.id, detail: detail });
      });
    });

    var byKind = {};
    objects.forEach(function (o) { byKind[o.kind] = (byKind[o.kind] || 0) + 1; });
    var byLaw = {};
    violations.forEach(function (v) { byLaw[v.law] = (byLaw[v.law] || 0) + 1; });
    return { at: new Date().toISOString(), objects: objects, violations: violations, summary: { byKind: byKind, byLaw: byLaw } };
  }

  /** Отчет в конзолата — редовете са готови за копиране в доклад за дефект. */
  function report(result) {
    var r = result || scan();
    var lines = ['HapiDebugObjects: ' + r.objects.length + ' обекта · ' + r.violations.length + ' нарушения'];
    Object.keys(r.summary.byKind).sort().forEach(function (kind) {
      lines.push('  обект ' + kind + ': ' + r.summary.byKind[kind]);
    });
    Object.keys(r.summary.byLaw).sort().forEach(function (law) {
      lines.push('  закон ' + law + ': ' + r.summary.byLaw[law]);
    });
    r.violations.forEach(function (v) {
      lines.push('  ✘ ' + v.law + ' · ' + v.kind + ' ' + v.object + ' — ' + v.detail);
    });
    if (window.console && window.console.log) lines.forEach(function (line) { window.console.log(line); });
    return r;
  }

  function enable() {
    if (!isDebug()) return null;
    return report();
  }

  var api = { isDebug: isDebug, scan: scan, report: report, enable: enable, OBJECTS: OBJECTS, LAWS: LAWS };
  window.HapiDebugObjects = api;

  // Автоматично при включен дебъгинг: след като панелът е нарисуван, но без да чака
  // потребителя да отвори конзолата.
  if (isDebug()) {
    var run = function () { report(); };
    if (window.document && window.document.readyState === 'loading' && window.document.addEventListener) {
      window.document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      run();
    }
  }
})();
