'use strict';
// Минимален, но ЧЕСТЕН DOM за тестовете на интерфейса.
//
// Защо не `jsdom`: проектът няма runtime зависимости и тестовете не бива да въвеждат
// такава. Затова тук има малък DOM, който:
//   • РАЗБИРА `innerHTML` — панелите пишат HTML низ и после търсят по него; ако низът не
//     се парсва, „кликването“ е невъзможно и тестът проверява само текст, не поведение;
//   • поддържа селекторите, които кодът РЕАЛНО ползва (`#id`, `.class`, `[data-x]`,
//     `[name="x"]`, потомък и списък със запетая) и хвърля ясна грешка за непознат синтаксис,
//     вместо тихо да върне null (тихо null = тест, който никога не пада);
//   • има `addEventListener`/`dispatch`/`click()`, за да може тестът да натисне бутон,
//     както го прави потребителят.
//
// Умишлено НЕ се стреми да е пълен браузър: няма layout, CSS, навигация и мрежа.

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[body] != null ? ENTITIES[body] : all;
  });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ── Парсер: тагове, атрибути, текст, коментари ───────────────────────────────────
function parseHtml(html, ownerDocument) {
  const nodes = [];
  const stack = [];
  const push = (node) => {
    if (stack.length) stack[stack.length - 1].childNodes.push(node);
    else nodes.push(node);
  };
  let i = 0;
  const text = String(html == null ? '' : html);
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      const rest = text.slice(i);
      if (rest) push({ nodeType: 3, data: decodeEntities(rest), parentNode: null });
      break;
    }
    if (lt > i) push({ nodeType: 3, data: decodeEntities(text.slice(i, lt)), parentNode: null });
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end === -1 ? text.length : end + 3;
      continue;
    }
    const gt = text.indexOf('>', lt);
    if (gt === -1) break;
    const raw = text.slice(lt + 1, gt);
    if (raw[0] === '/') {
      const name = raw.slice(1).trim().toLowerCase();
      // Затваряме до съответния таг (толерантност към небалансиран HTML).
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].tagName === name) { stack.length = k; break }
      }
      i = gt + 1;
      continue;
    }
    const selfClose = raw.trimEnd().endsWith('/');
    const body = selfClose ? raw.trimEnd().slice(0, -1) : raw;
    const nameMatch = body.match(/^([a-zA-Z][a-zA-Z0-9:-]*)/);
    if (!nameMatch) { i = gt + 1; continue }
    const tagName = nameMatch[1].toLowerCase();
    const el = ownerDocument.createElement(tagName);
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let m;
    while ((m = attrRe.exec(body))) {
      const value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5];
      el.setAttribute(m[1], decodeEntities(value == null ? '' : value));
    }
    const bare = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?=\s|$)/g;
    // Браузърът приема ВСЕКИ атрибут без `=` за булев (`data-close-portal`, `hidden`,
    // `multiple`, `webkitdirectory`). Досега тук се познаваха само няколко имена, а
    // `data-close-portal` се губеше — тоест тестът не можеше да натисне бутона
    // „← Списък с портали“, който в браузъра работи. Затова първо се махат двойките
    // `name="value"` (за да не се вземе дума от стойност за атрибут), после останалото
    // е булев атрибут.
    const withoutPairs = body.replace(attrRe, ' ');
    while ((m = bare.exec(withoutPairs.slice(nameMatch[1].length)))) {
      const name = m[1];
      if (!el.hasAttribute(name)) el.setAttribute(name, '');
    }
    if (el.hasAttribute('class') && el.getAttribute('class') === '' && /class\b/.test(body)) el.setAttribute('class', '');
    // Браузърът отразява булевите атрибути в СВОЙСТВА: `<input type="checkbox" checked>`
    // дава `el.checked === true`, `<option selected>` — `el.selected === true`. Без това
    // панел, който пита „отметнато ли е това поле“, не може да бъде проверен през
    // интерфейса: всички отметки изглеждат свалени, дори когато са отбелязани.
    if (el.hasAttribute('checked')) el.checked = true;
    if (el.hasAttribute('selected')) el.selected = true;
    push(el);
    if (!VOID_TAGS.has(tagName) && !selfClose) stack.push(el);
    i = gt + 1;
  }
  const link = (node, parent) => {
    if (node.nodeType === 1) {
      node.parentNode = parent;
      node.childNodes.forEach((c) => link(c, node));
    } else node.parentNode = parent;
  };
  nodes.forEach((n) => link(n, null));
  // Браузърът избира ПЪРВАТА опция на `<select>` — без това панелите виждат празна
  // стойност и отказват с „Избери …“, макар потребителят да вижда избрано.
  const pickFirstOption = (node) => {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'select' && !node.value) {
      const first = node.childNodes.find((c) => c.nodeType === 1 && c.tagName === 'option');
      if (first) {
        // Като в браузър: ЯВНО зададена стойност (дори празна) печели; иначе — текстът.
        const attr = first.getAttribute('value');
        node.value = attr === null ? first.textContent.trim() : attr;
      }
    }
    node.childNodes.forEach(pickFirstOption);
  };
  nodes.forEach(pickFirstOption);
  return nodes;
}

