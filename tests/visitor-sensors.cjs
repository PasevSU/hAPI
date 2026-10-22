'use strict';
// Сензори за комуникацията: кой влиза, какво тегли, колко пъти, от кое IP и (само от
// офлайн файл) приблизителна локация. Проверява се ТОЧНИЯТ резултат, не само че кодът
// не гърми — включително че модулът не прави никакви външни заявки.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');
const V = require('../hapi_enterprise/visitor-intel');

const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const FIREFOX_MOBILE = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';
const BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-visitors-'));
const geoFile = path.join(tmp, 'geoip.json');
fs.writeFileSync(geoFile, JSON.stringify({
  ranges: [
    { cidr: '203.0.113.0/24', country: 'BG', region: 'София', city: 'София' },
    { cidr: '198.51.100.0/24', country: 'DE', region: 'Berlin', city: 'Berlin' },
    { cidr: '203.0.113.128/25', country: 'BG', region: 'Пловдив', city: 'Пловдив' },
  ],
}));

const fakeReq = ({ ip = '203.0.113.9', ua = EDGE, lang = 'bg-BG,bg;q=0.9,en;q=0.8', referer = 'https://www.google.com/search?q=dokument', extra = {} } = {}) => ({
  headers: { 'user-agent': ua, 'accept-language': lang, referer, ...extra },
  socket: { remoteAddress: ip },
});

let current = 'A0';
const stage = (name, fn) => { current = name; fn(); console.log('  ✔ ' + name); };

