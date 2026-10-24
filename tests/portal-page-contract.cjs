'use strict';
// ДОГОВОР: публичната страница на портала (documentation/04_FUNCTION_SPECIFICATIONS/PORTAL_PAGE_CONTRACT.md).
//
// Проверява се всяко REQ от договора на живо, а не „страницата се отваря“:
//   PP-01 id на портала · PP-02 QR към страницата · PP-03/PP-06 резюме и „цялостен набор“
//   PP-04 изписан адрес за изтегляне · PP-05 „Изтегли“ сваля · PP-07 съобщение само за админ
//   PP-08 сигурност · PP-10 портален токен в линковете
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { startServer } = require('./lib/gui-harness.cjs');

const ROOT = path.join(__dirname, '..');
const ADDON = path.join(ROOT, 'hapi_enterprise');
const svgFor = (text) => {
  const q = require('../hapi_enterprise/qrcode.js')(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
};

(async () => {
  const server = await startServer({ env: { PUBLIC_BASE_URL: 'https://example.test' }, keepData: true });
  const { api, authFetch, base } = server;
  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

  const upload = async (portalId, name, text) => {
    const res = await authFetch(`${base}/admin/api/portals/${portalId}/files`, {
      method: 'POST',
      headers: { 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'text/plain' },
      body: text,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };

  try {
    const created = await api('/admin/api/portals', 'POST', {
      slug: 'contract',
      title: 'Документи по дело 2026-114',
      description: 'Пълен набор от доказателства по делото.',
      visibility: 'public',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const portalId = created.data.id;

    const free = await upload(portalId, 'dogovor.txt', 'свободен файл');
    const keyed = await upload(portalId, 'akt.pdf', 'файл с ключ');
    const blocked = await upload(portalId, 'arhiv.zip', 'забранен файл');
    assert.deepEqual([free.status, keyed.status, blocked.status], [201, 201, 201]);
    assert.equal((await api(`/admin/api/portals/${portalId}/files/${keyed.data.id}/access`, 'PATCH', { mode: 'KEY_REQUIRED', listed: true, reason: 'тест: ключ' })).status, 200);
    assert.equal((await api(`/admin/api/portals/${portalId}/files/${blocked.data.id}/access`, 'PATCH', { mode: 'DISABLED', listed: true, reason: 'тест: недостъпен' })).status, 200);

    // ── PP-01/PP-02/PP-03: страницата има елементите за id, QR и резюме ──────────────
    const page = await fetch(`${base}/p/${portalId}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    for (const id of ['portal-id', 'copy-id', 'summary', 'summary-list', 'qr', 'files']) {
      assert.ok(html.includes(`id="${id}"`), `страницата съдържа #${id} (договорът го изисква)`);
    }
    assert.ok(html.includes('Какво съдържа този портал'), 'заглавието на резюмето е по договора');
    assert.ok(html.includes('Идентификатор на портала'), 'етикетът на идентификатора е по договора');
    assert.match(page.headers.get('content-security-policy') || '', /img-src 'self' data:/, 'CSP позволява QR изображението');

    // ── PP-01…PP-05, PP-10: кодът на страницата изпълнява договора ──────────────────
    const script = await (await fetch(`${base}/portal.js`)).text();
    for (const needle of [
      'portal-id', // PP-01
      'paintSummary', // PP-03
      'downloadUrlFor', // PP-04
      'a.setAttribute("download"', // PP-05 — истински линк за сваляне
      'withAuth(', // PP-10
      'applyLanguage', // PP-14 — езикът се прилага на едно място
      'I18N', // PP-14 — текстовете идват от речника
    ]) {
      assert.ok(script.includes(needle), `portal.js съдържа ${needle}`);
    }
    // Точните формулировки живеят в речника (portal-i18n.js) — там се проверяват,
    // за да не се разминават българският текст и преводите.
    const i18nScript = await (await fetch(`${base}/portal-i18n.js`)).text();
    for (const needle of [
      'Адрес за изтегляне', // PP-04
      'Този портал е цялостен набор от ', // PP-06
      'още не съдържа файлове', // PP-03 при празен портал
      'Сканирай кода', // PP-02 — подсказката при QR кода
    ]) {
      assert.ok(i18nScript.includes(needle), `речникът съдържа ${needle}`);
    }
    assert.equal(/\/admin\/api\/packages/.test(script), false, 'страницата не обещава ZIP пакет, който не съществува');
    assert.equal(/innerHTML\s*=\s*[^'"`]*(file\.|data\.|listing)/.test(script), false, 'данните не влизат през innerHTML (INV-9)');
    const css = await (await fetch(`${base}/portal.css`)).text();
    for (const cls of ['.summary-panel', '.summary-text', '.file-link', '.ident', '.btn-sm']) {
      assert.ok(css.includes(cls), `portal.css съдържа ${cls}`);
    }

    // ── Договорът на данните: id, брой файлове, адрес на QR ────────────────────────────
    const view = await (await fetch(`${base}/api/v1/p/${portalId}`)).json();
    assert.equal(view.id, portalId, 'страницата получава id на портала');
    assert.equal(view.fileCount, 3, 'резюмето има от какво да брои файловете');
    assert.equal(view.urls.qrTarget, '/p/' + portalId, 'QR води до страницата, не до JSON (INV-2)');
    const listing = await (await fetch(`${base}/api/v1/p/contract/files`)).json();
    assert.deepEqual(listing.files.map((f) => f.accessMode).sort(), ['DISABLED', 'FREE', 'KEY_REQUIRED']);

    // ── PP-05: „Изтегли“ сваля, а забраненият файл не се отваря ─────────────────────────
    const dl = (id, headers = {}) => fetch(`${base}/api/v1/p/contract/files/${id}/download`, { headers });
    const freeRes = await dl(free.data.id);
    assert.equal(freeRes.status, 200);
    assert.equal(sha(await freeRes.text()), sha('свободен файл'));
    assert.equal((await dl(keyed.data.id)).status, 403, 'файл с ключ без ключ → 403');
    const minted = await api(`/admin/api/portals/${portalId}/files/${keyed.data.id}/access-keys`, 'POST', {});
    assert.equal(minted.status, 201);
    assert.equal((await dl(keyed.data.id, { 'X-File-Key': minted.data.key })).status, 200, 'с верен ключ → 200');
    assert.equal((await dl(blocked.data.id)).status, 403, 'забранен файл → 403 (INV-6)');

    // ── PP-02: QR файлът кодира точно страницата ──────────────────────────────────────
    const qr = await (await fetch(`${base}/api/v1/p/contract/qr.svg`)).text();
    assert.equal(qr, svgFor('https://example.test/p/' + portalId), 'qr.svg = SVG(/p/<id>)');

    // ── PP-07: съобщение — само admin и само при конфигуриран HA ──────────────────────
    const anon = await fetch(`${base}/admin/api/notify/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'notify.smtp', portalId }),
    });
    assert.equal(anon.status, 401, 'без токен → 401 (INV-8)');
    const noHa = await api('/admin/api/notify/dispatch', 'POST', { service: 'notify.smtp', portalId });
    assert.equal(noHa.status, 503, 'без SUPERVISOR_TOKEN → 503');

    // ── PP-03: празен портал казва точно това, което е ─────────────────────────────────
    const empty = await api('/admin/api/portals', 'POST', { slug: 'empty-portal', title: 'Празен', visibility: 'public' });
    assert.equal(empty.status, 201);
    const emptyView = await (await fetch(`${base}/api/v1/p/${empty.data.id}`)).json();
    assert.equal(emptyView.fileCount, 0);

    console.log(
      'PASS portal-page-contract: id + QR + резюме · адрес за изтегляне изписан · FREE 200/KEY 403→200/DISABLED 403 · ' +
      'QR = SVG(/p/<id>) · съобщение само за админ (401/503)'
    );
  } finally {
    await server.stop({ keep: true }).catch(() => { });
    try { fs.rmSync(server.dir, { recursive: true, force: true }); } catch { /* Windows може да държи файла още */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