// ── Селектори ───────────────────────────────────────────────────────────────────
function parseCompound(text) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  // Стойност в кавички може да е екранирана (`CSS.escape` дава `a\/b` за път с наклонена
  // черта). Браузърът разчита екранирането до истинската стойност, затова и тук се маха.
  const unescape = (value) => (value === undefined ? undefined : String(value).replace(/\\([\s\S])/g, '$1'));
  const re = /(^[a-zA-Z][-a-zA-Z0-9]*)|#([-a-zA-Z0-9_]+)|\.([-a-zA-Z0-9_]+)|\[\s*([-a-zA-Z0-9_:.]+)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g;
  let m, consumed = 0;
  while ((m = re.exec(text))) {
    consumed += m[0].length;
    if (m[1]) out.tag = m[1].toLowerCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else if (m[4]) {
      out.attrs.push({
        name: m[4].toLowerCase(),
        value: m[5] === undefined ? undefined : unescape(m[6] !== undefined ? m[6] : m[7] !== undefined ? m[7] : m[8]),
      });
    }
  }
  if (consumed !== text.replace(/\s+/g, ' ').trim().length) {
    throw new Error('dom-stub: неподдържан селектор «' + text + '» — разшири parseCompound, вместо да връщаш null');
  }
  return out;
}

function parseSelector(selector) {
  return String(selector)
    .split(',')
    .map((group) => group.trim().split(/\s+/).filter(Boolean).map(parseCompound))
    .filter((parts) => parts.length);
}

function matchesCompound(el, compound) {
  if (el.nodeType !== 1) return false;
  if (compound.tag && el.tagName !== compound.tag) return false;
  if (compound.id && el.getAttribute('id') !== compound.id) return false;
  for (const cls of compound.classes) if (!el.classList.contains(cls)) return false;
  for (const attr of compound.attrs) {
    if (!el.hasAttribute(attr.name)) return false;
    if (attr.value !== undefined && el.getAttribute(attr.name) !== attr.value) return false;
  }
  return true;
}

function matchesSelector(el, parts) {
  // Съвпадение отдясно наляво по веригата от родители (потомък, не само дете).
  let index = parts.length - 1;
  let node = el;
  if (!matchesCompound(node, parts[index])) return false;
  index -= 1;
  node = node.parentNode;
  while (index >= 0 && node) {
    if (matchesCompound(node, parts[index])) index -= 1;
    node = node.parentNode;
  }
  return index < 0;
}