(async () => {
  // ── A. Разпознаване на клиента ────────────────────────────────────────────────
  stage('A01 клиент · Edge/Chrome/Firefox/бот · езици · реферер · маскиране', () => {
    assert.deepEqual(V.parseUserAgent(EDGE), { browser: 'edge', version: '130.0.0.0', os: 'windows', device: 'desktop', bot: false });
    const ff = V.parseUserAgent(FIREFOX_MOBILE);
    assert.equal(ff.browser, 'firefox');
    assert.equal(ff.os, 'android');
    assert.equal(ff.device, 'mobile');
    assert.equal(V.parseUserAgent(BOT).bot, true, 'ботът е разпознат като бот, не като браузър');
    assert.deepEqual(V.parseLanguages('bg-BG,bg;q=0.9,en;q=0.8').map((l) => l.lang), ['bg-bg', 'bg', 'en']);
    assert.deepEqual(V.classifyReferer('https://www.google.com/search?q=x'), { host: 'google.com', type: 'search' });
    assert.deepEqual(V.classifyReferer('https://t.me/share'), { host: 't.me', type: 'social' });
    assert.deepEqual(V.classifyReferer(''), { host: '', type: 'direct' });
    assert.deepEqual(V.classifyReferer('https://example.test/p/x', ['example.test']), { host: 'example.test', type: 'internal' });
    assert.equal(V.maskIp('203.0.113.77'), '203.0.113.0');
    assert.equal(V.maskIp('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::');
    assert.equal(V.normalizeIp('::ffff:203.0.113.77'), '203.0.113.77');
    assert.equal(V.hashIp('203.0.113.77', 's'), V.hashIp('203.0.113.77', 's'), 'хешът е стабилен');
    assert.notEqual(V.hashIp('203.0.113.77', 's'), V.hashIp('203.0.113.78', 's'));
  });

  stage('A02 офлайн геолокация · най-специфичният диапазон печели · без файл = unknown', () => {
    const geo = V.createGeo({ file: geoFile });
    assert.equal(geo.status.loaded, true);
    assert.equal(geo.lookup('203.0.113.9').country, 'BG');
    assert.equal(geo.lookup('203.0.113.9').city, 'София');
    assert.equal(geo.lookup('203.0.113.200').city, 'Пловдив', '/25 е по-специфичен от /24');
    assert.equal(geo.lookup('198.51.100.4').country, 'DE');
    assert.equal(geo.lookup('8.8.8.8'), null, 'непознат адрес не се измисля');
    assert.equal(geo.lookup('127.0.0.1').country, 'LOCAL');
    assert.equal(geo.lookup('192.168.1.5').country, 'LOCAL');
    const missing = V.createGeo({ file: path.join(tmp, 'няма-такъв.json') });
    assert.equal(missing.status.loaded, false);
    assert.equal(missing.lookup('203.0.113.9'), null);
  });

  stage('A03 без мрежа · модулът не може да звъни навън', () => {
    const source = fs.readFileSync(path.join(__dirname, '../hapi_enterprise/visitor-intel.js'), 'utf8');
    for (const needle of ['fetch(', 'https.request', 'http.request', "require('node:dns')", "require('dns')", 'axios']) {
      assert.equal(source.includes(needle), false, 'намерено е ' + needle);
    }
    assert.match(source, /externalCalls: false/);
  });

  // ── B. Състояние: режими на IP, агрегати, изтриване, срок ─────────────────────
  let clock = Date.parse('2026-10-20T10:00:00Z');
  const now = () => clock;
  const full = V.create({ dir: path.join(tmp, 'full'), salt: 's1', ipMode: 'full', retentionDays: 2, geoFile, now });
  fs.mkdirSync(path.join(tmp, 'full'), { recursive: true });

  stage('B01 режим full · IP се пази · локация · профил · агрегати · CSV', () => {
    const portal = { id: 'p1', slug: 'demo', title: 'Демо' };
    const file = { id: 'f1', name: 'dogovor.pdf' };
    full.observe(fakeReq(), { kind: 'visit', portal });
    full.observe(fakeReq(), { kind: 'download', portal, file, status: 200 });
    full.observe(fakeReq({ ip: '203.0.113.200' }), { kind: 'denied', portal, file, status: 403, reason: 'KEY_REQUIRED' });
    full.observe(fakeReq({ ip: '198.51.100.4', ua: BOT, referer: '', lang: '' }), { kind: 'visit', portal });

    const sensors = full.sensors();
    assert.equal(sensors.unique_visitors, 3, 'трима различни посетителя (по IP+UA)');
    assert.equal(sensors.totals.downloads, 1);
    assert.equal(sensors.totals.denied, 1);
    assert.equal(sensors.download_visitors, 1);
    assert.deepEqual(sensors.geo.countries, { BG: 2, DE: 1 });
    assert.equal(sensors.country_top, 'BG');
    assert.equal(sensors.denied.reasons.KEY_REQUIRED, 1);
    assert.equal(sensors.clients.bots, 1, 'ботът е отделен, не замърсява „edge“');
    assert.equal(sensors.clients.browsers.edge, 2, 'двама души с Edge — не три събития');
    assert.equal(sensors.referrers.types.search, 3, 'реферерите се броят по събитие');
    assert.equal(sensors.privacy.ipMode, 'full');
    assert.equal(sensors.privacy.externalCalls, false);
    assert.equal(sensors.files[0].name, 'dogovor.pdf');
    assert.equal(sensors.files[0].downloads, 1);
    assert.equal(sensors.portals[0].slug, 'demo');

    const top = sensors.topIps.find((entry) => entry.ip === '203.0.113.9');
    assert.ok(top, 'IP адресът се вижда в topIps при режим full');
    assert.equal(top.country, 'BG');
    assert.equal(top.city, 'София');

    const one = full.list()[0];
    const profile = full.profile(one.id);
    assert.equal(profile.language, 'bg-bg');
    assert.deepEqual(profile.geo, { country: 'BG', region: 'София', city: 'София', asn: '' });
    assert.equal(profile.agents[0].key, 'edge/windows/desktop');
    assert.equal(profile.files[0].name, 'dogovor.pdf');
    assert.equal(profile.last.kind, 'download');

    const csv = full.csv().split('\n');
    assert.equal(csv.length, 4, 'заглавие + трима посетителя');
    assert.match(csv[0], /^visitor,firstSeen/);
    assert.match(full.prometheus(), /hapi_visitors_unique 3/);
  });

  stage('B02 маскиран и хеширан режим · самият адрес не се пази', () => {
    const masked = V.create({ dir: path.join(tmp, 'masked'), salt: 's2', ipMode: 'masked', geoFile, now });
    masked.observe(fakeReq(), { kind: 'visit', portal: { id: 'p1', slug: 'demo', title: 'Демо' } });
    assert.equal(masked.sensors().topIps[0].ip, '203.0.113.0', 'последният октет е нулиран');
    assert.equal(masked.sensors().topIps[0].city, 'София', 'локацията пак се знае');

    const hashed = V.create({ dir: path.join(tmp, 'hashed'), salt: 's3', ipMode: 'hashed', geoFile, now });
    hashed.observe(fakeReq(), { kind: 'visit', portal: { id: 'p1', slug: 'demo', title: 'Демо' } });
    const snapshot = hashed.sensors();
    assert.equal(snapshot.topIps.length, 0, 'в режим hashed няма записи по IP');
    assert.equal(snapshot.unique_visitors, 1, 'но посетителят се брои');
    assert.equal(snapshot.geo.countries.BG, 1, 'геолокацията се смята, без да се пази адресът');
  });

  stage('B03 срок на пазене · старите посетители се махат', () => {
    const intel = V.create({ dir: path.join(tmp, 'retention'), salt: 's4', ipMode: 'full', retentionDays: 1, geoFile, now });
    intel.observe(fakeReq(), { kind: 'visit', portal: { id: 'p1', slug: 'demo', title: 'Демо' } });
    assert.equal(intel.sensors().unique_visitors, 1);
    clock += 2 * 86400000;
    const pruned = intel.prune();
    assert.equal(pruned.removed > 0, true, 'нещо е премахнато');
    assert.equal(intel.sensors().unique_visitors, 0, 'след срока посетителят е изчезнал');
    clock = Date.parse('2026-10-20T10:00:00Z');
  });

  stage('B04 право на изтриване · един посетител, после никой', () => {
    const intel = V.create({ dir: path.join(tmp, 'forget'), salt: 's5', ipMode: 'full', geoFile, now });
    intel.observe(fakeReq(), { kind: 'visit', portal: { id: 'p1', slug: 'demo', title: 'Демо' } });
    const id = intel.list()[0].id;
    assert.equal(intel.forget(id).removed, true);
    assert.equal(intel.profile(id), null);
    assert.equal(intel.sensors().unique_visitors, 0);
    assert.equal(intel.forget(id).removed, false);
  });

  // ── C. Жив сървър: истинските маршрути хранят сензорите ──────────────────────
  const server = await startServer({ env: { VISITOR_IP_MODE: 'full', TRUST_PROXY: 'true', GEOIP_DB_PATH: geoFile } });
  const { api, authFetch, base } = server;
  const visitorHeaders = {
    'X-Forwarded-For': '203.0.113.9',
    'User-Agent': EDGE,
    'Accept-Language': 'bg-BG,bg;q=0.9',
    Referer: 'https://www.google.com/search?q=dokument',
  };

  // Спирането на детето убива и сокетите, които тестовият клиент държи в пула си;
  // Node отчита това като „fetch failed / ECONNRESET“ за тела, които вече не чакаме.
  // Игнорира се САМО този шум и САМО след като сме започнали да спираме сървъра —
  // всичко друго остава провал.
  let stopping = false;
  process.on('unhandledRejection', (reason) => {
    const code = reason && reason.cause && reason.cause.code;
    if (stopping && code === 'ECONNRESET') return;
    console.error('непохваната грешка:', reason);
    process.exitCode = 1;
  });

  try {
    let portalId = '', slug = 'sensors', fileId = '', key = '';

    await stage('C01 портал · публичен · файл със ключ', async () => {
      const created = await api('/admin/api/portals', 'POST', { slug, title: 'Сензори' });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      portalId = created.data.id;
      assert.equal((await api(`/admin/api/portals/${portalId}`, 'PATCH', { visibility: 'public' })).status, 200);

      const up = await authFetch(`${base}/admin/api/portals/${portalId}/files`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-File-Name': 'dokument.txt', 'X-File-Encrypt': '0' }, body: 'съдържание',
      });
      assert.equal(up.status, 201);
      fileId = (await up.json()).id;

      assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode: 'KEY_REQUIRED' })).status, 200);
      const minted = await api(`/admin/api/portals/${portalId}/files/${fileId}/access-keys`, 'POST', {});
      key = minted.data.key;
    });

    await stage('C02 посещение · отказ без ключ · успешно с ключ · отказан файл', async () => {
      const page = await fetch(`${base}/p/${portalId}`, { headers: visitorHeaders });
      assert.equal(page.status, 200);
      await page.text();

      const denied = await fetch(`${base}/api/v1/p/${slug}/files/${fileId}/download`, { headers: visitorHeaders });
      assert.equal(denied.status, 403);
      await denied.text();

      const ok = await fetch(`${base}/api/v1/p/${slug}/files/${fileId}/download`, { headers: { ...visitorHeaders, 'X-File-Key': key } });
      assert.equal(ok.status, 200);
      assert.equal(await ok.text(), 'съдържание');

      assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode: 'DISABLED' })).status, 200);
      const disabled = await fetch(`${base}/api/v1/p/${slug}/files/${fileId}/download`, { headers: { ...visitorHeaders, 'X-File-Key': key } });
      assert.equal(disabled.status, 403);
      await disabled.text();
      assert.equal((await api(`/admin/api/portals/${portalId}/files/${fileId}/access`, 'PATCH', { mode: 'FREE' })).status, 200);
    });

    await stage('C03 администраторски входове · успешен и отказан', async () => {
      const anonymous = await fetch(`${base}/admin/api/sensors`, { headers: visitorHeaders });
      assert.equal(anonymous.status, 401);
      await anonymous.text();
      assert.equal((await api('/admin/api/sensors', 'GET')).status, 200);
      const sensors = (await api('/admin/api/sensors')).data;
      assert.equal(sensors.visitorsIntel.totals.adminLogins >= 1, true, 'успешният вход е отчетен');
      assert.equal(sensors.visitorsIntel.totals.adminDenied >= 1, true, 'отказаният вход е отчетен');
      assert.equal(sensors.visitorsIntel.denied.reasons.unauthorized >= 1, true);
    });

    await stage('C04 сензорите виждат кой, какво, колко, откъде', async () => {
      const data = (await api('/admin/api/sensors')).data;
      const intel = data.visitorsIntel;
      assert.equal(intel.unique_visitors >= 1, true);
      assert.equal(intel.totals.visits >= 1, true);
      assert.equal(intel.totals.downloads, 1, 'точно едно успешно изтегляне');
      assert.equal(intel.denied.reasons.KEY_REQUIRED, 1);
      assert.equal(intel.denied.reasons.DISABLED, 1);
      assert.equal(intel.geo.countries.BG >= 1, true, 'локацията идва от офлайн базата');
      assert.equal(intel.country_top, 'BG');
      assert.equal(intel.files.find((f) => f.id === fileId).downloads, 1);
      assert.equal(intel.clients.browsers.edge >= 1, true);
      assert.equal(intel.referrers.types.search >= 1, true);
      // Плоските ключове за HA сензорите.
      assert.equal(typeof data.uniqueVisitors, 'number');
      assert.equal(typeof data.deniedTotal, 'number');
      assert.equal(data.countryTop, 'BG');
    });

    await stage('C05 профил · списък · CSV · Prometheus', async () => {
      const list = (await api('/admin/api/sensors/visitors?sort=downloads')).data;
      assert.equal(list.ipMode, 'full');
      assert.equal(list.visitors.length >= 1, true);
      const first = list.visitors[0];
      assert.equal(first.downloads, 1);
      assert.deepEqual(first.ips, ['203.0.113.9'], 'вижда се точното IP при режим full');
      assert.equal(first.geo.city, 'София');

      const profile = (await api(`/admin/api/sensors/visitors/${first.id}`)).data;
      assert.equal(profile.ipMode, 'full');
      assert.equal(profile.visitor.files[0].name, 'dokument.txt');
      assert.equal(profile.visitor.language, 'bg-bg');
      assert.equal(profile.visitor.agents.some((a) => a.key === 'edge/windows/desktop'), true);

      const csv = await fetch(`${base}/admin/api/sensors/visitors.csv`, { headers: { Authorization: 'Bearer ' + server.token } });
      assert.equal(csv.status, 200);
      assert.match(csv.headers.get('content-type'), /text\/csv/);
      assert.match(await csv.text(), /^visitor,firstSeen,lastSeen/);

      const prom = await fetch(`${base}/admin/api/sensors/prometheus`, { headers: { Authorization: 'Bearer ' + server.token } });
      assert.equal(prom.status, 200);
      const text = await prom.text();
      assert.match(text, /hapi_visitors_unique \d+/);
      assert.match(text, /hapi_visitors_country\{country="BG"\}/);
    });

    await stage('C06 X-Forwarded-For се вярва само при trust proxy', async () => {
      const spoof = await fetch(`${base}/p/${portalId}`, { headers: { 'X-Forwarded-For': '198.51.100.4' } });
      assert.equal(spoof.status, 200);
      await spoof.text();
      const intel = (await api('/admin/api/sensors')).data.visitorsIntel;
      assert.equal(intel.geo.countries.DE >= 1, true, 'при trust proxy адресът от заглавието се използва');
      const direct = await fetch(`${base}/p/${portalId}`);
      assert.equal(direct.status, 200);
      await direct.text();
      const after = (await api('/admin/api/sensors')).data.visitorsIntel;
      assert.equal(after.geo.local >= 1, true, 'без заглавие се взима сокетът (локален)');
    });

    await stage('C07 право на изтриване през API · после 404', async () => {
      const list = (await api('/admin/api/sensors/visitors')).data.visitors;
      const target = list[0];
      assert.equal((await api(`/admin/api/sensors/visitors/${target.id}`, 'DELETE')).status, 200);
      assert.equal((await api(`/admin/api/sensors/visitors/${target.id}`)).status, 404, 'профилът е изтрит');
      assert.equal((await api(`/admin/api/sensors/visitors/${target.id}`, 'DELETE')).status, 404);
      const auditEvents = (await api('/admin/api/audit?limit=200')).data.events.map((e) => e.event);
      assert.ok(auditEvents.includes('sensors.visitor.forget'), 'изтриването влиза в одита');
    });

    await stage('C08 презареждане на офлайн базата без рестарт', async () => {
      const reload = await api('/admin/api/sensors/geo', 'POST', {});
      assert.equal(reload.status, 200, JSON.stringify(reload.data));
      assert.equal(reload.data.loaded, true);
      assert.equal(reload.data.ranges, 3, 'трите диапазона от файла');
      assert.equal(reload.data.file, geoFile);
    });

    console.log('PASS visitor-sensors: клиент · офлайн гео · IP режими · срок · живи маршрути · изтриване');
  } catch (e) {
    console.error(`\n✘ ПРОВАЛ в ${current}: ${e && e.message ? e.message : e}\n`);
    throw e;
  } finally {
    stopping = true;
    await server.stop({ keep: true }).catch(() => { });
    try { fs.rmSync(server.dir, { recursive: true, force: true }); } catch { /* Windows може да държи файла */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* същото */ }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
