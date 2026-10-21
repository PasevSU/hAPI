'use strict';
// Виртуално хранилище на портал (Фаза 8): йерархия topic → category → group → файл.
//
// Това е единственото място, което превръща физическите файлове на портала във
// виртуален път. API-то води точно към тези пътища, а не към диска.
// Чист JS (UMD) — работи в add-on-а и в GUI-я.
(function () {
  const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

  function sanitizeSegment(value) {
    let s = String(value == null ? '' : value).replace(FORBIDDEN, '_');
    s = s.replace(/\s+/g, ' ').trim();
    if (!s || s === '.' || s === '..') return '';
    return s.slice(0, 120);
  }

  /** Папките на файла: topic → category → group (празните се пропускат). */
  function foldersFor(file) {
    return [file && file.topic, file && file.category, file && file.group]
      .map(sanitizeSegment)
      .filter(Boolean);
  }

  function fileName(file) {
    return sanitizeSegment(file && (file.name || file.id)) || 'file';
  }

  /** Каноничен виртуален път: /<topic>/<category>/<group>/<име>. */
  function virtualPath(file) {
    return '/' + [...foldersFor(file), fileName(file)].join('/');
  }

  function withSuffix(name, n) {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
  }

  function folderNode(name, path) {
    return { type: 'folder', name, path, folders: [], files: [] };
  }

  function sortNode(node) {
    node.folders.sort((a, b) => a.name.localeCompare(b.name, 'bg'));
    node.files.sort((a, b) => a.name.localeCompare(b.name, 'bg'));
    node.folders.forEach(sortNode);
  }

  function countFolders(node) {
    return node.folders.reduce((sum, child) => sum + 1 + countFolders(child), 0);
  }

  /**
   * Строи виртуалното дърво. Дублираните имена в една папка получават „ (2)“.
   * Пътят е стабилен за даден набор от файлове и не зависи от диска.
   */
  function buildTree(files) {
    const list = Array.isArray(files) ? files : [];
    const rootNode = folderNode('/', '/');
    const used = new Set();
    let counted = 0;
    for (const file of list) {
      if (file && file.listed === false) continue;
      counted++;
      let node = rootNode;
      for (const part of foldersFor(file)) {
        let next = node.folders.find((f) => f.name === part);
        if (!next) {
          next = folderNode(part, `${node.path === '/' ? '' : node.path}/${part}`);
          node.folders.push(next);
        }
        node = next;
      }
      const base = fileName(file);
      let name = base;
      let path = `${node.path === '/' ? '' : node.path}/${name}`;
      let n = 2;
      while (used.has(path)) {
        name = withSuffix(base, n++);
        path = `${node.path === '/' ? '' : node.path}/${name}`;
      }
      used.add(path);
      node.files.push({
        type: 'file',
        name,
        path,
        id: (file && file.id) || null,
        size: Number(file && file.size) || 0,
        sha256: (file && file.sha256) || '',
        topic: (file && file.topic) || '',
        category: (file && file.category) || '',
        group: (file && file.group) || '',
      });
    }
    sortNode(rootNode);
    return {
      virtual: true,
      root: '/',
      folderCount: countFolders(rootNode),
      fileCount: counted,
      tree: rootNode,
    };
  }

  /** Намира възел по виртуален път. Връща null при невалиден/липсващ път. */
  function resolve(tree, path) {
    const source = tree && tree.tree ? tree.tree : tree;
    if (!source) return null;
    if (path === undefined || path === null || path === '' || path === '/') return source;
    const raw = String(path);
    if (raw[0] !== '/') return null;
    const parts = raw.split('/').slice(1);
    if (parts.some((p) => !p || p === '.' || p === '..')) return null;
    let node = source;
    for (const part of parts) {
      if (!node || node.type !== 'folder') return null;
      const folder = node.folders.find((f) => f.name === part);
      if (folder) {
        node = folder;
        continue;
      }
      const file = node.files.find((f) => f.name === part);
      return file && part === parts[parts.length - 1] ? file : null;
    }
    return node;
  }

  /** Всички файлове с виртуалните им пътища (плоско). */
  function flatten(tree) {
    const out = [];
    const walk = (node) => {
      node.files.forEach((f) => out.push({ ...f, parent: node.path }));
      node.folders.forEach(walk);
    };
    const source = tree && tree.tree ? tree.tree : tree;
    if (source) walk(source);
    return out;
  }

  const API = { sanitizeSegment, foldersFor, virtualPath, buildTree, resolve, flatten };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof globalThis !== 'undefined') globalThis.HapiVirtualStorage = API;
})();
