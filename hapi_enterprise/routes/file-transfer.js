'use strict';
// Преместване и копиране на файл между портали (F2-10 / F2-11) — компонент на HTTP слоя.
//
//   POST /admin/api/portals/{id}/files/{fileId}/transfer
//        { "mode": "move" | "copy", "targetPortalId": "…" }
//
// Извадено от `server.js` по бюджета на редовете и за да има едно място, на което се
// решава какво значи „файлът отива в друг портал“.
//
// Правилата, които не се договарят:
//   • Байтовете се записват с `wx` (без презапис) и се четат обратно — SHA-256 на копието
//     трябва да съвпада с този на оригинала. Разминаване → копието се маха и няма запис.
//   • `content_id` се ПРЕИЗЧИСЛЯВА: той съдържа `portalId`, т.е. копие в друг портал не е
//     същият обект. Иначе два портала щяха да сочат един и същ идентификатор.
//   • „Премести“ се отказва, когато файлът е доказателство (`sealed` или в манифест на QR
//     ревизия) — същото правило като при задържането (`EVIDENCE_NEVER_DELETED`): манифестът
//     на източника твърди какво е публикувано, а изтритите байтове правят твърдението
//     непроверимо. Копирането е разрешено — оригиналът остава на мястото си.
//   • Заключен файл не се мести; файл с версии също не се мести — архивът на версиите живее
//     под портала-източник и преместването му би го обезсмислило. Отказът е 409, не тихо губене.
//
// Договор: `handle()` връща `true`, когато заявката е за този компонент (и е приключена).
function create(deps) {
  const {
    json, fail, parse, audit, update, clean, fsp, path, crypto, filesRoot,
    id, contentIds, storeMirrored, removeMirrored, portalFolder, portalFolderCopy,
    writeApiDir, baseUrl, observer, retention, getPortals, publish,
  } = deps;

  const MODES = ['move', 'copy'];
  const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

  function notMatching(parts, method) {
    const target = parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'portals'
      && parts[4] === 'files' && parts.length === 7 && parts[6] === 'transfer';
    return !target || method !== 'POST';
  }

  async function handle({ req, res, parts, method, portal }) {
    if (!portal) return false;
    if (notMatching(parts, method)) return false;
    const p = portal;

    const b = (await parse(req)) || {};
    const mode = String(b.mode || '').trim().toLowerCase();
    if (!MODES.includes(mode)) {
      fail(res, 400, "Invalid mode: expected 'move' or 'copy'");
      return true;
    }
    const targetPortalId = clean(String(b.targetPortalId || ''));
    if (!targetPortalId) {
      fail(res, 400, 'Missing targetPortalId');
      return true;
    }
    if (targetPortalId === p.id) {
      fail(res, 400, 'Target portal is the source portal');
      return true;
    }
    const src = p.files.find((x) => x.id === parts[5]);
    if (!src) {
      fail(res, 404, 'File not found');
      return true;
    }
    const dst = (getPortals() || []).find((x) => x.id === targetPortalId);
    if (!dst) {
      fail(res, 404, 'Target portal not found');
      return true;
    }
    if (src.locked) {
      fail(res, 409, 'Locked file: unlock it before transferring');
      return true;
    }
    if (mode === 'move') {
      if ((src.version || 1) > 1) {
        fail(res, 409, 'Versioned file: the version archive lives under the source portal, so a move would orphan it — copy instead');
        return true;
      }
      const why = typeof retention.protection === 'function' ? retention.protection(p, src) : null;
      if (why) {
        fail(res, 409, `Evidence: the file is part of a published manifest (${why}); a move is refused — copy instead`);
        return true;
      }
    }

    const srcAbs = path.join(filesRoot, p.id, src.id);
    let bytes;
    try {
      bytes = await fsp.readFile(srcAbs);
    } catch {
      fail(res, 404, 'File bytes unavailable');
      return true;
    }
    const storedSha = sha256(bytes);

    // Новият запис: идентичността на файла (sha256/size) се запазва, `content_id` — не.
    const created = {
      id: id(),
      name: src.name,
      size: src.size,
      sha256: src.sha256,
      contentId: contentIds.of({ portalId: dst.id, sha256: src.sha256, size: src.size }),
      uploadedAt: new Date().toISOString(),
      category: src.category,
      group: src.group,
    };
    if (src.encrypted) {
      created.encrypted = true;
      created.storedSize = bytes.length;
    }
    if (src.listed === false) created.listed = false;

    // 1. Копие на байтовете + сверка, ПРЕДИ да се пипа регистърът.
    const dstAbs = path.join(filesRoot, dst.id, created.id);
    try {
      await fsp.mkdir(path.join(filesRoot, dst.id), { recursive: true });
      await fsp.writeFile(dstAbs, bytes, { flag: 'wx', mode: 0o600 });
      const copied = await fsp.readFile(dstAbs);
      if (sha256(copied) !== storedSha || copied.length !== bytes.length) {
        throw Object.assign(new Error('The copy does not match the source (SHA-256 diff)'), { status: 500 });
      }
    } catch (e) {
      await fsp.rm(dstAbs, { force: true }).catch(() => { });
      fail(res, e.status || 500, e.message || 'Copy failed');
      return true;
    }

    // 2. Регистърът: новият запис влиза при целта; при „премести“ старият излиза от източника.
    try {
      await update(() => {
        dst.files.push(created);
        if (mode === 'move') p.files = p.files.filter((x) => x.id !== src.id);
      });
    } catch (e) {
      // Регистърът не е записан → копието е сирак и се маха, за да не остане файл без запис.
      await fsp.rm(dstAbs, { force: true }).catch(() => { });
      fail(res, e.status || 500, e.message || 'Registry update failed');
      return true;
    }

    // 3. Огледало и папка на портала — със същите правила като при качване.
    const mirrored = await storeMirrored(dst.id, created.id, bytes).catch(() => 'failed');
    if (mirrored) created.mirror = mirrored;
    if (mirrored === 'failed') observer.mirrorFailed();
    const placed = created.encrypted || !portalFolderCopy
      ? null
      : await portalFolder.store(dst, created.name, bytes).catch(() => null);
    if (placed) created.storagePath = placed.storagePath;

    // 4. Източникът се освобождава само след успешен запис при целта.
    if (mode === 'move') {
      await fsp.rm(srcAbs, { force: true }).catch(() => { });
      await removeMirrored(p.id, src.id).catch(() => { });
      if (src.storagePath) await portalFolder.remove(p, src.storagePath).catch(() => { });
      observer.fileDelete({ bytes: src.size || 0 });
    }
    await writeApiDir(dst, baseUrl(req)).catch(() => { });
    if (mode === 'move') await writeApiDir(p, baseUrl(req)).catch(() => { });

    void audit(mode === 'move' ? 'file.move' : 'file.copy', {
      from: p.id,
      to: dst.id,
      fileId: src.id,
      newFileId: created.id,
      sha256: created.sha256,
      encrypted: !!created.encrypted,
      mirror: mirrored || 'disabled',
    });
    // Копието/преместването е нов завършен документ на новото място — събитие, не одит.
    if (typeof publish === 'function') publish('document.finalized', { portalId: dst.id, fileId: created.id, bytes: created.size || 0 });

    json(res, 201, {
      mode,
      verified: true,
      sha256: created.sha256,
      contentId: created.contentId,
      source: { portalId: p.id, fileId: src.id, removed: mode === 'move' },
      target: { portalId: dst.id, fileId: created.id, name: created.name },
    });
    return true;
  }

  return { handle };
}

module.exports = { create };
