'use strict';
// КЕШ НА СТАТИКАТА (0.69.226) — договор, не настройка.
//
// Измерено преди промяната: панелът теглеше 34 файла / 1044 KB при ВСЯКО зареждане (всеки
// отговор беше `no-store`), а публичният портал — 150 KB. Причината `no-store` беше вярна
// (след обновяване на add-on-а стар речник замръзва), но решението беше грешно: то хвърля
// кеша, вместо да вкара версия в адреса.
//
// Договорът днес:
//   §1 `/ui/<файл>?v=<версия>` → `private, max-age=31536000, immutable`; без версия → `no-cache`.
//   §2 `ui/index.html` (единственият вход без версия) е `no-cache` и НЕСЕ `?v=` за всеки
//      свой ресурс — иначе §1 не се задейства никога. Тялото е същото като на диска, само
//      с добавена версия.
//   §3 същото за `/portal.css`, `/portal.js`, `/portal-i18n.js` и страницата `/p/<id>`.
//   §4 нито един отговор не е `public` — миниатюрите са на заключен портал и споделен
//      прокси не бива да ги пази (тайната не изтича през кеша на доставчика).
//
// Тестът пада и при „кеш без версия“ (замръзнал речник), и при „версия без кеш“ (старото
// поведение), защото проверява двете половини на договора заедно.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const ROOT = path.join(__dirname, '..');
const ADDON = path.join(ROOT, 'hapi_enterprise');
const VERSION = /^version:\s*["']?([^"'\s]+)/m.exec(fs.readFileSync(path.join(ADDON, 'config.yaml'), 'utf8'))[1];
const IMMUTABLE = 'private, max-age=31536000, immutable';
const tag = (name) => `[${name}]`;

(async () => {
  const server = await startServer({ env: { PUBLIC_BASE_URL: 'https://example.test' }, keepData: true });
  const { api, base } = server;
  let checks = 0;
  const ok = (cond, message) => {
    assert.ok(cond, message);
    checks += 1;
  };

  try {
    // ── §1: статиката на панела ───────────────────────────────────────────────
    const versioned = await fetch(`${base}/ui/app.js?v=${VERSION}`);
    ok(versioned.status === 200, tag('§1') + ' app.js?v= се сервира');
    ok(
      versioned.headers.get('cache-control') === IMMUTABLE,
      tag('§1') + ` версия в адреса дава immutable · днес: ${versioned.headers.get('cache-control')}`
    );

    const bare = await fetch(`${base}/ui/app.js`);
    ok(bare.status === 200, tag('§1') + ' app.js се сервира и без версия');
    ok(
      bare.headers.get('cache-control') === 'no-cache',
      tag('§1') + ` без версия файлът НЕ е immutable · днес: ${bare.headers.get('cache-control')}`
    );

    // ── §2: входната страница носи версията за всичките си ресурси ────────────
    const page = await fetch(`${base}/ui/`);
    const pageBody = await page.text();
    ok(page.status === 200, tag('§2') + ' /ui/ се сервира');
    ok(page.headers.get('cache-control') === 'no-cache', tag('§2') + ' страницата се проверява всеки път (`no-cache`)');

    const diskIndex = fs.readFileSync(path.join(ADDON, 'ui', 'index.html'), 'utf8');
    const refs = [...diskIndex.matchAll(/(?:src|href)="([a-z0-9-]+\.(?:css|js))"/g)].map((m) => m[1]);
    ok(refs.length >= 20, tag('§2') + ` входът сочи поне 20 локални ресурса · днес: ${refs.length}`);
    const missing = refs.filter((ref) => !pageBody.includes(`"${ref}?v=${VERSION}"`));
    ok(missing.length === 0, tag('§2') + ` всеки ресурс иска версия · без нея: ${missing.join(', ') || '—'}`);

    // Тялото е същото като на диска: версията се добавя при сервиране, файлът на диска не се
    // пипа (иначе `html-assets` и проверката за съществуващи файлове биха гледали друга истина).
    const stripped = pageBody.split(`?v=${VERSION}`).join('');
    ok(stripped === diskIndex, tag('§2') + ' сервираният HTML е файлът от диска + версия, нищо друго');

    // ── §3: публичният портал ────────────────────────────────────────────────
    const cssVersioned = await fetch(`${base}/portal.css?v=${VERSION}`);
    ok(
      cssVersioned.headers.get('cache-control') === IMMUTABLE,
      tag('§3') + ` portal.css?v= е immutable · днес: ${cssVersioned.headers.get('cache-control')}`
    );
    const cssBare = await fetch(`${base}/portal.css`);
    ok(cssBare.headers.get('cache-control') === 'no-cache', tag('§3') + ' portal.css без версия не замръзва');

    const created = await api('/admin/api/portals', 'POST', {
      slug: 'cache',
      title: 'Портал за проверка на кеша',
      description: 'Три файла, един договор.',
      visibility: 'public',
    });
    ok(created.status === 201, tag('§3') + ' порталът за проверката се създава · ' + JSON.stringify(created.data));
    const landing = await fetch(`${base}/p/${created.data.id}`);
    const landingBody = await landing.text();
    ok(landing.status === 200, tag('§3') + ' страницата на портала се отваря');
    ok(landing.headers.get('cache-control') === 'no-store', tag('§3') + ' самата страница остава `no-store` (има токени в адреса)');
    for (const asset of ['/portal.css', '/portal.js', '/portal-i18n.js']) {
      ok(landingBody.includes(`"${asset}?v=${VERSION}"`), tag('§3') + ` страницата иска ${asset} с версия`);
      ok(!landingBody.includes(`"${asset}"`), tag('§3') + ` страницата не иска ${asset} без версия`);
    }

    // ── §4: нищо не е `public` ───────────────────────────────────────────────
    for (const file of ['server.js', ...fs.readdirSync(path.join(ADDON, 'server_module')).filter((f) => f.endsWith('.js')).map((f) => path.join('server_module', f))]) {
      const text = fs.readFileSync(path.join(ADDON, file), 'utf8');
      ok(!/['"]public,\s*max-age/.test(text), tag('§4') + ` ${file} не кешира публично (споделен прокси пази тайни)`);
    }
    const serverText = fs.readFileSync(path.join(ADDON, 'server.js'), 'utf8');
    ok(serverText.includes("'private, max-age=3600'"), tag('§4') + ' миниатюрите се пазят само в браузъра (`private`)');

    // ── §5: `/statik/` — линкът на отчета (ADR-0028) ──────────────────────────
    // Един `id` никога не сочи друго съдържание, затова `immutable` е верен; адресът е
    // capability, тоест не бива да влиза в търсачки и не бива да е `no-store` (иначе
    // 750 KB PDF се тегли при всяко отваряне на вече видян линк).
    const statikSource = fs.readFileSync(path.join(ADDON, 'server_module', 'statik.js'), 'utf8');
    ok(/max-age=31536000, immutable/.test(statikSource), tag('§5') + ' линкът на отчета е `immutable` по `id`');
    ok(/noindex/.test(statikSource), tag('§5') + ' линкът не влиза в търсачки (`noindex`)');
    ok(!/no-store/.test(statikSource), tag('§5') + ' линкът не се пречиства при всяко теглене');

    console.log(`OK static-cache · ${checks} твърдения · версия ${VERSION}`);
  } finally {
    await server.stop();
  }
})().catch((error) => {
  console.error('FAIL static-cache ·', error.message);
  process.exitCode = 1;
});
