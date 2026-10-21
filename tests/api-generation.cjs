'use strict';
// Фаза 8: генериране на публично API + хранилище за портал (api-spec + api-registry).
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { spawn } = require('node:child_process');
const spec = require('../hapi_enterprise/api-spec.js');

(async () => {
  // --- 1. Чисти функции: препратки и OpenAPI договор -------------------------
  const refs = spec.buildReferences('https://hapi.example.bg/', 'demo-portal');
  assert.equal(refs.base, 'https://hapi.example.bg');
  assert.equal(refs.apiUrl, 'https://hapi.example.bg/api/v1/p/demo-portal');
  assert.equal(refs.openapiUrl, refs.apiUrl + '/openapi.json');
  assert.equal(refs.manifestUrl, refs.apiUrl + '/manifest');
  assert.equal(refs.filesUrl, refs.apiUrl + '/files');
  assert.equal(refs.storageUrl, refs.apiUrl + '/storage');
  // Публичната страница (там води QR кодът) е с ID на портала, когато го има;
  // без id (стар код) остава по slug — затова всички стари връзки продължават да работят.
  assert.equal(refs.landingUrl, 'https://hapi.example.bg/p/demo-portal');
  assert.equal(
    spec.buildReferences('https://hapi.example.bg', 'demo-portal', 'p_123').landingUrl,
    'https://hapi.example.bg/p/p_123',
    'landing адресът използва id, не името',
  );

  assert.throws(() => spec.buildReferences('', '../evil'), (e) => e.code === 'INVALID_SLUG');
  assert.throws(() => spec.assertSlug('UPPER'), (e) => e.code === 'INVALID_SLUG');

  const record = spec.buildApiRecord({ slug: 'demo-portal', title: 'Demo' }, { baseUrl: '' });
  assert.equal(record.slug, 'demo-portal');
  assert.equal(record.storage.virtual, true);
  assert.equal(record.storage.url, '/api/v1/p/demo-portal/storage');
  assert.equal(record.storage.scheme, '/<topic>/<category>/<group>/<name>');
  assert.equal(record.links.apiUrl, '/api/v1/p/demo-portal');
  const withId = spec.buildApiRecord({ id: 'p_123', slug: 'demo-portal', title: 'Demo' }, { baseUrl: '' });
  assert.equal(withId.landing, '/p/p_123', 'записът на API-то носи id-адреса на страницата');

  // Виртуалните бройки идват от файловете на портала
  const withFiles = spec.buildApiRecord(
    { slug: 'demo-portal', title: 'Demo', files: [{ id: '1', name: 'a.pdf', category: 'Категория' }] },
    { baseUrl: '' },
  );
  assert.equal(withFiles.storage.fileCount, 1);
  assert.equal(withFiles.storage.folderCount, 1);

  const openapi = spec.buildOpenApi({ slug: 'demo-portal', title: 'Demo' }, { baseUrl: 'https://x.test' });
  assert.equal(openapi.openapi, '3.1.0');
  assert.ok(openapi.paths['/api/v1/p/demo-portal/files/{fileId}/download']);
  assert.ok(openapi.paths['/api/v1/p/demo-portal/storage']);
  assert.ok(openapi.components.securitySchemes.portalKey);
  assert.deepEqual(openapi.servers, [{ url: 'https://x.test' }]);

  // Договорът трябва да съвпада със сървъра: `order` приема uploadedAt, не „date“.
  const fileParams = openapi.paths['/api/v1/p/demo-portal/files'].get.parameters;
  const orderParam = fileParams.find((p) => p.name === 'order');
  assert.deepEqual(orderParam.schema.enum, ['name', 'uploadedAt', 'size'], 'order enum съвпада със сървъра');
  for (const param of ['q', 'topic', 'category', 'group', 'tag']) {
    assert.ok(fileParams.some((p) => p.name === param), 'липсва параметър ' + param);
  }
  const pageSchema = openapi.paths['/api/v1/p/demo-portal/files'].get.responses[200].content['application/json'].schema;
  assert.ok(pageSchema.properties.hasMore, 'страницата документира hasMore');
  assert.ok(pageSchema.properties.total, 'страницата документира total');
  assert.ok(
    openapi.paths['/api/v1/p/demo-portal/files'].get.responses[401],
    'документиран е 401 за липсващ ключ',
  );

  // --- 2. Интеграция: endpoint + файлове на диска ---------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-gen-'));
  const token = 'api-gen-admin-secret-2026-x7';
  const port = 18472;
  const B = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], {
    env: { ...process.env, DATA_DIR: dir, ADMIN_TOKEN: token, PORT: String(port) },
    stdio: 'pipe',
  });
  try {
    let ready = false;
    for (let i = 0; i < 70; i++) {
      try {
        if ((await fetch(B + '/health')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 70));
    }
    assert(ready);

    const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const call = async (p, m = 'GET', b) =>
      fetch(B + p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) });

    // Портал
    let r = await call('/admin/api/portals', 'POST', { slug: 'api-demo', title: 'API Demo' });
    assert.equal(r.status, 201);
    const portal = await r.json();
    assert.equal(portal.slug, 'api-demo');

    // Файл с таксономия → виртуален път
    r = await fetch(`${B}/admin/api/portals/${portal.id}/files`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'x-file-name': 'protokol.pdf', 'content-type': 'application/octet-stream' },
      body: Buffer.from('demo-content'),
    });
    assert.equal(r.status, 201);
    const uploaded = await r.json();
    r = await call(`/admin/api/portals/${portal.id}/files/${uploaded.id}/metadata`, 'PATCH', {
      topic: 'Дело 2026-114',
      category: 'Доказателства',
      group: 'Том 1',
    });
    assert.equal(r.status, 200);

    // Без токен → 401
    r = await fetch(B + '/admin/api/v2/portals/api-demo/api', { method: 'POST' });
    assert.equal(r.status, 401);

    // Генериране на хранилище и препратки
    r = await call('/admin/api/v2/portals/api-demo/api', 'POST');
    assert.equal(r.status, 201);
    const made = await r.json();
    assert.equal(made.references.apiUrl, `${B}/api/v1/p/api-demo`);
    assert.equal(made.references.openapiUrl, `${B}/api/v1/p/api-demo/openapi.json`);
    assert.ok(made.disk.dir.endsWith(path.join('api', 'api-demo')));
    assert.ok(made.disk.files.includes('api.json'));
    assert.ok(made.disk.files.includes('openapi.json'));
    assert.equal(made.record.storage.virtual, true);
    assert.equal(made.record.storage.url, `${B}/api/v1/p/api-demo/storage`);
    assert.equal(made.record.storage.fileCount, 1);
    assert.equal(made.record.storage.folderCount, 3);

    // Файловете наистина съществуват на диска
    const apiDir = path.join(dir, 'api', 'api-demo');
    assert.ok(fs.existsSync(path.join(apiDir, 'api.json')));
    assert.ok(fs.existsSync(path.join(apiDir, 'openapi.json')));
    const stored = JSON.parse(fs.readFileSync(path.join(apiDir, 'api.json'), 'utf8'));
    assert.equal(stored.slug, 'api-demo');
    assert.equal(stored.title, 'API Demo');
    assert.equal(stored.openapi, `${B}/api/v1/p/api-demo/openapi.json`);
    assert.equal(stored.storage.virtual, true);
    assert.equal(stored.storage.fileCount, 1);

    // Четене през admin API
    r = await call('/admin/api/v2/portals/api-demo/api');
    assert.equal(r.status, 200);
    const read = await r.json();
    assert.equal(read.record.slug, 'api-demo');
    assert.equal(read.record.links.filesUrl, `${B}/api/v1/p/api-demo/files`);

    // Публичният openapi.json вече е генерираният договор (не legacy spec)
    r = await call('/admin/api/portals/' + portal.id, 'PATCH', { visibility: 'public' });
    assert.equal(r.status, 200);
    r = await fetch(`${B}/api/v1/p/api-demo/openapi.json`);
    assert.equal(r.status, 200);
    const publicSpec = await r.json();
    assert.equal(publicSpec.openapi, '3.1.0');
    assert.ok(publicSpec.paths['/api/v1/p/api-demo/files/{fileId}/download']);
    assert.ok(publicSpec.paths['/api/v1/p/api-demo/storage'], 'OpenAPI описва /storage');

    // Манифест: файлът носи виртуален път, не физически
    r = await fetch(`${B}/api/v1/p/api-demo/manifest`);
    assert.equal(r.status, 200);
    const manifest = await r.json();
    assert.equal(manifest.storage.virtual, true);
    assert.equal(manifest.storage.url, `${B}/api/v1/p/api-demo/storage`);
    const entry = manifest.files.find((f) => f.name === 'protokol.pdf');
    assert.ok(entry, 'файлът е в манифеста');
    assert.equal(entry.path, '/Дело 2026-114/Доказателства/Том 1/protokol.pdf');

    // Виртуално хранилище: корен и папка
    r = await fetch(`${B}/api/v1/p/api-demo/storage`);
    assert.equal(r.status, 200);
    const rootNode = await r.json();
    assert.equal(rootNode.type, 'folder');
    assert.equal(rootNode.folderCount, 3);
    assert.equal(rootNode.fileCount, 1);

    r = await fetch(`${B}/api/v1/p/api-demo/storage?path=${encodeURIComponent('/Дело 2026-114/Доказателства')}`);
    assert.equal(r.status, 200);
    const folder = await r.json();
    assert.equal(folder.type, 'folder');
    assert.equal(folder.folders.length, 1);
    assert.equal(folder.files.length, 0);

    // Изход от дървото → 404
    r = await fetch(`${B}/api/v1/p/api-demo/storage?path=${encodeURIComponent('/../../etc/passwd')}`);
    assert.equal(r.status, 404);

    // Идемпотентност: второ генериране не чупи нищо
    r = await call('/admin/api/v2/portals/api-demo/api', 'POST');
    assert.equal(r.status, 201);

    // Непознат портал → 404
    r = await call('/admin/api/v2/portals/nope/api', 'POST');
    assert.equal(r.status, 404);

    // Изтриване на хранилището
    r = await call('/admin/api/v2/portals/api-demo/api', 'DELETE');
    assert.equal(r.status, 200);
    assert.equal(fs.existsSync(apiDir), false);
    r = await call('/admin/api/v2/portals/api-demo/api');
    assert.equal(r.status, 404);

    console.log('api-generation OK');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
