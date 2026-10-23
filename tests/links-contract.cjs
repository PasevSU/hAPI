'use strict';
// Договор за адресите: един вид за всеки линк, на едно място.
//
// Защо: до 0.69.48 адресите се строеха на седем места по три различни правила —
// `server.js` (портал), `send.js` (`/s/<id>`), HTML проектите (относително, веднъж с
// наклон и веднъж без), `api-spec.js`, и три различни „базови адреса“ в панела. Един и
// същ път изглеждаше различно според секцията, а оттам „файлът на портала е неясно къде
// се намира“. Този тест държи три неща:
//   1. формите (id срещу slug, наклон за папка, кодиране) — чисто, без сървър;
//   2. базовият адрес — от заявка и от адреса на страницата, вкл. Ingress префикс;
//   3. никой друг файл не строи тези адреси на ръка (статична проверка);
//   4. живият сървър връща същите адреси и те наистина отговарят.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startServer } = require('./lib/gui-harness.cjs');
const surface = require('./lib/http-surface.cjs');
const links = require(path.join(__dirname, '..', 'hapi_enterprise', 'links.js'));

const ROOT = path.join(__dirname, '..');
const portal = { id: 'p-1', slug: 'demo-portal' };

// ── 1. Форми ────────────────────────────────────────────────────────────────
assert.equal(links.portalLandingPath(portal), '/p/p-1', 'човешката страница е с id');
assert.equal(links.portalLandingPath({ slug: 'само-slug' }), '/p/%D1%81%D0%B0%D0%BC%D0%BE-slug', 'без id — slug, кодиран');
assert.equal(links.portalApiPath(portal), '/api/v1/p/demo-portal', 'API-то е със slug');
assert.equal(links.portalApiFilePath(portal, 'manifest'), '/api/v1/p/demo-portal/manifest', 'ресурс под API-то');
assert.equal(links.portalApiFilePath(portal, '/openapi.json'), '/api/v1/p/demo-portal/openapi.json', 'водещ наклон не се дублира');

// Папка → наклон в края; същият път без наклон е само за Location/Cookie.
assert.equal(links.htmlProjectPath(portal, 'proj1'), '/site/demo-portal/proj1/', 'HTML проектът е папка → с наклон');
assert.equal(links.htmlProjectBasePath(portal, 'proj1'), '/site/demo-portal/proj1', 'без наклон — за Location');
assert.ok(links.htmlProjectPath(portal, 'proj1').startsWith(links.htmlProjectBasePath(portal, 'proj1') + '/'), 'двете форми сочат едно и също място');

assert.equal(links.sendPath('s1'), '/s/s1', 'еднократната връзка');
assert.equal(links.adminApiPath('portals'), '/admin/api/portals', 'административен път');
assert.equal(links.adminApiPath('/portals'), '/admin/api/portals', 'водещ наклон не се дублира');
assert.equal(links.panelPath(), '/ui/', 'панелът е папка → с наклон');

// Базов адрес: без двойни наклони, без измислена схема.
assert.equal(links.withBase('', '/p/x'), '/p/x', 'без базов адрес — относителен');
assert.equal(links.withBase('https://h.example.bg', '/p/x'), 'https://h.example.bg/p/x', 'базов адрес без наклон');
assert.equal(links.withBase('https://h.example.bg/', '/p/x'), 'https://h.example.bg/p/x', 'наклонът в края на базата се маха');
assert.equal(links.withBase('https://h.example.bg', 'p/x'), 'https://h.example.bg/p/x', 'път без наклон се допълва');

// Тайната връзка: ЦЯЛОТО (id + ключ) е след `#` — фрагментът не се изпраща по мрежата.
const secret = links.secretLink({ base: 'https://h.example.bg', path: '/secret', id: 'ID123', key: 'KEY456' });
assert.equal(secret, 'https://h.example.bg/secret#ID123KEY456', 'тайната връзка носи ключа само във фрагмента');
assert.equal(secret.split('#')[0].includes('KEY456'), false, 'ключът НЕ е в частта, която се изпраща');
assert.equal(links.secretLink({ id: 'a', key: 'b' }), '/secret#ab', 'подразбираща се страница и без база');

