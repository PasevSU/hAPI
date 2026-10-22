'use strict';
// ПЪЛЕН ПЪТ (сензори): цялата логика на наблюдението в един сценарий, в реда, в който
// я изживява администраторът — от първата публична заявка до рестарт и изтриване.
//
//   S01 подготовка (офлайн база, портал, файл, ключ)
//   S02 публичен трафик: посещение, изтегляне, отказ по ключ, отказан файл, скрит файл
//   S03 администраторски вход: успешен и отказан
//   S04 агрегати: точни числа, файлове, портали, причини за отказ
//   S05 локация: BG/DE/неизвестно/локално + презареждане на базата без рестарт
//   S06 режими на IP: masked и hashed (нов сървър) — адресът не се пази
//   S07 срок на пазене: старите записи изчезват (управляем часовник)
//   S08 CSV и Prometheus: точно съдържание, без имена на файлове в метриките
//   S09 панелът в DOM: числата са същите като от API, изтриване през бутона, CSV
//   S10 право на изтриване: профилът и следите му изчезват, влиза в одита
//   S11 рестарт: броячите оцеляват (flush при спиране + зареждане)
//   S12 одитната верига е валидна след всичко
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, mountUi, waitFor } = require('./lib/gui-harness.cjs');
const V = require('../hapi_enterprise/visitor-intel');

const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const FIREFOX_MOBILE = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';
const BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const HUMAN_A = { 'X-Forwarded-For': '203.0.113.9', 'User-Agent': EDGE, 'Accept-Language': 'bg-BG,bg;q=0.9', Referer: 'https://www.google.com/search?q=dogovor' };
const HUMAN_B = { 'X-Forwarded-For': '198.51.100.4', 'User-Agent': FIREFOX_MOBILE, 'Accept-Language': 'de-DE,de;q=0.9', Referer: 'https://t.me/share' };
const CRAWLER = { 'X-Forwarded-For': '192.0.2.77', 'User-Agent': BOT };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-sensors-journey-'));
const geoFile = path.join(tmp, 'geoip.json');
fs.writeFileSync(geoFile, JSON.stringify({
  ranges: [
    { cidr: '203.0.113.0/24', country: 'BG', region: 'София', city: 'София' },
    { cidr: '198.51.100.0/24', country: 'DE', region: 'Berlin', city: 'Berlin' },
  ],
}));

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

let current = 'S00';
const stage = async (name, fn) => { current = name; await fn(); console.log('  ✔ ' + name); };

