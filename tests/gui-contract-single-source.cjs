'use strict';
// АДРЕСИТЕ В ПАНЕЛА ИДВАТ ОТ ДОГОВОРА НА СЪРВЪРА — ЕДИН ИЗТОЧНИК (DEF-69, 0.69.239).
//
// Двете правила, които този тест пази:
//   1. Договорът печели. Ако сървърът каже друг адрес за страницата/API-то, панелът показва
//      НЕГОВИЯ адрес, а не своя `buildReferences`. Затова тестът подменя отговора на
//      `api-info` със ЗАГЛАВЕН договор (`/p/from-contract`) — адрес, който панелът не би
//      построил сам никога, тоест съвпадението е ДОКАЗАТЕЛСТВО, не съвпадение.
//   2. Подписаният достъп не се дублира. Договорът вече носи `?expires=…&sig=…` в адреса на
//      страницата; панелът слага същия подпис за частен портал. Без проверката в
//      `withAccessQuery` се получаваше `…?expires=…&sig=…?expires=…&sig=…` — тоест счупен
//      адрес, който изглежда валиден.
//
// Минава се САМО през интерфейса: форма, натискания, екран; мрежата се пипа само за да се
// подмени отговорът на сървъра (не за да се „помогне“ на кода, който проверяваме).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { mountApp } = require('./lib/gui-journey.cjs');

const SIGNED = 'contract-signed';
const SOURCE = 'contract-source';
const BUDGET = Number(process.env.HAPI_GUI_TIMEOUT_MS || 45000);
const text = (node) => String((node && node.textContent) || '').replace(/\s+/g, ' ').trim();
const occurrences = (haystack, needle) => String(haystack).split(needle).length - 1;

