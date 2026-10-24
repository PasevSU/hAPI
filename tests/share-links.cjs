'use strict';
// Share links за портал: NFC/QR таг за Home Assistant Companion + universal link.
//
// Проверява се:
//   • unit: tag id е стабилен, безопасен за URL и различен за различните портали;
//   • unit: двата адреса са ТОЧНО форматите от документацията на приложението
//     (`https://www.home-assistant.io/tag/<id>` и `…/ios/nfc/?url=<…>`) и се
//     декодират обратно до същия адрес;
//   • unit: автоматизацията е валиден YAML-образен текст с екранирани кавички;
//   • API: `/admin/api/portals/<id>/api-info` връща `links` за реалния портал,
//     а адресът на тага съдържа неговия slug.
const { stopChild, freePort } = require('./helpers.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const share = require('../hapi_enterprise/share-links');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ── 1. Tag id ─────────────────────────────────────────────────────────────
  assert.match(share.tagId('my-portal'), /^hapi-my-portal-[0-9a-f]{8}$/, 'четимо име + кратък хеш');
  assert.equal(share.tagId('my-portal'), share.tagId('my-portal'), 'стабилно при всяко пускане');
  assert.match(share.tagId('My Portal'), /^hapi-my-portal-[0-9a-f]{8}$/, 'интервалите и главните букви се нормализират');
  assert.match(share.tagId('--a__b--'), /^hapi-a-b-[0-9a-f]{8}$/, 'повторните тирета се свиват');
  // Кирилицата не влиза в tag id, но хешът пази уникалността: два различни портала
  // с кирилски имена не бива да дават един и същ стикер.
  assert.match(share.tagId('Дело 2026'), /^hapi-2026-[0-9a-f]{8}$/);
  assert.notEqual(share.tagId('Дело 2026'), share.tagId('Договор 2026'), 'различните портали са различни тагове');
  assert.match(share.tagId(''), /^hapi-portal-[0-9a-f]{8}$/);
  assert.ok(share.tagId('a'.repeat(200)).length <= 64, 'tag id-то е ограничено до 64 знака');
  assert.ok(!/[\s"'<>&]/.test(share.tagId('my portal & co')), 'няма URL-опасни знаци');

  // ── 2. Двата адреса са форматите от документацията ───────────────────────
  const tagUrl = share.tagUrl('hapi-demo');
  assert.equal(tagUrl, 'https://www.home-assistant.io/tag/hapi-demo');
  assert.ok(tagUrl.startsWith(share.TAG_BASE));

  const landing = 'https://hapi.example.bg/p/p_123?x=1&y=2';
  const uni = share.universalUrl(landing);
  assert.ok(uni.startsWith('https://www.home-assistant.io/ios/nfc/?url='));
  assert.equal(decodeURIComponent(uni.slice(share.UNIVERSAL_BASE.length)), landing, 'URL-ът се декодира обратно');

  // ── 3. Автоматизация ──────────────────────────────────────────────────────
  const yaml = share.automation({ tagId: 'hapi-demo', title: 'Договори "2026"', url: landing }); assert.match(yaml, /platform: tag/, 'тригерът е tag');
  assert.match(yaml, /tag_id: "hapi-demo"/, 'tag_id съвпада с адреса на тага');
  assert.match(yaml, /tag_scanned|persistent_notification/, 'има действие');
  assert.ok(yaml.includes('\\"2026\\"'), 'кавичките в заглавието се екранират: ' + yaml);
  assert.ok(!/[\u0000-\u0008]/.test(yaml), 'няма управляващи знаци');
  assert.equal(share.yamlString('a\\b'), '"a\\\\b"', 'обратната наклонена черта се екранира');

  // ── 4. build() сглобява всичко и сочи към документацията ─────────────────
  const built = share.build({ slug: 'demo', title: 'Demo', landingUrl: landing });
  assert.equal(built.tag.url, share.tagUrl(share.tagId('demo')));
  assert.match(built.tag.url, /^https:\/\/www\.home-assistant\.io\/tag\/hapi-demo-[0-9a-f]{8}$/);
  assert.equal(built.tag.event, 'tag_scanned');
  assert.equal(built.nfc.write, built.tag.url, 'на стикера се записва тагът');
  assert.equal(built.nfc.alternative, uni);
  assert.ok(built.automation.includes(built.tag.id));
  assert.match(built.docs, /companion\.home-assistant\.io/);
  assert.equal(share.build({ slug: 'x' }).universal.target, '', 'липсващ адрес не чупи нищо');

  // ── 5. API: реалният портал получава links ───────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-links-'));
  const token = 'share-links-admin-token-0123456789';
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: { ...process.env, DATA_DIR: dir, ADMIN_TOKEN: token, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    let ready = false;
    for (let i = 0; i < 160; i++) {
      try {
        if ((await fetch(base + '/health')).ok) {
          ready = true;
          break;
        }
      } catch { }
      await sleep(50);
    }
    assert.ok(ready, 'сървърът стартира');

    const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const call = (p, m = 'GET', b) =>
      fetch(base + p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) });

    let r = await call('/admin/api/portals', 'POST', { slug: 'tag-demo', title: 'Tag Demo' });
    assert.equal(r.status, 201, 'порталът е създаден');
    const portal = await r.json();

    r = await call(`/admin/api/portals/${encodeURIComponent(portal.id)}/api-info`);
    assert.equal(r.status, 200);
    const info = await r.json();
    assert.ok(info.links, 'api-info носи links');
    assert.match(info.links.tag.url, /^https:\/\/www\.home-assistant\.io\/tag\/hapi-tag-demo-[0-9a-f]{8}$/);
    assert.equal(info.links.tag.url, 'https://www.home-assistant.io/tag/' + info.links.tag.id);
    assert.equal(info.links.nfc.mode, 'tag');
    assert.ok(
      decodeURIComponent(info.links.universal.url.slice(share.UNIVERSAL_BASE.length)) === info.landingUrl,
      'universal link-ът сочи към landing адреса на портала',
    );
    assert.ok(info.links.automation.includes(info.links.tag.id));
    // QR кодът води до човешката страница; за частен портал адресът носи подписан достъп.
    assert.ok(info.qrTarget.startsWith(info.landingUrl), 'QR кодът остава към човешката страница');
    assert.equal(info.qrTarget, require('../hapi_enterprise/links.js').joinQuery(info.landingUrl, info.folderQuery, info.accessQuery), 'QR-ът носи папката и подписания достъп');

    // Без токен админският отговор не се дава.
    r = await fetch(`${base}/admin/api/portals/${encodeURIComponent(portal.id)}/api-info`);
    assert.equal(r.status, 401, 'api-info иска токен');

    console.log('PASS share links: tag id, universal link, автоматизация и api-info → links');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
