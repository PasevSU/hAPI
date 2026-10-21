'use strict';
// Дърво на папка от хранилището (storage_root) — чист модул (UMD).
//
// Едно място, което превръща плоските относителни пътища на файловете в йерархия,
// за да може GUI-ят да я покаже като експлорер (папки → подпапки → файлове), а
// API-то да даде на всяка папка собствен адрес. Не пипа диска — работи и в браузъра.
(function () {
  // Колкото е дълбоко дървото в add-on-а; по-дълбоките пътища се отказват.
  const MAX_DEPTH = 12;

  /** '/a/b/' → 'a/b'; '' и '/' → ''; невалиден или изход от дървото → null. */
  function normRel(value) {
    const s = String(value == null ? '' : value)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    if (!s) return '';
    const parts = s.split('/');
    if (parts.length > MAX_DEPTH) return null;
    for (const part of parts) {
      if (!part || part === '.' || part === '..') return null;
      if (/[\u0000-\u001f]/.test(part)) return null;
    }
    return parts.join('/');
  }

  function emptyFolder(name, path) {
    return { type: 'folder', name, path, folders: [], files: [], folderCount: 0, fileCount: 0, bytes: 0 };
  }

  function byName(a, b) {
    const cmp = a.name.localeCompare(b.name, 'bg', { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  }

  function sortTree(node) {
    node.folders.sort(byName);
    node.files.sort(byName);
    node.folders.forEach(sortTree);
    return node;
  }

  /** Броя папки/файлове/байтове за всеки възел (отдолу-нагоре). */
  function recount(node) {
    let folderCount = 0;
    let fileCount = 0;
    let bytes = 0;
    for (const file of node.files) {
      fileCount += 1;
      bytes += Number(file.size) || 0;
    }
    for (const child of node.folders) {
      const counted = recount(child);
      folderCount += 1 + counted.folderCount;
      fileCount += counted.fileCount;
      bytes += counted.bytes;
    }
    node.folderCount = folderCount;
    node.fileCount = fileCount;
    node.bytes = bytes;
    return { folderCount, fileCount, bytes };
  }

  /**
   * Строи дърво от плоски записи: `[{ path: 'sub/a.txt', size: 3 }, …]`.
   * Пътят се нормализира; невалидните и дублираните се пропускат.
   * Допълнителните полета на записа се запазват във файловия възел.
   */
  function build(entries) {
    const root = emptyFolder('/', '');
    const folders = new Map([['', root]]);
    const seen = new Set();
    const list = Array.isArray(entries) ? entries.slice() : [];
    list.sort((a, b) => String(a && a.path).localeCompare(String(b && b.path)));
    for (const entry of list) {
      const rel = normRel(entry && entry.path);
      if (rel === null || rel === '') continue;
      if (seen.has(rel.toLowerCase())) continue;
      seen.add(rel.toLowerCase());
      const parts = rel.split('/');
      let node = root;
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        let next = folders.get(acc);
        if (!next) {
          next = emptyFolder(parts[i], acc);
          folders.set(acc, next);
          node.folders.push(next);
        }
        node = next;
      }
      const extra = Object.assign({}, entry);
      delete extra.path;
      delete extra.size;
      const file = Object.assign(
        { type: 'file', name: parts[parts.length - 1], path: rel, size: Number(entry && entry.size) || 0 },
        extra,
      );
      file.size = Number(file.size) || 0;
      node.files.push(file);
    }
    sortTree(root);
    recount(root);
    return root;
  }

  /** Привежда чуждо дърво (напр. виртуалното) към същата форма и смята броячите. */
  function normalize(node) {
    const source = node && node.tree ? node.tree : node;
    if (!source || typeof source !== 'object') return emptyFolder('/', '');
    const walk = (current, depth) => {
      const safeDepth = Math.min(Number(depth) || 0, MAX_DEPTH);
      const path = normRel(current.path) || '';
      const out = emptyFolder(String(current.name || (path.split('/').pop() || '/')), path);
      out.name = String(current.name || '/');
      const childFolders = Array.isArray(current.folders) ? current.folders : [];
      const childFiles = Array.isArray(current.files) ? current.files : [];
      out.files = childFiles
        .map((file) => ({
          type: 'file',
          name: String((file && file.name) || ''),
          path: normRel(file && file.path) || '',
          size: Number(file && file.size) || 0,
        }))
        .filter((file) => file.name);
      out.folders = childFolders.filter((child) => child && safeDepth < MAX_DEPTH).map((child) => walk(child, safeDepth + 1));
      out.files.forEach((file) => {
        if (!file.path) file.path = out.path ? `${out.path}/${file.name}` : file.name;
      });
      return out;
    };
    const tree = walk(source, 0);
    sortTree(tree);
    recount(tree);
    return tree;
  }

  /**
   * Добавя папка (и липсващите ѝ родители) към съществуващо дърво.
   * Нужно е, за да се виждат и ПРАЗНИТЕ папки — `build` създава само папки с файлове.
   */
  function addFolder(root, rel) {
    const source = root && root.tree ? root.tree : root;
    const path = normRel(rel);
    if (!source || !path) return source;
    let node = source;
    let acc = '';
    for (const part of path.split('/')) {
      acc = acc ? `${acc}/${part}` : part;
      let next = (node.folders || []).find((child) => child.name === part);
      if (!next) {
        next = emptyFolder(part, acc);
        node.folders.push(next);
      }
      node = next;
    }
    return node;
  }

  /** Намира възел по относителен път ('' или '/' → коренът). */
  function resolve(root, rel) {    const source = root && root.tree ? root.tree : root;
    if (!source) return null;
    const path = normRel(rel);
    if (path === null) return null;
    if (!path) return source;
    const parts = path.split('/');
    let node = source;
    for (let i = 0; i < parts.length; i++) {
      if (!node || node.type !== 'folder') return null;
      const folder = node.folders.find((child) => child.name === parts[i]);
      if (folder) {
        node = folder;
        continue;
      }
      const file = node.files.find((child) => child.name === parts[i]);
      return file && i === parts.length - 1 ? file : null;
    }
    return node;
  }

  /** Плосък списък на възлите (за търсене) — с дълбочина и тип. */
  function flatten(root) {
    const out = [];
    const source = root && root.tree ? root.tree : root;
    if (!source) return out;
    const walk = (node, depth) => {
      out.push({ type: node.type, name: node.name, path: node.path, depth, size: node.size || 0 });
      (node.folders || []).forEach((child) => walk(child, depth + 1));
      (node.files || []).forEach((file) => out.push({ type: 'file', name: file.name, path: file.path, depth: depth + 1, size: file.size || 0 }));
    };
    walk(source, 0);
    return out;
  }

  const API = { MAX_DEPTH, normRel, build, normalize, resolve, flatten, recount, sortTree, addFolder };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.HapiStorageTree = API;
})();
