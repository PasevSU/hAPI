'use strict';
// ДОГОВОРЪТ СЕ ВИЖДА В ПАНЕЛА ВЕДНАГА СЛЕД СЪЗДАВАНЕТО (0.69.219).
//
// Заявката на собственика: „API и QR кодовете за целия портал, за файловете и read-only още
// при създаването; те трябва да водят към портала, който дори и да няма нищо публикувано,
// трябва да го отразява“.
//
// `portal-creation-contract.cjs` пази СЪРВЪРА (какви адреси издава). Тук се пази ПАНЕЛЪТ и се
// минава САМО през него — форма, натискания, екран:
//   • порталът се създава с бутона „Създай и генерирай API + QR“;
//   • QR кодът се отваря САМ, а под него стои договорът от СЪРВЪРА: страница · API ·
//     преглед (read-only) — без втора заявка и без панелът да си измисля адреси;
//   • порталът е ПРАЗЕН и това не пречи: и трите адреса се отварят (проверяват се през
//     `app.openLink`, тоест по вече показан адрес, не със заявка вместо интерфейса).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, waitFor } = require('./lib/gui-harness.cjs');
const { mountApp } = require('./lib/gui-journey.cjs');

const SLUG = 'panel-contract';
const BUDGET = Number(process.env.HAPI_GUI_TIMEOUT_MS || 45000);
const text = (node) => String((node && node.textContent) || '').replace(/\s+/g, ' ').trim();

(async () => {
  const server = await startServer();
  // Остатъци от предишен пуск в тестовото хранилище — чистят се преди и след.
  const shareDir = path.join(server.storageRoot(), 'share', SLUG);
  const wipe = () => { try { fs.rmSync(shareDir, { recursive: true, force: true }) } catch { /* заключен файл */ } };
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

    // ── Създаване през ФОРМАТА на панела ─────────────────────────────────────
    app.nav('portals');
    await settle('панелът „Портали“');
    app.click('#pf-new', 'бутонът „Нов портал“');
    await waitFor(() => app.$('#pf-create'), { label: 'формата за нов портал' });
    app.fill('[name="slug"]', SLUG);
    app.fill('[name="title"]', 'Панел и договор');
    app.select('[name="visibility"]', 'public');
    // „Само за преглед“ е отметнато по подразбиране — спътникът се създава заедно с портала.
    const readOnly = app.$('[name="readonly_view"]');
    if (readOnly && readOnly.checked !== true) app.check('[name="readonly_view"]', true);
    app.clearToasts();
    app.click('#pf-create', 'бутонът „Създай и генерирай API + QR“');
    const toast = await waitFor(() => {
      const said = app.toast();
      return said && /създаден/i.test(said.message) ? said : null;
    }, { label: 'порталът да е създаден', timeout: BUDGET });
    assert.equal(toast.kind, 'ok', 'порталът се създава: ' + toast.message);

    // ── Договорът е на екрана, преди да има и един файл ──────────────────────
    const links = () =>
      Array.from(app.document.querySelectorAll('.pf-qr-pop'))
        .filter((block) => !block.hasAttribute('hidden'))
        .flatMap((block) =>
          Array.from(block.querySelectorAll('.pf-qr-pop-links a')).map((a) => ({
            href: a.getAttribute('href') || '',
            label: text(a),
          })),
        );
    const shown = await waitFor(() => {
      const found = links();
      return found.length >= 3 ? found : null;
    }, { label: 'трите адреса от договора в отворения QR блок', timeout: BUDGET });

    const page = shown.find((l) => /\/p\//.test(l.href) && !/\/api\//.test(l.href));
    const api = shown.find((l) => /\/api\/v1\/p\//.test(l.href));
    // Адресът на прегледа се разпознава по ЕТИКЕТА, не по подниз в адреса: страницата на
    // спътника е `/p/<неговия id>` (id, не slug — както при всеки портал), тоест „view“
    // в адреса няма.
    const preview = shown.find((l) => /Преглед|Preview|Vorschau/i.test(l.label));
    assert.ok(page, 'адресът на портала е показан: ' + shown.map((l) => l.href).join(' | '));
    assert.ok(api, 'адресът на API-то е показан');
    assert.ok(preview, 'адресът на прегледа (read-only) е показан — той е част от договора');
    assert.match(preview.href, /\/p\//, 'прегледът е страница, не API: ' + preview.href);
    assert.notEqual(page.href, preview.href, 'прегледът е СВОЯ страница, не същата като портала');

    // QR кодът в същия блок сочи ЧОВЕШКАТА страница, не JSON-а.
    const pop = Array.from(app.document.querySelectorAll('.pf-qr-pop')).find((block) => !block.hasAttribute('hidden'));
    const qrLink = pop && pop.querySelector('.pf-qr-pop-link');
    assert.ok(qrLink, 'QR кодът е нарисуван в блока');
    assert.equal(qrLink.getAttribute('href'), page.href, 'QR кодът сочи страницата на портала');

    // ── И трите водят до жива страница, макар порталът да е ПРАЗЕН ───────────
    for (const item of [['портал', page], ['преглед', preview], ['API', api]]) {
      const res = await app.openLink(item[1].href);
      assert.equal(res.status, 200, `${item[0]} се отваря, макар порталът да е празен: ` + res.status);
    }
    const emptyPage = await app.openLink(page.href);
    assert.match(emptyPage.body, /id="hapi-boot"/, 'страницата е истинската публична страница, не съобщение за грешка');

    console.log(
      'PASS gui-portal-create-contract: създаден през формата · QR блокът показва договора от сървъра — ' +
        `страница (${page.label}) · API (${api.label}) · преглед (${preview.label}) · QR сочи страницата · и трите се отварят на ПРАЗЕН портал`,
    );
  } finally {
    wipe();
    await server.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
