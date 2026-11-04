'use strict';
// ЗАКРИВАНЕ НА ПОРТАЛ (архив за съхранение, 6 месеца преди окончателно изтриване).
//
// Защо не „Изтрий“: порталът е адресът, който човек вече е раздал — по QR код, по имейл,
// на гише. Едно натискане не бива да прави байтовете невъзвратими, нито да оставя
// получателя пред празна страница без обяснение. Затова:
//
//   1. ЗАКРИВАНЕ — порталът излиза от активния списък (адресът му отговаря 410 „закрит“),
//      а данните му се ПРЕМЕСТВАТ в `archives/closed/<id>` заедно със снимка на записа
//      (`portal.json`). Нищо не се трие.
//   2. СРОК — записът пази `purgeAfter` = датата на закриване + 6 месеца (183 дни).
//      През това време порталът се връща с едно натискане от „Затворени портали“.
//   3. ИЗТРИВАНЕ — след срока фоновата проверка (на всеки 6 часа) премахва архива и
//      записва `portal.purge` в одита. Тя НЕ пипа `archives/<id>` (QR доказателствата):
//      `EVIDENCE_NEVER_DELETED` важи и тук — доказателството не изтича с портала.
//
// Старият `DELETE /admin/api/portals/<id>` остава като „изтрий веднага“ за скриптове и
// тестове; интерфейсът води единствено през закриване.
//
// Договор като на останалите компоненти: `handle()` връща `true`, когато заявката е за
// този компонент (и е приключена), и `false`, когато трябва да я поеме следващият.
const fsp = require('node:fs/promises');
const path = require('node:path');

const RETENTION_DAYS = 183; // 6 месеца
const DAY_MS = 86400000;
const PURGE_EVERY_MS = 6 * 3600 * 1000;

