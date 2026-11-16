'use strict';
// ETag И 304 ЗА СТАТИКАТА (DEF-88, 0.69.227) — договор, не оптимизация по желание.
//
// Защо има тест: след DEF-87 файловете с версия в адреса се кешират за година, но всеки адрес
// БЕЗ версия (HTML страницата на панела, стар таб, ръчна заявка, вградена проверка) получава
// `no-cache`. Без ETag това значи ЦЯЛОТО тяло при всяко питане (`ui/index.html` е 40 KB), а
// диспечерът четеше 34 файла от диска при всяка заявка. Днес тялото живее в паметта, а ETag е
// sha256 от СЕРВИРАНОТО съдържание — при `If-None-Match` отговорът е `304` без тяло.
//
// Тестът пада и при „304 с тяло“ (нарушение на RFC 9110), и при „етикет, който не описва
// сервираното“ (тогава браузърът би заключил стара страница).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const ROOT = path.join(__dirname, '..');
const ADDON = path.join(ROOT, 'hapi_enterprise');
const VERSION = /^version:\s*["']?([^"'\s]+)/m.exec(fs.readFileSync(path.join(ADDON, 'config.yaml'), 'utf8'))[1];
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
    // ── §1: ресурс с версия в адреса ─────────────────────────────────────────
    const first = await fetch(`${base}/ui/app.js?v=${VERSION}`);
    const etag = first.headers.get('etag');
    ok(first.status === 200, tag('§1') + ' app.js се сервира');
    ok(Boolean(etag) && /^"[A-Za-z0-9_-]{20,}"$/.test(etag), tag('§1') + ` ETag е силен етикет · днес: ${etag}`);
    await first.arrayBuffer();

    const again = await fetch(`${base}/ui/app.js?v=${VERSION}`, { headers: { 'If-None-Match': etag } });
    const againBody = await again.arrayBuffer();
    ok(again.status === 304, tag('§1') + ` същият етикет → 304 · днес: ${again.status}`);
    ok(againBody.byteLength === 0, tag('§1') + ' 304 НЕ носи тяло (RFC 9110)');
    ok(again.headers.get('etag') === etag, tag('§1') + ' 304 връща същия етикет');

    const other = await fetch(`${base}/ui/app.js?v=${VERSION}`, { headers: { 'If-None-Match': '"stale-etag-value"' } });
    ok(other.status === 200, tag('§1') + ` чужд етикет → 200 с тяло · днес: ${other.status}`);
    await other.arrayBuffer();

    // Етикетът описва СЕРВИРАНОТО тяло: сверява се срещу sha256 на самия отговор.
    const body = await (await fetch(`${base}/ui/app.js?v=${VERSION}`)).arrayBuffer();
    const expected = '"' + crypto.createHash('sha256').update(Buffer.from(body)).digest('base64url').slice(0, 27) + '"';
    ok(expected === etag, tag('§1') + ' ETag = sha256 от сервираното тяло');

    // ── §2: HTML страницата (адрес без версия, `no-cache`) ───────────────────
    const page = await fetch(`${base}/ui/`);
    const pageTag = page.headers.get('etag');
    const pageBody = await page.text();
    ok(page.status === 200 && Boolean(pageTag), tag('§2') + ' страницата носи ETag');
    ok(page.headers.get('cache-control') === 'no-cache', tag('§2') + ' страницата остава `no-cache`');
    const pageCached = await fetch(`${base}/ui/`, { headers: { 'If-None-Match': pageTag } });
    ok(pageCached.status === 304, tag('§2') + ` повторното отваряне не тегли 40 KB · днес: ${pageCached.status}`);
    ok((await pageCached.arrayBuffer()).byteLength === 0, tag('§2') + ' и тук 304 е без тяло');
    ok(pageBody.includes(`?v=${VERSION}`), tag('§2') + ' страницата продължава да носи версия за ресурсите си');

    // ── §3: публичните файлове на портала ────────────────────────────────────
    for (const [asset, name] of [['/portal.css', 'стилът'], ['/portal.js', 'скриптът'], ['/portal-i18n.js', 'речникът']]) {
      const res = await fetch(`${base}${asset}`);
      const assetTag = res.headers.get('etag');
      await res.arrayBuffer();
      ok(res.status === 200 && Boolean(assetTag), tag('§3') + ` ${name} носи ETag`);
      const cached = await fetch(`${base}${asset}`, { headers: { 'If-None-Match': assetTag } });
      ok(cached.status === 304, tag('§3') + ` ${name} при същия етикет → 304 · днес: ${cached.status}`);
      ok((await cached.arrayBuffer()).byteLength === 0, tag('§3') + ` ${name}: 304 без тяло`);
    }

    // ── §4: диспечерът не чете от диска при всяка заявка ─────────────────────
    // Тялото се пази в `static-etag.js`; повторна заявка за същия файл не бива да стига до
    // `fs.readFileSync`. Проверява се по СЪДЪРЖАНИЕ: двата отговора са байт по байт равни.
    const a = Buffer.from(await (await fetch(`${base}/ui/app.js?v=${VERSION}`)).arrayBuffer());
    const b = Buffer.from(await (await fetch(`${base}/ui/app.js?v=${VERSION}`)).arrayBuffer());
    ok(a.equals(b) && a.length > 0, tag('§4') + ' повторната заявка дава същото тяло (от паметта)');

    // Регистърът на портала (жив договор) също не бива да губи: страницата на портала се отваря.
    const created = await api('/admin/api/portals', 'POST', {
      slug: 'etag',
      title: 'Портал за проверка на етикетите',
      description: 'Един адрес, един етикет.',
      visibility: 'public',
    });
    ok(created.status === 201, tag('§4') + ' порталът за проверката се създава');
    const landing = await fetch(`${base}/p/${created.data.id}`);
    await landing.arrayBuffer();
    ok(landing.status === 200, tag('§4') + ' страницата на портала се отваря');

    console.log(`OK static-etag · ${checks} твърдения · версия ${VERSION}`);
  } finally {
    await server.stop();
  }
})().catch((error) => {
  console.error('FAIL static-etag ·', error.message);
  process.exitCode = 1;
});
