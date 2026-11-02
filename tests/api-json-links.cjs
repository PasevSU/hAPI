'use strict';
// 0.69.101 — ВСЕКИ АДРЕС, КОЙТО `api.json` ОБЯВЯВА, ТРЯБВА ДА ОТГОВАРЯ.
//
// Защо: `api.json` е документът, който клиентът чете, за да се свърже (самото му описание
// го казва). Досега той сочеше само КАРТИНКАТА на QR кода (`qr.svg`) и не споменаваше нито
// машиночитаемия договор на печата (`qr.json`), нито ръкостиска (`ping`) — два публични
// маршрута, които работеха, но ги нямаше в картата. Клиент, тръгнал от картата, не можеше
// да ги открие; а ако някой обърка базовия адрес, картата пълна с мъртви препратки изглежда
// съвсем валидна.
//
// Тестът затова не проверява „има ли поле“, а че ВСЯКА абсолютна препратка в документа
// отговаря 200 с непразно тяло — и че двете нови обещания са там и отговарят JSON.
const assert = require('node:assert/strict');
const { startServer } = require('./lib/gui-harness.cjs');

const DOC = 'съдържание, за да има какво да се обяви';

/** Всички абсолютни http(s) адреси в документа, с пътя им (за съобщения при провал). */
function addresses(value, where = '', out = []) {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) out.push({ where: where || '(корен)', url: value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => addresses(item, `${where}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) addresses(item, where ? `${where}.${key}` : key, out);
  }
  return out;
}

(async () => {
  const server = await startServer();
  try {
    const created = await server.api('/admin/api/portals', 'POST', { slug: 'karta', title: 'Карта', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава: ' + created.status);
    const portal = created.data.v || created.data;
    for (const name of ['първи.txt', 'втори.txt']) {
      const up = await server.authFetch(`${server.base}/admin/api/portals/${portal.id}/files`, {
        method: 'POST',
        headers: { 'X-File-Name': encodeURIComponent(name), 'content-type': 'application/octet-stream' },
        body: DOC,
      });
      assert.equal(up.status, 201, 'файлът „' + name + '“ се качва: ' + up.status);
      await up.arrayBuffer();
    }

    const res = await server.authFetch(server.base + '/api/v1/p/karta/api.json');
    assert.equal(res.status, 200, 'картата се сервира: ' + res.status);
    const map = await res.json();

    // ── 1. Нито един обявен адрес не е мъртъв ────────────────────────────────
    const listed = addresses(map);
    assert.ok(listed.length >= 8, 'картата обявява поне 8 адреса (намерени: ' + listed.length + ')');
    for (const { where, url } of listed) {
      const answer = await fetch(url, { redirect: 'manual' });
      const body = Buffer.from(await answer.arrayBuffer());
      assert.ok(answer.status >= 200 && answer.status < 300,
        `обявеният адрес ${where} = ${url} отговаря ${answer.status}, а трябва 2xx`);
      assert.ok(body.length > 0, `обявеният адрес ${where} = ${url} връща празно тяло`);
    }

    // ── 2. Машиночитаемият договор на печата е в картата, не само картинката ──
    assert.match(String(map.qr), /\/qr\.svg$/, 'qr сочи картинката (тя се печата и сканира): ' + map.qr);
    assert.match(String(map.qrJson), /\/qr\.json$/, 'qrJson сочи JSON договора на печата: ' + map.qrJson);
    assert.match(String(map.ping), /\/ping$/, 'картата обявява и ръкостиска: ' + map.ping);
    assert.equal(map.links.qrJsonUrl, map.qrJson, 'препратката и полето не се разминават');
    assert.equal(map.links.pingUrl, map.ping, 'препратката и полето не се разминават');

    const qrJson = await fetch(map.qrJson);
    assert.equal(qrJson.status, 200, 'qr.json отговаря 200: ' + qrJson.status);
    const qrBody = await qrJson.json();
    assert.equal(qrBody.portal.slug, 'karta', 'qr.json е за СЪЩИЯ портал');
    assert.ok(qrBody.active, 'qr.json носи активната ревизия: ' + qrBody.active);

    const ping = await fetch(map.ping);
    assert.equal(ping.status, 200, 'ping отговаря 200: ' + ping.status);
    const pingBody = await ping.json();
    assert.equal(pingBody.ok, true, 'ръкостискът казва „работи“');
    assert.equal(pingBody.portal.slug, 'karta', 'ръкостискът е за СЪЩИЯ портал');

    // ── 3. Старият адрес не се чупи: `/qr` остава 301 към картинката ─────────
    const legacy = await fetch(`${server.base}/api/v1/p/karta/qr`, { redirect: 'manual' });
    assert.equal(legacy.status, 301, '`/qr` пренасочва (301), не 404: ' + legacy.status);
    assert.match(String(legacy.headers.get('location')), /\/qr\.svg$/, 'пренасочването води към qr.svg: ' + legacy.headers.get('location'));

    // ── 4. Договорът описва и двете нови обещания (не само кодът ги има) ─────
    const openapi = await (await fetch(map.openapi)).json();
    for (const suffix of ['/api.json', '/qr.json', '/ping', '/manifest', '/files', '/storage']) {
      const key = '/api/v1/p/karta' + suffix;
      assert.ok(openapi.paths[key], 'OpenAPI описва ' + key + ' (иначе клиентът го научава от 404)');
    }

    console.log(`api-json-links OK: ${listed.length} обявени адреса, всички 2xx и непразни · qr.svg + qr.json (${qrBody.active}) + ping · /qr → 301 · OpenAPI описва договорите`);
  } finally {
    await server.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
