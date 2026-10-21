'use strict';
// PG-0: Public API Gateway — канали, портали, изолация, токени, Public Access Test.
const assert = require('node:assert/strict');
const GW = require('../hapi_enterprise/public-gateway.js');
const A = require('../hapi_enterprise/download-access.js');

// 1. Два независими канала с ясно разделение.
assert.deepEqual(GW.CHANNELS.map((c) => c.id), ['ingress', 'public']);
assert.match(GW.CHANNELS[0].auth, /HA сесия/);
assert.match(GW.CHANNELS[1].auth, /ключ|токен/);
assert.equal(GW.CHANNELS[1].download, 'Според политиката на файла');

// 2. Gateway: публичният порт не е публикуван по подразбиране.
const gw = GW.normalizeGateway({});
assert.equal(gw.ingress.port, 8099);
assert.equal(gw.public.port, 8088);
assert.equal(gw.public.published, false);
assert.equal(gw.public.require_https, true);
assert.equal(gw.public.domain, null);
assert.deepEqual(gw.storage.allowed_roots, ['/share', '/media']);

// 3. Портал: нормализация на slug и безопасни стойности.
const p = GW.normalizePortal({ title: 'Project A' });
assert.equal(p.slug, 'project-a');
assert.equal(p.status, 'active');
assert.equal(p.access, 'FREE');
assert.equal(GW.normalizePortal({ slug: 'x', access: 'NOPE' }).access, 'FREE');
assert.equal(GW.normalizePortal({ slug: 'x', visibility: 'hidden' }).visibility, 'hidden');

// 4. Валидация: slug, storage root, PRIVATE без роля.
assert.equal(GW.validatePortal({ slug: 'demo', title: 'Demo', storage_root: '/share/demo' }).ok, true);
assert.equal(GW.validatePortal({ slug: 'a', title: 'A' }).ok, false);
assert.equal(GW.validatePortal({ slug: 'demo', title: 'D', storage_root: '/config/hapi' }).errors.join().includes('/config/hapi'), true);
assert.equal(GW.validatePortal({ slug: 'demo', title: 'D', access: 'PRIVATE' }).ok, false);
assert.equal(GW.validatePortal({ slug: 'demo', title: 'D', access: 'PRIVATE', roles: ['admin'] }).ok, true);

// 5. Публични адреси.
assert.equal(GW.publicUrl({ slug: 'demo', title: 'D' }, { public: { domain: 'portal.example.com' } }), 'https://portal.example.com/p/demo/');
assert.equal(GW.apiUrls({ slug: 'demo', title: 'D' }, { public: { domain: 'portal.example.com' } }).portal, 'https://portal.example.com/api/public/v1/portals/demo');
assert.equal(
  GW.downloadUrl({ id: 'FILE 1' }, { public: { domain: 'portal.example.com' } }),
  'https://portal.example.com/api/public/v1/files/FILE%201/download',
);

// 5b. Същият origin като Home Assistant: относителни адреси, без собствен домейн.
assert.equal(GW.normalizeGateway({}).public.relative, false);
assert.equal(GW.normalizeGateway({ public: { relative: true } }).public.relative, true);
assert.equal(GW.publicUrl({ slug: 'demo', title: 'D' }, { public: { relative: true } }), '/p/demo/');
assert.equal(GW.apiUrls({ slug: 'demo', title: 'D' }, { public: { relative: true } }).portal, '/api/public/v1/portals/demo');
assert.equal(GW.downloadUrl({ id: 'FILE 1' }, { public: { relative: true } }), '/api/public/v1/files/FILE%201/download');

// 6. Изолация: административни, конфигурационни и файлови пътища се отказват.
assert.equal(GW.isolate('/p/demo/').ok, true);
assert.equal(GW.isolate('/config/secrets.yaml').reason, 'config-path');
assert.equal(GW.isolate('/admin/api/v2/portals').reason, 'admin-path');
assert.equal(GW.isolate('/api/hassio/auth').reason, 'admin-path');
assert.equal(GW.isolate('/etc/passwd').reason, 'filesystem-path');
assert.equal(GW.isolate('/p/../../etc/passwd').reason, 'path-traversal');
assert.equal(GW.isolate('//server/share').reason, 'unc');
assert.equal(GW.isolate('/%E0%A4%A').reason, 'bad-encoding');

