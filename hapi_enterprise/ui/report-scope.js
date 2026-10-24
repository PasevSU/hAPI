'use strict';
// Обхвати на отчетите — ЕДНО място, за да не се разминават отчетите по местата, от
// които се пускат:
//
//   file              — един файл (от опциите на файла)
//   portal            — един портал (файловете, регистрирани в него)
//   portal-recursive  — същият портал + папките от хранилището, рекурсивно
//   combo             — всички портали в един отчет (главното табло)
//   combo-recursive   — всички портали + папките им, рекурсивно (главното табло)
//
// Модулът само СГЛОБЯВА манифест по договора на `report-manifest.js` — не рендира,
// не пише на диск и не се удостоверява. Затова работи и през `file://`, и в тестове.
//
// Правила, които пази (и които тестовете проверяват):
//   • START е първи и заключен, STOP е последен и заключен;
//   • броят блокове не надхвърля 200 (таванът на манифеста), затова подробните
//     редове са ограничени и отчетът КАЗВА, че е съкратен;
//   • в отчета влиза само това, което е в данните — няма измислени хешове, подписи
//     или сертификати (валидаторът ги забранява изрично).
(function () {
  const MAX_DETAIL = 40; // колко файла/папки влизат подробно
  const MAX_PORTALS = 40; // колко портала влизат подробно
  const SCOPES = ['file', 'portal', 'portal-recursive', 'combo', 'combo-recursive'];
  const STORAGE_KEY = 'hapi.reportScope';
  const START = 'rfc3161-start';
  const STOP = 'rfc3161-stop';

  const text = (v) => (v == null ? '' : String(v).trim());

  /** Обем в четима форма — същата логика като в панелите. */
  function fmtSize(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1048576) return (v / 1024).toFixed(1).replace('.0', '') + ' KB';
    if (v < 1073741824) return (v / 1048576).toFixed(1).replace('.0', '') + ' MB';
    return (v / 1073741824).toFixed(2) + ' GB';
  }

  const fileBytes = (files) => (files || []).reduce((sum, f) => sum + (Number(f && f.size) || 0), 0);

  function edges(inner) {
    return [
      { id: 'start', type: START, locked: true, label: 'RFC 3161 START' },
      ...inner,
      { id: 'stop', type: STOP, locked: true, label: 'RFC 3161 STOP' },
    ];
  }

  /** Манифест по договора: същите полета като `report-manifest.template()`. */
  function manifestOf(profile, inner) {
    return {
      schemaVersion: 1,
      profile,
      page: { format: 'A4', orientation: 'portrait', marginsMm: [15, 15, 15, 15] },
      branding: { organization: '', logo: '', qr: false },
      print: { pageNumbers: true, headerFooter: false, footerNote: '' },
      blocks: edges(inner),
    };
  }

  const meta = (id, label, items) => ({
    id,
    type: 'metadata',
    label,
    items: items.filter(([, value]) => text(value) !== '').map(([key, value]) => ({ key, value: text(value) })),
  });

  /** Колко папки и файлове има в едно дърво (рекурсивно), без да броим корена. */
  function treeTotals(tree) {
    if (!tree || typeof tree !== 'object') return { folders: 0, files: 0, bytes: 0 };
    const folders = Number(tree.folderCount) || 0;
    const files = Number(tree.fileCount) || 0;
    const bytes = Number(tree.bytes) || 0;
    return { folders, files, bytes };
  }

  /** Плоски редове „път — файлове — обем“ за папките (за рекурсивните отчети). */
  function folderRows(tree, limit) {
    const out = [];
    const walk = (node) => {
      if (!node || out.length >= limit) return;
      for (const child of Array.isArray(node.folders) ? node.folders : []) {
        if (out.length >= limit) return;
        out.push({
          path: '/' + String(child.path || child.name || ''),
          files: Number(child.fileCount) || 0,
          bytes: Number(child.bytes) || 0,
        });
        walk(child);
      }
    };
    walk(tree);
    return out;
  }

  function portalItem(portal, tree, recursive) {
    const files = Array.isArray(portal && portal.files) ? portal.files : [];
    const totals = recursive ? treeTotals(tree) : { folders: 0, files: 0, bytes: 0 };
    return [
      ['Портал', portal && portal.title],
      ['slug', portal && portal.slug],
      ['Видимост', portal && portal.visibility],
      ['Файлове (регистрирани)', String(files.length)],
      ['Обем (регистрирани)', fmtSize(fileBytes(files))],
      ...(recursive
        ? [
          ['Папки (рекурсивно)', String(totals.folders)],
          ['Файлове в папките', String(totals.files)],
          ['Обем в папките', fmtSize(totals.bytes)],
        ]
        : []),
    ];
  }

  function fileItem(portal, file) {
    return [
      ['Портал', portal && portal.title],
      ['Файл', file && file.name],
      ['Размер', fmtSize(file && file.size)],
      ['Версия', String((file && file.version) || 1)],
      ['Политика', file && (file.accessMode || 'FREE')],
      ['Content ID', file && file.contentId],
      ['SHA-256 (регистриран при качване)', file && file.sha256],
      ['Качен', file && file.uploadedAt],
      ['Тема / категория', [file && file.topic, file && file.category].filter(Boolean).join(' / ')],
    ];
  }

  function downloadUrl(portal, file) {
    const slug = text(portal && portal.slug);
    const id = text(file && file.id);
    // Същият builder като сървъра (`links.js` се зарежда преди панела) — без втори формат.
    if (!slug || !id || !globalThis.HapiLinks) return '';
    return globalThis.HapiLinks.portalApiFilePath({ slug }, 'files/' + encodeURIComponent(id) + '/download');
  }

  function stamp(at) {
    const d = at instanceof Date ? at : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** Отчет за един файл — това, което стои в опциите на файла. */
  function buildFile({ portal, file, at } = {}) {
    if (!file) throw new Error('Липсва файл за отчета');
    const url = downloadUrl(portal, file);
    const inner = [
      { id: 'title', type: 'title', value: 'Отчет за файл · ' + text(file.name) },
      meta('file', 'Файл', fileItem(portal, file)),
      ...(url ? [{ id: 'qr', type: 'qr', label: 'Адрес за изтегляне', value: url }] : []),
      {
        id: 'note',
        type: 'text',
        label: 'Обхват',
        value:
          'Отчетът описва един файл: име, размер, версия, политика и SHA-256, регистриран при качването. ' +
          'Отпечатъкът е от регистъра на портала — отчетът не подменя проверката на файла.',
      },
    ];
    const summary = { scope: 'file', title: text(file.name), portals: 1, files: 1, folders: 0, bytes: Number(file.size) || 0, truncated: false, at: stamp(at) };
    return {
      scope: 'file',
      manifest: manifestOf('forensic-file', inner),
      summary,
      label: 'Отчет за файл · ' + summary.title,
    };
  }

  /** Отчет за един портал; `recursive` добавя папките от хранилището. */
  function buildPortal({ portal, tree, recursive = false, at } = {}) {
    if (!portal) throw new Error('Липсва портал за отчета');
    const files = Array.isArray(portal.files) ? portal.files : [];
    const totals = recursive ? treeTotals(tree) : { folders: 0, files: 0, bytes: 0 };
    const detailed = files.slice(0, MAX_DETAIL);
    const inner = [
      { id: 'title', type: 'title', value: 'Отчет за портал · ' + text(portal.title) },
      meta('portal', 'Портал', portalItem(portal, tree, recursive)),
      ...detailed.map((f, i) => meta('file' + (i + 1), 'Файл ' + (i + 1) + ' · ' + text(f.name), fileItem(portal, f))),
    ];
    const hiddenFiles = files.length - detailed.length;
    if (hiddenFiles > 0) {
      inner.push({ id: 'more-files', type: 'text', label: 'Съкратено', value: `Показани са първите ${detailed.length} от ${files.length} файла. Останалите ${hiddenFiles} са извън подробния списък, но влизат в обобщението по-горе.` });
    }
    if (recursive) {
      const rows = folderRows(tree, MAX_DETAIL);
      rows.forEach((row, i) => {
        inner.push(meta('folder' + (i + 1), 'Папка ' + row.path, [['Път', row.path], ['Файлове', String(row.files)], ['Обем', fmtSize(row.bytes)]]));
      });
      if (totals.folders > rows.length) {
        inner.push({ id: 'more-folders', type: 'text', label: 'Съкратено', value: `Показани са ${rows.length} от ${totals.folders} папки (рекурсивно).` });
      }
    }
    const scope = recursive ? 'portal-recursive' : 'portal';
    const summary = {
      scope,
      title: text(portal.title),
      portals: 1,
      files: files.length,
      folders: totals.folders,
      bytes: fileBytes(files),
      truncated: hiddenFiles > 0 || (recursive && totals.folders > Math.min(MAX_DETAIL, totals.folders)),
      at: stamp(at),
    };
    return {
      scope,
      manifest: manifestOf(recursive ? 'forensic-portal-recursive' : 'forensic-portal', inner),
      summary,
      label: (recursive ? 'Рекурсивен отчет за портал · ' : 'Отчет за портал · ') + summary.title,
    };
  }

  /** Комбо отчет за всички портали; `recursive` добавя папките на всеки портал. */
  function buildCombo({ portals, trees, recursive = false, at } = {}) {
    const list = Array.isArray(portals) ? portals : [];
    const byId = trees && typeof trees === 'object' ? trees : {};
    const files = list.reduce((sum, p) => sum + (Array.isArray(p && p.files) ? p.files.length : 0), 0);
    const bytes = list.reduce((sum, p) => sum + fileBytes(p && p.files), 0);
    const folders = list.reduce((sum, p) => sum + (recursive ? treeTotals(byId[p && p.id]).folders : 0), 0);
    const detailed = list.slice(0, MAX_PORTALS);
    const inner = [
      {
        id: 'title',
        type: 'title',
        value: (recursive ? 'Рекурсивен комбо отчет · ' : 'Комбо отчет · ') + list.length + (list.length === 1 ? ' портал' : ' портала'),
      },
      meta('scope', 'Обхват', [
        ['Портали', String(list.length)],
        ['Файлове (регистрирани)', String(files)],
        ['Обем (регистрирани)', fmtSize(bytes)],
        ...(recursive ? [['Папки (рекурсивно)', String(folders)]] : []),
        ['Генериран', stamp(at)],
      ]),
    ];
    detailed.forEach((p, i) => {
      inner.push(meta('portal' + (i + 1), 'Портал ' + (i + 1) + ' · ' + text(p.title), portalItem(p, byId[p.id], recursive)));
    });
    if (list.length > detailed.length) {
      inner.push({ id: 'more-portals', type: 'text', label: 'Съкратено', value: `Показани са първите ${detailed.length} от ${list.length} портала.` });
    }
    const scope = recursive ? 'combo-recursive' : 'combo';
    const summary = { scope, title: scope, portals: list.length, files, folders, bytes, truncated: list.length > detailed.length, at: stamp(at) };
    return {
      scope,
      manifest: manifestOf(recursive ? 'forensic-combo-recursive' : 'forensic-combo', inner),
      summary,
      label: (recursive ? 'Реквизитен комбо отчет · ' : 'Комбо отчет · ') + list.length + (list.length === 1 ? ' портал' : ' портала') + ' · ' + files + ' файла',
    };
  }

  /** Записва обхвата, за да го поеме Report Studio при отваряне. */
  function open(result) {
    if (!result || !result.manifest) throw new Error('Липсва манифест за отваряне');
    const payload = { at: Date.now(), scope: result.scope, manifest: result.manifest, summary: result.summary || null, label: result.label || result.scope };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Без хранилище (частен режим) отчетът пак може да се види — манифестът се
      // предава през прозореца на панела.
      if (typeof window !== 'undefined') window.HAPI_PENDING_REPORT = payload;
    }
    if (typeof window !== 'undefined' && window.HapiUI && typeof window.HapiUI.go === 'function') window.HapiUI.go('report');
    return payload;
  }

  /** Чете чакащия обхват (или `null`). */
  function readPending() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* повредена стойност → няма чакащ обхват */
    }
    return (typeof window !== 'undefined' && window.HAPI_PENDING_REPORT) || null;
  }

  function clearPending() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* няма хранилище */
    }
    if (typeof window !== 'undefined') delete window.HAPI_PENDING_REPORT;
  }

  const API = { SCOPES, MAX_DETAIL, MAX_PORTALS, STORAGE_KEY, buildFile, buildPortal, buildCombo, open, readPending, clearPending, fmtSize, treeTotals, folderRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof globalThis !== 'undefined') globalThis.HapiReportScope = API;
})();
