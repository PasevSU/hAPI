'use strict';
// ЗАКЛЮЧЕН ПОРТАЛ: паролата се пита НА САМАТА СТРАНИЦА (0.69.210).
//
// Защо има тест: до 0.69.210 заключен портал беше невъзможен за посетител без издаден ключ —
// страницата връщаше 404 и нямаше къде да се въведе парола. Сега сървърът сервира КОРАТА с
// `data-locked="1"`, страницата показва форма, а `POST /unlock` връща подписан достъп.
// Тестът пази точно веригата: кора → грешна парола → вярна парола → съдържание.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

(async () => {
  const server = await startServer();
  try {
    const created = await server.api('/admin/api/portals', 'POST', {
      slug: 'locked-page',
      title: 'Locked page',
      visibility: 'public',
      term: 'unlimited',
      access: 'locked',
      password: 'Osem-znaka-3',
    });
    assert.equal(created.status, 201, 'порталът е създаден заключен');
    const id = created.data.id;

    console.log('· кората се отваря и казва „заключен“, без да дава съдържание');
    {
      const res = await fetch(server.base + '/p/' + id);
      const html = await res.text();
      assert.equal(res.status, 200, 'страницата се сервира (иначе няма къде да се въведе парола)');
      assert.match(html, /data-locked="1"/, 'страницата знае, че порталът е заключен');
      assert.match(html, /id="unlock-pw"/, 'има поле за парола');
      assert.match(html, /id="unlock-go"/, 'има бутон за отключване');
      assert.equal(/dogovor\.pdf|Документи/.test(html), false, 'в кората НЯМА съдържание на портала');
    }

    console.log('· API-то без достъп не дава файловете');
    {
      const res = await fetch(server.base + '/api/v1/p/locked-page');
      assert.ok([401, 404].includes(res.status), 'без парола → отказ: ' + res.status);
    }

    console.log('· грешна парола → 401, вярна → подписан достъп → страницата става обикновена');
    {
      const bad = await server.api('/api/v1/p/locked-page/unlock', 'POST', { password: 'greshna-para' });
      assert.equal(bad.status, 401);

      const good = await server.api('/api/v1/p/locked-page/unlock', 'POST', { password: 'Osem-znaka-3' });
      assert.equal(good.status, 200);
      const query = String(good.data.query || '');
      assert.match(query, /expires=\d+&sig=[0-9a-f]+/);

      const page = await fetch(server.base + '/p/' + id + query);
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.equal(/data-locked="1"/.test(html), false, 'с подписания достъп страницата не е „заключена“');

      const api = await fetch(server.base + '/api/v1/p/locked-page' + query);
      assert.equal(api.status, 200, 'с подписания достъп API-то отваря');
      const data = await api.json();
      assert.equal(data.slug, 'locked-page');
      assert.equal(data.access, 'locked', 'порталът си остава заключен — отключен е САМО този достъп');
    }

    console.log('· страницата набира паролата през boot-а, не през адреса');
    {
      const js = read('hapi_enterprise/portal/portal.js');
      assert.match(js, /data\.locked/, 'страницата чете флага от `#hapi-boot`');
      assert.match(js, /boot\.api \+ "\/unlock"/, 'паролата отива в POST към /unlock на СЪЩИЯ портал');
      assert.match(js, /method: "POST"/, 'заявката е POST (паролата не влиза в адреса)');
      assert.equal(/password=/.test(js), false, 'паролата НЕ се слага в query низ');
      assert.match(js, /location\.replace\(next\.toString\(\)\)/, 'след успех страницата се презарежда с подписания достъп');
      const html = read('hapi_enterprise/portal/portal.html');
      assert.match(html, /data-i18n="unlock\.title"/, 'заглавието е в речника');
      assert.match(html, /data-i18n="unlock\.button"/, 'бутонът е в речника');
    }

    console.log('PASS portal-unlock-page: кора с data-locked · форма с парола · 401 при грешна · подписан достъп · страница и API се отварят · паролата не влиза в адреса');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error('FAIL portal-unlock-page:', e && e.message);
  process.exitCode = 1;
});
