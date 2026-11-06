'use strict';
// ВТОРАТА КОЖА НА ПАНЕЛА („модерен“ изглед) — превключвател, клас и стилове.
//
// Защо има тест: кожата е само оформление, тоест ако се счупи, НИЩО не гърми — панелът
// просто изглежда като преди (или по-зле). Затова тук се пази договорът, който може да се
// размине тихо:
//   • бутонът `#skin-toggle` съществува в горната лента и не е вътре в навигацията (иначе
//     `renderNav()` би го изтрил при всяка смяна на панела);
//   • `app.js` слага класа на `body`, помни избора в `localStorage['hapi.skin']` и НЕ го
//     презаписва при самото зареждане (иначе „класически“ се записва преди човекът да е избрал);
//   • стиловете живеят в `themes.css` (нормативният ред на дизайн системата) и не внасят
//     външни ресурси — CSP е `style-src 'self'`;
//   • кожата има равностойна светла тема (`body.skin-modern.light`), не „инверсия на тъмната“.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const uiDir = path.join(__dirname, '..', 'hapi_enterprise', 'ui');
const read = (name) => fs.readFileSync(path.join(uiDir, name), 'utf8');
const html = read('index.html');
const app = read('app.js');
const themes = read('themes.css');
const cases = [];
const ok = (label) => cases.push(label);

// ── 1. Бутонът е в горната лента, извън навигацията ──────────────────────────
{
  assert.match(html, /id="skin-toggle"/, 'index.html има бутон за втората кожа');
  const topbar = html.slice(html.indexOf('<header class="topbar">'), html.indexOf('</header>'));
  assert.ok(topbar.includes('id="skin-toggle"'), 'бутонът е в горната лента');
  assert.equal(topbar.includes('id="theme-toggle"'), true, 'стои до превключвателя на темата');
  assert.match(topbar, /id="skin-toggle"[^>]*aria-pressed="false"/, 'тръгва в състояние „класическа“');
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  assert.equal(nav.includes('skin-toggle'), false, 'бутонът НЕ е в навигацията — renderNav() не го пипа');
  ok('бутонът е в горната лента, извън навигацията, с aria-pressed');
}

// ── 2. Класът се слага на body и изборът се помни ────────────────────────────
{
  assert.match(app, /document\.body\.classList\.toggle\('skin-modern'/, 'класът се слага на body');
  assert.match(app, /localStorage\.setItem\('hapi\.skin'/, 'изборът се записва');
  assert.match(app, /localStorage\.getItem\('hapi\.skin'\) === 'modern'/, 'изборът се чете при зареждане');
  assert.match(app, /applySkin\(savedSkin, false\)/, 'при зареждане НЕ се презаписва изборът');
  assert.match(app, /\$\('#skin-toggle'\)\.addEventListener|skinToggle\.addEventListener/, 'бутонът е свързан');
  assert.match(app, /classList\.contains\('skin-modern'\)/, 'повторното натискане връща класическата кожа');
  ok('клас на body · запис и четене от localStorage · без презапис при зареждане');
}

// ── 3. Стиловете са в themes.css и са самостоятелни ──────────────────────────
{
  assert.match(themes, /body\.skin-modern\s*\{/, 'themes.css описва кожата');
  assert.match(themes, /body\.skin-modern\.light\s*\{/, 'има равностойна светла тема');
  for (const sel of ['body.skin-modern .topbar', 'body.skin-modern .nav-item.active', 'body.skin-modern .btn-primary', 'body.skin-modern .panel', 'body.skin-modern .pf-portal']) {
    assert.ok(themes.includes(sel), 'кожата покрива ' + sel);
  }
  // Кожата е САМО в themes.css: втори файл би позволил „две истини“ за нея.
  for (const name of fs.readdirSync(uiDir).filter((f) => f.endsWith('.css'))) {
    if (name === 'themes.css') continue;
    assert.equal(read(name).includes('skin-modern'), false, name + ': кожата се описва само в themes.css');
  }
  assert.equal(/@import/.test(themes), false, 'кожата не внася чужди стилове (CSP: style-src self)');
  const skinBlock = themes.slice(themes.indexOf('body.skin-modern'));
  assert.equal(/url\(/.test(skinBlock), false, 'кожата не тегли изображения или шрифтове');
  const open = (skinBlock.match(/\{/g) || []).length;
  const close = (skinBlock.match(/\}/g) || []).length;
  assert.equal(open, close, 'скобите в секцията на кожата са балансирани: ' + open + '/' + close);
  ok('стиловете са само в themes.css, без външни ресурси, балансирани');
}

// ── 4. Кожата не пипа съдържанието: няма нови заявки или панели ──────────────
{
  const skinPart = app.slice(app.indexOf("$('#skin-toggle')"), app.indexOf('renderNav();\n    renderView();\n    void loadCapabilities') + 1);
  assert.equal(/fetch\(/.test(skinPart), false, 'превключването не прави заявки');
  assert.equal(/innerHTML/.test(skinPart), false, 'превключването не пипа разметката на панелите');
  ok('кожата не прави заявки и не променя разметката');
}

console.log('PASS ui-skin: ' + cases.length + ' проверки · ' + cases.join(' · '));
