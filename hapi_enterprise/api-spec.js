'use strict';
// Генериране на публично API за портал (Фаза 8 / API-01…03) — чист JS, без I/O.
//
// Работи и в браузър (UMD), за да може GUI-ят да показва/сваля api.json и
// openapi.json без сървър, и в Node, където api-registry.js ги записва на диск.

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

function assertSlug(slug) {
  const value = String(slug == null ? '' : slug);
  if (!SLUG.test(value)) {
    throw Object.assign(new Error(`Невалиден slug: „${value}“. Позволено: [a-z0-9-], до 63 знака.`), {
      code: 'INVALID_SLUG',
      status: 400,
    });
  }
  return value;
}

function trimBase(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

// Виртуалното хранилище е чист модул (UMD): require в Node, global в браузър.
function virtualStorage() {
  if (typeof require === 'function') {
    try {
      return require('./virtual-storage');
    } catch {
      /* браузър */
    }
  }
  return typeof globalThis !== 'undefined' ? globalThis.HapiVirtualStorage : null;
}

/** Канонични препратки към API-то на портала (един източник за всички клиенти). */
function buildReferences(baseUrl, slug, id) {
  const safe = assertSlug(slug);
  const base = trimBase(baseUrl);
  const prefix = `${base}/api/v1/p/${encodeURIComponent(safe)}`;
  return {
    base,
    slug: safe,
    // Публичната страница (там води QR кодът) се адресира с ID на портала, когато го има;
    // JSON API-то остава на slug — така връзката не издава името и не се чупи при смяна.
    landingUrl: `${base}/p/${encodeURIComponent(String(id || safe))}`,
    apiUrl: prefix,
    manifestUrl: `${prefix}/manifest`,
    filesUrl: `${prefix}/files`,
    storageUrl: `${prefix}/storage`,
    openapiUrl: `${prefix}/openapi.json`,
    qrUrl: `${prefix}/qr.svg`,
  };
}

/** Съдържание на api.json — това, което клиентите четат, за да се свържат. */
function buildApiRecord(portal, options = {}) {
  const refs = buildReferences(options.baseUrl, portal && portal.slug, portal && portal.id);
  const files = Array.isArray(options.files) ? options.files : Array.isArray(portal && portal.files) ? portal.files : [];
  const vs = virtualStorage();
  const tree = vs ? vs.buildTree(files) : { folderCount: 0, fileCount: files.length };
  return {
    slug: refs.slug,
    title: String((portal && portal.title) || refs.slug),
    version: String((portal && portal.apiVersion) || '1.0.0'),
    apiUrl: refs.apiUrl,
    openapi: refs.openapiUrl,
    manifest: refs.manifestUrl,
    files: refs.filesUrl,
    // Човешката страница на портала — същият адрес, който носи QR кодът.
    landing: refs.landingUrl,
    storage: {
      virtual: true,
      root: '/',
      url: refs.storageUrl,
      scheme: '/<topic>/<category>/<group>/<name>',
      folderCount: tree.folderCount,
      fileCount: tree.fileCount,
    },
    qr: refs.qrUrl,
    links: refs,
    updatedAt: new Date().toISOString(),
  };
}

/** OpenAPI 3.1 за портала: един договор за публичното API v1. */
function buildOpenApi(portal, options = {}) {
  const refs = buildReferences(options.baseUrl, portal && portal.slug);
  const title = String((portal && portal.title) || refs.slug);
  const p = `/api/v1/p/${refs.slug}`;
  const ok = (description) => ({ description, content: { 'application/json': { schema: { type: 'object' } } } });
  const secured = [{ portalKey: [] }];
  return {
    openapi: '3.1.0',
    info: {
      title: `${title} — Public API`,
      version: String((portal && portal.apiVersion) || '1.0.0'),
      description:
        'Публично API на портал в hAPI Enterprise. Ключът се подава в X-Portal-Key; ' +
        'файловият ключ — в X-File-Key. Административните API-та не са част от този договор.',
      'x-hapi-storage': refs.slug,
    },
    servers: [{ url: refs.base || '/' }],
    security: secured,
    paths: {
      [p]: {
        get: {
          summary: 'Метаданни на портала',
          security: secured,
          responses: { 200: ok('Portal metadata'), 401: { description: 'Липсва или е невалиден ключ' }, 404: { description: 'Not found' } },
        },
      },
      [`${p}/manifest`]: {
        get: {
          summary: 'Манифест (списък + хешове, без съдържание)',
          security: secured,
          responses: { 200: ok('Manifest'), 401: { description: 'Липсва или е невалиден ключ' }, 404: { description: 'Not found' } },
        },
      },
      [`${p}/files`]: {
        get: {
          summary: 'Списък на файловете (пагинация и филтри)',
          security: secured,
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Търсене в името' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, minimum: 1, maximum: 500 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0, minimum: 0 } },
            {
              name: 'order',
              in: 'query',
              schema: { type: 'string', enum: ['name', 'uploadedAt', 'size'], default: 'name' },
              description: 'uploadedAt е името на полето в отговора (не „date“).',
            },
            { name: 'direction', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } },
            { name: 'topic', in: 'query', schema: { type: 'string', maxLength: 120 } },
            { name: 'category', in: 'query', schema: { type: 'string', maxLength: 120 } },
            { name: 'group', in: 'query', schema: { type: 'string', maxLength: 120 } },
            { name: 'tag', in: 'query', schema: { type: 'string', maxLength: 120 } },
          ],
          responses: {
            200: {
              description: 'Страница с файлове',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['files', 'total', 'limit', 'offset', 'hasMore'],
                    properties: {
                      files: { type: 'array', items: { type: 'object' } },
                      total: { type: 'integer' },
                      limit: { type: 'integer' },
                      offset: { type: 'integer' },
                      hasMore: { type: 'boolean' },
                    },
                  },
                },
              },
            },
            400: { description: 'Невалидна пагинация, сортиране или филтър' },
            401: { description: 'Липсва или е невалиден ключ на портала' },
          },
        },
      },
      [`${p}/files/{fileId}`]: {
        get: {
          summary: 'Метаданни на файл',
          security: secured,
          parameters: [{ name: 'fileId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: ok('File metadata'),
            401: { description: 'Липсва или е невалиден ключ' },
            404: { description: 'Not found' },
          },
        },
      },
      [`${p}/files/{fileId}/download`]: {
        get: {
          summary: 'Изтегляне (поддържа Range)',
          security: secured,
          parameters: [{ name: 'fileId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Binary stream' },
            206: { description: 'Partial content' },
            401: { description: 'Липсва или е невалиден ключ' },
            404: { description: 'Not found' },
          },
        },
      },
      [`${p}/storage`]: {
        get: {
          summary: 'Виртуално хранилище (дърво)',
          description:
            'Йерархия topic → category → group → файл. Връща папките и файловете с виртуален път, ' +
            'а не физически път на диска.',
          security: secured,
          parameters: [
            {
              name: 'path',
              in: 'query',
              schema: { type: 'string' },
              description: 'Виртуален път, напр. /Тема/Категория. Без стойност → коренът.',
            },
          ],
          responses: {
            200: ok('Virtual storage node'),
            401: { description: 'Липсва или е невалиден ключ' },
            404: { description: 'Path not found' },
          },
        },
      },
      [`${p}/openapi.json`]: {
        get: { summary: 'Тази спецификация', responses: { 200: ok('OpenAPI document') } },
      },
    },
    components: {
      securitySchemes: {
        portalKey: { type: 'apiKey', in: 'header', name: 'X-Portal-Key' },
        fileKey: { type: 'apiKey', in: 'header', name: 'X-File-Key' },
      },
    },
  };
}

// Името е различно от `API` в report-manifest.js: двата файла се зареждат като
// класически <script> в една глобална лексикална среда и не бива да си пречат.
const API_SPEC = { SLUG, assertSlug, buildReferences, buildApiRecord, buildOpenApi };

if (typeof module !== 'undefined' && module.exports) module.exports = API_SPEC;
if (typeof globalThis !== 'undefined') globalThis.HapiApiSpec = API_SPEC;
