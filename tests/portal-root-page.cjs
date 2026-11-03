'use strict';
// ПОРТАЛЪТ КАТО ЕДИН АДРЕС — `/portal.html` на сървъра (и през Home Assistant).
//
// Правилото, което пази този тест:
//   • адресът е ЕДИН и води до HTML файла (не до JSON и не до технически адреси);
//   • на чиста инсталация поздравява и казва, че още няма портали (без мъртви връзки);
//   • един достъпен портал → направо неговата страница с файловете;
//   • няколко → списък, в който всяко действие е бутон към `/p/<id>` (пак HTML, същият адрес);
//   • `?folder=<slug>` остава страницата на конкретния портал;
//   • зад Home Assistant адресите в страницата носят неговия префикс (`/hapi`) и HTTPS —
//     иначе страница, отворена на `https://<ha>/hapi/portal.html`, води към `https://<ha>/p/…`,
//     където hAPI няма маршрут.
const assert = require('node:assert/strict');
const { startServer } = require('./lib/gui-harness.cjs');

(async () => {
  const server = await startServer({ keepData: true });
  const { api, base } = server;
  try {
    // ── 1. Чиста инсталация: поздрав без портали ──────────────────────────────
    const empty = await fetch(`${base}/portal.html`);
    const emptyHtml = await empty.text();
    assert.equal(empty.status, 200, 'чистата инсталация отговаря 200, не 404');
    assert.match(empty.headers.get('content-type') || '', /text\/html/, 'връща се HTML, не JSON');
    assert.ok(emptyHtml.includes('Здравейте! Това е hAPI Enterprise.'), 'страницата поздравява');
    assert.ok(emptyHtml.includes('Още няма портали'), 'и казва какво е положението');
    assert.equal(/<a[\s>]/i.test(emptyHtml), false, 'без портали няма и мъртви връзки');

    // ── 2. Един портал: направо неговите файлове ──────────────────────────────
    const first = await api('/admin/api/portals', 'POST', {
      slug: 'root-page-a',
      title: 'Портал А',
      description: 'Тук са вашите документи.',
      visibility: 'public',
    });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const one = await fetch(`${base}/portal.html`);
    const oneHtml = await one.text();
    assert.equal(one.status, 200);
    assert.ok(oneHtml.includes('Здравейте! Това е портал „Портал А“.'), 'поздравът назовава портала');
    assert.ok(oneHtml.includes('Тук са вашите документи.'), 'описанието на портала е поздравът');
    const anchors = [...oneHtml.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(anchors.length >= 1, 'има бутон към портала');
    for (const anchor of anchors) {
      assert.ok(anchor.includes(`/p/${first.data.id}`) || /\sdownload\b/.test(anchor),
        'всяка връзка е към ПОРТАЛА (или е сваляне на файл), а не към технически адрес: ' + anchor);
    }
    for (const banned of ['api.json', 'openapi.json', 'qr.svg', '/api/v1/']) {
      assert.equal(oneHtml.includes(banned), false, 'страницата не извежда технически адрес „' + banned + '“');
    }

    // ── 3. Няколко портала: списък с бутони ──────────────────────────────────
    const second = await api('/admin/api/portals', 'POST', {
      slug: 'root-page-b',
      title: 'Портал Б',
      visibility: 'public',
    });
    assert.equal(second.status, 201, JSON.stringify(second.data));
    const many = await fetch(`${base}/portal.html`);
    const manyHtml = await many.text();
    assert.equal(many.status, 200);
    assert.ok(manyHtml.includes('Портал А') && manyHtml.includes('Портал Б'), 'изброени са и двата портала');
    assert.ok(manyHtml.includes('Портали: 2.'), 'казва колко са');
    const open = [...manyHtml.matchAll(/<a\b[^>]*href="([^"]*\/p\/[^"]*)"/g)].map((m) => m[1]);
    assert.equal(open.length, 2, 'по един бутон на портал, всички към /p/<id>');

    // ── 4. Конкретен портал остава достъпен по същия адрес ───────────────────
    const byFolder = await fetch(`${base}/portal.html?folder=root-page-a`);
    const byFolderHtml = await byFolder.text();
    assert.equal(byFolder.status, 200, '?folder=<slug> работи');
    assert.ok(byFolderHtml.includes('Здравейте! Това е портал „Портал А“.'), 'това е страницата на портала');
    const missing = await fetch(`${base}/portal.html?folder=nyama-takuv`);
    await missing.text();
    assert.equal(missing.status, 404, 'несъществуващ портал е 404, не празна страница');

    // ── 5. Зад Home Assistant: префикс `/hapi` и HTTPS ──────────────────────
    const forwarded = await fetch(`${base}/portal.html`, {
      headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'ha.example.bg', 'X-Forwarded-Prefix': '/hapi' },
    });
    const forwardedHtml = await forwarded.text();
    assert.ok(forwardedHtml.includes('https://ha.example.bg/hapi/p/'), 'адресите носят префикса на HA и HTTPS');
    assert.equal(/https?:\/\/[^"\s]*:8123/.test(forwardedHtml), false, 'никакъв вътрешен порт в адресите');

    console.log(
      'PASS portal-root-page: /portal.html = поздрав · 0 портала → обяснение · 1 → неговата страница · ' +
      '2 → списък с бутони · ?folder= работи · зад HA адресите са https + /hapi',
    );
  } finally {
    await server.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
