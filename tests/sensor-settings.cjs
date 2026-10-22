'use strict';
// Настройки на сензорите — от конзолата и от add-on опциите, а не само от средата.
//
// Правилото, което този тест пази:
//   • валидацията е една и съща за PATCH и за файла с настройки (runtime-config);
//   • невалидна стойност → 400 и НИЩО не се променя (нито в паметта, нито на диска);
//   • записаното от конзолата има приоритет пред средата, а изчистването връща средата;
//   • смяната действа веднага (жив сензор), а не след рестарт;
//   • настройката оцелява рестарт и се вижда в /admin/api/sensors за панела;
//   • в одита влиза КАКВО е поискано, но не и пътят до геобазата.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, mountUi, waitFor } = require('./lib/gui-harness.cjs');
const rc = require('../hapi_enterprise/runtime-config.js');

const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const HUMAN = { 'X-Forwarded-For': '203.0.113.9', 'User-Agent': EDGE, 'Accept-Language': 'bg-BG,bg;q=0.9' };

let current = 'S00';
const stage = async (name, fn) => {
  current = name;
  await fn();
  console.log('  ✔ ' + name);
};

(async () => {
  // ── A. Валидация (без сървър) ────────────────────────────────────────────────
  await stage('A01 валидация · приема и отказва точно това, което трябва', () => {
    assert.deepEqual(
      rc.validateSensors({ ipMode: 'masked', trustProxy: true, retentionDays: 30, geoipPath: '/data/geo.mmdb' }),
      { ipMode: 'masked', trustProxy: true, retentionDays: 30, geoipPath: '/data/geo.mmdb' },
      'валиден набор минава без промяна',
    );
    assert.deepEqual(
      rc.validateSensors({ ipMode: null, trustProxy: null, retentionDays: null, geoipPath: '' }),
      { ipMode: null, trustProxy: null, retentionDays: null, geoipPath: '' },
      'null значи „наследи от средата“',
    );
    const bad = [
      [{ ipMode: 'raw' }, /ipMode/i],
      [{ ipMode: 'FULL' }, /ipMode/i],
      [{ trustProxy: 'yes' }, /trustProxy/i],
      [{ trustProxy: 1 }, /trustProxy/i],
      [{ retentionDays: 0 }, /retentionDays/i],
      [{ retentionDays: 3651 }, /retentionDays/i],
      [{ retentionDays: 1.5 }, /retentionDays/i],
      [{ geoipPath: 'geo.mmdb' }, /geoipPath/i],
      [{ geoipPath: '/data/../../etc/passwd' }, /geoipPath/i],
      [{ geoipPath: '/data/' + 'x'.repeat(600) }, /geoipPath/i],
      [{ nope: true }, /Unknown/i],
    ];
    for (const [value, re] of bad) assert.throws(() => rc.validateSensors(value), re, 'трябва да се откаже: ' + JSON.stringify(value));
    // Числов низ се привежда до число (както при осталите настройки), за да не се губи
    // валидна стойност само защото е дошла от текстово поле.
    assert.equal(rc.validateSensors({ retentionDays: '30' }).retentionDays, 30);
    // Същата проверка важи и през целия валидатор на настройките.
    assert.throws(() => rc.validate({ sensors: { ipMode: 'raw' } }), /ipMode/i);
    assert.equal(rc.validate({}).sensors.ipMode, null, 'без подадени сензори полетата са null');
  });

  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hapi-sensor-settings-'));
  let server = await startServer({ dataDir: dir, keepData: true });
  try {
    const settings = async () => (await server.api('/admin/api/settings')).data;
    const sensorsApi = async () => (await server.api('/admin/api/sensors')).data;
    const patch = (body) => server.api('/admin/api/settings', 'PATCH', body);

    // ── B. Подразбиране ────────────────────────────────────────────────────────
    await stage('B01 подразбиране · хеширан IP · без прокси · 90 дни · без геобаза', async () => {
      const s = await settings();
      assert.deepEqual(s.effective.sensors, { ipMode: 'hashed', trustProxy: false, retentionDays: 90, geoipPath: '' });
      assert.equal(s.settings.sensors.ipMode, null, 'нищо не е записано още');
      const live = await sensorsApi();
      assert.deepEqual(live.sensorSettings, { ipMode: 'hashed', trustProxy: false, retentionDays: 90, geoipPath: '', geoLoaded: false }, 'панелът вижда същите стойности + дали геобазата е заредена');
    });

    // ── C. Отказ без промяна ───────────────────────────────────────────────────
    await stage('C01 невалидна стойност · 400 и нищо не се променя', async () => {
      const before = (await settings()).effective.sensors;
      for (const bad of [
        { sensors: { ipMode: 'raw' } },
        { sensors: { trustProxy: 'yes' } },
        { sensors: { retentionDays: 0 } },
        { sensors: { retentionDays: 5000 } },
        { sensors: { geoipPath: 'rel/geo.mmdb' } },
        { sensors: { geoipPath: '/data/../etc/passwd' } },
        { sensors: { nope: 1 } },
      ]) {
        const r = await patch(bad);
        assert.equal(r.status, 400, 'отказ за ' + JSON.stringify(bad));
        assert.match(String(r.data && r.data.error), /ipMode|trustProxy|retentionDays|geoipPath|Unknown/i, 'съобщението казва кое поле е грешно');
      }
      assert.deepEqual((await settings()).effective.sensors, before, 'нищо не се е променило');
    });

    // ── D. Запис и жива промяна ────────────────────────────────────────────────
    await stage('D01 запис · пълен IP и 30 дни, действа веднага на живо', async () => {
      // Портал с един публичен файл, за да има живи посещения.
      const portal = await server.api('/admin/api/portals', 'POST', { slug: 'sens', title: 'Сензори' });
      assert.equal(portal.status, 201, JSON.stringify(portal.data));
      const portalId = portal.data.id;
      assert.equal((await server.api(`/admin/api/portals/${portalId}`, 'PATCH', { visibility: 'public' })).status, 200);

      const p = await patch({ sensors: { ipMode: 'full', trustProxy: true, retentionDays: 30, geoipPath: '' } });
      assert.equal(p.status, 200, JSON.stringify(p.data));
      assert.deepEqual(p.data.effective.sensors, { ipMode: 'full', trustProxy: true, retentionDays: 30, geoipPath: '' }, 'ефективните стойности са новите');
      assert.deepEqual(p.data.settings.sensors, { ipMode: 'full', trustProxy: true, retentionDays: 30, geoipPath: '' }, 'записаното е същото');

      // Жив ефект: посещение с X-Forwarded-For се пази с пълния адрес, защото trustProxy е включен.
      await fetch(`${server.base}/p/${portalId}`, { headers: HUMAN });
      const stored = async () => ((await server.api('/admin/api/sensors/visitors')).data.visitors || []).flatMap((v) => v.ips || []);
      assert.ok((await stored()).includes('203.0.113.9'), 'посетителят е записан с пълния адрес: ' + JSON.stringify(await stored()));

      // Смяна на режима без рестарт: НОВ клиент вече се пази маскиран.
      assert.equal((await patch({ sensors: { ipMode: 'masked' } })).status, 200);
      await fetch(`${server.base}/p/${portalId}`, { headers: { ...HUMAN, 'X-Forwarded-For': '198.51.100.44' } });
      const masked = await stored();
      assert.equal(masked.includes('198.51.100.44'), false, 'суровият адрес вече не се пази: ' + JSON.stringify(masked));
      assert.ok(masked.includes('198.51.100.0'), 'маскираният адрес се пази: ' + JSON.stringify(masked));

      // Връщаме пълния режим за следващите проверки.
      assert.equal((await patch({ sensors: { ipMode: 'full' } })).status, 200);
    });

    // ── E. Одит ────────────────────────────────────────────────────────────────
    await stage('E01 одит · събитието пази стойностите, но не пътя до геобазата', async () => {
      assert.equal((await patch({ sensors: { trustProxy: true, retentionDays: 30, geoipPath: '/data/geoip/dbip.mmdb' } })).status, 200);
      const audit = (await server.api('/admin/api/audit?limit=50')).data.events || [];
      const event = audit.find((e) => e.type === 'sensors.settings' || e.event === 'sensors.settings');
      assert.ok(event, 'има събитие sensors.settings: ' + JSON.stringify(audit.slice(0, 3)));
      assert.equal(event.ipMode, 'full', 'одитът пази режима');
      assert.equal(event.retentionDays, 30, 'одитът пази срока');
      assert.equal(event.geoConfigured, true, 'одитът казва само, че има геобаза');
      assert.equal(JSON.stringify(event).includes('dbip.mmdb'), false, 'пътят до геобазата не влиза в одита');
    });

    // ── F. Рестарт ─────────────────────────────────────────────────────────────
    await stage('F01 рестарт · настройките оцеляват и се виждат в панела', async () => {
      const before = (await settings()).effective.sensors;
      assert.equal(before.geoipPath, '/data/geoip/dbip.mmdb');
      const port = Number(new URL(server.base).port);
      await server.stop({ keep: true });
      server = await startServer({ dataDir: dir, port, keepData: true });
      const after = (await settings()).effective.sensors;
      assert.deepEqual(after, before, 'след рестарт стойностите са същите');
      const live = (await sensorsApi()).sensorSettings;
      assert.equal(live.ipMode, 'full');
      assert.equal(live.retentionDays, 30);
      assert.equal(live.geoipPath, '/data/geoip/dbip.mmdb');
      assert.equal(live.geoLoaded, false, 'липсващият файл не се представя за зареден');
      await server.stop({ keep: true });
    });
  } finally {
    try { await server.stop({ keep: true }); } catch { }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── G. Средата: наследяване и отмяна ────────────────────────────────────────
  const envDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hapi-sensor-env-'));
  const envServer = await startServer({ dataDir: envDir, env: { VISITOR_IP_MODE: 'masked', TRUST_PROXY: 'true', VISITOR_RETENTION_DAYS: '45' } });
  try {
    await stage('G01 среда · наследява се, конзолата я побеждава, изчистването я връща', async () => {
      const start = (await envServer.api('/admin/api/settings')).data.effective.sensors;
      assert.deepEqual(start, { ipMode: 'masked', trustProxy: true, retentionDays: 45, geoipPath: '' }, 'средата се вижда като ефективна');
      const mine = await envServer.api('/admin/api/settings', 'PATCH', { sensors: { ipMode: 'hashed' } });
      assert.equal(mine.data.effective.sensors.ipMode, 'hashed', 'записаното побеждава средата');
      assert.equal(mine.data.effective.sensors.retentionDays, 45, 'полетата без запис продължават да идват от средата');
      const back = await envServer.api('/admin/api/settings', 'PATCH', { sensors: { ipMode: null, trustProxy: null, retentionDays: null } });
      assert.equal(back.data.effective.sensors.ipMode, 'masked', 'изчистването връща средата');
      assert.equal(back.data.effective.sensors.trustProxy, true);
      assert.equal(back.data.effective.sensors.retentionDays, 45);
    });
  } finally {
    try { await envServer.stop({ keep: true }); } catch { }
    fs.rmSync(envDir, { recursive: true, force: true });
  }

  // ── H. Интерфейс ───────────────────────────────────────────────────────────
  const guiDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hapi-sensor-gui-'));
  const guiServer = await startServer({ dataDir: guiDir });
  try {
    await stage('H01 конзола · секция „Сензори“ показва ефективните стойности и ги записва', async () => {
      const ui = mountUi(guiServer, { modules: ['i18n.js', 'settings-panel.js', 'bootstrap.js'] });
      const panel = ui.window.SettingsPanel;
      assert.ok(panel && typeof panel.mount === 'function', 'панелът е зареден');
      const host = ui.container();
      panel.state.section = 'sensors';
      panel.mount(host);
      await waitFor(() => host.querySelector('#set-sensors-ipmode'), { label: 'полето за режим на IP' });
      const html = host.innerHTML;
      assert.ok(html.includes('Сензори'), 'секцията е в панела');
      assert.ok(html.includes('хеширан (необратим)'), 'изборът показва режимите: ' + html.slice(0, 0));
      const trust = host.querySelector('#set-sensors-trustproxy');
      assert.ok(trust, 'има избор за прокси');
      assert.ok(host.querySelector('#set-sensors-retention'), 'има срок');
      assert.ok(host.querySelector('#set-sensors-geoip'), 'има път до геобаза');

      // Текущото състояние се вижда като таблица, а не като голо поле.
      assert.ok(html.includes('Режим на IP (ефективен)'), 'таблицата показва ефективния режим');

      host.querySelector('#set-sensors-ipmode').value = 'masked';
      host.querySelector('#set-sensors-trustproxy').value = 'true';
      host.querySelector('#set-sensors-retention').value = '12';
      host.querySelector('#set-sensors-geoip').value = '';
      host.querySelector('button[data-action="sensors"]').click();
      await waitFor(() => ui.toasts.some((t) => /Сензори/.test(String(t.message || t.text || t))), { label: 'известие след запис' });

      const saved = (await guiServer.api('/admin/api/settings')).data;
      assert.deepEqual(saved.effective.sensors, { ipMode: 'masked', trustProxy: true, retentionDays: 12, geoipPath: '' }, 'стойностите от формата са записани');

      // Невалиден срок се хваща още в панела, без заявка.
      panel.state.section = 'sensors';
      panel.mount(host);
      await waitFor(() => host.querySelector('#set-sensors-retention'), { label: 'полето за срок' });
      host.querySelector('#set-sensors-ipmode').value = 'full';
      host.querySelector('#set-sensors-trustproxy').value = '';
      host.querySelector('#set-sensors-retention').value = '0';
      host.querySelector('#set-sensors-geoip').value = '';
      host.querySelector('#set-sensors-geoip').value = '';
      ui.toasts.length = 0;
      host.querySelector('button[data-action="sensors"]').click();
      await waitFor(() => ui.toasts.length > 0, { label: 'известие за грешен срок' });
      assert.match(String(ui.toasts[0].message || ui.toasts[0].text || ui.toasts[0]), /цяло число дни/);
      const unchanged = (await guiServer.api('/admin/api/settings')).data.effective.sensors;
      assert.equal(unchanged.ipMode, 'masked', 'невалидната форма не променя нищо');
    });
  } finally {
    try { await guiServer.stop({ keep: true }); } catch { }
    fs.rmSync(guiDir, { recursive: true, force: true });
  }

  console.log('PASS sensor-settings: валидация · отказ без промяна · жив ефект · одит · рестарт · среда/конзола · панел');
})().catch((e) => {
  console.error('FAIL sensor-settings [' + current + ']');
  console.error(e);
  process.exit(1);
});
