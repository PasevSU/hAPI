'use strict';
// Мониторингът в панела с порталите (ui/files-manager.js): всички данни от сензорите —
// общо за инсталацията и за всеки портал поотделно. Проверява се какво е НАРИСУВАНО,
// сверено със самия API, а не с хардкоднати числа.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, mountUi, waitFor } = require('./lib/gui-harness.cjs');

const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';
const BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const BG = { 'X-Forwarded-For': '203.0.113.9', 'User-Agent': EDGE, 'Accept-Language': 'bg-BG' };
const DE = { 'X-Forwarded-For': '198.51.100.4', 'User-Agent': FIREFOX, 'Accept-Language': 'de-DE' };
const ROBOT = { 'X-Forwarded-For': '192.0.2.77', 'User-Agent': BOT };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-pmon-'));
const geoFile = path.join(tmp, 'geoip.json');
fs.writeFileSync(geoFile, JSON.stringify({
  ranges: [
    { cidr: '203.0.113.0/24', country: 'BG', city: 'София' },
    { cidr: '198.51.100.0/24', country: 'DE', city: 'Berlin' },
  ],
}));

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

(async () => {
  const server = await startServer({ env: { VISITOR_IP_MODE: 'full', TRUST_PROXY: 'true', GEOIP_DB_PATH: geoFile } });
  const { api, authFetch, base } = server;

  try {
    // ── Два портала с файлове и реален трафик от три „различни“ клиента ─────────
    const mk = async (slug, title) => {
      const created = await api('/admin/api/portals', 'POST', { slug, title });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      assert.equal((await api(`/admin/api/portals/${created.data.id}`, 'PATCH', { visibility: 'public' })).status, 200);
      return created.data.id;
    };
    const upload = async (portalId, name, body) => {
      const up = await authFetch(`${base}/admin/api/portals/${portalId}/files`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-File-Name': name, 'X-File-Encrypt': '0' }, body,
      });
      assert.equal(up.status, 201, await up.text());
    };

    const portalA = await mk('mon-a', 'Портал А');
    const portalB = await mk('mon-b', 'Портал Б');
    await upload(portalA, 'dogovor.txt', 'договор');
    await upload(portalA, 'prilojenie.txt', 'приложение');
    await upload(portalB, 'otchet.txt', 'отчет');

    const filesA = (await api(`/admin/api/portals/${portalA}`)).data.files;
    const filesB = (await api(`/admin/api/portals/${portalB}`)).data.files;
    const dogovor = filesA.find((f) => f.name === 'dogovor.txt');
    const otchet = filesB.find((f) => f.name === 'otchet.txt');

    const go = async (url, headers) => { const r = await fetch(base + url, { headers }); const body = await r.text(); return { status: r.status, body } };
    assert.equal((await go(`/p/${portalA}`, BG)).status, 200);
    assert.equal((await go(`/p/${portalA}`, DE)).status, 200);
    assert.equal((await go(`/api/v1/p/mon-a/files/${dogovor.id}/download`, BG)).status, 200);
    assert.equal((await go(`/p/${portalB}`, ROBOT)).status, 200);
    assert.equal((await go(`/api/v1/p/mon-b/files/${otchet.id}/download`, ROBOT)).status, 200);

    // Отказ: забраняваме файл и DE го опитва.
    assert.equal((await api(`/admin/api/portals/${portalA}/files/${dogovor.id}/access`, 'PATCH', { mode: 'DISABLED', reason: 'тест: недостъпен' })).status, 200);
    assert.equal((await go(`/api/v1/p/mon-a/files/${dogovor.id}/download`, DE)).status, 403);
    assert.equal((await api(`/admin/api/portals/${portalA}/files/${dogovor.id}/access`, 'PATCH', { mode: 'FREE' })).status, 200);

    // ── Очакваните числа идват от API, не от главата на теста ──────────────────
    const live = (await api('/admin/api/sensors')).data.visitorsIntel;
    const liveA = live.portals.find((p) => p.id === portalA);
    const liveB = live.portals.find((p) => p.id === portalB);
    assert.ok(liveA && liveB, 'сензорите виждат и двата портала');
    assert.equal(liveA.visits, 2, 'две отваряния на портала А');
    assert.equal(liveA.downloads, 1);
    assert.equal(liveA.denied, 1, 'един отказан опит');
    assert.equal(liveA.visitors, 2, 'двама души в А');
    assert.equal(liveA.geo.countries.BG, 1, 'А има посетител от BG');
    assert.equal(liveA.geo.countries.DE, 1, 'и от DE');
    assert.equal(liveB.geo.unknown, 1, 'ботът в Б е от адрес извън базата');

    // ── Панелът ────────────────────────────────────────────────────────────────
    const ui = mountUi(server, { modules: ['data.js', 'icons.js', 'files-manager.js'] });
    const w = ui.window;
    assert.ok(w.FilesManagerPanel, 'панелът се зарежда');
    const host = ui.container();
    w.FilesManagerPanel.mount(host);

    await waitFor(() => host.querySelector('#pf-monitor'), { label: 'секцията „Мониторинг“', timeout: 20000 });
    await waitFor(() => text(host.querySelector('#pf-monitor')).includes('Уникални посетители'), { label: 'картите', timeout: 20000 });
    await waitFor(() => host.querySelector('#pf-monitor-portals'), { label: 'таблицата с портали', timeout: 20000 });

    // Общо: числата съвпадат с API-то.
    const monitorText = () => text(host.querySelector('#pf-monitor'));
    assert.match(monitorText(), new RegExp('Уникални посетители ' + live.unique_visitors + ' '));
    assert.match(monitorText(), new RegExp('Изтегляния ' + live.totals.downloads + ' '));
    assert.match(monitorText(), new RegExp('Отказани достъпи ' + live.denied_total + ' '));
    assert.match(monitorText(), /Режим на IP: full/);
    assert.match(monitorText(), /външни заявки: не/);
    assert.match(monitorText(), /KEY_REQUIRED|DISABLED/, 'причините за отказ се виждат');

    // Таблицата с портали нарежда по изтегляния и показва и двата.
    const portalsTable = text(host.querySelector('#pf-monitor-portals'));
    assert.match(portalsTable, /Портал А/);
    assert.match(portalsTable, /Портал Б/);
    const rowsOf = (table) => table.querySelectorAll('tbody tr').filter((tr) => tr.querySelectorAll('td').length > 1);
    assert.equal(rowsOf(host.querySelector('#pf-monitor-portals')).length, 2);

    // „Какво се тегли“ показва имената на файловете.
    const filesTable = text(host.querySelector('#pf-monitor-files'));
    assert.match(filesTable, /dogovor\.txt/);
    assert.match(filesTable, /otchet\.txt/);

    // ── Отваряме портала: мониторингът става за НЕГО ──────────────────────────
    const cardA = host.querySelectorAll('.pf-portal').find((card) => text(card).includes('Портал А'));
    assert.ok(cardA, 'картата на портал А е налице');
    const open = cardA.querySelector('button[data-open-portal]');
    assert.ok(open, 'има бутон „Отвори портала“');
    open.click();
    await waitFor(() => text(host.querySelector('#pf-monitor')).includes('Този портал'), { label: 'данните на портала', timeout: 20000 });
    const own = () => text(host.querySelector('#pf-monitor'));
    assert.match(own(), new RegExp('Посещения ' + liveA.visits + ' '));
    assert.match(own(), new RegExp('Изтегляния ' + liveA.downloads + ' '));
    assert.match(own(), new RegExp('Откази ' + liveA.denied + ' '));
    assert.match(own(), new RegExp('Посетители ' + liveA.visitors + ' '));
    assert.match(own(), /BG/, 'държавата на този портал е изписана');
    assert.match(own(), /DE/);
    assert.match(own(), /edge/, 'клиентът на този портал е изписан');
    assert.match(own(), /bg-bg|de-de/, 'езикът на този портал е изписан');

    // Таблицата с файлове е само за този портал.
    const ownFiles = text(host.querySelector('#pf-monitor-files'));
    assert.match(ownFiles, /dogovor\.txt/);
    assert.equal(ownFiles.includes('otchet.txt'), false, 'файлът на другия портал не бива да е тук');

    // ── Обновяване: нов трафик влиза без презареждане на страницата ────────────
    assert.equal((await go(`/p/${portalA}`, BG)).status, 200);
    host.querySelector('#pf-monitor-refresh').click();
    await waitFor(() => new RegExp('Посещения ' + (liveA.visits + 1) + ' ').test(text(host.querySelector('#pf-monitor'))), { label: 'обновените числа', timeout: 20000 });

    console.log('PASS portal-monitoring: общо + за портал · локация · клиенти · езици · файлове · обновяване');
  } catch (e) {
    console.error('\n✘ ПРОВАЛ: ' + (e && e.message ? e.message : e) + '\n');
    throw e;
  } finally {
    await server.stop({ keep: true }).catch(() => { });
    try { fs.rmSync(server.dir, { recursive: true, force: true }) } catch { /* Windows може да държи файла */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* същото */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
