'use strict';
// ВТОРАТА КОЖА НА ПУБЛИЧНИЯ ПОРТАЛ (`portal_skin` / `PORTAL_SKIN`).
//
// Защо това има тест: кожата се сервира на СЪЩИЯ адрес `/portal.css`, залепена след
// класическия стил. Ако залепването се счупи (забравен файл, грешен env, обърнат ред),
// страницата не „гърми“ — просто изглежда различно, а всички поведенчески тестове остават
// зелени. Затова тук се проверява точно това, което може да се счупи тихо:
//   • по подразбиране се сервира САМО класическият стил (байт по байт);
//   • при `modern` класическият стил стои ОТПРЕДИ (иначе новите правила няма какво да
//     надградят), а модерният маркер и ключовите селектори идват след него;
//   • непозната стойност пада обратно на класическия стил, вместо да чупи страницата;
//   • HTML-ът НЕ се променя — няма втори `<link>`, няма външни ресурси (CSP: `style-src 'self'`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { freePort, stopChild } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const PORTAL = path.join(ROOT, 'hapi_enterprise', 'portal');
const CLASSIC = fs.readFileSync(path.join(PORTAL, 'portal.css'), 'utf8');
const MODERN = fs.readFileSync(path.join(PORTAL, 'portal-modern.css'), 'utf8');
const TOKEN = 'portal-skin-token-0123456789abcdef';
const cases = [];
const ok = (label) => cases.push(label);

/** Стартира сървъра с изолирана инсталация; `skin` е стойността на PORTAL_SKIN (null = без). */
async function boot(skin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-skin-'));
  const port = await freePort();
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_PORT: '0', PUBLIC_GATEWAY_PORT: '0', ADMIN_TOKEN: TOKEN };
  delete env.PORTAL_SKIN;
  if (skin !== null) env.PORTAL_SKIN = skin;
  const child = spawn(process.execPath, [path.join(ROOT, 'hapi_enterprise', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c.toString() });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(base + '/health')).status === 200) { up = true; break }
    } catch {
      /* още не слуша */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(up, 'сървърът не отвори /health за 15 s' + (stderr ? ' · ' + stderr : ''));
  return { base, child };
}

(async () => {
  // ── 1. По подразбиране: само класическият стил ──────────────────────────────
  {
    const { base, child } = await boot(null);
    try {
      const res = await fetch(base + '/portal.css');
      assert.equal(res.status, 200, '/portal.css се сервира');
      assert.match(String(res.headers.get('content-type') || ''), /text\/css/, '/portal.css е CSS');
      const css = await res.text();
      assert.equal(css, CLASSIC, 'без PORTAL_SKIN се сервира ТОЧНО класическият файл');
      assert.equal(css.includes('MODERN-SKIN'), false, 'модерната кожа не се залепва по подразбиране');
      ok('по подразбиране: байт по байт класическият portal.css');
    } finally {
      await stopChild(child);
    }
  }

  // ── 2. modern: класически + модерен, в този ред ─────────────────────────────
  {
    const { base, child } = await boot('modern');
    try {
      const res = await fetch(base + '/portal.css');
      assert.equal(res.status, 200);
      const css = await res.text();
      // Класиката е ОТПРЕДИ: тя носи базовия DOM-договор, кожата само надгражда.
      assert.ok(css.startsWith(CLASSIC), 'CSS-ът започва с класическия стил');
      assert.ok(css.length > CLASSIC.length, 'модерната кожа добавя правила');
      assert.ok(css.includes('MODERN-SKIN'), 'модерната кожа е залепена');
      assert.ok(css.includes(MODERN.trim().slice(0, 400)), 'съдържанието на portal-modern.css е цялото');
      // Ключовите селектори, които правят кожата „модерна“ — не просто друг цвят.
      for (const marker of ['backdrop-filter', 'grid-template-columns', '@media (prefers-reduced-motion: reduce)', '.file:hover', '.btn-primary', '@keyframes skin-rise']) {
        assert.ok(MODERN.includes(marker), 'кожата съдържа ' + marker);
      }
      // Без външни ресурси: CSP на страницата е `style-src 'self'`, `@import` на чужд адрес
      // би бил тихо блокиран, тоест кожата би изглеждала счупена без грешка.
      assert.equal(/@import/.test(MODERN), false, 'кожата не внася чужди стилове');
      assert.equal(/url\((?!#)/.test(MODERN), false, 'кожата не тегли изображения или шрифтове');
      // Балансът на скобите пази от отрязан файл, който браузърът „дочита“ мълчаливо.
      const open = (MODERN.match(/\{/g) || []).length;
      const close = (MODERN.match(/\}/g) || []).length;
      assert.equal(open, close, 'скобите в portal-modern.css са балансирани: ' + open + '/' + close);
      ok('modern: класика + кожа на един адрес, без външни ресурси, балансиран CSS');
    } finally {
      await stopChild(child);
    }
  }

  // ── 3. Непозната стойност пада обратно на класиката ──────────────────────────
  {
    const { base, child } = await boot('neznaina-koscha');
    try {
      const css = await (await fetch(base + '/portal.css')).text();
      assert.equal(css, CLASSIC, 'непозната стойност не чупи страницата — сервира се класиката');
      ok('непозната стойност на PORTAL_SKIN → класическият стил');
    } finally {
      await stopChild(child);
    }
  }

  // ── 4. HTML-ът не се променя (един `<link>`, същият адрес) ──────────────────
  {
    const html = fs.readFileSync(path.join(PORTAL, 'portal.html'), 'utf8');
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(links, ['/portal.css'], 'страницата линква САМО /portal.css — кожата не добавя втори стил');
    assert.equal(html.includes('portal-modern.css'), false, 'HTML-ът не знае за името на файла с кожата');
    // 410 „закрит“, страницата на токена и файловете също линкват `/portal.css` — тоест
    // кожата важи и там, без да се пипа нито един от тези маршрути.
    const routes = ['routes/portal-archive.js', 'routes/portal-tokens.js', 'routes/portal-storage.js']
      .map((rel) => fs.readFileSync(path.join(ROOT, 'hapi_enterprise', rel), 'utf8'));
    for (const src of routes) assert.ok(src.includes('/portal.css'), 'служебните страници линкват същия стил');
    ok('един <link> в HTML-а; 410/токен/файл страниците ползват същия стил');
  }

  console.log('PASS portal-skin: ' + cases.length + ' проверки · ' + cases.join(' · '));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
