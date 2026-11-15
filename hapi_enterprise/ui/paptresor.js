'use strict';
// Paptresor — печатен отчет за ПРИЛАГАНЕ на QR кода на портал (A4 плакат или лист с етикети).
//
// Защо отделен модул, а не код в `settings-panel.js`:
//   • отчетът е ЧИСТА функция (вход → HTML низ), затова се проверява без браузър
//     (`tests/paptresor.cjs`): марка, адрес, обяснение, рекламни блокове, осем етикета;
//   • панелът само подава избрания портал, QR картинката и текстовете от полетата.
//
// Граници на отговорността:
//   • НЕ тегли нищо: без `<script>`, без външни адреси и без `url(...)` — листът се
//     разпечатва и на машина без интернет, и се отваря от диск;
//   • НЕ строи QR кода сам: картинката идва от `qrcode.js` (`createSvgTag`) и се
//     заменя с текста „липсва“, ако я няма — отчетът пак носи адреса и е верен;
//   • оформлението е в `ui/components.css` (`.pt-*`), не в низа: екранът и печатът
//     ползват едни и същи правила, а CSP-то не се разширява.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HapiPaptresor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BRAND = 'Paptresor';
  const LAYOUTS = ['poster', 'labels'];
  const LABELS_PER_SHEET = 8;

  // Модулът върви и в браузъра (глобалният речник), и като `require` в тестовете — затова
  // речникът се взима оттам, където е: `window.HapiI18n` или `./i18n.js`.
  const dictionary = () => {
    if (typeof window !== 'undefined' && window.HapiI18n) return window.HapiI18n;
    try {
      return typeof require === 'function' ? require('./i18n.js') : null;
    } catch {
      return null;
    }
  };
  const P = (key, vars) => {
    const d = dictionary();
    if (!d) return String(key);
    const lang = typeof d.getLang === 'function' ? d.getLang() : 'bg';
    const raw = d.DICT[lang] && d.DICT[lang][key] !== undefined ? d.DICT[lang][key] : d.DICT.bg[key];
    const text = raw === undefined ? String(key) : raw;
    if (!vars) return text;
    return String(text).replace(/\{(\w+)\}/g, (all, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : all,
    );
  };

  // Стойностите по подразбиране са ТЕКСТ, който човек може да смени в панела. Затова
  // всяко поле от отчета идва оттук, а не е зашито в шаблона — и то от речника
  // (BG/EN/DE), за да не се строи български лист на чужд език.
  const DEFAULTS = {
    get title() {
      return P('pt.def.title');
    },
    get explanation() {
      return P('pt.def.explanation');
    },
    get ads() {
      return [
        { title: P('pt.def.ad1.title'), text: P('pt.def.ad1.text') },
        { title: P('pt.def.ad2.title'), text: P('pt.def.ad2.text') },
        { title: P('pt.def.ad3.title'), text: P('pt.def.ad3.text') },
      ];
    },
    get steps() {
      return [P('pt.def.step1'), P('pt.def.step2'), P('pt.def.step3')];
    },
    get fields() {
      return [P('pt.def.field1'), P('pt.def.field2'), P('pt.def.field3'), P('pt.def.field4')];
    },
  };

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const text = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

  /** Многоредов текст → абзаци. Празен ред разделя, самотен нов ред е същият абзац. */
  function paragraphs(value, fallback) {
    const raw = String(value == null || text(value) === '' ? fallback || '' : value);
    return raw
      .split(/\n{2,}/)
      .map((block) => block.split('\n').map(text).filter(Boolean).join(' '))
      .filter(Boolean);
  }

  /** Рекламните блокове: празните се изхвърлят, таванът е три — повече не се събират на A4. */
  function adsOf(value) {
    const list = Array.isArray(value) ? value : DEFAULTS.ads;
    return list
      .map((ad) => ({ title: text(ad && ad.title), text: text(ad && ad.text) }))
      .filter((ad) => ad.title || ad.text)
      .slice(0, 3);
  }

  /** До какво води кодът — човешкото име на достъпа, без вътрешни кодове в печата. */
  function accessText(portal) {
    const raw = text(portal && (portal.access || portal.visibility));
    if (!raw) return '—';
    const known = {
      public: P('pt.access.public'),
      private: P('pt.access.private'),
      unlisted: P('pt.access.hidden'),
      hidden: P('pt.access.hidden'),
      free: P('pt.access.public'),
      key_required: P('pt.access.key'),
    };
    return known[raw.toLowerCase()] || raw;
  }

  function portalData(value) {
    const p = value || {};
    const files = Array.isArray(p.files) ? p.files.length : Number(p.files) || 0;
    return {
      title: text(p.title) || P('pt.noName'),
      id: text(p.id),
      slug: text(p.slug),
      link: text(p.link),
      access: accessText(p),
      files,
    };
  }

  /**
   * QR картинката се приема САМО като `<svg …>` без скрипт: тя идва от `qrcode.js`, но
   * отчетът се строи от низ, който после влиза в `innerHTML` — затова формата се проверява.
   */
  function qrMarkup(svg) {
    const clean = String(svg == null ? '' : svg).trim();
    if (/^<svg[\s>]/i.test(clean) && !/<script/i.test(clean)) return clean;
    return `<div class="pt-qr-empty">${esc(P('pt.qrMissing'))}</div>`;
  }

  function metaRows(portal) {
    const row = (label, value) => '<tr><th>' + esc(label) + '</th><td>' + value + '</td></tr>';
    const code = (v) => (v ? '<code>' + esc(v) + '</code>' : '—');
    return '<table class="pt-table"><tbody>' +
      row(P('pt.meta.portal'), esc(portal.title)) +
      row(P('pt.meta.url'), code(portal.link)) +
      row(P('pt.meta.id'), code(portal.id)) +
      row(P('pt.meta.slug'), code(portal.slug)) +
      row(P('pt.meta.access'), esc(portal.access)) +
      row(P('pt.meta.files'), esc(String(portal.files))) +
      '</tbody></table>';
  }

  function noteBlock(lines) {
    if (!lines.length) return '';
    return '<section class="pt-note"><h3>' + esc(P('pt.note')) + '</h3>' +
      lines.map((line) => '<p>' + esc(line) + '</p>').join('') +
      '</section>';
  }

  function fieldLines(fields) {
    const list = (Array.isArray(fields) && fields.length ? fields : DEFAULTS.fields).map(text).filter(Boolean);
    return '<section class="pt-fill"><h3>' + esc(P('pt.fields')) + '</h3><div class="pt-lines">' +
      list.map((f) => '<span class="pt-line">' + esc(f) + '</span>').join('') +
      '</div></section>';
  }

  function adCards(ads) {
    if (!ads.length) return '';
    return '<section class="pt-ads">' +
      ads.map((ad) =>
        '<div class="pt-ad"><strong>' + esc(ad.title || BRAND) + '</strong>' +
        (ad.text ? '<span>' + esc(ad.text) + '</span>' : '') + '</div>').join('') +
      '</section>';
  }

  function footer(brand, when) {
    return '<footer class="pt-foot"><span>' + esc(brand) + '</span>' +
      '<span>' + esc(P('pt.generatedBy')) + '</span>' +
      '<span>' + esc(when) + '</span></footer>';
  }

  function posterSheet(ctx) {
    const { brand, title, subtitle, portal, qr, when, explanation, ads, steps } = ctx;
    const stepList = (steps || DEFAULTS.steps).map(text).filter(Boolean);
    return '<article class="pt-sheet pt-poster" data-layout="poster">' +
      '<header class="pt-head">' +
      '<div class="pt-brand">' + esc(brand) + '</div>' +
      '<div class="pt-head-title"><h2>' + esc(title) + '</h2>' +
      (subtitle ? '<p class="pt-head-sub">' + esc(subtitle) + '</p>' : '') + '</div>' +
      '<div class="pt-head-date">' + esc(P('pt.issued')) + '<br><strong>' + esc(when) + '</strong></div>' +
      '</header>' +
      '<section class="pt-main">' +
      '<div class="pt-qr-box"><span class="pt-corner tl"></span><span class="pt-corner tr"></span>' +
      '<span class="pt-corner bl"></span><span class="pt-corner br"></span>' +
      '<div class="pt-qr">' + qr + '</div>' +
      '<p class="pt-qr-hint">' + esc(P('pt.scan')) + '</p></div>' +
      '<div class="pt-meta"><h3>' + esc(P('pt.leads')) + '</h3>' + metaRows(portal) + '</div>' +
      '</section>' +
      noteBlock(explanation) +
      '<section class="pt-steps"><h3>' + esc(P('pt.steps')) + '</h3><ol>' +
      (stepList.length ? stepList.map((s) => '<li>' + esc(s) + '</li>').join('') : '<li>—</li>') +
      '</ol></section>' +
      fieldLines(ctx.fields) +
      adCards(ads) +
      footer(brand, when) +
      '</article>';
  }

  function labelsSheet(ctx) {
    const { brand, title, portal, qr, when, explanation, ads } = ctx;
    const label = (n) =>
      '<div class="pt-label">' +
      '<div class="pt-label-qr">' + qr + '</div>' +
      '<div class="pt-label-text"><strong>' + esc(title) + '</strong>' +
      '<span class="pt-label-portal">' + esc(portal.title) + '</span>' +
      (portal.link ? '<code>' + esc(portal.link) + '</code>' : '') +
      '<span class="pt-label-line">' + esc(P('pt.label.number', { n })) + '</span></div>' +
      '<span class="pt-label-brand">' + esc(brand) + '</span>' +
      '</div>';
    const cells = [];
    for (let i = 1; i <= LABELS_PER_SHEET; i += 1) cells.push(label(i));
    const adLine = ads.map((ad) => [ad.title, ad.text].filter(Boolean).join(' — ')).join(' · ');
    return '<article class="pt-sheet pt-labels" data-layout="labels">' +
      '<header class="pt-head pt-head-sm">' +
      '<div class="pt-brand">' + esc(brand) + '</div>' +
      '<div class="pt-head-title"><h2>' + esc(title) + '</h2>' +
      '<p class="pt-head-sub">' + esc(P('pt.labels.perSheet', { n: LABELS_PER_SHEET, when })) + '</p></div>' +
      '</header>' +
      '<section class="pt-grid">' + cells.join('') + '</section>' +
      (explanation.length ? '<p class="pt-labels-note">' + esc(explanation.join(' ')) + '</p>' : '') +
      (adLine ? '<p class="pt-labels-ad">' + esc(adLine) + '</p>' : '') +
      footer(brand, when) +
      '</article>';
  }

  function nowText() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /**
   * Отчетът като HTML низ.
   *
   * @param {object} opts
   * @param {'poster'|'labels'} [opts.layout]  A4 плакат (един код) или лист с осем етикета.
   * @param {object} [opts.portal]  { id, slug, title, link, access|visibility, files }.
   * @param {string} [opts.qrSvg]   SVG от `qrcode.js`; без него листът пак е верен.
   * @param {string} [opts.brand]   Името на марката (по подразбиране „Paptresor“).
   * @param {string} [opts.title]   Заглавие на листа.
   * @param {string} [opts.subtitle] Подзаглавие (напр. име на организация).
   * @param {string} [opts.explanation] Обяснението; празен ред разделя абзаци.
   * @param {Array}  [opts.ads]     До три рекламни блока { title, text }.
   * @param {Array}  [opts.steps]   Стъпките „как се прилага“ (по подразбиране три).
   * @param {Array}  [opts.fields]  Полетата за попълване с ръка.
   * @param {string} [opts.generatedAt] Дата на издаване (по подразбиране — сега).
   */
  function build(opts) {
    const o = opts || {};
    const layout = LAYOUTS.includes(o.layout) ? o.layout : 'poster';
    const ctx = {
      layout,
      brand: text(o.brand) || BRAND,
      title: text(o.title) || DEFAULTS.title,
      subtitle: text(o.subtitle),
      portal: portalData(o.portal),
      qr: qrMarkup(o.qrSvg),
      when: text(o.generatedAt) || nowText(),
      explanation: paragraphs(o.explanation, DEFAULTS.explanation),
      ads: adsOf(o.ads),
      steps: Array.isArray(o.steps) && o.steps.length ? o.steps : DEFAULTS.steps,
      fields: o.fields,
    };
    return layout === 'labels' ? labelsSheet(ctx) : posterSheet(ctx);
  }

  return { BRAND, DEFAULTS, LAYOUTS, LABELS_PER_SHEET, build };
});
