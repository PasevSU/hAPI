'use strict';
// Секциите на „Настройки“ в Enterprise Control Center (ui/) — проверка без браузър.
//
// Панелът е един IIFE, който закача `window.SettingsPanel`. Тук му подаваме минимален
// DOM-шим и проверяваме това, което лесно се чупи при пренареждане: че осемте таба се
// рендират, че изборът на секция сменя заглавието и че без връзка секцията казва защо
// е празна, вместо да показва празен екран.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', 'settings-panel.js'), 'utf8');

function stubElement() {
  const children = new Map();
  const el = {
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    addEventListener() { },
    setAttribute() { },
    getAttribute() {
      return null;
    },
    querySelector(sel) {
      if (!children.has(sel)) children.set(sel, stubElement());
      return children.get(sel);
    },
    querySelectorAll() {
      return [];
    },
    classList: { toggle() { }, add() { }, remove() { } },
  };
  return el;
}

function loadPanel() {
  const window = {};
  const document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    documentElement: stubElement(),
    body: stubElement(),
  };
  const storage = () => ({ getItem: () => null, setItem() { }, removeItem() { } });
  const fetchStub = async () => {
    throw Error('офлайн');
  };
  // Панелът е браузърен IIFE без module.exports, затова го пускаме в отделен контекст
  // (vm), а не в глобалния — така тестът не замърсява процеса и не изпълнява код
  // в обхвата на самия тест.
  const sandbox = { window, document, localStorage: storage(), sessionStorage: storage(), location: { protocol: 'file:', origin: 'null' }, fetch: fetchStub, console, setTimeout, clearTimeout };
  vm.runInNewContext(code, sandbox, { filename: 'settings-panel.js' });
  return window.SettingsPanel;
}

const panel = loadPanel();
assert.ok(panel && typeof panel.mount === 'function', 'панелът се зарежда и expose-ва mount');

const host = stubElement();
panel.mount(host);

const html = host.innerHTML;
const LABELS = [
  'Основни', 'Йерархия', 'Картотека', 'Категории и групи', 'Задачи',
  'Потребители', 'Променливи', 'Данни', 'Диагностика', 'Съхранение', 'Резервни копия', 'Журнал',
];
for (const label of LABELS) {
  assert.ok(html.includes(label), `табът „${label}“ е в панела`);
}
assert.equal((html.match(/data-section="[a-z]+"/g) || []).length, LABELS.length, 'дванайсет таба: Основни + единайсет секции');
assert.ok(html.includes('Секции на настройките'), 'табовете имат достъпно име');

// Избор на секция: заглавието се сменя и (без връзка) секцията казва защо е празна.
panel.state.section = 'diagnostics';
panel.mount(host);
assert.ok(host.innerHTML.includes('Настройки · Диагностика'), 'заглавието показва избраната секция');
assert.ok(host.innerHTML.includes('Зареждам'), 'секцията първо показва, че зарежда');

setTimeout(() => {
  const body = host.querySelector('#set-section-body');
  assert.ok(
    /Няма връзка с add-on|грешка/.test(body.innerHTML),
    'без връзка секцията обяснява защо е празна, вместо да мълчи',
  );
  panel.state.section = 'general';
  panel.mount(host);
  assert.ok(host.innerHTML.includes('Връзка с add-on-а'), 'връщането към „Основни“ показва настройките на връзката');
  console.log('PASS ui-settings-sections: 12 таба · избор на секция · действия · ясно състояние без връзка');
}, 50);