function create(deps) {
  const {
    json, fail, audit, update, db, filesRoot, internalRoot, apiRoot, archiveRoot,
    portalFolder, mirrorPortalDir, writeApiDir, baseUrl, log,
  } = deps;
  // Срокът по подразбиране е 6 месеца. Задава се само от средата (за тестове и за
  // оператор, който има вътрешно правило за по-кратък или по-дълъг срок).
  const configuredDays = Number(deps.retentionDays);
  const retentionDays = Number.isFinite(configuredDays) && configuredDays >= 0 ? configuredDays : RETENTION_DAYS;
  const closedRoot = path.join(archiveRoot, 'closed');

  /** Живият набор данни: `db` се подменя при презареждане от друг процес. */
  function live() {
    const d = db();
    if (!Array.isArray(d.portalsArchive)) d.portalsArchive = [];
    return d;
  }

  function archiveDir(id) { return path.join(closedRoot, String(id)); }

  /** Пренася папка. `rename` е мигновен в рамките на един дял; иначе копира и трие. */
  async function move(from, to) {
    try {
      await fsp.rename(from, to);
      return true;
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      if (e.code !== 'EXDEV') throw e;
      await fsp.cp(from, to, { recursive: true, force: true });
      await fsp.rm(from, { recursive: true, force: true });
      return true;
    }
  }

  function daysLeft(entry) {
    const at = Date.parse(entry && entry.purgeAfter);
    if (!Number.isFinite(at)) return 0;
    return Math.max(0, Math.ceil((at - Date.now()) / DAY_MS));
  }

  function view(entry) {
    return {
      id: entry.id, slug: entry.slug, title: entry.title,
      closedAt: entry.closedAt, purgeAfter: entry.purgeAfter,
      retentionDays: entry.retentionDays || retentionDays,
      files: entry.files || 0, bytes: entry.bytes || 0,
      daysLeft: daysLeft(entry),
    };
  }

  /** Затворените портали, най-скоро изтичащите първи. */
  function list() {
    return live().portalsArchive
      .slice()
      .sort((a, b) => String(a.purgeAfter).localeCompare(String(b.purgeAfter)))
      .map(view);
  }

  /** Записът за портал, който е бил закрит и още е в срока (за 410 страницата). */
  function closedInfo(key) {
    const k = String(key || '');
    if (!k) return null;
    return live().portalsArchive.find((x) => x.id === k || x.slug === k) || null;
  }

  /**
   * Закрива портала: данните отиват в `archives/closed/<id>`, записът — в `portalsArchive`.
   * Файловете се местят ПРЕДИ записа; ако записът се провали, `onFailure` ги връща обратно,
   * за да не остане портал без файлове (същият договор като при `DELETE`).
   */
  async function close(portal) {
    const at = Date.now();
    const purgeAfter = at + retentionDays * DAY_MS;
    const dir = archiveDir(portal.id);
    const record = JSON.parse(JSON.stringify(portal));
    const bytes = (record.files || []).reduce((n, f) => n + (Number(f.size) || 0), 0);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'portal.json'), JSON.stringify({
      record,
      closedAt: new Date(at).toISOString(),
      purgeAfter: new Date(purgeAfter).toISOString(),
      retentionDays,
    }, null, 2));
    await move(path.join(filesRoot, portal.id), path.join(dir, 'files'));
    await move(path.join(internalRoot, portal.id), path.join(dir, 'internal'));
    const entry = {
      id: portal.id, slug: portal.slug, title: portal.title,
      closedAt: new Date(at).toISOString(), purgeAfter: new Date(purgeAfter).toISOString(),
      retentionDays, files: (record.files || []).length, bytes,
    };
    await update(() => {
      const d = live();
      d.portals = d.portals.filter((x) => x.id !== portal.id);
      d.portalsArchive.push(entry);
      void audit('portal.close', {
        portalId: entry.id, slug: entry.slug, purgeAfter: entry.purgeAfter,
        retentionDays: RETENTION_DAYS, files: entry.files, bytes: entry.bytes,
      });
      return entry;
    }, async () => {
      // Записът не мина — връщаме файловете, за да не остане портал без съдържание.
      await move(path.join(dir, 'files'), path.join(filesRoot, portal.id));
      await move(path.join(dir, 'internal'), path.join(internalRoot, portal.id));
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => { });
    });
    // Производни артефакти: адресът на API-то, папката на портала и огледалото. Те се
    // строят наново при връщане, затова се махат СЛЕД успешния запис.
    await fsp.rm(path.join(apiRoot, portal.slug), { recursive: true, force: true }).catch(() => { });
    await portalFolder.removeArtifacts(portal).catch(() => { });
    if (mirrorPortalDir) await fsp.rm(mirrorPortalDir(portal.id), { recursive: true, force: true }).catch(() => { });
    return view(entry);
  }

  /** Връща закрит портал: файловете се местят обратно, записът — в `portals`. */
  async function restore(id, req) {
    const entry = live().portalsArchive.find((x) => x.id === String(id));
    if (!entry) return null;
    const dir = archiveDir(entry.id);
    let record;
    try {
      record = JSON.parse(await fsp.readFile(path.join(dir, 'portal.json'), 'utf8')).record;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
    await move(path.join(dir, 'files'), path.join(filesRoot, entry.id));
    await move(path.join(dir, 'internal'), path.join(internalRoot, entry.id));
    await update(() => {
      const d = live();
      d.portalsArchive = d.portalsArchive.filter((x) => x.id !== entry.id);
      d.portals.push(record);
      void audit('portal.restore', { portalId: entry.id, slug: entry.slug });
      return record;
    });
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => { });
    // Адресът и папката се строят наново — иначе порталът се връща без API/QR.
    try { if (writeApiDir) await writeApiDir(record, baseUrl(req)); } catch (e) { log && log.warn && log.warn('portal.restore.api.failed', { portalId: entry.id, err: e.message }); }
    await portalFolder.ensure(record).catch(() => { });
    return record;
  }

  /**
   * Изтрива окончателно всичко, на което срокът е изтекъл. Връща списък на изтритите id.
   * QR доказателствата (`archives/<id>`) НЕ се пипат — те са следа от публикуван манифест.
   */
  async function purgeDue() {
    const due = live().portalsArchive.filter((x) => {
      const at = Date.parse(x.purgeAfter);
      return Number.isFinite(at) && at <= Date.now();
    });
    const purged = [];
    for (const entry of due) {
      await fsp.rm(archiveDir(entry.id), { recursive: true, force: true }).catch(() => { });
      await update(() => {
        const d = live();
        d.portalsArchive = d.portalsArchive.filter((x) => x.id !== entry.id);
        void audit('portal.purge', {
          portalId: entry.id, slug: entry.slug, closedAt: entry.closedAt,
          files: entry.files || 0, bytes: entry.bytes || 0,
        });
        return entry.id;
      });
      purged.push(entry.id);
    }
    return purged;
  }

  /** Страница за адрес на закрит портал: 410 „закрит“, а не 404 „няма такъв“. */
  function sendClosed(res, key) {
    const entry = closedInfo(key);
    if (!entry) return false;
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const until = String(entry.purgeAfter || '').slice(0, 10);
    const html = '<!doctype html><html lang="bg"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Порталът е закрит</title>'
      + '<link rel="stylesheet" href="/portal.css"></head><body><main>'
      + '<h1>Порталът е закрит</h1>'
      + '<p>Този портал не се поддържа повече. Собственикът му е прекратил достъпа'
      + (until ? ' на ' + esc(String(entry.closedAt || '').slice(0, 10)) : '') + '.</p>'
      + '<p>Ако ти трябва нещо от него, обърни се към организацията, която ти е дала адреса.</p>'
      + (until ? '<p class="hint">Данните се пазят до ' + esc(until) + ' и след това се изтриват.</p>' : '')
      + '</main></body></html>';
    res.writeHead(410, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(html);
    return true;
  }

  /**
   * Старото „изтрий веднага“ (`DELETE /admin/api/portals/<id>`), запазено за скриптове.
   * Правилото `EVIDENCE_NEVER_DELETED` важи: портал с архивирани QR ревизии иска `?force=1`.
   */
  async function hardDelete({ res, url, portal }) {
    const force = url.searchParams.get('force') === '1';
    const archivedRevs = portalQrRevisions(portal);
    if (archivedRevs.length && !force) {
      void audit('portal.delete.refused', { portalId: portal.id, archivedRevisions: archivedRevs.length });
      return fail(res, 409, `Evidence: порталът има ${archivedRevs.length} архивирани QR ревизии и изтриването им е отделно решение (EVIDENCE_NEVER_DELETED). Повтори със ?force=1, ако наистина искаш да изтриеш и доказателствата — решението влиза в одита`);
    }
    return json(res, 200, await update(async () => {
      portal.visibility = 'private';
      await fsp.rm(path.join(filesRoot, portal.id), { recursive: true, force: true });
      await fsp.rm(path.join(internalRoot, portal.id), { recursive: true, force: true });
      await fsp.rm(path.join(apiRoot, portal.slug), { recursive: true, force: true });
      await portalFolder.removeArtifacts(portal).catch(() => { });
      if (mirrorPortalDir) await fsp.rm(mirrorPortalDir(portal.id), { recursive: true, force: true }).catch(() => { });
      if (force && archivedRevs.length) {
        const d = live();
        if (d.portalQr) delete d.portalQr[portal.id];
        await fsp.rm(path.join(archiveRoot, portal.id), { recursive: true, force: true }).catch(() => { });
      }
      const d = live();
      d.portals = d.portals.filter((x) => x !== portal);
      void audit('portal.delete', { portalId: portal.id, forced: force, archivedRevisions: archivedRevs.length });
      return { deleted: portal.id, forced: force, purgedArchives: force ? archivedRevs.length : 0 };
    }));
  }

  function portalQrRevisions(portal) {
    const d = live();
    const reg = d.portalQr && d.portalQr[portal.id];
    const revisions = reg && Array.isArray(reg.revisions) ? reg.revisions : [];
    return revisions.filter((r) => r && (r.archiveId || r.archivedAt));
  }

  // eslint-disable-next-line no-unused-vars -- `req` идва по договора на компонентите (`handle({ req, res, … })`), тук не е нужен
  async function handle({ req, res, url, parts, method, portal }) {
    // `archive` не е портал — идва преди разрешаването на портала.
    if (parts[3] === 'archive') {
      if (parts.length === 4 && method === 'GET') {
        // Проверката за изтекъл срок върви с четенето: няма нужда от планировчик, за да
        // се разбере, че срокът е минал, а интерфейсът вижда истината веднага.
        const purged = await purgeDue().catch(() => []);
        return json(res, 200, { retentionDays, purged, portals: list() });
      }
      if (parts.length === 6 && parts[5] === 'restore' && method === 'POST') {
        const restored = await restore(parts[4], req);
        if (!restored) return fail(res, 404, 'Portal not found');
        return json(res, 200, { restored: restored.id, slug: restored.slug, title: restored.title });
      }
      return fail(res, 404, 'Not found');
    }
    if (portal && parts.length === 5 && parts[4] === 'close' && method === 'POST') {
      return json(res, 200, await close(portal));
    }
    return false;
  }

  // Фонова проверка: закритите портали се трият и без никой да отвори панела.
  const timer = setInterval(() => { purgeDue().catch(() => { }); }, PURGE_EVERY_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();

  return { handle, list, close, restore, purgeDue, closedInfo, sendClosed, hardDelete, retentionDays };
}

module.exports = { create };
