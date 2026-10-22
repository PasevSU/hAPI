'use strict';
// Панелът „Кой влиза“ (ui/visitors-panel.js) върху ЖИВ add-on: рисува реалните сензори,
// показва кой, какво, колко и откъде, изтрива посетител с потвърждение и изнася CSV.
// Проверява се резултатът в DOM, не само че кодът не гърми.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, mountUi, waitFor } = require('./lib/gui-harness.cjs');

const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-vpanel-'));
const geoFile = path.join(tmp, 'geoip.json');
fs.writeFileSync(geoFile, JSON.stringify({ ranges: [{ cidr: '203.0.113.0/24', country: 'BG', city: 'София' }] }));

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const buttonByText = (host, pattern) => host.querySelectorAll('button').find((b) => pattern.test(text(b))) || null;

(async () => {
  const server = await startServer({ env: { VISITOR_IP_MODE: 'full', TRUST_PROXY: 'true', GEOIP_DB_PATH: geoFile } });
  const { api, authFetch, base } = server;

  try {
    // ── Данни: портал с публичен файл и реален трафик от два „различни“ клиента ──
    const portal = await api('/admin/api/portals', 'POST', { slug: 'vpanel', title: 'Панел посетители' });
    assert.equal(portal.status, 201, JSON.stringify(portal.data));
    const portalId = portal.data.id;
    assert.equal((await api(`/admin/api/portals/${portalId}`, 'PATCH', { visibility: 'public' })).status, 200);

    const up = await authFetch(`${base}/admin/api/portals/${portalId}/files`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-File-Name': 'dogovor.txt', 'X-File-Encrypt': '0' }, body: 'съдържание',
    });
    assert.equal(up.status, 201);
    const fileId = (await up.json()).id;

    const human = { 'X-Forwarded-For': '203.0.113.9', 'User-Agent': EDGE, 'Accept-Language': 'bg-BG,bg;q=0.9', Referer: 'https://www.google.com/search?q=dogovor' };
    const page = await fetch(`${base}/p/${portalId}`, { headers: human });
    assert.equal(page.status, 200);
    await page.text();
    const dl = await fetch(`${base}/api/v1/p/vpanel/files/${fileId}/download`, { headers: human });
    assert.equal(dl.status, 200);
    await dl.text();
    const bot = await fetch(`${base}/p/${portalId}`, { headers: { 'X-Forwarded-For': '198.51.100.4', 'User-Agent': BOT } });
    assert.equal(bot.status, 200);
    await bot.text();

    // ── Панелът ────────────────────────────────────────────────────────────────
    const ui = mountUi(server, { modules: ['data.js', 'icons.js', 'visitors-panel.js'] });
    const w = ui.window;
    assert.ok(w.HapiVisitorsPanel, 'модулът се зарежда');

    const host = ui.container();
    w.HapiVisitorsPanel.mount(host);

    await waitFor(() => text(host).includes('Уникални посетители'), { label: 'заглавието на картите', timeout: 15000 });
    await waitFor(() => host.querySelectorAll('#v-visitors tbody tr').length >= 2, { label: 'двама посетителя в таблицата', timeout: 15000 });

    // Картите показват РЕАЛНИТЕ числа от сензорите — сверяваме ги със самия API,
    // вместо да ги хардкодваме (администраторските заявки по-горе също са посетители).
    const live = (await api('/admin/api/sensors')).data.visitorsIntel;
    assert.equal(live.unique_visitors >= 2, true, 'сензорите виждат поне двама души');
    const cards = text(host.querySelector('#v-cards'));
    assert.match(cards, new RegExp('Уникални посетители ' + live.unique_visitors + ' '));
    assert.match(cards, new RegExp('Теглили файл ' + live.download_visitors + ' '));
    assert.match(cards, /Държави 1/);
    assert.equal(host.querySelector('#v-badge').textContent.includes('пълни IP'), true, 'режимът на IP се вижда: ' + host.querySelector('#v-badge').textContent);

    // Редът на човека: IP, локация, изтегляния.
    const rows = host.querySelectorAll('#v-visitors tbody tr');
    const humanRow = rows.find((row) => text(row).includes('203.0.113.9'));
    assert.ok(humanRow, 'редът с IP адреса е налице');
    assert.match(text(humanRow), /София, BG/, 'локацията идва от офлайн базата');
    assert.match(text(humanRow), /Клиент|edge · windows · desktop/, 'клиентът е разпознат');
    const botRow = rows.find((row) => text(row).includes('198.51.100.4'));
    assert.ok(botRow, 'ботът е отделен ред');
    assert.match(text(botRow), /неизвестно/, 'без диапазон в базата локацията е „неизвестно“, не се измисля');

    // Какво се тегли и откъде идват.
    assert.match(text(host.querySelector('#v-files tbody')), /dogovor\.txt/);
    assert.match(text(host.querySelector('#v-files tbody')), /1/);
    assert.match(text(host.querySelector('#v-geo tbody')), /BG/);

    // ── Изтриване с потвърждение ───────────────────────────────────────────────
    const deleteButton = humanRow.querySelectorAll('button').find((b) => /Изтрий/.test(text(b)));
    assert.ok(deleteButton, 'има бутон „Изтрий“ в реда');
    const visitorId = deleteButton.dataset.id;
    assert.ok(visitorId, 'бутонът носи идентификатора на посетителя');
    deleteButton.click();

    await waitFor(() => !text(host.querySelector('#v-visitors tbody')).includes('203.0.113.9'), { label: 'редът да изчезне', timeout: 15000 });
    assert.equal((await api(`/admin/api/sensors/visitors/${visitorId}`)).status, 404, 'профилът е изтрит и на сървъра');

    // ── CSV експорт ────────────────────────────────────────────────────────────
    const csv = buttonByText(host, /^Експорт CSV$/);
    assert.ok(csv, 'има бутон за CSV');
    ui.clearToasts();
    csv.click();
    await waitFor(() => ui.toasts.some((t) => /CSV|Експорт/.test(t.message)), { label: 'съобщението за CSV', timeout: 15000 });
    assert.match(ui.toasts.map((t) => t.message).join(' | '), /CSV файлът е изтеглен/);

    // ── Обновяване: показва каквото сървърът казва сега ───────────────────────
    const before = host.querySelector('#v-badge').textContent;
    buttonByText(host, /^Обнови$/).click();
    await waitFor(() => /пълни IP|маскирани|хеш/.test(host.querySelector('#v-badge').textContent), { label: 'обновяването', timeout: 15000 });
    assert.match(host.querySelector('#v-badge').textContent, /IP|хеш/, 'след обновяване badge-ът пак показва режима (преди: ' + before + ')');

    console.log('PASS visitors-panel: реални сензори в DOM · IP и локация · какво се тегли · изтриване · CSV');
  } catch (e) {
    console.error('\n✘ ПРОВАЛ: ' + (e && e.message ? e.message : e) + '\n');
    throw e;
  } finally {
    await server.stop({ keep: true }).catch(() => { });
    try { fs.rmSync(server.dir, { recursive: true, force: true }) } catch { /* Windows може да държи файла */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* същото */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
