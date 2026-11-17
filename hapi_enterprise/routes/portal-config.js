'use strict';
// ОПЦИИ НА ПОРТАЛА ПРЕЗ HTTP — един вход към `configuration.yaml`.
//
// Защо е отделен модул: панелът не бива да знае къде е файлът, как се проверява и как се пази
// ревизията. Затова ЦЯЛАТА работа с описанието минава оттук, а `portal-config.js` остава
// договорът без HTTP. Така има един четец, един запис и един начин за сверка.
//
//   GET  /admin/api/portals/{id}/config              — ефективни стойности + хешът (чекпойнт)
//   PUT  /admin/api/portals/{id}/config              — запис на промяната (иска `expectHash`)
//   POST /admin/api/portals/{id}/config/verify       — сверка на `files[]` с диска
//   POST /admin/api/portals/{id}/config/adopt        — ръчна промяна във файла влиза в базата
//   GET  /admin/api/portals/{id}/config/export.yaml  — файлът както е на диска
//   POST /admin/api/portals/{id}/config/import       — цял YAML замества файла (иска `If-Match`)
//
// Правилото, което не се разхлабва: всяка мутация носи `configHash` (тялото `expectHash` или
// заглавката `If-Match`) и връща новия хеш. Запис върху чужда промяна е `409` с текущия хеш и
// разликата — иначе два отворени таба си затрупват работата без никой да разбере.
const portalConfig = require('../portal-config');
const paths = require('../paths');