(async () => {
  const server = await startServer();
  const origin = server.base;
  const shareDir = (slug) => path.join(server.storageRoot(), 'share', slug);
  const wipe = () => {
    for (const slug of [SIGNED, SOURCE]) {
      try { fs.rmSync(shareDir(slug), { recursive: true, force: true }) } catch { /* заключен файл */ }
    }
  };
  wipe();
  const app = mountApp(server);
  try {
    const settle = (label) =>
      waitFor(() => {
        const host = app.view();
        if (!host) return false;
        const body = text(host);
        return body.length > 0 && !/Зареждам/.test(body);
      }, { label: label || 'изгледът да утихне', timeout: BUDGET });

    // Редовете на QR студиото са ЕДИНСТВЕНОТО място, където панелът показва адресите.
    // Затвореното студио остава в документа (скрито) — затова се чете САМО отвореното,
    // иначе тестът вижда редовете на предишния портал.
    const studioOpen = () => Boolean(app.window.HapiQrStudio && app.window.HapiQrStudio.isOpen());
    const links = () =>
      (studioOpen() ? Array.from(app.document.querySelectorAll('#qs-modal .qs-link-row')) : []).map((row) => ({
        href: (row.querySelector('.qs-link-value') || { textContent: '' }).textContent.trim(),
        label: text(row.querySelector('.qs-link-label')),
      }));
    const pageRow = (found) => found.find((l) => /\/p\/[^/]/.test(l.href));
    const apiRow = (found) => found.find((l) => /\/api\/v1\/p\//.test(l.href));

    const createPortal = async (slug, title) => {
      // След създаване панелът отваря САМО новия портал; „Нов портал“ живее в списъка,
      // тоест първо се връщаш към него — както прави човек с бутона „към списъка“.
      const back = app.$('[data-close-portal]');
      if (back) back.click();
      const fresh = app.$('#pf-new');
      if (fresh) fresh.click();
      await waitFor(() => app.$('#pf-create'), { label: 'формата за нов портал' });
      app.fill('[name="slug"]', slug);
      app.fill('[name="title"]', title);
      // Частен портал: сървърът издава подписан достъп и го слага в адресите на договора.
      app.select('[name="visibility"]', 'private');
      // Спътникът „само за преглед“ не е нужен тук — тогава редовете са само от портала.
      const readOnly = app.$('[name="readonly_view"]');
      if (readOnly && readOnly.checked) app.check('[name="readonly_view"]', false);
      app.clearToasts();
      app.click('#pf-create', 'бутонът „Създай и генерирай API + QR“');
      const toast = await waitFor(() => {
        const said = app.toast();
        return said && /създаден/i.test(said.message) ? said : null;
      }, { label: `порталът „${slug}“ да е създаден`, timeout: BUDGET });
      assert.equal(toast.kind, 'ok', `порталът „${slug}“ се създава: ` + toast.message);
      const found = await waitFor(() => {
        const rows = links();
        return pageRow(rows) ? rows : null;
      }, { label: `адресите на „${slug}“ в QR блока`, timeout: BUDGET });
      return found;
    };

    const closeStudio = () => {
      const close = app.$('#qs-close');
      if (close) close.click();
    };

    // ── 1. Подписаният достъп се слага ВЕДНЪЖ ────────────────────────────────
    app.nav('portals');
    await settle('панелът „Портали“');
    const signed = await createPortal(SIGNED, 'Подписан договор');
    const signedPage = pageRow(signed);
    assert.match(signedPage.href, /\/p\/[^/?]+/, 'страницата на портала е показана: ' + signedPage.href);
    assert.equal(
      occurrences(signedPage.href, 'expires='),
      1,
      'подписът е в адреса ВЕДНЪЖ, не два пъти (иначе адресът е счупен): ' + signedPage.href,
    );
    assert.equal(occurrences(signedPage.href, 'sig='), 1, 'един подпис в адреса: ' + signedPage.href);
    assert.doesNotMatch(signedPage.href, /sig=[^&?]+\?/, 'вторият подпис не се залепва след първия: ' + signedPage.href);
    const signedApi = apiRow(signed);
    assert.ok(signedApi, 'адресът на API-то също е показан: ' + signed.map((l) => l.href).join(' | '));
    assert.equal(occurrences(signedApi.href, 'sig='), 1, 'и API адресът носи подписа веднъж: ' + signedApi.href);
    // Адресът с ЕДИН подпис е истински: частният портал се отваря с него.
    const live = await app.openLink(signedPage.href);
    assert.equal(live.status, 200, 'подписаният адрес от екрана се отваря: ' + live.status);
    closeStudio();

    // ── 2. Договорът на сървъра печели пред `buildReferences` ────────────────
    // Заглавният договор носи адреси, които панелът НЕ строи сам (`from-contract`), тоест
    // показаното на екрана може да дойде само от него.
    const sentinel = {
      ready: true,
      id: 'from-contract',
      slug: 'from-contract',
      readonly: false,
      page: origin + '/p/from-contract',
      api: origin + '/api/v1/p/from-contract.api',
      manifest: origin + '/api/v1/p/from-contract.api/manifest',
      openapi: origin + '/api/v1/p/from-contract.api/openapi.json',
      qr: origin + '/api/v1/p/from-contract.api/qr.svg',
      readOnly: null,
    };
    let intercepted = 0;
    app.setFetchInterceptor((full) => {
      if (!/\/api-info(\?|$)/.test(String(full))) return null;
      intercepted += 1;
      return new Response(JSON.stringify({ accessQuery: '', accessExpires: null, contract: sentinel }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const sourced = await createPortal(SOURCE, 'Договорът е източникът');
    assert.ok(intercepted > 0, 'панелът попита сървъра за договора (иначе тестът не проверява нищо)');
    app.setFetchInterceptor(null);

    const sourcePage = pageRow(sourced);
    assert.ok(
      sourcePage.href.startsWith(sentinel.page + '?'),
      'страницата е адресът от ДОГОВОРА, не построеният в панела: ' + sourcePage.href,
    );
    assert.equal(occurrences(sourcePage.href, 'sig='), 1, 'и тук подписът е веднъж: ' + sourcePage.href);
    const sourceApi = apiRow(sourced);
    assert.ok(sourceApi, 'API адресът от договора е показан: ' + sourced.map((l) => l.href).join(' | '));
    assert.ok(
      sourceApi.href.startsWith(sentinel.api),
      'API-то също идва от договора: ' + sourceApi.href,
    );

    console.log(
      'PASS gui-contract-single-source: подписаният достъп се слага веднъж (страница и API) · ' +
        'адресът от договора печели пред построения в панела · заглавният договор се вижда на екрана',
    );
  } finally {
    app.setFetchInterceptor(null);
    wipe();
    await server.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
