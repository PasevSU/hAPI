'use strict';
// Публичен токен за портал — ПРЕЗ ИНТЕРФЕЙСА, не през API-то.
//
// Правилото на проекта: функция, която не може да се стигне от панела, е недовършена.
// Затова тук се натискат истинските бутони в „Контролен панел на портала“:
//   • порталът е частен и add-on-ът иска токен (`require_portal_token`) → адресът е 404;
//   • „Издай токен за портал“ дава адрес `/t/<токен>`, който се отваря и дава бисквитка;
//   • с бисквитката порталът се отваря (200), а без нея — не;
//   • „Покажи издадените“ връща списък, а „Отнеми“ спира бисквитката веднага.
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor } = require('./lib/gui-harness.cjs');
const { stopChild } = require('./helpers.cjs');

const PANEL_MODULES = [
  'data.js', 'icons.js', 'report-studio.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'files-manager.js', 'directory-panel.js',
  'dashboard-panel.js', 'settings-panel.js', 'export-center.js', 'public-gateway.js',
  'visitors-panel.js', 'secret-share.js', 'report-sign.js',
];

const buttonByText = (host, pattern) => [...host.querySelectorAll('button')].find((b) => pattern.test(b.textContent || '')) || null;
const cookieOf = (res) => {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  return String(raw.join(';')).split(';')[0];
};

(async () => {
  // Именно режимът на add-on-а: без токен порталът не се отваря отвън.
  const server = await startServer({ env: { REQUIRE_PORTAL_TOKEN: 'true' } });
  try {
    const portal = await server.api('/admin/api/portals', 'POST', { slug: 'token-ui', title: 'Токен от панела', visibility: 'private' });
    assert.equal(portal.status, 201, 'порталът е създаден: ' + JSON.stringify(portal.data));
    const portalId = portal.data.id;

    const bare = await fetch(server.base + '/p/' + portalId);
    await bare.text();
    assert.equal(bare.status, 404, 'без токен частният портал не се отваря');

    const ui = mountUi(server, { modules: PANEL_MODULES });
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portalId;
    ui.window.FilesManagerPanel.state.panel = 'actions';
    ui.window.FilesManagerPanel.mount(host);

    await waitFor(() => host.textContent.includes('Публичен достъп'), { label: 'секцията „Публичен достъп“' });

    // ── 1. Издаване през бутона ───────────────────────────────────────────────
    const issue = buttonByText(host, /Издай токен/);
    assert.ok(issue, 'има бутон „Издай токен за портал“');
    issue.click();
    await waitFor(() => /\/t\/pt_[A-Za-z0-9_-]{20,}/.test(host.textContent), { label: 'адресът с токена' });
    const tokenUrl = /https?:\/\/\S+\/t\/pt_[A-Za-z0-9_-]+/.exec(host.textContent);
    assert.ok(tokenUrl, 'панелът показва готовия адрес с токен');
    assert.match(host.textContent, /показва само сега/i, 'казва, че токенът не се показва повторно');

    // ── 2. Адресът работи: бисквитка + отваряне ──────────────────────────────
    const entered = await fetch(tokenUrl[0], { redirect: 'manual' });
    assert.equal(entered.status, 302, 'входът по токен пренасочва');
    const cookie = cookieOf(entered);
    assert.match(cookie, /hapi_session=/, 'издава се бисквитка');
    const opened = await fetch(server.base + '/p/' + portalId, { headers: { cookie } });
    const html = await opened.text();
    assert.equal(opened.status, 200, 'с бисквитката порталът се отваря');
    assert.ok(html.includes('/portal.js'), 'отваря се истинската страница на портала');

    // ── 3. Списък и отнемане през панела ─────────────────────────────────────
    const list = buttonByText(host, /Покажи издадените/);
    assert.ok(list, 'има бутон „Покажи издадените“');
    list.click();
    await waitFor(() => buttonByText(host, /Отнеми/), { label: 'списъкът с токени' });
    const revoke = buttonByText(host, /Отнеми/);
    revoke.click();
    await waitFor(() => /Токенът е отнет/.test(host.textContent), { label: 'потвърждението за отнемане' });

    const afterRevoke = await fetch(server.base + '/p/' + portalId, { headers: { cookie } });
    await afterRevoke.text();
    assert.equal(afterRevoke.status, 404, 'след отнемане старата бисквитка не отваря портала');

    console.log('gui-portal-token OK: токен през панела · /t/<токен> отваря · отнемане спира бисквитката');
  } finally {
    await stopChild(server.child);
    await server.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