function create(deps) {
  const { json, fail, parse, body, audit, fsp, path, portalAbs, portalFolder, update, hash, checks } = deps;
  // Името на проверката идва от договора в `check-log.js` (търси се с `source=check.config`).
  const CONFIG = (checks && checks.names && checks.names.config) || 'config';
  const DESCRIPTION = portalFolder.DESCRIPTION;
  const RESERVED = portalConfig.RESERVED;

  function routeOf(parts, method) {
    if (parts[0] !== 'admin' || parts[1] !== 'api' || parts[2] !== 'portals' || parts[4] !== 'config') return null;
    if (parts.length === 5) return method === 'GET' || method === 'PUT' ? 'root' : null;
    if (parts.length !== 6) return null;
    // Литералите се сравняват направо с `parts[5]`: така договорът в `admin-api-spec.js` и
    // проверката за „описан, но липсващ в кода“ виждат СЪЩИЯ сегмент, а не локално копие.
    if (parts[5] === 'verify' && method === 'POST') return 'verify';
    if (parts[5] === 'adopt' && method === 'POST') return 'adopt';
    if (parts[5] === 'export.yaml' && method === 'GET') return 'export';
    if (parts[5] === 'import' && method === 'POST') return 'import';
    return null;
  }

  /** Описанието живее САМО в собствената папка на портала; общ корен няма файл. */
  function fileOf(portal) {
    const root = String((portal && portal.storage_root) || paths.LOGICAL_ROOTS.share);
    if (paths.isLogicalRoot(root)) return null;
    const dir = portalAbs(root);
    return { root, dir, file: path.join(dir, DESCRIPTION), label: String(root).replace(/\\/g, '/').replace(/\/+$/, '') + '/' + DESCRIPTION };
  }

  async function exists(file) {
    return fsp.access(file).then(() => true, () => false);
  }

  function payload(read, extra) {
    return {
      file: extra.label,
      exists: extra.exists,
      hash: read ? read.hash : null,
      revision: read ? read.revision : 0,
      legacy: read ? read.legacy : false,
      data: read ? read.data : extra.data,
      effective: portalConfig.effective(read ? read.data : extra.data),
      // Договорът (§27) нарича списъка `problems`; при грешка тялото носи `issues` (същите полета).
      problems: read ? read.problems : [],
    };
  }

  /**
   * Опциите от ФАЙЛА влизат в записа на портала (посоката „файл → база“).
   * Съдържанието (`files[]`) НЕ се пипа: то е на базата и се сверява, не се внася мълчаливо.
   */
  async function adopt(portal, data, reason) {
    const applied = [];
    await update(() => {
      const set = (key, value, name) => {
        if (portal[key] === value) return;
        portal[key] = value;
        applied.push(name);
      };
      set('title', data.name, 'name');
      set('visibility', data.visibility, 'visibility');
      set('flag', data.flag, 'flag');
      set('category', data.category, 'category');
      set('subject', data.subject, 'subject');
      set('notesText', data.notes, 'notes');
      set('contactId', data.contact_id, 'contact_id');
      set('caseId', data.case_id, 'case_id');
      set('parentId', data.parent_id, 'parent_id');
      // Папките пазят само ИЗКЛЮЧЕНИЯТА от подразбирането — както ги пише и PATCH на дървото.
      const meta = {};
      for (const [rel, flags] of Object.entries(data.folders || {})) {
        if (flags.visible === false || flags.media === true || flags.locked === true) meta[rel] = flags;
      }
      const before = JSON.stringify(portal.folderMeta || {});
      if (JSON.stringify(meta) !== before) {
        portal.folderMeta = meta;
        applied.push('folders');
      }
      if (applied.length) void audit('portal.config.adopt', { portalId: portal.id, applied, reason });
    });
    return applied;
  }

  function conflict(res, error) {
    return json(res, 409, {
      error: 'PORTAL_CONFIG_CONFLICT',
      message: error.message,
      currentHash: error.currentHash,
      diff: error.diff || [],
    });
  }

  function invalid(res, error) {
    return json(res, 422, { error: 'PORTAL_CONFIG_INVALID', message: error.message, issues: error.issues || [] });
  }

  async function save(res, where, portal, data, expectHash, reason) {
    let written;
    try {
      written = portalConfig.write(where.file, data, { slug: portal.slug, title: portal.title, digest: hash.digest, expectHash });
    } catch (error) {
      if (error.code === 'PORTAL_CONFIG_CONFLICT') return conflict(res, error);
      if (error.code === 'PORTAL_CONFIG_INVALID') return invalid(res, error);
      throw error;
    }
    const applied = await adopt(portal, portalConfig.read(where.file, { slug: portal.slug }).data, reason);
    const read = portalConfig.read(where.file, { slug: portal.slug, digest: hash.digest });
    return json(res, 200, { ...payload(read, { label: where.label, exists: true }), hash: written.hash, revision: written.revision, applied });
  }
  async function handle({ req, res, url, parts, method, portal }) {
    if (!portal) return false;
    const route = routeOf(parts, method);
    if (!route) return false;
    const where = fileOf(portal);
    if (!where) {
      fail(res, 409, 'PORTAL_CONFIG_NO_FOLDER: порталът ползва общ корен и няма своя папка за configuration.yaml');
      return true;
    }

    if (route === 'root' && method === 'GET') {
      if (!(await exists(where.file))) {
        const initial = portalConfig.initial({ slug: portal.slug, title: portal.title });
        return json(res, 200, { ...payload(null, { label: where.label, exists: false, data: initial }) });
      }
      let read;
      try {
        read = portalConfig.read(where.file, { slug: portal.slug, digest: hash.digest });
      } catch (error) {
        return fail(res, 500, 'PORTAL_CONFIG_UNREADABLE: ' + error.message);
      }
      void audit('portal.config.read', { portalId: portal.id, revision: read.revision, legacy: read.legacy, ok: !read.problems.length });
      return json(res, 200, payload(read, { label: where.label, exists: true }));
    }

    if (route === 'root' && method === 'PUT') {
      const b = await parse(req);
      const patch = b.config || b.options || b.data || null;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        fail(res, 400, 'PORTAL_CONFIG_INVALID: очаква се обект с опции (config)');
        return true;
      }
      // Чекпойнтът идва в тялото (`expectHash`) или в заглавка (`If-Match`), както е в §27.
      const headerHash = String(req.headers['if-match'] || '').replace(/^W\//, '').replace(/"/g, '');
      const checkpoint = b.expectHash !== undefined ? b.expectHash : (headerHash || undefined);
      if (checkpoint === undefined) {
        fail(res, 400, 'PORTAL_CONFIG_HASH_REQUIRED: всяка промяна носи expectHash или If-Match (чекпойнт на файла)');
        return true;
      }
      const present = await exists(where.file);
      // При съществуващ файл `null` значи „запиши на сляпо“ — точно това трябва да се откаже.
      if (present && !checkpoint) {
        const current = portalConfig.read(where.file, { slug: portal.slug, digest: hash.digest });
        return conflict(res, { message: 'PORTAL_CONFIG_CONFLICT: липсва чекпойнт за съществуващ файл', currentHash: current.hash, diff: [] });
      }
      if (!present && checkpoint) {
        return conflict(res, { message: 'PORTAL_CONFIG_CONFLICT: файлът не съществува, чекпойнтът е от друго копие', currentHash: null, diff: [] });
      }
      return save(res, where, portal, patch, present ? checkpoint : null, 'put');
    }

    if (route === 'verify') {
      if (!(await exists(where.file))) return fail(res, 404, 'PORTAL_CONFIG_MISSING: порталът още няма configuration.yaml');
      const read = portalConfig.read(where.file, { slug: portal.slug, digest: hash.digest });
      if (read.problems.length) return json(res, 200, { ok: false, issues: read.problems, hash: read.hash, revision: read.revision });
      const entries = [];
      const walk = async (dir, rel) => {
        for (const item of await fsp.readdir(dir, { withFileTypes: true })) {
          if (item.name.startsWith('.')) continue;
          const childRel = rel ? rel + '/' + item.name : item.name;
          const full = path.join(dir, item.name);
          if (item.isDirectory()) {
            await walk(full, childRel);
            continue;
          }
          if (!item.isFile() || RESERVED.has(item.name)) continue;
          try {
            const got = await hash.file(full);
            entries.push({ path: '/' + childRel, sha256: got.hex, bytes: got.bytes });
          } catch {
            entries.push({ path: '/' + childRel, unreadable: true });
          }
        }
      };
      await walk(where.dir, '');
      const report = portalConfig.verify(read.data, entries);
      void audit('portal.config.verify', { portalId: portal.id, ok: report.ok, missing: report.missing.length, extra: report.extra.length, changed: report.changed.length, unreadable: report.unreadable.length });
      // „Сверка“ в панела е проверка като всяка друга: успехът отива в дневника, а проблемът — и в
      // журнала с причина, за да се засича, вместо да остане само в одита.
      const context = { portalId: portal.id, checked: entries.length, missing: report.missing.length, extra: report.extra.length, changed: report.changed.length, unreadable: report.unreadable.length };
      if (report.ok) checks.ok(CONFIG, context);
      else checks.fail(CONFIG, report.missing.length ? 'CONFIG_FILES_MISSING' : report.changed.length ? 'CONFIG_FILES_CHANGED' : report.unreadable.length ? 'CONFIG_FILES_UNREADABLE' : 'CONFIG_FILES_EXTRA', context);
      return json(res, 200, { ...report, hash: read.hash, revision: read.revision, checked: entries.length });
    }

    if (route === 'adopt') {
      if (!(await exists(where.file))) return fail(res, 404, 'PORTAL_CONFIG_MISSING: порталът още няма configuration.yaml');
      const read = portalConfig.read(where.file, { slug: portal.slug, digest: hash.digest });
      if (read.problems.length) return json(res, 400, { error: 'PORTAL_CONFIG_INVALID', issues: read.problems });
      const applied = await adopt(portal, read.data, 'adopt');
      // След внасянето файлът се сглобява наново от записа: самоличността и `files[]` идват от
      // базата, а настройките (включително ръчните) остават. Така няма две истини.
      const synced = await portalFolder.syncConfig(portal);
      const after = portalConfig.read(where.file, { slug: portal.slug, digest: hash.digest });
      return json(res, 200, { applied, sync: synced, ...payload(after, { label: where.label, exists: true }) });
    }

    if (route === 'export') {
      if (!(await exists(where.file))) return fail(res, 404, 'PORTAL_CONFIG_MISSING: порталът още няма configuration.yaml');
      const read = portalConfig.read(where.file, { slug: portal.slug, digest: hash.digest });
      res.writeHead(200, {
        'Content-Type': 'application/yaml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="configuration.yaml"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ETag: '"' + (read.hash || '') + '"',
        'X-Config-Hash': read.hash || '',
      });
      res.end(read.text);
      return true;
    }

    // POST /config/import — цялото съдържание идва като тяло; чекпойнтът е в `If-Match`/`?hash=`.
    if (route !== 'import') return false;
    const raw = await body(req, portalConfig.MAX_BYTES + 1024);
    const text = raw.toString('utf8');
    if (!text.trim()) return fail(res, 400, 'PORTAL_CONFIG_INVALID: празно тяло');
    const parsed = portalConfig.parse(text);
    if (parsed.problems.length) return json(res, 422, { error: 'PORTAL_CONFIG_INVALID', issues: parsed.problems });
    let imported;
    try {
      imported = portalConfig.migrate(parsed.data);
      if (!imported.id) imported.id = portalConfig.makeId(imported.slug, imported.name, 1);
    } catch (error) {
      return invalid(res, error);
    }
    const header = String(req.headers['if-match'] || '').replace(/^W\//, '').replace(/"/g, '');
    const supplied = header || url.searchParams.get('hash') || '';
    const present = await exists(where.file);
    if (!supplied) return fail(res, 400, 'PORTAL_CONFIG_HASH_REQUIRED: import носи If-Match (или ?hash=) с хеша на текущия файл');
    if (!present) return conflict(res, { message: 'PORTAL_CONFIG_CONFLICT: файлът не съществува, чекпойнтът е от друго копие', currentHash: null, diff: [] });
    const current = portalConfig.read(where.file, { slug: portal.slug, digest: hash.digest });
    if (current.hash !== supplied) {
      return conflict(res, { message: 'PORTAL_CONFIG_CONFLICT: файлът е променен между четенето и импорта', currentHash: current.hash, diff: portalConfig.diff(current.data, imported) });
    }
    // `?dry=1` показва само какво щеше да се промени — без запис (договор §27).
    if (url.searchParams.get('dry') === '1') {
      return json(res, 200, { ok: true, dry: true, hash: current.hash, diff: portalConfig.diff(current.data, imported) });
    }
    // Импортът е съзнателно ЗАМЕСТВАНЕ: ревизията продължава от диска, а порталът остава същият.
    imported.slug = portal.slug;
    imported.id = current.data.id || imported.id;
    return save(res, where, portal, imported, supplied, 'import');
  }

  return { handle };
}

module.exports = { create };
