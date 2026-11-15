'use strict';
// Качване на файл в папката на портала — НА СЕСИИ, с проверка по хеш и без пипане на датите (0.69.214).
//
// Защо отделен компонент: старият `POST …/tree/upload` приемаше цялото тяло наведнъж и
// отговаряше с 201 или не. Това не дава нито напредък, нито възстановяване, нито доказуема
// цялост: при прекъсване на мрежата на 900-ия мегабайт човек започва от нула и никой не знае
// дали това, което е стигнало, е същото, което е изпратено.
//
// Договорът тук е четири стъпки, всяка от които може да се повтори безопасно:
//
//   POST   /admin/api/portals/{portalId}/uploads              → отваря сесия (име, път, размер, sha256, дата на промяна)
//   GET    /admin/api/portals/{portalId}/uploads/{sid}         → какво вече е пристигнало (възстановяване)
//   PUT    /admin/api/portals/{portalId}/uploads/{sid}/{i}     → парче №i + неговия SHA-256 в `X-Chunk-Sha256`
//   POST   /admin/api/portals/{portalId}/uploads/{sid}/complete→ сглобява, СВЕРЯВА целия файл и го записва
//   DELETE /admin/api/portals/{portalId}/uploads/{sid}         → отказ (нищо не се записва)
//
// Правилата, които не се договарят:
//   • Всяко парче носи своя SHA-256; сървърът го проверява ПРЕДИ да го запише. Липсваща или
//     сгрешена заявка не оставя „половин парче“ — пише се във временен файл и се преименува.
//   • Целият файл се сверява по SHA-256 и размер, преди да влезе в папката. Разминаване →
//     409, файл НЕ се появява, сесията остава за повторен опит.
//   • След записа файлът се ЧЕТЕ ОБРАТНО (през `workdirIo`, тоест и при криптирана работна
//     папка) и хешът се сравнява пак. Така „записано“ значи „проверено“, а не „не хвърли“.
//   • Датите не се пипат: `mtime` от клиента се възстановява точно (`utimes`), а датата на
//     създаване се пази в регистъра и в историята. `ctime` НЕ се задава — операционната
//     система го държи и няма API за него; това е записано в историята, вместо да се премълчи.
//   • Накрая се дописва един ред в `upload-history/<portalId>.jsonl` — файлът за следене на
//     промените: кой файл, кога, с какъв хеш, с какви дати и дали е бил възстановяван.
//
// Сесиите живеят на диска (`upload-sessions/<portalId>/<sid>/`), за да оцелеят рестарт на
// add-on-а: това е „възстановяване на процеса“, а не бутон, който започва отначало.
function create(deps) {
  const {
    json, fail, parse, body, audit, fsp, path, crypto,
    portalAbs, workdirIo, qrRegistry, folderMetaOf, lockedAncestor,
    sessionsRoot, historyRoot, maxBytes,
  } = deps;

  const CHUNK_MIN = 4096;
  const CHUNK_MAX = 8 * 1024 * 1024;
  const CHUNK_DEFAULT = 1024 * 1024;
  const TTL_MS = 24 * 60 * 60 * 1000;
  const HEX64 = /^[0-9a-f]{64}$/i;
  const SID = /^[0-9a-f]{16,40}$/;
  const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  const isInt = (v) => Number.isInteger(v) && v >= 0;

  const sessionDir = (portalId, sid) => path.join(sessionsRoot, portalId, sid);
  const chunksDir = (portalId, sid) => path.join(sessionDir(portalId, sid), 'chunks');
  const metaFile = (portalId, sid) => path.join(sessionDir(portalId, sid), 'meta.json');
  const historyFile = (portalId) => path.join(historyRoot, `${portalId}.jsonl`);

  async function readMeta(portalId, sid) {
    try {
      return JSON.parse(await fsp.readFile(metaFile(portalId, sid), 'utf8'));
    } catch {
      return null;
    }
  }

  // Записът на състоянието минава през временен файл: прекъсване по средата не оставя
  // половин JSON, който после да „не се чете“ и сесията да изглежда изчезнала.
  async function writeMeta(meta) {
    const file = metaFile(meta.portalId, meta.sessionId);
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(meta, null, 2)}\n`);
    await fsp.rename(tmp, file);
  }

  /** Стари сесии се чистят, за да не расте папката с всяко прекъснато качване. */
  async function sweep() {
    let portals;
    try {
      portals = await fsp.readdir(sessionsRoot, { withFileTypes: true });
    } catch {
      return 0;
    }
    let removed = 0;
    const cutoff = Date.now() - TTL_MS;
    for (const portal of portals) {
      if (!portal.isDirectory()) continue;
      const dir = path.join(sessionsRoot, portal.name);
      let sessions;
      try {
        sessions = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const session of sessions) {
        if (!session.isDirectory()) continue;
        const meta = await readMeta(portal.name, session.name);
        const expires = meta && Number.isFinite(meta.expiresAt) ? meta.expiresAt : 0;
        if (!expires || expires < cutoff) {
          await fsp.rm(path.join(dir, session.name), { recursive: true, force: true }).catch(() => {});
          removed += 1;
        }
      }
    }
    return removed;
  }

  function matches(parts) {
    if (parts[0] !== 'admin' || parts[1] !== 'api' || parts[2] !== 'portals') return false;
    return parts[4] === 'uploads' && (parts.length === 5 || parts.length === 6 || parts.length === 7);
  }

  function targetPath(p, rel) {
    const rootAbs = portalAbs(p.storage_root || '/share');
    const full = path.resolve(rootAbs, ...rel.split('/'));
    if (full === rootAbs || !full.startsWith(rootAbs + path.sep)) return null;
    return { rootAbs, full };
  }

  /** Проверките на пътя са същите като при старото качване — едно място, един отговор. */
  function checkPath(p, raw) {
    const st = require('../storage-tree');
    const rel = st.normRel(raw || '');
    if (rel === null || !rel) return { error: 'Invalid path', status: 400 };
    if (qrRegistry.tooDeep(rel)) return { error: 'MAX_BRANCH_DEPTH_3: максималната дълбочина е 3 подпапки', status: 409 };
    const name = rel.split('/').pop() || '';
    // Без контролни знаци в името: проверката е по код, не с регулярен израз — така `eslint`
    // не отчита `no-control-regex` и е видно какво точно се отказва.
    const hasControl = [...name].some((ch) => ch.charCodeAt(0) < 0x20);
    if (!name || name.startsWith('.') || name.length > 240 || hasControl) return { error: 'Invalid file name', status: 400 };
    const locked = lockedAncestor(folderMetaOf(p), rel);
    if (locked) return { error: `Папката ${locked} е заключена`, status: 409 };
    const place = targetPath(p, rel);
    if (!place) return { error: 'Invalid path', status: 400 };
    return { rel, name, ...place };
  }

  async function listActive(portalId) {
    const dir = path.join(sessionsRoot, portalId);
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await readMeta(portalId, entry.name);
      if (!meta) continue;
      out.push({
        sessionId: meta.sessionId,
        path: `/${meta.path}`,
        name: meta.name,
        size: meta.size,
        sha256: meta.sha256,
        chunks: (meta.chunks || []).length,
        totalChunks: meta.totalChunks,
        receivedBytes: meta.receivedBytes || 0,
        expiresAt: new Date(meta.expiresAt).toISOString(),
      });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async function readHistory(portalId, limit = 200) {
    try {
      const text = await fsp.readFile(historyFile(portalId), 'utf8');
      const lines = text.split('\n').filter(Boolean);
      return lines.slice(Math.max(0, lines.length - limit)).map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  async function handle({ req, res, parts, method, portal }) {
    if (!portal) return false;
    if (!matches(parts)) return false;
    const p = portal;

    // ── Списък: активни сесии + историята (файлът за следене на промените) ─────
    if (parts.length === 5 && method === 'GET') {
      json(res, 200, {
        history: historyFile(p.id).replace(/\\/g, '/').split('/').pop(),
        sessions: await listActive(p.id),
        entries: await readHistory(p.id),
      });
      return true;
    }

    // ── Новa сесия ─────────────────────────────────────────────────────────────
    if (parts.length === 5 && method === 'POST') {
      const b = (await parse(req)) || {};
      const checked = checkPath(p, b.path);
      if (checked.error) {
        fail(res, checked.status, checked.error);
        return true;
      }
      const size = Number(b.size);
      if (!isInt(size) || size <= 0) {
        fail(res, 400, 'Invalid size');
        return true;
      }
      const limit = typeof maxBytes === 'function' ? maxBytes() : Number(maxBytes) || 0;
      if (limit && size > limit) {
        fail(res, 413, `Файлът е по-голям от тавана (${limit} байта)`);
        return true;
      }
      const declared = String(b.sha256 || '').toLowerCase();
      if (!HEX64.test(declared)) {
        fail(res, 400, 'Invalid sha256: очаква се 64 шестнадесетични знака');
        return true;
      }
      const chunkSize = Math.min(CHUNK_MAX, Math.max(CHUNK_MIN, Number(b.chunkSize) || CHUNK_DEFAULT));
      const totalChunks = Math.max(1, Math.ceil(size / chunkSize));
      const mtime = Number.isFinite(Number(b.mtime)) && Number(b.mtime) > 0 ? Math.floor(Number(b.mtime)) : null;
      const createdAt = typeof b.createdAt === 'string' && !Number.isNaN(Date.parse(b.createdAt)) ? new Date(b.createdAt).toISOString() : null;
      const exists = await fsp.access(checked.full).then(() => true, () => false);
      const overwrite = Boolean(b.overwrite);
      if (exists && !overwrite) {
        fail(res, 409, 'Файлът вече съществува');
        return true;
      }
      const mkdir = Boolean(b.mkdir) || String(b.mkdir) === '1';
      const parentDir = path.dirname(checked.full);
      if (parentDir !== checked.rootAbs && !mkdir && !(await fsp.access(parentDir).then(() => true, () => false))) {
        fail(res, 404, 'Родителската папка липсва');
        return true;
      }
      const sid = crypto.randomBytes(12).toString('hex');
      const meta = {
        sessionId: sid,
        portalId: p.id,
        path: checked.rel,
        name: checked.name,
        size,
        sha256: declared,
        mtime,
        createdAt,
        chunkSize,
        totalChunks,
        chunks: [],
        receivedBytes: 0,
        overwrite,
        mkdir,
        retries: 0,
        openedAt: new Date().toISOString(),
        expiresAt: Date.now() + TTL_MS,
      };
      await fsp.mkdir(chunksDir(p.id, sid), { recursive: true });
      await writeMeta(meta);
      void sweep();
      void audit('portal.upload.session.open', { portalId: p.id, path: `/${checked.rel}`, size, chunks: totalChunks, overwrite, resumed: false });
      json(res, 201, {
        sessionId: sid,
        path: `/${checked.rel}`,
        name: checked.name,
        size,
        sha256: declared,
        chunkSize,
        totalChunks,
        chunks: [],
        receivedBytes: 0,
        expiresAt: new Date(meta.expiresAt).toISOString(),
      });
      return true;
    }

    if (parts.length >= 6 && !SID.test(String(parts[5] || ''))) {
      fail(res, 400, 'Invalid session id');
      return true;
    }
    const sid = parts[5];

    // ── Състояние (това вика панелът, за да продължи след прекъсване) ──────────
    if (parts.length === 6 && method === 'GET') {
      const meta = await readMeta(p.id, sid);
      if (!meta) {
        fail(res, 404, 'Session not found');
        return true;
      }
      json(res, 200, {
        sessionId: meta.sessionId,
        path: `/${meta.path}`,
        name: meta.name,
        size: meta.size,
        sha256: meta.sha256,
        mtime: meta.mtime,
        createdAt: meta.createdAt,
        chunkSize: meta.chunkSize,
        totalChunks: meta.totalChunks,
        chunks: [...meta.chunks].sort((a, b) => a - b),
        receivedBytes: meta.receivedBytes,
        expiringAt: new Date(meta.expiresAt).toISOString(),
      });
      return true;
    }

    // ── Отказ: изтрива се само сесията, никога файл ────────────────────────────
    if (parts.length === 6 && method === 'DELETE') {
      const meta = await readMeta(p.id, sid);
      if (!meta) {
        fail(res, 404, 'Session not found');
        return true;
      }
      await fsp.rm(sessionDir(p.id, sid), { recursive: true, force: true });
      void audit('portal.upload.session.cancel', { portalId: p.id, path: `/${meta.path}`, received: meta.receivedBytes });
      json(res, 200, { cancelled: sid, path: `/${meta.path}` });
      return true;
    }

    // ── Парче ─────────────────────────────────────────────────────────────────
    if (parts.length === 7 && method === 'PUT' && /^\d+$/.test(String(parts[6]))) {
      const meta = await readMeta(p.id, sid);
      if (!meta) {
        fail(res, 404, 'Session not found');
        return true;
      }
      const index = Number(parts[6]);
      if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
        fail(res, 400, 'Chunk index out of range');
        return true;
      }
      const expectedLen = index === meta.totalChunks - 1 ? meta.size - index * meta.chunkSize : meta.chunkSize;
      const declaredChunk = String(req.headers['x-chunk-sha256'] || '').toLowerCase();
      if (!HEX64.test(declaredChunk)) {
        fail(res, 400, 'X-Chunk-Sha256 е задължителен: без него цялостта не се доказва');
        return true;
      }
      const data = await body(req, meta.chunkSize + 1024);
      if (!data || data.length !== expectedLen) {
        fail(res, 400, `Chunk length mismatch: очаквани ${expectedLen}, получени ${data ? data.length : 0}`);
        return true;
      }
      const got = sha256(data);
      if (got !== declaredChunk) {
        void audit('portal.upload.chunk.rejected', { portalId: p.id, path: `/${meta.path}`, index, expected: declaredChunk.slice(0, 12), got: got.slice(0, 12) });
        fail(res, 400, 'Chunk hash mismatch: парчето е повредено при пренос');
        return true;
      }
      const file = path.join(chunksDir(p.id, sid), String(index));
      // Преименуването е „атомарно“: половин парче никога не носи номер.
      const tmp = `${file}.part`;
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, file);
      if (meta.chunks.includes(index)) meta.retries += 1;
      else {
        meta.chunks.push(index);
        meta.receivedBytes += data.length;
      }
      await writeMeta(meta);
      json(res, 202, {
        sessionId: sid,
        index,
        chunks: meta.chunks.length,
        totalChunks: meta.totalChunks,
        receivedBytes: meta.receivedBytes,
        percent: Math.round((meta.receivedBytes / meta.size) * 1000) / 10,
      });
      return true;
    }

    // ── Край: сглобяване, сверка, запис, възстановени дати, история ────────────
    if (parts.length === 7 && method === 'POST' && parts[6] === 'complete') {
      const meta = await readMeta(p.id, sid);
      if (!meta) {
        fail(res, 404, 'Session not found');
        return true;
      }
      if (meta.chunks.length !== meta.totalChunks) {
        const missing = [];
        for (let i = 0; i < meta.totalChunks; i++) if (!meta.chunks.includes(i)) missing.push(i);
        fail(res, 409, `Липсват ${missing.length} парчета (${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}) — продължи качването`);
        return true;
      }
      const checked = checkPath(p, meta.path);
      if (checked.error) {
        fail(res, checked.status, checked.error);
        return true;
      }
      // Сглобяване с хеширане в движение: иначе „проверено“ значи „проверено след като вече
      // е записано“, а тук проверката е ПРЕДИ файлът да влезе в папката.
      const hash = crypto.createHash('sha256');
      const parts2 = [];
      let total = 0;
      for (let i = 0; i < meta.totalChunks; i++) {
        const buf = await fsp.readFile(path.join(chunksDir(p.id, sid), String(i)));
        hash.update(buf);
        parts2.push(buf);
        total += buf.length;
      }
      const data = Buffer.concat(parts2, total);
      const gotSha = hash.digest('hex');
      if (total !== meta.size || gotSha !== meta.sha256) {
        void audit('portal.upload.verify.failed', { portalId: p.id, path: `/${meta.path}`, expected: meta.sha256.slice(0, 12), got: gotSha.slice(0, 12), size: total });
        fail(res, 409, `SHA-256 не съвпада (${gotSha.slice(0, 12)}… вместо ${meta.sha256.slice(0, 12)}…) — файлът НЕ е записан`);
        return true;
      }
      const exists = await fsp.access(checked.full).then(() => true, () => false);
      if (exists && !meta.overwrite) {
        fail(res, 409, 'Файлът вече съществува');
        return true;
      }
      try {
        await fsp.mkdir(meta.mkdir ? path.dirname(checked.full) : checked.rootAbs, { recursive: true });
        const stored = workdirIo.pack(data);
        if (exists) {
          const tmp = path.join(path.dirname(checked.full), `.${meta.name}.${sid}.part`);
          await fsp.writeFile(tmp, stored);
          await fsp.rename(tmp, checked.full);
        } else {
          await fsp.writeFile(checked.full, stored, { flag: 'wx' });
        }
        // Датите: `mtime` се възстановява точно, ако клиентът го е дал.
        if (meta.mtime) {
          const when = new Date(meta.mtime);
          await fsp.utimes(checked.full, when, when);
        }
        // Обратно четене: доказва, че НА ДИСКА стои същото съдържание (и при L2 контейнер).
        const back = await workdirIo.read(checked.full);
        const backSha = sha256(back);
        if (backSha !== meta.sha256 || back.length !== meta.size) {
          await fsp.rm(checked.full, { force: true }).catch(() => {});
          void audit('portal.upload.verify.disk', { portalId: p.id, path: `/${meta.path}`, expected: meta.sha256.slice(0, 12), got: backSha.slice(0, 12) });
          fail(res, 500, 'Файлът на диска не съвпада с изпратеното — записът е отменен');
          return true;
        }
      } catch (e) {
        fail(res, 500, `Файлът не може да бъде записан: ${e.code || e.message}`);
        return true;
      }
      const stat = await fsp.stat(checked.full).catch(() => null);
      const entry = {
        at: new Date().toISOString(),
        portalId: p.id,
        sessionId: sid,
        path: `/${meta.path}`,
        name: meta.name,
        size: meta.size,
        sha256: meta.sha256,
        verified: true,
        overwritten: exists,
        retriedChunks: meta.retries || 0,
        metadata: {
          mtime: meta.mtime ? new Date(meta.mtime).toISOString() : null,
          createdAt: meta.createdAt,
          mtimePreserved: Boolean(meta.mtime),
          // Честно: `ctime` се държи от файловата система и няма API, с който да се зададе.
          ctime: stat ? stat.ctime.toISOString() : null,
          ctimeSettable: false,
        },
        elapsedMs: Date.now() - Date.parse(meta.openedAt),
      };
      await fsp.mkdir(historyRoot, { recursive: true });
      await fsp.appendFile(historyFile(p.id), `${JSON.stringify(entry)}\n`);
      await fsp.rm(sessionDir(p.id, sid), { recursive: true, force: true });
      void audit('portal.upload.complete', {
        portalId: p.id,
        path: `/${meta.path}`,
        size: meta.size,
        chunks: meta.totalChunks,
        retriedChunks: meta.retries || 0,
        mtimePreserved: Boolean(meta.mtime),
        overwritten: exists,
      });
      json(res, 201, {
        sessionId: sid,
        path: entry.path,
        name: entry.name,
        size: entry.size,
        sha256: entry.sha256,
        verified: true,
        overwritten: exists,
        mtime: entry.metadata.mtime,
        createdAt: entry.metadata.createdAt,
        retriedChunks: entry.retriedChunks,
        history: { file: historyFile(p.id).replace(/\\/g, '/').split('/').pop(), entries: (await readHistory(p.id)).length },
      });
      return true;
    }

    fail(res, 404, 'Not found');
    return true;
  }

  return { handle };
}

module.exports = { create };
