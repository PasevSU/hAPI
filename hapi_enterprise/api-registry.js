'use strict';
// Създаване на хранилище за API на портал (Фаза 8): api/<slug>/
//   api.json      — препратки за клиенти (api/manifest/files/openapi/qr)
//   openapi.json  — договорът (OpenAPI 3.1)
//   qr.svg        — QR към API-то (ако е подаден рендер)
//   portal.html   — човешката страница на портала (списък с файловете и адресите им)
//
// Използва се от server.js (admin API) и от тестовете. Без външни зависимости.
// Записът е атомарен (tmp + rename) и сериализиран по slug, за да не се конкурират
// няколко едновременни заявки за един и същ портал.

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const spec = require('./api-spec');
const portalFolder = require('./portal-folder');

const FILES = ['api.json', 'openapi.json', 'qr.svg', 'portal.html'];

// Windows: rename върху файл, който току-що е бил отворен (AV/indexer), може да върне
// EPERM/EBUSY. Кратък retry прави записа устойчив при паралелни заявки.
async function renameWithRetry(from, to, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (e) {
      const retryable = e && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code);
      if (!retryable || i === attempts - 1) throw e;
      await new Promise((resolve) => setTimeout(resolve, 15 * (i + 1)));
    }
  }
}

async function writeAtomic(file, content) {
  // Уникално име на временния файл: Date.now() се сблъсква при паралелни заявки.
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fsp.writeFile(tmp, content, { mode: 0o600 });
    await renameWithRetry(tmp, file);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => { });
    throw e;
  }
}

function create(options = {}) {
  const root = options.root ? path.resolve(String(options.root)) : '';
  if (!root) {
    throw Object.assign(new Error('api-registry: липсва root (директория за API хранилища)'), {
      code: 'CONFIG',
      status: 500,
    });
  }
  const defaultBaseUrl = String(options.baseUrl || '');
  const qrSvg = typeof options.qrSvg === 'function' ? options.qrSvg : null;
  // Какво кодира QR кодът: по подразбиране API адресът, но сървърът подава
  // публичната страница на портала, за да не отваря телефонът суров JSON.
  const qrPayload = typeof options.qrPayload === 'function' ? options.qrPayload : (record) => record.apiUrl;
  const queues = new Map();

  function slugOf(portal) {
    return spec.assertSlug(portal && portal.slug);
  }

  function paths(portal) {
    const slug = slugOf(portal);
    const dir = path.join(root, slug);
    return { slug, dir, api: path.join(dir, 'api.json'), openapi: path.join(dir, 'openapi.json'), qr: path.join(dir, 'qr.svg'), page: path.join(dir, 'portal.html') };
  }

  /** Изпълнява задачите за един slug последователно (без паралелни записи). */
  function serialize(slug, task) {
    const previous = queues.get(slug) || Promise.resolve();
    const next = previous.catch(() => { }).then(task);
    const guarded = next.catch(() => { });
    queues.set(slug, guarded);
    guarded.then(() => {
      if (queues.get(slug) === guarded) queues.delete(slug);
    });
    return next;
  }

  async function ensureNow(portal, base) {
    const p = paths(portal);
    await fsp.mkdir(p.dir, { recursive: true, mode: 0o700 });
    const record = spec.buildApiRecord(portal, { baseUrl: base });
    const openapi = spec.buildOpenApi(portal, { baseUrl: base });
    await writeAtomic(p.api, JSON.stringify(record, null, 2));
    await writeAtomic(p.openapi, JSON.stringify(openapi, null, 2));
    if (qrSvg) await writeAtomic(p.qr, String(qrSvg(qrPayload(record, portal, base))));
    // Човешката страница на портала: отваря се направо от папката, без add-on.
    await writeAtomic(p.page, portalFolder.page(portal, base));
    return {
      record,
      references: spec.buildReferences(base, p.slug),
      // `disk` е физическото място на файловете на API-то; `record.storage` е
      // виртуалното хранилище на портала (пътищата, които API-то обслужва).
      disk: { dir: p.dir, files: qrSvg ? FILES.slice() : FILES.filter((f) => f !== 'qr.svg') },
    };
  }

  /** Създава/обновява хранилището и връща препратките към него. */
  function ensure(portal, overrides = {}) {
    const base = overrides && overrides.baseUrl !== undefined ? String(overrides.baseUrl) : defaultBaseUrl;
    return serialize(slugOf(portal), () => ensureNow(portal, base));
  }

  /** Чете api.json; null, ако API-то още не е генерирано. */
  async function read(portal) {
    const p = paths(portal);
    try {
      return JSON.parse(await fsp.readFile(p.api, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  /** Изтрива хранилището на портала (след премахване или смяна на slug). */
  function remove(portal) {
    const slug = slugOf(portal);
    return serialize(slug, async () => {
      const p = paths(portal);
      await fsp.rm(p.dir, { recursive: true, force: true });
      return { removed: p.slug, dir: p.dir };
    });
  }

  return { root, baseUrl: defaultBaseUrl, paths, ensure, read, remove };
}

module.exports = { create, FILES };