(async () => {
  const env = { VISITOR_IP_MODE: 'full', TRUST_PROXY: 'true', GEOIP_DB_PATH: geoFile };
  const server = await startServer({ env });
  const { api, authFetch, base } = server;
  const dataDir = server.dir;
  const adminToken = server.token;
  let portalId = '', fileId = '', key = '';

  // ── S01 — подготовка ─────────────────────────────────────────────────────────
  await stage('S01 подготовка · портал, файл със ключ, офлайн база', async () => {
    const portal = await api('/admin/api/portals', 'POST', { slug: 'sensors', title: 'Сензори' });
    assert.equal(portal.status, 201, JSON.stringify(portal.data));
    portalId = portal.data.id;
    assert.equal((await api(`/admin/api/portals/${portalId}`, 'PATCH', { visibility: 'public' })).status, 200);

    const up = await authFetch(`${base}/admin/api/portals/${portalId}/files`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-File-Name': 'dogovor.txt', 'X-File-Encrypt': '0' }, body: 'съдържание на договора',
    });
    assert.equal(up.status, 201, await up.text());
    fileId = (await api(`/admin/api/portals/${portalId}/files`)).data.files[0].id;

    assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode: 'KEY_REQUIRED' })).status, 200);
    key = (await api(`/admin/api/portals/${portalId}/files/${fileId}/access-keys`, 'POST', {})).data.key;
    assert.ok(key, 'има издаден ключ');
  });

  // ── S02 — публичен трафик и откази ───────────────────────────────────────────
  await stage('S02 трафик · посещение · изтегляне · отказ по ключ · отказан файл · скрит файл', async () => {
    const pageA = await fetch(`${base}/p/${portalId}`, { headers: HUMAN_A });
    assert.equal(pageA.status, 200); await pageA.text();

    const noKey = await fetch(`${base}/api/v1/p/sensors/files/${fileId}/download`, { headers: HUMAN_A });
    assert.equal(noKey.status, 403, 'без ключ → 403'); await noKey.text();

    const withKey = await fetch(`${base}/api/v1/p/sensors/files/${fileId}/download`, { headers: { ...HUMAN_A, 'X-File-Key': key } });
    assert.equal(withKey.status, 200);
    assert.equal(await withKey.text(), 'съдържание на договора');

    const pageB = await fetch(`${base}/p/${portalId}`, { headers: HUMAN_B });
    assert.equal(pageB.status, 200); await pageB.text();
    const dlB = await fetch(`${base}/api/v1/p/sensors/files/${fileId}/download`, { headers: { ...HUMAN_B, 'X-File-Key': key } });
    assert.equal(dlB.status, 200); await dlB.text();

    // Отказан файл: DISABLED дава отказ дори с ключ.
    assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode: 'DISABLED' })).status, 200);
    const disabled = await fetch(`${base}/api/v1/p/sensors/files/${fileId}/download`, { headers: { ...HUMAN_A, 'X-File-Key': key } });
    assert.equal(disabled.status, 403, 'DISABLED → 403'); await disabled.text();
    assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode: 'FREE' })).status, 200);

    // Скрит файл: пряк адрес → 404 (не се брои като изтегляне).
    assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/metadata`, 'PATCH', { listed: false })).status, 200);
    const hidden = await fetch(`${base}/api/v1/p/sensors/files/${fileId}/download`, { headers: HUMAN_A });
    assert.equal(hidden.status, 404, 'скрит файл → 404'); await hidden.text();
    assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/metadata`, 'PATCH', { listed: true })).status, 200);

    const crawler = await fetch(`${base}/p/${portalId}`, { headers: CRAWLER });
    assert.equal(crawler.status, 200); await crawler.text();
  });

  // ── S03 — администраторски входове ───────────────────────────────────────────
  await stage('S03 администратор · успешен вход и отказ без токен', async () => {
    const anonymous = await fetch(`${base}/admin/api/sensors`, { headers: HUMAN_A });
    assert.equal(anonymous.status, 401); await anonymous.text();
    assert.equal((await api('/admin/api/sensors')).status, 200);
  });

  // ── S04 — агрегати ───────────────────────────────────────────────────────────
  await stage('S04 агрегати · 4 посетителя · 2 изтегляния · 2 отказа · файл и портал', async () => {
    const intel = (await api('/admin/api/sensors')).data.visitorsIntel;
    assert.equal(intel.unique_visitors, 4, 'трима публични + администраторът');
    assert.equal(intel.totals.downloads, 2, 'двете успешни изтегляния');
    assert.equal(intel.download_visitors, 2);
    assert.equal(intel.denied_total, 2);
    assert.deepEqual(intel.denied.reasons, { KEY_REQUIRED: 1, DISABLED: 1, unauthorized: 1 }, 'всяка причина се вижда отделно');
    assert.equal(intel.totals.adminLogins >= 1, true);
    assert.equal(intel.totals.adminDenied, 1, 'единият отказ е точно един');

    const file = intel.files.find((f) => f.id === fileId);
    assert.equal(file.name, 'dogovor.txt');
    assert.equal(file.downloads, 2);
    assert.equal(file.visitors, 2, 'двама различни души са теглили');

    const portal = intel.portals.find((p) => p.id === portalId);
    assert.equal(portal.slug, 'sensors');
    assert.equal(portal.downloads, 2);

    assert.equal(intel.clients.bots, 1, 'ботът е отделен');
    assert.equal(intel.referrers.types.search >= 1, true, 'търсачката е разпозната');
    assert.equal(intel.referrers.types.social >= 1, true, 'социалният линк е разпознат');
    assert.equal(intel.languages['bg-bg'] >= 1, true);
    assert.equal(intel.languages['de-de'] >= 1, true);
  });

  // ── S05 — локация и презареждане на базата ──────────────────────────────────
  await stage('S05 локация · BG/DE/неизвестно/локално · презареждане без рестарт', async () => {
    const intel = (await api('/admin/api/sensors')).data.visitorsIntel;
    assert.equal(intel.geo.countries.BG, 1);
    assert.equal(intel.geo.countries.DE, 1);
    assert.equal(intel.geo.unknown, 1, 'ботът е от адрес извън базата');
    assert.equal(intel.geo.local, 1, 'администраторът е от 127.0.0.1');
    assert.equal(intel.countries_known, 2);
    assert.equal(intel.country_top, 'BG');
    assert.equal(intel.privacy.geoFile.loaded, true);
    assert.equal(intel.privacy.geoFile.ranges, 2);
    assert.equal(intel.privacy.externalCalls, false);

    const list = (await api('/admin/api/sensors/visitors')).data.visitors;
    const bg = list.find((v) => (v.ips || []).includes('203.0.113.9'));
    assert.equal(bg.geo.city, 'София');
    const de = list.find((v) => (v.ips || []).includes('198.51.100.4'));
    assert.equal(de.geo.country, 'DE');

    // Нова база: един диапазон. Презареждането не иска рестарт.
    fs.writeFileSync(geoFile, JSON.stringify({ ranges: [{ cidr: '203.0.113.0/24', country: 'BG', city: 'Пловдив' }] }));
    const reload = await api('/admin/api/sensors/geo', 'POST', {});
    assert.equal(reload.status, 200);
    assert.equal(reload.data.loaded, true);
    assert.equal(reload.data.ranges, 1, 'чете НОВИЯ файл');
    const afterReload = await fetch(`${base}/p/${portalId}`, { headers: { 'X-Forwarded-For': '203.0.113.50', 'User-Agent': EDGE } });
    assert.equal(afterReload.status, 200); await afterReload.text();
    const newVisitor = (await api('/admin/api/sensors/visitors')).data.visitors.find((v) => (v.ips || []).includes('203.0.113.50'));
    assert.equal(newVisitor.geo.city, 'Пловдив', 'новодошлият получава локация от новата база');
  });

  // ── S06 — режими на IP (отделни сървъри) ────────────────────────────────────
  await stage('S06 режими · masked скрива октета · hashed не пази адрес', async () => {
    for (const mode of ['masked', 'hashed']) {
      const other = await startServer({ env: { VISITOR_IP_MODE: mode, TRUST_PROXY: 'true', GEOIP_DB_PATH: geoFile } });
      try {
        const created = await other.api('/admin/api/portals', 'POST', { slug: 'mode', title: 'Режим' });
        assert.equal(created.status, 201);
        assert.equal((await other.api(`/admin/api/portals/${created.data.id}`, 'PATCH', { visibility: 'public' })).status, 200);
        const page = await fetch(`${other.base}/p/${created.data.id}`, { headers: HUMAN_A });
        assert.equal(page.status, 200); await page.text();

        const intel = (await other.api('/admin/api/sensors')).data.visitorsIntel;
        assert.equal(intel.privacy.ipMode, mode);
        assert.equal(intel.unique_visitors, 2, 'посетителят и администраторът');
        if (mode === 'masked') {
          const ips = intel.topIps.map((entry) => entry.ip);
          assert.ok(ips.includes('203.0.113.0'), 'октетът е нулиран: ' + ips.join(','));
          assert.equal(ips.includes('203.0.113.9'), false, 'точният адрес не се пази');
          assert.equal(intel.geo.countries.BG, 1, 'локацията пак се знае');
        } else {
          assert.equal(intel.topIps.filter((entry) => entry.ip.startsWith('203.0.113')).length, 0, 'адресът не се пази изобщо');
          assert.equal(intel.geo.countries.BG, 1);
        }
      } finally {
        await other.stop({ keep: true }).catch(() => { });
        try { fs.rmSync(other.dir, { recursive: true, force: true }) } catch { /* Windows може да държи файла */ }
      }
    }
  });

  // ── S07 — срок на пазене (управляем часовник, без чакане) ───────────────────
  await stage('S07 срок · записите по-стари от срока изчезват', async () => {
    let clock = Date.parse('2026-10-01T09:00:00Z');
    const dir = path.join(tmp, 'retention');
    fs.mkdirSync(dir, { recursive: true });
    const intel = V.create({ dir, salt: 's7', ipMode: 'full', retentionDays: 1, geoFile, now: () => clock });
    const req = (ip) => ({ headers: { 'user-agent': EDGE, 'accept-language': 'bg-BG', referer: '' }, socket: { remoteAddress: ip } });
    intel.observe(req('203.0.113.9'), { kind: 'visit', portal: { id: 'p', slug: 's', title: 'S' } });
    intel.observe(req('203.0.113.10'), { kind: 'download', portal: { id: 'p', slug: 's', title: 'S' }, file: { id: 'f', name: 'a.txt' } });
    assert.equal(intel.sensors().unique_visitors, 2);
    clock += 2 * 86400000;
    intel.observe(req('203.0.113.11'), { kind: 'visit', portal: { id: 'p', slug: 's', title: 'S' } });
    const pruned = intel.prune();
    assert.equal(pruned.removed >= 2, true, 'два стари записа са премахнати');
    assert.equal(intel.sensors().unique_visitors, 1, 'остава само новият');
    intel.flush();
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'visitor-intel.json'), 'utf8'));
    assert.equal(Object.keys(saved.visitors).length, 1, 'изчистването е записано на диска');
  });

  // ── S08 — CSV и Prometheus ───────────────────────────────────────────────────
  await stage('S08 износи · CSV с редове · Prometheus без имена на файлове', async () => {
    const auth = { Authorization: 'Bearer ' + server.token };
    const csv = await fetch(`${base}/admin/api/sensors/visitors.csv`, { headers: auth });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    const lines = (await csv.text()).trim().split('\n');
    assert.equal(lines[0], 'visitor,firstSeen,lastSeen,visits,downloads,denied,country,city,browser,os,device,language,referrer');
    assert.equal(lines.length, 6, 'заглавие + петима посетителя');

    const prom = await (await fetch(`${base}/admin/api/sensors/prometheus`, { headers: auth })).text();
    assert.match(prom, /hapi_visitors_unique 5/);
    assert.match(prom, /hapi_visitors_downloads 2/);
    assert.match(prom, /hapi_visitors_denied 2/);
    assert.match(prom, /hapi_visitors_country\{country="BG"\}/);
    assert.equal(prom.includes('dogovor'), false, 'метриките не носят имена на файлове');
    assert.equal(prom.includes('203.0.113.9'), false, 'и не носят IP адреси');
  });

  // ── S09 — панелът в DOM ─────────────────────────────────────────────────────
  await stage('S09 панел · числата са същите като от API · изтриване · CSV', async () => {
    const live = (await api('/admin/api/sensors')).data.visitorsIntel;
    const ui = mountUi(server, { modules: ['data.js', 'icons.js', 'visitors-panel.js'] });
    const host = ui.container();
    ui.window.HapiVisitorsPanel.mount(host);

    await waitFor(() => text(host).includes('Уникални посетители'), { label: 'картите', timeout: 15000 });
    await waitFor(() => host.querySelectorAll('#v-visitors tbody tr').length === live.unique_visitors, { label: 'всички посетители в таблицата', timeout: 15000 });

    assert.match(text(host.querySelector('#v-cards')), new RegExp('Уникални посетители ' + live.unique_visitors + ' '));
    assert.match(text(host.querySelector('#v-cards')), new RegExp('Теглили файл ' + live.download_visitors + ' '));
    assert.match(text(host.querySelector('#v-cards')), /Отказани достъпи 2/);
    assert.match(text(host.querySelector('#v-files tbody')), /dogovor\.txt/);
    const geoText = text(host.querySelector('#v-geo tbody'));
    assert.match(geoText, /BG/, 'държавата е в „Откъде идват“');

    // Изтриваме през бутона този, който е теглил от DE.
    const deRow = host.querySelectorAll('#v-visitors tbody tr').find((row) => text(row).includes('198.51.100.4'));
    assert.ok(deRow, 'редът на DE посетителя е налице');
    const deId = deRow.querySelectorAll('button').find((b) => /Изтрий/.test(text(b))).dataset.id;
    ui.clearToasts();
    deRow.querySelectorAll('button').find((b) => /Изтрий/.test(text(b))).click();
    await waitFor(() => !text(host.querySelector('#v-visitors tbody')).includes('198.51.100.4'), { label: 'редът да изчезне', timeout: 15000 });
    assert.equal(ui.lastToast().message, 'Данните на посетителя са изтрити');
    assert.equal((await api(`/admin/api/sensors/visitors/${deId}`)).status, 404);

    const csv = host.querySelectorAll('button').find((b) => /^Експорт CSV$/.test(text(b)));
    ui.clearToasts();
    csv.click();
    await waitFor(() => ui.toasts.some((t) => /CSV файлът е изтеглен/.test(t.message)), { label: 'CSV', timeout: 15000 });

    // Числата в панела следват изтриването, не остават стари.
    const after = (await api('/admin/api/sensors')).data.visitorsIntel;
    assert.equal(after.unique_visitors, 4);
    assert.equal(after.geo.countries.DE, undefined, 'DE посетителят е изтрит и от картата');
    buttonByTextOrThrow(host, /^Обнови$/).click();
    await waitFor(() => new RegExp('Уникални посетители ' + after.unique_visitors + ' ').test(text(host.querySelector('#v-cards'))), { label: 'обновените карти', timeout: 15000 });
  });

  function buttonByTextOrThrow(host, pattern) {
    const found = host.querySelectorAll('button').find((b) => pattern.test(text(b)));
    assert.ok(found, 'липсва бутон ' + pattern);
    return found;
  }

  // ── S10 — право на изтриване и одит ─────────────────────────────────────────
  await stage('S10 изтриване · следите изчезват · влиза в одита', async () => {
    const list = (await api('/admin/api/sensors/visitors')).data.visitors;
    const target = list.find((v) => (v.ips || []).includes('192.0.2.77'));
    assert.ok(target, 'кrawler-ът е в списъка');
    assert.equal((await api(`/admin/api/sensors/visitors/${target.id}`, 'DELETE')).status, 200);
    assert.equal((await api(`/admin/api/sensors/visitors/${target.id}`)).status, 404);

    const intel = (await api('/admin/api/sensors')).data.visitorsIntel;
    assert.equal(intel.unique_visitors, 3);
    assert.equal(intel.topIps.some((entry) => entry.ip === '192.0.2.77'), false, 'адресът не остава в агрегатите');
    assert.equal(intel.geo.unknown, 0, 'непознатата локация също е изчистена');
    const events = (await api('/admin/api/audit?limit=200')).data.events.map((e) => e.event);
    assert.equal(events.filter((e) => e === 'sensors.visitor.forget').length >= 2, true, 'двете изтривания са в одита');
  });

  // ── S11 — рестарт: броячите и одитната верига оцеляват ─────────────────────
  await stage('S11 рестарт · данните и одитната верига оцеляват', async () => {
    const before = (await api('/admin/api/sensors')).data.visitorsIntel;
    // Записът е с дебаунс: изчакваме СНИМКАТА на диска да стигне текущото състояние,
    // за да проверяваме персистентност, а не моментна закъснялост.
    const statePath = path.join(dataDir, 'visitor-intel.json');
    await waitFor(() => {
      try {
        const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        return Object.keys(saved.visitors).length === before.unique_visitors && saved.totals.downloads === before.totals.downloads;
      } catch { return false }
    }, { label: 'снимката на диска да е актуална', timeout: 15000 });
    await server.stop({ keep: true });

    // Същият токен: солата на идентичността идва от него, а в производство той не се
    // сменя при рестарт (иначе същите хора изглеждат като нови посетители).
    const restartedServer = await startServer({ env, dataDir, token: adminToken });
    try {
      const after = (await restartedServer.api('/admin/api/sensors')).data.visitorsIntel;
      assert.equal(after.unique_visitors, before.unique_visitors, 'посетителите са запазени');
      assert.equal(after.totals.downloads, before.totals.downloads, 'изтеглянията са запазени');
      assert.equal(after.totals.denied, before.totals.denied, 'отказите са запазени');
      assert.equal(after.geo.countries.BG, before.geo.countries.BG);
      assert.equal(after.privacy.ipMode, 'full');
      assert.equal(after.since, before.since, 'началото на наблюдението не се мести');
      const verify = (await restartedServer.api('/admin/api/audit/verify')).data;
      assert.equal(verify.valid, true, JSON.stringify(verify));
      assert.equal(verify.count >= 10, true, 'записите са много: ' + verify.count);
    } finally {
      await restartedServer.stop({ keep: true }).catch(() => { });
    }
  });

  console.log('PASS full-journey-sensors: S01…S11 — трафик · локация · режими · срок · износи · панел · изтриване · рестарт');
  try { fs.rmSync(dataDir, { recursive: true, force: true }) } catch { /* Windows може да държи файла */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* същото */ }
})().catch((e) => {
  console.error(`\n✘ ПРОВАЛ в ${current}: ${e && e.message ? e.message : e}\n`);
  console.error(e);
  process.exitCode = 1;
});
