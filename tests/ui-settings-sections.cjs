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
// Речникът се зарежда преди панела — точно както в index.html; без него панелът
// показва ключове вместо текст (и това е нарочно видимо).
const i18nCode = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', 'i18n.js'), 'utf8');

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

function loadPanel(overrides) {
  const o = overrides || {};
  const window = {};
  const document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    documentElement: stubElement(),
    body: stubElement(),
    addEventListener() { },
    createElement: () => stubElement(),
  };
  const storage = () => ({
    getItem: (key) => (o.base && key === 'hapi.apiBase' ? o.base : null),
    setItem() { },
    removeItem() { },
  });
  const fetchStub = async (url) => {
    if (!o.json) throw Error('офлайн');
    const key = Object.keys(o.json).find((k) => String(url).endsWith(k));
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => (key ? o.json[key] : {}),
    };
  };
  // Панелът е браузърен IIFE без module.exports, затова го пускаме в отделен контекст
  // (vm), а не в глобалния — така тестът не замърсява процеса и не изпълнява код
  // в обхвата на самия тест.
  const sandbox = { window, document, localStorage: storage(), sessionStorage: storage(), location: { protocol: 'file:', origin: 'null' }, fetch: fetchStub, console, setTimeout, clearTimeout, setInterval, clearInterval };
  vm.runInNewContext(i18nCode, sandbox, { filename: 'i18n.js' });
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
  'Потребители', 'Променливи', 'Данни', 'Диагностика', 'Анализи', 'Сензори', 'Сигурност', 'QR архиви',
  'Подпис на отчети', 'Съхранение', 'Резервни копия', 'Журнал',
];
for (const label of LABELS) {
  assert.ok(html.includes(label), `табът „${label}“ е в панела`);
}
assert.equal((html.match(/data-section="[a-z]+"/g) || []).length, LABELS.length, 'седемнайсет таба: Основни + шестнайсет секции');
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

  // ── Свързано състояние: секция „Данни“ рисува формата за тайна връзка ──
  const online = loadPanel({
    base: 'http://stub.local',
    json: {
      '/admin/api/v2/secrets': { secrets: [{ idHash: 'a'.repeat(64), createdAt: '2026-10-22T09:00:00.000Z', note: '—' }] },
      '/admin/api/portals': { portals: [{ id: 'p1', title: 'Портал 1', slug: 'p1', files: [] }] },
    },
  });
  const onlineHost = stubElement();
  online.state.section = 'data';
  online.mount(onlineHost);
  setTimeout(() => {
    const dataBody = onlineHost.querySelector('#set-section-body').innerHTML;
    assert.match(dataBody, /Създай тайна връзка/, 'секция „Данни“ показва формата за тайна връзка');
    assert.match(dataBody, /id="set-secret-text"/, 'има поле за съдържанието');
    assert.match(dataBody, /id="set-secret-password"/, 'има поле за втора парола');
    assert.match(dataBody, /data-action="secretCreate"/, 'има бутон за създаване');
    assert.match(dataBody, /връзка към панела/, 'има режим „връзка към панела“');
    assert.match(dataBody, /id="set-secret-out"/, 'има място за резултата (линк и QR)');
    console.log('PASS ui-settings-sections: 17 таба · избор на секция · действия · ясно състояние без връзка · форма за тайна връзка');
  }, 80);
}, 50);
