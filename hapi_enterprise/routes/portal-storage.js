'use strict';
// Изтегляне на файл ОТ ПАПКАТА на портала (публичен вход през портала, не отделен адрес).
//
//   GET /api/v1/p/<slug>/tree/file?path=<относителен път>
//
// Защо: файловете в `/share/<папка>` се качват там от „Папки на портала“ и НЕ е нужно
// всеки да получава собствен регистриран запис и собствен публичен адрес. Порталите
// показват папката си (`?folder=`), а файлът се тегли през ЕДИН контролиран маршрут:
// политиката (`portal-policy.js`) решава за портала и действието `download`, а тук се
// проверява, че пътят е ВЪТРЕ в папката на ТОЗИ портал.
//
// Правила (иначе файлът се вижда, а не бива):
//   • `..`, `%2e%2e`, обратни наклонени черти и NUL се отхвърлят преди докосване на диска;
//   • реалният път (`realpath`) трябва да е под реалния корен — символична връзка навън не минава;
//   • скрита (`visible:false`) или заключена папка не се дава;
//   • отдава се само файл (не директория), с `Content-Disposition: attachment` и име.
//
// Договор като на останалите компоненти: `handle()` връща `true`, когато заявката е за
// този компонент (и е приключена).
function create(deps) {
  const { fail, audit, policy, resolvePortal, portalRoot, folderMetaOf, fileMode, links, baseUrl, htmlEsc } = deps;
  const fsp = require('node:fs/promises');
  const fs = require('node:fs');
  const path = require('node:path');
  const storageTree = require('../storage-tree');

  const MIME = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.webp2': 'image/webp',
    '.zip': 'application/zip',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };

  /** Скрита (`visible:false`) или заключена папка по пътя — включително самият път. */
  function hiddenOrLockedAncestor(meta, rel) {
    const parts = String(rel || '').split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const flags = meta['/' + parts.slice(0, i + 1).join('/')];
      if (flags && (flags.visible === false || flags.locked)) return true;
    }
    return false;
  }

  async function handle({ req, res, url, parts, method }) {
    // Универсалният вход: `/portal.html?order=share/<папка>` (виж `serveOrder`).
    if (url.pathname === '/portal.html' && method === 'GET' && url.searchParams.get('order')) return serveOrder({ req, res, url });
    // /api/v1/p/<slug>/tree/file
    if (!(parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'p' && parts[4] === 'tree' && parts[5] === 'file')) return false;
    if (parts.length !== 6) { fail(res, 404, 'Not found'); return true }
    if (method !== 'GET') { fail(res, 405, 'Method not allowed'); return true }

    const portal = resolvePortal(parts[3]);
    if (!portal) { fail(res, 404, 'Not found'); return true }
    const decision = policy.decide({ req, url, portal, action: 'download' });
    if (!decision.allowed) { fail(res, 404, 'Not found'); return true }

    const rel = storageTree.normRel(url.searchParams.get('path') || '');
    if (rel === null || !rel) { fail(res, 400, 'Invalid path'); return true }

    // Правилата за самия файл се прилагат ТУК (сървърно), а не само със скрити бутони:
    // „недостъпен“ и „необявен“ не се дават, а „с ключ“ не се дава без ключ — иначе
    // папката би заобиколила правилата, зададени за файла в панела/конфигурацията.
    const registered = (portal.files || []).find((f) => f.storagePath === '/' + rel);
    if (registered) {
      const mode = fileMode(registered);
      if (mode === 'DISABLED' || registered.listed === false) { fail(res, 404, 'Not found'); return true }
      if (mode === 'KEY_REQUIRED') { fail(res, 403, 'Файлът е заключен с ключ — отвори го през регистрирания му адрес'); return true }
    }

    // Скритите и заключените папки не се дават и през директен път, не само в списъка.
    // Проверяват се ВСИЧКИ родители: файл в скрита папка не бива да се тегли по име.
    const meta = folderMetaOf(portal);
    if (hiddenOrLockedAncestor(meta, rel)) { fail(res, 404, 'Not found'); return true }

    const rootAbs = path.resolve(portalRoot(portal.storage_root || '/share'));
    // Общ корен (/share, /media) не се отдава: това би дало файловете на ВСИЧКИ портали.
    if (rootAbs === path.resolve('/share') || rootAbs === path.resolve('/media')) { fail(res, 403, 'Folder API requires a dedicated folder'); return true }
    const wanted = path.resolve(rootAbs, ...rel.split('/'));
    if (wanted !== rootAbs && !wanted.startsWith(rootAbs + path.sep)) { fail(res, 400, 'Invalid path'); return true }

    let realRoot, realFile, stat;
    try {
      realRoot = await fsp.realpath(rootAbs);
      realFile = await fsp.realpath(wanted);
      stat = await fsp.stat(realFile);
    } catch {
      fail(res, 404, 'File not found'); return true;
    }
    if (!realFile.startsWith(realRoot + path.sep) || !stat.isFile()) { fail(res, 404, 'File not found'); return true }

    const name = path.basename(realFile);
    const mime = MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    fs.createReadStream(realFile).on('error', () => res.destroy()).pipe(res);
    void audit('portal.tree.file.download', { portalId: portal.id, path: '/' + rel, bytes: stat.size, via: decision.via });
    return true;
  }

  /**
   * Универсалният вход от QR кода: `/portal.html?order=share/<папка>[/<подпапка>]`.
   *
   * `order` е ДОГОВОРЪТ с страницата, не удостоверяване: страницата само РАЗЧИТА пътя и
   * иска съдържанието му. Затова сървърът тук проверява, че папката е ИМЕННО папката на
   * съществуващ портал (`storage_root`), и че за него има право `read` — име на папка само
   * по себе си не отваря нищо. Подпапката се предава на страницата като `data-folder`.
   */
  function serveOrder({ req, res, url }) {
    const rel = links.portalFolderRel(url.searchParams.get('order') || '');
    const segs = rel ? rel.split('/') : [];
    if (segs.length < 2) { fail(res, 404, 'Not found'); return true }
    const portal = resolvePortal(segs[1]);
    const owned = portal && links.portalFolderRel(portalRoot(portal.storage_root || '/share')) === segs[0] + '/' + segs[1];
    if (!owned) { fail(res, 404, 'Not found'); return true }
    if (!policy.decide({ req, url, portal, action: 'read' }).allowed) { fail(res, 404, 'Not found'); return true }
    const folder = segs.slice(2).join('/');
    const html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'portal.html'), 'utf8')
      .replace('{{BASE}}', htmlEsc(baseUrl(req)))
      .replace('{{API}}', htmlEsc(links.portalApiPath(portal)))
      .replace('{{FOLDER}}', htmlEsc(folder))
      .replace('{{FOLDERS}}', '1');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    res.end(html);
    void audit('portal.order.open', { portalId: portal.id, order: rel, folder: '/' + folder });
    return true;
  }

  /** Правило на САМИЯ файл (от регистъра): `storagePath` сочи записа, липсващ запис = FREE. */
  function folderFileMode(portal, file) {
    const reg = (portal.files || []).find((f) => f.storagePath === '/' + file.path);
    return reg ? (reg.accessMode || 'FREE') : 'FREE';
  }

  /** Файловете в папката, които правилата ПОЗВОЛЯВАТ да се видят (недостъпните ги няма). */
  function folderFilesOf(portal, node) {
    return (node.files || []).filter((file) => {
      const reg = (portal.files || []).find((f) => f.storagePath === '/' + file.path);
      return !reg || (folderFileMode(portal, file) !== 'DISABLED' && reg.listed !== false);
    });
  }

  return { handle, folderFileMode, folderFilesOf };
}

module.exports = { create };