// ── 2. Базов адрес от заявка и от страница ─────────────────────────────────
assert.equal(links.baseFromRequest({ headers: { host: 'nas.local:8099' } }), 'http://nas.local:8099', 'http от Host');
assert.equal(links.baseFromRequest({ headers: { host: 'a.bg', 'x-forwarded-proto': 'https' } }), 'https://a.bg', 'https от X-Forwarded-Proto');
assert.equal(links.baseFromRequest({ headers: { 'x-forwarded-host': 'b.bg', host: 'inner:1' } }), 'http://b.bg', 'X-Forwarded-Host печели');
assert.equal(links.baseFromRequest({ headers: {}, publicBaseUrl: 'https://public.bg/' }), 'https://public.bg', 'настроеният публичен адрес печели');
assert.equal(links.baseFromRequest({ headers: { host: 'лош хост' } }), '', 'невалиден Host → без база');
assert.equal(links.baseFromLocation({ protocol: 'file:', origin: 'null', pathname: '/ui/index.html' }), '', 'file:// → без база');
assert.equal(links.baseFromLocation({ protocol: 'https:', origin: 'https://ha.bg', pathname: '/ui/index.html' }), 'https://ha.bg', 'панелът от корена');
assert.equal(
  links.baseFromLocation({ protocol: 'https:', origin: 'https://ha.bg', pathname: '/api/hassio_ingress/TOKEN/ui/index.html' }),
  'https://ha.bg/api/hassio_ingress/TOKEN',
  'Ingress префиксът се запазва'
);
assert.equal(
  links.baseFromLocation({ protocol: 'https:', origin: 'https://ha.bg', pathname: '/api/hassio_ingress/TOKEN/admin/x' }),
  'https://ha.bg/api/hassio_ingress/TOKEN',
  'административният път също дава същата база'
);
assert.equal(
  links.baseFromLocation({ protocol: 'https:', origin: 'https://ha.bg', pathname: '/app/99438e72_hapi_enterprise/ui/' }),
  'https://ha.bg/app/99438e72_hapi_enterprise',
  'старият Ingress префикс също'
);

// ── 3. Никой друг файл не строи тези адреси на ръка ────────────────────────
const RAW = [
  [/(['"`])\/p\/\1\s*\+/, "'/p/' + …"],
  [/(['"`])\/s\/\1\s*\+/, "'/s/' + …"],
  [/(['"`])\/site\/\1\s*\+/, "'/site/' + …"],
  [/(['"`])\/api\/v1\/p\/\1\s*\+/, "'/api/v1/p/' + …"],
  [/(['"`])\/admin\/api\/\1\s*\+/, "'/admin/api/' + …"],
];
const suspects = surface
  .files(ROOT)
  .concat(
    fs.readdirSync(path.join(ROOT, 'hapi_enterprise', 'ui')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'hapi_enterprise', 'ui', f))
  )
  .concat([path.join(ROOT, 'hapi_enterprise', 'send.js'), path.join(ROOT, 'hapi_enterprise', 'api-spec.js')]);
const offenders = [];
for (const file of suspects) {
  const src = fs.readFileSync(file, 'utf8');
  for (const [re, label] of RAW) if (re.test(src)) offenders.push(path.relative(ROOT, file) + ' → ' + label);
}
assert.deepEqual(offenders, [], 'адресите се строят само в links.js; намерени на ръка: ' + offenders.join(' · '));

// ── 4. Живият сървър дава същите адреси и те отговарят ─────────────────────
const token = require('node:crypto').randomBytes(24).toString('hex');

async function live() {
  const server = await startServer({ token });
  try {
    const created = await server.api('/admin/api/portals', 'POST', { slug: 'links-live', title: 'Links Live', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data));
    const record = created.data;

    // Сървърът сам връща адресите — сверяваме ги с builder-а, не с очакван низ.
    const info = await server.api('/admin/api/portals/' + record.id + '/api-info');
    assert.equal(info.status, 200, 'api-info отговаря');
    assert.equal(info.data.landingUrl, links.withBase(server.base, links.portalLandingPath(record)), 'landing адресът е от builder-а');
    assert.equal(info.data.apiUrl, links.withBase(server.base, links.portalApiPath(record)), 'API адресът е от builder-а');
    assert.equal(info.data.qrTarget, info.data.landingUrl, 'QR кодът води до човешката страница, не до JSON');

    // Същите пътища отговарят на живо (относително към сървъра).
    for (const p of [links.portalLandingPath(record), links.portalApiPath(record), links.portalApiPath(record) + '/manifest']) {
      const res = await fetch(server.base + p);
      await res.text();
      assert.ok([200, 302].includes(res.status), 'адресът отговаря: ' + p + ' → ' + res.status);
    }

    // Панелът е папка и се сервира с наклон; без наклон също работи.
    const panel = await fetch(server.base + links.panelPath());
    await panel.text();
    assert.equal(panel.status, 200, 'панелът отговаря на ' + links.panelPath());
  } finally {
    await server.stop();
  }
}

live()
  .then(() => {
    process.stdout.write(
      'PASS links-contract: ' + linksCount() + ' форми · база от заявка и от страница · никой друг файл не строи адреси · живите адреси отговарят\n'
    );
  })
  .catch((e) => {
    process.stderr.write('FAIL links-contract: ' + (e && e.message ? e.message : e) + '\n');
    process.exitCode = 1;
  });

function linksCount() {
  return Object.keys(links).length;
}
