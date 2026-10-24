'use strict';
// Папки на портала в хранилището — компонент на HTTP слоя.
//
// Извадено от `server.js` (бюджет на редовете + един договор за папките):
//   POST   /admin/api/portals/{id}/tree/folder            — нова папка
//   PATCH  /admin/api/portals/{id}/tree/folder            — флагове (видима/медийна/заключена)
//   DELETE /admin/api/portals/{id}/tree/folder?path=…     — изтриване (?recursive=1 за непразна)
//
// Договор: `handle()` връща `true`, когато заявката е за този компонент (и е приключена),
// и `false`, когато трябва да я поеме следващият компонент.
function create(deps) {
  const { json, fail, parse, audit, clean, fsp, path, portalRoot, folderMetaOf, lockedAncestor, filesRoot, internalRoot, update, keyring } = deps;

  function notMatching(parts, method) {
    const target = parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'portals' && parts[4] === 'tree' && parts[5] === 'folder' && parts.length === 6;
    return !target || !['POST', 'PATCH', 'DELETE'].includes(method);
  }

  // Наклонена черта или управляващ знак в името на папката. Проверява се по код, за да
  // няма изключение `no-control-regex`.
  function hasBadNameChars(name) {
    return Array.from(String(name)).some((ch) => ch === '/' || ch === '\\' || ch.codePointAt(0) < 32);
  }

  async function handle({ req, res, url, parts, method, portal }) {
    if (!portal) return false;
    if (notMatching(parts, method)) return false;
    const st = require('../storage-tree');
    const p = portal;
    const rootAbs = path.resolve(portalRoot(p.storage_root || '/share'));

    if (method === 'POST') {
      const b = await parse(req);
      const parent = st.normRel(b.parent || '');
      const name = clean(b.name);
      if (parent === null) {
        fail(res, 400, 'Invalid path');
        return true;
      }
      if (!name || name === '.' || name === '..' || name.length > 100 || hasBadNameChars(name)) {
        fail(res, 400, 'Invalid folder name');
        return true;
      }
      const rel = st.normRel(parent ? `${parent}/${name}` : name);
      const full = rel === null ? null : path.resolve(rootAbs, parent, name);
      if (rel === null || full !== path.resolve(rootAbs, rel) || !full.startsWith(rootAbs + path.sep)) {
        fail(res, 400, 'Invalid path');
        return true;
      }
      try {
        // Коренът на портала се създава при нужда: прикаченият файл вече НЕ го създава
        // (виж `portal_folder_copy`), а човекът трябва да може да си направи папка.
        // Междинна липсваща папка остава 404 — там грешката е в пътя, не в корена.
        await fsp.mkdir(rootAbs, { recursive: true });
        await fsp.mkdir(full);
      } catch (e) {
        if (e.code === 'EEXIST') fail(res, 409, 'Папката вече съществува');
        else if (e.code === 'ENOENT') fail(res, 404, 'Родителската папка липсва');
        else fail(res, 500, 'Папката не може да бъде създадена: ' + e.code);
        return true;
      }
      void audit('portal.tree.folder', { portalId: p.id, path: '/' + rel });
      json(res, 201, { path: '/' + rel, name, parent: '/' + parent, created: true });
      return true;
    }

    if (method === 'PATCH') {
      const b = await parse(req);
      const rel = st.normRel(b.path || '');
      if (rel === null) {
        fail(res, 400, 'Invalid path');
        return true;
      }
      const current = folderMetaOf(p)['/' + rel] || { visible: true, media: false, locked: false };
      const next = { visible: current.visible !== false, media: current.media === true, locked: current.locked === true };
      for (const key of ['visible', 'media', 'locked']) {
        if (b[key] === undefined) continue;
        if (typeof b[key] !== 'boolean') {
          fail(res, 400, 'Invalid ' + key);
          return true;
        }
        next[key] = b[key];
      }
      const saved = await update(() => {
        p.folderMeta = p.folderMeta && typeof p.folderMeta === 'object' ? p.folderMeta : {};
        const key = '/' + rel;
        // Пази се само ако е различно от подразбирането, за да не расте базата.
        if (next.visible === false || next.media || next.locked) p.folderMeta[key] = { visible: next.visible, media: next.media, locked: next.locked };
        else delete p.folderMeta[key];
        void audit('portal.tree.folder.meta', { portalId: p.id, path: key, visible: next.visible, media: next.media, locked: next.locked });
        return { path: key, ...next };
      });
      json(res, 200, saved);
      return true;
    }

    // DELETE: празна → 200; непразна иска ?recursive=1 (409 с броя); заключена не се трие.
    const rel = st.normRel(url.searchParams.get('path') || '');
    if (rel === null || !rel) {
      fail(res, 400, 'Invalid path');
      return true;
    }
    // Заключването важи и за САМАТА папка, не само за родителите ѝ.
    const meta = folderMetaOf(p);
    const locked = lockedAncestor(meta, rel) || (meta['/' + rel] && meta['/' + rel].locked ? '/' + rel : '');
    if (locked) {
      fail(res, 409, `Папката ${locked} е заключена`);
      return true;
    }
    const full = path.resolve(rootAbs, ...rel.split('/'));
    if (!full.startsWith(rootAbs + path.sep)) {
      fail(res, 400, 'Invalid path');
      return true;
    }
    let stat;
    try {
      stat = await fsp.lstat(full);
    } catch {
      fail(res, 404, 'Папката не е намерена');
      return true;
    }
    if (!stat.isDirectory()) {
      fail(res, 400, 'Пътят не е папка');
      return true;
    }
    const counts = { files: 0, folders: 0 };
    const walk = async (dir) => {
      for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) {
          counts.folders += 1;
          await walk(path.join(dir, ent.name));
        } else if (ent.isFile()) counts.files += 1;
      }
    };
    try {
      await walk(full);
    } catch (e) {
      fail(res, 500, 'Съдържанието не може да бъде прочетено: ' + (e.code || 'error'));
      return true;
    }
    const recursive = url.searchParams.get('recursive') === '1';
    if (!recursive && (counts.files || counts.folders)) {
      fail(res, 409, `Папката не е празна: ${counts.files} файла и ${counts.folders} папки`);
      return true;
    }
    const prefix = '/' + rel + '/';
    // L1 (0.69.67): пътят се взима през `keyring.pathOf` — при криптирани пътища
    // `f.storagePath` не съществува и директното четене би изпуснало файловете.
    const registered = p.files.filter((f) => String(keyring.pathOf(f) || '').startsWith(prefix));
    try {
      await fsp.rm(full, { recursive: true });
    } catch (e) {
      fail(res, 500, 'Папката не може да бъде изтрита: ' + (e.code || 'error'));
      return true;
    }
    await update(async () => {
      // Регистрираните файлове от тази папка отиват със съдържанието си — иначе остават
      // записи, сочещи към изтрити файлове.
      for (const f of registered) {
        p.files = p.files.filter((x) => x !== f);
        await fsp.rm(path.join(filesRoot, p.id, f.id), { force: true }).catch(() => { });
        await fsp.rm(path.join(internalRoot, p.id, f.id), { recursive: true, force: true }).catch(() => { });
      }
      for (const map of [p.folderNotes, p.folderMeta]) for (const key of Object.keys(map || {})) if (key === '/' + rel || key.startsWith(prefix)) delete map[key];
      void audit('portal.tree.folder.delete', { portalId: p.id, path: '/' + rel, files: counts.files, folders: counts.folders, registered: registered.length, recursive });
    });
    json(res, 200, { path: '/' + rel, deleted: true, files: counts.files, folders: counts.folders, registeredFiles: registered.length, recursive });
    return true;
  }

  return { handle };
}

module.exports = { create };
