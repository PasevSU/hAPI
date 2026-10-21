'use strict';
// Създаване на хранилище за API на портал (Фаза 8): api/<slug>/
//   api.json      — препратки за клиенти (api/manifest/files/openapi/qr)
//   openapi.json  — договорът (OpenAPI 3.1)
//   qr.svg        — QR към API-то (ако е подаден рендер)
//
// Използва се от server.js (admin API) и от тестовете. Без външни зависимости.

const fsp = require('node:fs/promises');
const path = require('node:path');
const spec = require('./api-spec');

const FILES = ['api.json', 'openapi.json', 'qr.svg'];

function create(options = {}) {
  const root = options.root ? path.resolve(String(options.root)) : '';
  if (!root) {
    throw Object.assign(new Error('api-registry: липсва root (директория за API хранилища)'), {
      code: 'CONFIG',
      status: 500,
    });
  }
  const baseUrl = String(options.baseUrl || '');
  const qrSvg = typeof options.qrSvg === 'function' ? options.qrSvg : null;

  function slugOf(portal) {
    return spec.assertSlug(portal && portal.slug);
  }

  function paths(portal) {
    const slug = slugOf(portal);
    const dir = path.join(root, slug);
    return { slug, dir, api: path.join(dir, 'api.json'), openapi: path.join(dir, 'openapi.json'), qr: path.join(dir, 'qr.svg') };
  }

  async function writeAtomic(file, content) {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, content, { mode: 0o600 });
    await fsp.rename(tmp, file);
  }

  /** Създава/обновява хранилището и връща препратките към него. */
  async function ensure(portal) {
    const p = paths(portal);
    await fsp.mkdir(p.dir, { recursive: true, mode: 0o700 });
    const record = spec.buildApiRecord(portal, { baseUrl });
    const openapi = spec.buildOpenApi(portal, { baseUrl });
    await writeAtomic(p.api, JSON.stringify(record, null, 2));
    await writeAtomic(p.openapi, JSON.stringify(openapi, null, 2));
    if (qrSvg) await writeAtomic(p.qr, String(qrSvg(record.apiUrl)));
    return {
      record,
      references: spec.buildReferences(baseUrl, p.slug),
      // `disk` е физическото място на файловете на API-то; `record.storage` е
      // виртуалното хранилище на портала (пътищата, които API-то обслужва).
      disk: { dir: p.dir, files: qrSvg ? FILES.slice() : FILES.slice(0, 2) },
    };
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

  async function remove(portal) {
    const p = paths(portal);
    await fsp.rm(p.dir, { recursive: true, force: true });
    return { removed: p.slug, dir: p.dir };
  }

  return { root, baseUrl, paths, ensure, read, remove };
}

module.exports = { create, FILES };
