'use strict';
// QR ревизиите на един портал — компонент на HTTP слоя.
//
//   GET  /admin/api/portals/{id}/qr                  — активен QR, история, архиви, политика
//   POST /admin/api/portals/{id}/qr/archive          — ФИЗИЧЕСКИ архив + следващ QR
//   POST /admin/api/portals/{id}/qr/block            — прекратяване на активния QR (с основание)
//   POST /admin/api/portals/{id}/qr/verify           — проверка на целостта на архивите СЕГА
//   GET  /admin/api/portals/{id}/qr/{qrId}           — ревизията, манифестът и наследникът
//   GET  /admin/api/portals/{id}/qr/{qrId}/archive   — сваляне на архивния файл
//
// Договор като на останалите компоненти: `handle()` връща `true`, когато заявката е за
// този компонент (и е приключена). `db()` връща ЖИВИТЕ метаданни, за да няма втора истина.
function create(deps) {
  const { json, fail, parse, audit, fsp, path, portalRoot, update, qr, integrity, archiveRoot, adminGate, db } = deps;

  const isQr = (parts) => parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'portals' && parts[4] === 'qr';

  /**
   * Проверка на целостта на архивите на един портал: чете ФАЙЛОВЕТЕ, не метаданните.
   * Записва резултата и вдига `integrity.failed`, за да остане в одитната верига.
   */
  const verifyOne = async (portal) => {
    const reg = qr.registry(db(), portal.id);
    const result = await integrity.verifyPortal({
      portalId: portal.id,
      dir: path.join(archiveRoot, portal.id),
      archives: reg.archives,
      revisions: reg.revisions,
    });
    await update(async () => integrity.record(db(), portal.id, result));
    if (!result.ok) {
      void audit('integrity.failed', {
        portalId: portal.id, slug: portal.slug, failed: result.failed.length,
        reasons: result.failed.map((f) => f.reason), archiveIds: result.failed.map((f) => f.id),
      });
    }
    return result;
  };

  // Фоновата проверка не блокира старта и не държи процеса жив (unref): ако средата я
  // изключи с `HAPI_INTEGRITY_INTERVAL_MS=0`, не се създава никакъв таймер.
  integrity.schedule(() => integrity.verifyPortals({
    db: db(), qr, archiveRoot, onResult: (portalId, result) => update(async () => integrity.record(db(), portalId, result)).then(() => {
      if (!result.ok) void audit('integrity.failed', { portalId, failed: result.failed.length, reasons: result.failed.map((f) => f.reason) });
    }),
  }), integrity.intervalMs(process.env));

  /** Публичен изглед на регистъра: активният QR, историята, архивите и политиката. */
  const view = (reg) => {
    const active = qr.activeRevision(reg);
    return {
      active: active ? { id: active.id, revision: active.seq, createdAt: active.createdAt } : null,
      revisions: reg.revisions.map((r) => ({
        id: r.id, revision: r.seq, contract: r.contract, createdAt: r.createdAt,
        previousQrId: r.previousQrId || null, previousManifestHash: r.previousManifestHash || null,
        manifestHash: r.manifestHash || null, archiveId: r.archiveId || null,
        archivedAt: r.archivedAt || null, blockedAt: r.blockedAt || null, blockReason: r.blockReason || null,
      })),
      archives: reg.archives,
      policy: qr.policy(),
    };
  };

  async function handle({ req, res, parts, method, portal }) {
    if (!portal || !isQr(parts)) return false;
    const p = portal;
    // Историята и архивните файлове не са публичен договор.
    if (!adminGate(req, res, 'portals', method)) return true;

    // GET /qr
    if (parts.length === 5 && method === 'GET') {
      const state = await update(async () => view(qr.ensureFirst(db(), p)));
      return json(res, 200, { portal: { id: p.id, slug: p.slug, title: p.title }, ...state, integrity: integrity.read(db(), p.id) });
    }

    // POST /qr/verify — проверка на ЦЕЛОСТТА: байтовете на архива, манифестът и файловете в него.
    if (parts[5] === 'verify' && parts.length === 6 && method === 'POST') {
      return json(res, 200, await verifyOne(p));
    }

    // POST /qr/archive — РЕАЛЕН архивен файл + манифест + следващ QR (старият остава).
    if (parts[5] === 'archive' && parts.length === 6 && method === 'POST') {
      const body = await parse(req).catch(() => ({}));
      const rootAbs = path.resolve(portalRoot(p.storage_root || '/share'));
      const files = await qr.walk(rootAbs);
      if (!files.length) return fail(res, 409, 'Папката на портала е празна — няма какво да се архивира');
      const dir = path.join(archiveRoot, p.id);
      const done = await update(async () => {
        const reg = qr.registry(db(), p.id);
        qr.ensureFirst(db(), p);
        const active = qr.activeRevision(reg);
        if (!active) throw Object.assign(new Error('Няма активен QR — прекратен е; създай нов преди архивиране'), { status: 409 });
        const note = String((body && body.note) || '').slice(0, 300);
        const archiveId = 'AR-' + String(reg.archives.length + 1).padStart(3, '0');
        const built = await qr.buildArchive({ portal: p, revision: active, files, note, archiveId });
        const fileName = `${p.slug}-${active.id}-${archiveId}.zip`;
        const manifestHash = qr.sha256(Buffer.from(JSON.stringify(built.manifest)));
        await fsp.mkdir(dir, { recursive: true });
        const full = path.join(dir, fileName);
        await fsp.writeFile(full, built.buffer);
        // §10.1 точки 6–7 и §19: архивът се ПРОВЕРЯВА веднага, четейки написаното от диска.
        // Ако проверката не мине, операцията НЕ се отчита като успешна: файлът се маха и
        // нищо не влиза в регистъра — иначе би имало „успешен“ архив без валидно доказателство.
        const check = await integrity.verifyArchive({ archive: { id: archiveId, qrId: active.id, file: fileName, sha256: built.hash }, dir, revision: { manifestHash } });
        if (!check.ok) {
          await fsp.rm(full, { force: true }).catch(() => { });
          void audit('qr.archive.verify.failed', { portalId: p.id, qrId: active.id, archiveId, reason: check.reason, detail: check.detail || null });
          throw Object.assign(new Error('Архивът не мина проверка за цялост (' + check.reason + ') — не е регистриран'), { status: 500 });
        }
        const saved = { id: archiveId, qrId: active.id, file: fileName, sha256: built.hash, size: built.size, files: files.length, createdAt: new Date().toISOString(), note, verificationStatus: 'verified', verifiedAt: new Date().toISOString() };
        reg.archives.push(saved);
        // Съдържанието се фиксира към ТОЗИ QR; следващият е наследник, не подмяна.
        active.archivedAt = saved.createdAt;
        active.archiveId = archiveId;
        active.manifest = built.manifest;
        active.manifestHash = manifestHash;
        const next = {
          id: qr.qrIdOf(active.seq + 1), seq: active.seq + 1, portalId: p.id, contract: active.contract || 'order',
          previousQrId: active.id, previousManifestHash: active.manifestHash, createdAt: saved.createdAt,
          archivedAt: null, archiveId: null, manifestHash: null, blockedAt: null, blockReason: null,
        };
        reg.revisions.push(next);
        void audit('qr.archived', { portalId: p.id, qrId: active.id, nextQrId: next.id, archiveId, sha256: built.hash, bytes: built.size, files: files.length });
        return { archive: saved, archivedQr: active.id, active: next.id, state: view(reg) };
      });
      return json(res, 201, done);
    }

    // POST /qr/block — прекратяване с ОСНОВАНИЕ; историята и архивите остават.
    if (parts[5] === 'block' && parts.length === 6 && method === 'POST') {
      const body = await parse(req).catch(() => ({}));
      const reason = String((body && body.reason) || '').trim();
      if (reason.length < 3) return fail(res, 400, 'Основанието за прекратяване е задължително');
      const state = await update(async () => {
        const reg = qr.registry(db(), p.id);
        qr.ensureFirst(db(), p);
        const active = qr.activeRevision(reg);
        if (!active) throw Object.assign(new Error('Няма активен QR за прекратяване'), { status: 409 });
        active.blockedAt = new Date().toISOString();
        active.blockReason = reason.slice(0, 500);
        void audit('qr.blocked', { portalId: p.id, qrId: active.id, reason: active.blockReason });
        return { blocked: active.id, state: view(reg) };
      });
      return json(res, 200, state);
    }

    if (parts.length >= 6 && method === 'GET') {
      const qrId = parts[5];
      const reg = qr.registry(db(), p.id);
      const revision = reg.revisions.find((r) => r.id === qrId);
      if (!revision) return fail(res, 404, 'Непознат QR');
      if (parts[6] === 'archive' && parts.length === 7) {
        const archive = reg.archives.find((a) => a.qrId === qrId) || reg.archives.find((a) => a.id === revision.archiveId);
        if (!archive) return fail(res, 404, 'Няма архив за този QR');
        const data = await fsp.readFile(path.join(archiveRoot, p.id, archive.file)).catch(() => null);
        if (!data) return fail(res, 404, 'Архивният файл липсва на диска');
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Length': data.length,
          'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(archive.file),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(data);
        return true;
      }
      if (parts.length === 6) {
        return json(res, 200, { qr: revision, archive: reg.archives.find((a) => a.id === revision.archiveId) || null, next: reg.revisions.find((r) => r.previousQrId === qrId) || null });
      }
    }

    return false;
  }

  return { handle };
}

module.exports = { create };
