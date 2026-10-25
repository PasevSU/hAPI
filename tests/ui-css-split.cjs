'use strict';
// ДИЗАЙН СИСТЕМАТА Е РАЗДЕЛЕНА НА ЧЕТИРИ ФАЙЛА (план 18 §7): tokens · layout · components · themes.
//
// Защо това има тест, а не е „подредба на файлове“: DOM тестовете проверяват ПОВЕДЕНИЕ, не
// оформление. Ако при местене изчезне правило или токен, интерфейсът става различен, а всички
// поведенчески тестове остават зелени. Затова тук се проверява точно това, което може да се
// счупи тихо:
//   • редът на зареждане (той е нормативен: темата трябва да е последна, за да надделява);
//   • че четирите файла СЕ СЕРВИРАТ (урокът от `panel-registry.js`: забравен файл в allow-list-а
//     на сървъра = 404 през ingress, което нито един от четирите GUI гейта не хвана);
//   • че всеки използван токен `var(--x)` е дефиниран — липсващ токен не чупи тест, а прави
//     текста невидим;
//   • че темата е само в themes.css (иначе „предефиниране“ се разпръсква и редът пак става важен).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const uiCss = require('./lib/ui-css.cjs');

const uiDir = path.join(__dirname, '..', 'hapi_enterprise', 'ui');
const cases = [];
const ok = (label) => cases.push(label);

// ── 1. index.html зарежда четирите файла В ТОЗИ РЕД ─────────────────────────
const indexHtml = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8');
{
  const order = [...indexHtml.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, uiCss.FILES, 'редът на зареждане е точно tokens → layout → components → themes, получено: ' + JSON.stringify(order));
  assert.equal(fs.existsSync(path.join(uiDir, 'styles.css')), false, 'старият styles.css не бива да съществува — две истини за стиловете');
  ok('index.html зарежда четирите файла в нормативния ред, styles.css го няма');
}

// ── 2. Всеки използван токен е дефиниран ───────────────────────────────────
// Липсващ токен НЕ чупи нищо видимо в тестовете: `color: var(--nope)` просто не се прилага и
// текстът може да стане невидим. Затова се сверяват употребите с дефинициите.
{
  const all = uiCss.text();
  const defined = new Set([...all.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...all.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  // Панелите слагат стилове и от JavaScript (напр. `el.style.setProperty('--x', …)`) — те също
  // трябва да сочат към дефиниран токен, иначе правилото работи „на празно“.
  for (const name of fs.readdirSync(uiDir).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(uiDir, name), 'utf8');
    for (const m of src.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]);
  }
  const missing = [...used].filter((name) => !defined.has(name));
  assert.deepEqual(missing, [], 'токени, които се ползват, но никъде не се дефинират: ' + missing.join(', '));
  assert.ok(defined.size >= 30, 'токените са малко (' + defined.size + ') — изглежда файлът с токени е орязан');
  assert.ok(used.size >= 20, 'употребите на токени са малко (' + used.size + ')');
  ok(defined.size + ' токена дефинирани, ' + used.size + ' използвани, нито един липсващ');
}

// ── 3. Темата е само в themes.css ─────────────────────────────────────────
{
  for (const name of uiCss.FILES) {
    const src = uiCss.of(name);
    if (name === 'themes.css') {
      assert.match(src, /body\.light \{/, 'themes.css съдържа темата');
      continue;
    }
    assert.equal(/body\.light\s*\{/.test(src), false, name + ' предефинира тема — това е само в themes.css');
  }
  // Токените живеят в tokens.css: ако `:root` се появи и другаде ИЗВЪН `@media`, „един източник“
  // пада. Вътре в `@media` е законно — това са отзивчивите стойности (`--per-row-*`).
  assert.match(uiCss.of('tokens.css'), /:root \{/, 'tokens.css дефинира :root');
  for (const name of ['layout.css', 'components.css', 'themes.css']) {
    const src = uiCss.of(name);
    // Проверява се СМИСЪЛЪТ: всеки `:root` извън `@media` би бил втори източник на токени.
    const outside = [...src.matchAll(/:root\s*\{/g)].filter((m) => {
      const before = src.slice(0, m.index);
      const depth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length;
      return depth === 0;
    });
    assert.deepEqual(outside.map((m) => m.index), [], name + ' дефинира :root извън @media — токените са само в tokens.css');
  }
  ok('темата е само в themes.css, а токените — само в tokens.css');
}

// ── 4. Четирите файла СЕ СЕРВИРАТ през /ui/ ────────────────────────────────
(async () => {
  const server = await startServer();
  try {
    for (const name of uiCss.FILES) {
      const res = await server.authFetch(server.base + '/ui/' + name);
      assert.equal(res.status, 200, '/ui/' + name + ' се сервира, получено: ' + res.status);
      const type = String(res.headers.get('content-type') || '');
      assert.match(type, /text\/css/, '/ui/' + name + ' е с CSS тип, получено: ' + type);
      const body = await res.text();
      assert.ok(body.length > 200, '/ui/' + name + ' не е празен');
    }
    // Старият адрес трябва да е 404 — иначе някой ще продължи да го зарежда и ще види „без стилове“.
    const stale = await server.authFetch(server.base + '/ui/styles.css');
    assert.equal(stale.status, 404, '/ui/styles.css вече не съществува, получено: ' + stale.status);
    ok('четирите файла се сервират като text/css, а старият /ui/styles.css е 404');
  } finally {
    await server.stop().catch(() => { });
  }
  console.log('PASS ui-css-split: ' + cases.length + ' проверки — ' + cases.join('; '));
})().catch((e) => {
  console.error('FAIL ui-css-split:', e.message);
  process.exit(1);
});