function createDocument({ lang = 'bg', title = 'hAPI' } = {}) {
  // Както в браузър: поле с `name` става свойство на своята форма (`form.input`).
  // Прави се след всяко `innerHTML`/`appendChild`, както го прави браузърът при разбор.
  function linkFormControls(node) {
    if (!node || node.nodeType !== 1) return;
    // `<select>` в браузъра има `value` от избраната опция (или от първата) — панелите
    // четат точно `select.value`, затова без това формата „забравя“ избора след прерисуване
    // (напр. „＋ нов контакт“ се връща на празно и контактът не се създава).
    const selects = node.tagName === 'select' ? [node] : node.querySelectorAll('select');
    for (const select of selects) {
      if (select.value) continue;
      const options = select.querySelectorAll('option');
      const picked = options.find((option) => option.selected) || options[0];
      if (picked) {
        // `value=""` е ВАЛИДНА стойност („— без контакт —“), а не липса: иначе в тялото на
        // заявката отива етикетът на опцията и сървърът отговаря „Unknown contact“.
        const attribute = picked.getAttribute('value');
        select.value = attribute === null ? picked.textContent : attribute;
      }
    }
    const forms = node.tagName === 'form' ? [node] : [];
    const walk = (current) => {
      for (const child of current.childNodes) {
        if (child.nodeType !== 1) continue;
        if (child.tagName === 'form') forms.push(child);
        walk(child);
      }
    };
    walk(node);
    for (const form of forms) {
      for (const field of form.querySelectorAll('[name]')) {
        const name = field.getAttribute('name');
        if (name && !(name in form)) form[name] = field;
      }
    }
  }

  class Element {
    constructor(tagName) {
      this.nodeType = 1;
      this.tagName = String(tagName).toLowerCase();
      this.attributes = new Map();
      this.childNodes = [];
      this.parentNode = null;
      this.listeners = new Map();
      this.style = {};
      this.value = '';
      this.checked = false;
      this.files = [];
      this.ownerDocument = doc;
      this.dataset = new Proxy(
        {},
        {
          get: (_, key) => this.getAttribute('data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())) || undefined,
          set: (_, key, value) => { this.setAttribute('data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), value); return true },
          has: (_, key) => this.hasAttribute('data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())),
          deleteProperty: (_, key) => { this.removeAttribute('data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())); return true },
        },
      );
      this.classList = {
        add: (...names) => names.forEach((n) => { const set = new Set(this.className.split(/\s+/).filter(Boolean)); set.add(n); this.className = [...set].join(' ') }),
        remove: (...names) => { const set = new Set(this.className.split(/\s+/).filter(Boolean)); names.forEach((n) => set.delete(n)); this.className = [...set].join(' ') },
        contains: (name) => this.className.split(/\s+/).filter(Boolean).includes(name),
        toggle: (name, force) => {
          const has = this.classList.contains(name);
          const next = force === undefined ? !has : Boolean(force);
          if (next) this.classList.add(name); else this.classList.remove(name);
          return next;
        },
      };
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v) }
    // Браузърът отразява `hidden` и `disabled` в АТРИБУТА и обратно: `<div hidden>` дава
    // `el.hidden === true`, а `el.hidden = true` слага атрибута. Без това панел, който
    // отваря меню с `menu.hidden = !open`, не може да бъде проверен: `<div class="fm-menu"
    // hidden>` се разчиташе като „менюто е отворено“ и менюто „API ▾“ изглеждаше счупено,
    // докато в браузър работи.
    get hidden() { return this.hasAttribute('hidden') }
    set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden') }
    get disabled() { return this.hasAttribute('disabled') }
    set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled') }
    // Браузърът отразява `href`/`src` в атрибут — без това `a.href = …` не се вижда
    // от тестовете (portal.js слага адресите точно така).
    get href() { return this.getAttribute('href') || ''; }
    set href(v) { this.setAttribute('href', String(v == null ? '' : v)) }
    get src() { return this.getAttribute('src') || ''; }
    set src(v) { this.setAttribute('src', String(v == null ? '' : v)) }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) { this.setAttribute('class', String(v == null ? '' : v)) }
    get children() { return this.childNodes.filter((n) => n.nodeType === 1) }
    // Браузърът има `parentElement` (родителят, ако е елемент). Панелът го ползва, за да
    // намери менюто до бутона („API ▾“): без това свойство менюто изглежда мъртво, докато
    // в браузър се отваря.
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null }
    get nextElementSibling() {
      if (!this.parentNode) return null;
      const list = this.parentNode.children;
      return list[list.indexOf(this) + 1] || null;
    }
    get previousElementSibling() {
      if (!this.parentNode) return null;
      const list = this.parentNode.children;
      const i = list.indexOf(this);
      return i > 0 ? list[i - 1] : null;
    }
    get firstChild() { return this.childNodes[0] || null }
    // Браузърът дава на формата достъп до полетата си по ИМЕ (`form.input`, `form.name`).
    // Панелите го ползват (напр. `uploadFile(form)`), затова стъбът трябва да го има —
    // иначе тестът вижда TypeError, какъвто в браузър няма.
    get elements() {
      const out = {};
      for (const field of this.querySelectorAll('[name]')) {
        const name = field.getAttribute('name');
        if (name) out[name] = field;
      }
      return out;
    }
    get textContent() { return this.childNodes.map((n) => (n.nodeType === 3 ? n.data : n.textContent)).join('') }
    set textContent(v) { this.childNodes = []; if (v !== '' && v != null) this.childNodes.push({ nodeType: 3, data: String(v), parentNode: this }) }
    get innerHTML() {
      return this.childNodes
        .map((n) => {
          if (n.nodeType === 3) return escapeHtml(n.data);
          const attrs = [...n.attributes.entries()].map(([k, v]) => ' ' + k + '="' + escapeHtml(v) + '"').join('');
          return '<' + n.tagName + attrs + '>' + n.innerHTML + '</' + n.tagName + '>';
        })
        .join('');
    }
    set innerHTML(html) {
      this.childNodes = [];
      parseHtml(html, this.ownerDocument).forEach((node) => {
        node.parentNode = this;
        this.childNodes.push(node);
      });
      linkFormControls(this);
    }
    /**
     * Браузърът добавя разметка на позиция (`beforeend` е най-често ползваната — така
     * панелите добавят ред към списък, без да прерисуват всичко). Без това добавянето на
     * поле по желание хвърля и сценарият не може да стигне до „Създай“.
     */
    insertAdjacentHTML(position, html) {
      const nodes = parseHtml(String(html), this.ownerDocument);
      const place = String(position).toLowerCase();
      const accept = (parent, node) => {
        node.parentNode = parent;
        return node;
      };
      if (place === 'beforeend') {
        nodes.forEach((node) => this.childNodes.push(accept(this, node)));
        linkFormControls(this);
        return;
      }
      if (place === 'afterbegin') {
        this.childNodes = nodes.map((node) => accept(this, node)).concat(this.childNodes);
        linkFormControls(this);
        return;
      }
      const parent = this.parentNode;
      if (!parent) throw new Error('dom-stub: insertAdjacentHTML(«' + place + '») без родител');
      const index = parent.childNodes.indexOf(this);
      const insert = nodes.map((node) => accept(parent, node));
      if (place === 'beforebegin') parent.childNodes.splice(index, 0, ...insert);
      else if (place === 'afterend') parent.childNodes.splice(index + 1, 0, ...insert);
      else throw new Error('dom-stub: неподдържана позиция за insertAdjacentHTML «' + place + '»');
      linkFormControls(parent);
    }
    setAttribute(name, value) {
      this.attributes.set(String(name).toLowerCase(), String(value == null ? '' : value));
      if (String(name).toLowerCase() === 'value') this.value = String(value);
    }
    getAttribute(name) { const v = this.attributes.get(String(name).toLowerCase()); return v === undefined ? null : v }
    hasAttribute(name) { return this.attributes.has(String(name).toLowerCase()) }
    removeAttribute(name) { this.attributes.delete(String(name).toLowerCase()) }
    appendChild(node) {
      node.parentNode = this;
      this.childNodes.push(node);
      // Поле, добавено във форма, става нейно свойство по име — както в браузъра.
      if (this.tagName === 'form') linkFormControls(this);
      else linkFormControls(node);
      return node;
    }
    // `append` приема и низове (браузърът ги превръща в текстови възли).
    append(...nodes) {
      for (const node of nodes) {
        this.appendChild(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node);
      }
    }
    insertBefore(node, ref) {
      node.parentNode = this;
      const at = ref ? this.childNodes.indexOf(ref) : -1;
      if (at < 0) this.childNodes.push(node); else this.childNodes.splice(at, 0, node);
      return node;
    }
    removeChild(node) { const at = this.childNodes.indexOf(node); if (at >= 0) this.childNodes.splice(at, 1); return node }
    replaceChildren(...nodes) { this.childNodes = []; nodes.forEach((n) => this.appendChild(n)) }
    remove() { if (this.parentNode) this.parentNode.removeChild(this) }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
      const list = this.listeners.get(type) || [];
      this.listeners.set(type, list.filter((f) => f !== fn));
    }
    dispatch(type, extra = {}) {
      const event = { type, target: this, currentTarget: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, stopPropagation() { this._stopped = true }, ...extra };
      // Браузърът провежда събитието НАГОРЕ по дървото (bubbling): слушател, закачен на
      // формата или на `document`, вижда щракването върху бутон вътре в нея. Досега тук се
      // викаха само слушателите на самия елемент, тоест декларираното на контейнер
      // поведение (напр. „＋ добави поле по желание“) никога не се задействаше и тестът
      // не можеше да провери нещо, което в браузъра работи.
      let node = this;
      while (node && !event._stopped) {
        event.currentTarget = node;
        for (const fn of ((node.listeners && node.listeners.get(type)) || []).slice()) fn(event);
        node = node.parentNode;
      }
      if (!event._stopped) {
        event.currentTarget = doc;
        for (const fn of (doc.listeners.get(type) || []).slice()) fn(event);
      }
      // Браузърът пуска `submit` на формата, когато се натисне бутон type=submit
      // (освен ако click не е отменен). Без това формите на панелите не правят нищо.
      if (type === 'click' && !event.defaultPrevented) {
        const kind = String(this.getAttribute('type') || 'submit').toLowerCase();
        const isSubmit = (this.tagName === 'button' && kind === 'submit') || (this.tagName === 'input' && kind === 'submit');
        if (isSubmit) {
          const form = this.closest('form');
          if (form) form.dispatch('submit');
        }
      }
      return event;
    }
    click() { return this.dispatch('click') }
    focus() { doc.activeElement = this }
    blur() { if (doc.activeElement === this) doc.activeElement = null }
    select() { }
    setSelectionRange() { }
    setRangeText() { }
    scrollIntoView() { }
    checkValidity() { return true }
    reportValidity() { return true }
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 } }
    closest(selector) {
      const parsed = parseSelector(selector);
      let node = this;
      while (node && node.nodeType === 1) {
        if (parsed.some((parts) => matchesSelector(node, parts))) return node;
        node = node.parentNode;
      }
      return null;
    }
    matches(selector) { return parseSelector(selector).some((parts) => matchesSelector(this, parts)) }
    querySelectorAll(selector) {
      const parsed = parseSelector(selector);
      const out = [];
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType !== 1) continue;
          if (parsed.some((parts) => matchesSelector(child, parts))) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
    contains(node) {
      let cur = node;
      while (cur) { if (cur === this) return true; cur = cur.parentNode }
      return false;
    }
  }

  const doc = {
    lang,
    title,
    listeners: new Map(),
    activeElement: null,
    createElement: (tag) => new Element(tag),
    // SVG елементите (иконите в portal.js) се създават с namespace — за теста е същият елемент.
    createElementNS: (ns, tag) => new Element(tag),
    createTextNode: (data) => ({ nodeType: 3, data: String(data), parentNode: null }),
    getElementById: (id) => doc.body.querySelector('#' + id) || doc.head.querySelector('#' + id),
    querySelector: (sel) => doc.documentElement.querySelector(sel),
    querySelectorAll: (sel) => doc.documentElement.querySelectorAll(sel),
    addEventListener: (type, fn) => {
      if (!doc.listeners.has(type)) doc.listeners.set(type, []);
      doc.listeners.get(type).push(fn);
    },
    dispatchEvent: (event) => {
      for (const fn of (doc.listeners.get(event.type) || []).slice()) fn(event);
      return true;
    },
    execCommand: () => true,
    write: () => { },
  };
  doc.documentElement = new Element('html');
  doc.head = doc.createElement('head');
  doc.body = doc.createElement('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.documentElement.ownerDocument = doc;
  return doc;
}

// `Event` се ползва от bootstrap.js (`new Event('hapi:shared-ready')`).
class StubEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.detail = init.detail;
  }
}

module.exports = { createDocument, parseHtml, parseSelector, StubEvent, VOID_TAGS };