// 7. Токени: отделна схема, HA JWT се отхвърля.
assert.equal(GW.validatePublicToken('hapi_' + 'a'.repeat(24)).ok, true);
assert.equal(GW.validatePublicToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln').reason, 'ha-token');
assert.equal(GW.validatePublicToken('abc').reason, 'wrong-prefix');
assert.equal(GW.validatePublicToken('hapi_short').reason, 'length');
assert.equal(GW.validatePublicToken('').reason, 'missing');

// 8. Маршрути.
assert.deepEqual(GW.gatewayRoute('/p/demo/'), { kind: 'portal', slug: 'demo', rest: '' });
assert.deepEqual(GW.gatewayRoute('/api/public/v1/portals/demo/files'), { kind: 'portal-api', slug: 'demo', sub: 'files' });
assert.deepEqual(GW.gatewayRoute('/api/public/v1/files/abc/download'), { kind: 'file-api', id: 'abc', download: true });
assert.equal(GW.gatewayRoute('/admin/x').kind, 'denied');
assert.equal(GW.gatewayRoute('/nope').kind, 'unknown');

// 9. Йерархия: по-слаба файлова политика не отменя порталната.
assert.equal(GW.resolvePolicy({ portal: { access: 'FREE' }, file: { access: 'DISABLED' } }).policy.mode, 'DISABLED');
assert.equal(GW.resolvePolicy({ portal: { access: 'KEY_REQUIRED' }, file: { access: 'FREE' } }).policy.mode, 'KEY_REQUIRED');
assert.equal(GW.resolvePolicy({ system: 'FREE', portal: { access: 'PRIVATE', roles: ['admin'] } }).policy.mode, 'PRIVATE');
assert.equal(GW.resolvePolicy({ portal: { access: 'FREE', visibility: 'public' }, file: { visibility: 'hidden' } }).visibility, 'hidden');
assert.equal(GW.resolvePolicy({ portal: { access: 'FREE' }, file: { access: 'DISABLED' } }).inherited, false);
assert.equal(GW.resolvePolicy({ portal: { access: 'FREE' } }).inherited, true);

// 10. Поведение: неактивен портал не показва и не дава.
const paused = GW.normalizePortal({ slug: 'paused-one', title: 'P', status: 'paused' });
assert.equal(GW.behaviourFor(paused, { access: 'FREE' }).downloadable, false);
assert.equal(GW.behaviourFor(paused, { access: 'FREE' }).listed, false);

// 11. Public Access Test: без публикуван порт достъп няма.
const portal = { slug: 'public-notices', title: 'Public notices', access: 'FREE', visibility: 'public', storage_root: '/share/notices' };
const file = { id: 'f1', name: 'Public_Report.pdf', access: 'FREE', visibility: 'public' };
const closed = GW.publicAccessTest({ gateway: {}, portal, file, ctx: {} });
assert.equal(closed.allowed, false);
assert.equal(closed.reason, 'gateway-published');

const open = GW.publicAccessTest({
  gateway: { public: { published: true, domain: 'portal.example.com' } },
  portal,
  file,
  ctx: { user: { id: '', roles: [], permissions: [] } },
});
assert.equal(open.allowed, true, JSON.stringify(open.checks));
assert.equal(open.url, 'https://portal.example.com/api/public/v1/files/f1/download');

// 11b. Същият IP и порт като HA: тестът минава без собствен домейн.
const sameOrigin = GW.publicAccessTest({
  gateway: { public: { published: true, relative: true } },
  portal,
  file,
  ctx: { user: { id: '', roles: [], permissions: [] } },
});
assert.equal(sameOrigin.allowed, true, JSON.stringify(sameOrigin.checks));
assert.equal(sameOrigin.portal_url, '/p/public-notices/');
assert.equal(sameOrigin.url, '/api/public/v1/files/f1/download');

// 12. KEY_REQUIRED без ключ → отказ; с валиден публичен ключ → достъп.
const keyed = GW.publicAccessTest({
  gateway: { public: { published: true, domain: 'portal.example.com' } },
  portal: { ...portal, access: 'KEY_REQUIRED' },
  file: { id: 'f2', name: 'Evidence_Package.zip', access: 'KEY_REQUIRED', visibility: 'public' },
  ctx: {},
});
assert.equal(keyed.allowed, false);
assert.equal(keyed.reason, 'token-active');

const tokenString = 'hapi_' + 'a'.repeat(24);
const keyedOk = GW.publicAccessTest({
  gateway: { public: { published: true, domain: 'portal.example.com' } },
  portal: { ...portal, access: 'KEY_REQUIRED' },
  file: { id: 'f2', name: 'Evidence_Package.zip', access: 'KEY_REQUIRED', visibility: 'public' },
  ctx: { tokenString, token: { id: 't1', uses: 0, max_uses: 5, expires_at: '2099-01-01T00:00:00Z' } },
});
assert.equal(keyedOk.allowed, true, JSON.stringify(keyedOk.checks));

// 13. HA токен не минава като публичен ключ.
const haToken = GW.publicAccessTest({
  gateway: { public: { published: true, domain: 'portal.example.com' } },
  portal: { ...portal, access: 'KEY_REQUIRED' },
  file: { id: 'f2', name: 'Evidence_Package.zip', access: 'KEY_REQUIRED', visibility: 'public' },
  ctx: { tokenString: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln', token: { id: 't1', uses: 0, max_uses: 5 } },
});
assert.equal(haToken.allowed, false);
assert.equal(haToken.reason, 'token-scheme');

// 14. Paused портал: отказ с причина.
const pausedTest = GW.publicAccessTest({
  gateway: { public: { published: true, domain: 'portal.example.com' } },
  portal: { ...portal, status: 'paused' },
  file,
  ctx: {},
});
assert.equal(pausedTest.allowed, false);
assert.equal(pausedTest.reason, 'portal-active');

// 15. Обобщение.
const summary = GW.summary([
  { slug: 'a-portal', title: 'A', status: 'active', access: 'FREE' },
  { slug: 'b-portal', title: 'B', status: 'paused', access: 'KEY_REQUIRED' },
  { slug: 'c-portal', title: 'C', status: 'disabled', access: 'DISABLED', visibility: 'hidden' },
]);
assert.deepEqual(summary, { total: 3, active: 1, paused: 1, disabled: 1, publicFree: 1, keyRequired: 1, hidden: 1 });

// 16. Съвместимост с трите основни режима на старата архитектура.
for (const mode of ['FREE', 'KEY_REQUIRED', 'DISABLED']) assert.ok(A.MODES_BY_ID[mode], mode);

console.log('public-gateway OK');
