'use strict';
// Export Manager (FD-1) — трансферно ядро с проверка на целостта.
//
// Един интерфейс за всички среди:
//   preflight → copy → verify → finalize
// Windows/USB/NAS използват временен файл (`.part`), SHA-256 на източника и на копието,
// flush на дескриптора и атомарно преименуване. Browser/HA адаптерите ползват същите
// правила за решение, но различен транспорт (виж docs/plan/19).
//
// Чистите функции (state machine, preflight, индекс, одит) работят и в GUI-я;
// файловите операции изискват Node (backend).
(function () {
  const NODE = typeof require === 'function' && typeof module !== 'undefined' && module.exports;
  const rules = NODE ? require('./export-rules.js') : globalThis.HapiExportRules;
  let fs = null;
  let fsp = null;
  let cryptoMod = null;
  let pathMod = null;
  if (NODE) {
    fs = require('node:fs');
    fsp = require('node:fs/promises');
    cryptoMod = require('node:crypto');
    pathMod = require('node:path');
  }

  const STATES = [
    'QUEUED',
    'PREFLIGHT',
    'COPYING',
    'VERIFYING',
    'FINALIZING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'RECOVERY_REQUIRED',
  ];
  const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];
  const TRANSITIONS = {
    QUEUED: ['PREFLIGHT', 'FAILED', 'CANCELLED'],
    PREFLIGHT: ['COPYING', 'FAILED', 'CANCELLED', 'RECOVERY_REQUIRED'],
    COPYING: ['VERIFYING', 'FAILED', 'CANCELLED', 'RECOVERY_REQUIRED'],
    VERIFYING: ['FINALIZING', 'FAILED', 'RECOVERY_REQUIRED'],
    FINALIZING: ['COMPLETED', 'FAILED', 'RECOVERY_REQUIRED'],
    COMPLETED: [],
    FAILED: ['QUEUED'],
    CANCELLED: [],
    RECOVERY_REQUIRED: ['QUEUED', 'FAILED'],
  };

  function nowIso(now) {
    return new Date(now instanceof Date ? now.getTime() : now || Date.now()).toISOString();
  }

  function newId() {
    const stamp = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `OP-${stamp}-${rand}`;
  }

  function createJob(config, meta) {
    const cfg = rules.normalizeConfig(config);
    const at = nowIso(meta && meta.now);
    return {
      operation_id: (meta && meta.operationId) || newId(),
      state: 'QUEUED',
      mode: cfg.mode,
      verify_sha256: cfg.verifySha256,
      on_conflict: cfg.onConflict,
      created_at: at,
      updated_at: at,
      source: '',
      destination: '',
      size: 0,
      expected_sha256: null,
      written_bytes: 0,
      verified: false,
      error: null,
      timeline: [{ state: 'QUEUED', at }],
    };
  }

  /** Преход между състояния. Връща нов job; нелегалните преходи се отказват. */
  function transition(job, next, info) {
    if (!job || !STATES.includes(job.state)) return { ok: false, reason: 'invalid-job', job: null };
    if (!STATES.includes(next)) return { ok: false, reason: 'invalid-state', job };
    const allowed = TRANSITIONS[job.state] || [];
    if (!allowed.includes(next)) return { ok: false, reason: `illegal ${job.state}→${next}`, job };
    const at = nowIso(info && info.now);
    const detail = info && info.detail ? String(info.detail) : '';
    const updated = Object.assign({}, job, {
      state: next,
      updated_at: at,
      timeline: [...job.timeline, { state: next, at, ...(detail ? { detail } : {}) }],
    });
    if (info && info.error) updated.error = String(info.error);
    if (info && info.writtenBytes != null) updated.written_bytes = Number(info.writtenBytes);
    if (info && info.verified != null) updated.verified = Boolean(info.verified);
    if (next === 'COMPLETED') updated.error = null;
    return { ok: true, reason: '', job: updated };
  }

  function progress(job) {
    if (!job || !job.size) return 0;
    return Math.min(100, Math.round((Number(job.written_bytes || 0) / Number(job.size)) * 100));
  }

  function requiredSpace(entries) {
    return (Array.isArray(entries) ? entries : []).reduce((sum, e) => sum + Number((e && e.size) || 0), 0);
  }

  /**
   * Предварителни проверки преди запис. Не пипа файловата система, ако env е подаден ръчно.
   * env: { freeBytes, sourceReadable, destWritable, sourceStable, exists:[], location }
   */
  function preflight(input) {
    const src = input && typeof input === 'object' ? input : {};
    const cfg = rules.normalizeConfig(src.config);
    const entries = Array.isArray(src.entries) ? src.entries : [];
    const env = Object.assign({ sourceReadable: true, destWritable: true, sourceStable: true, freeBytes: null }, src.env || {});
    const checks = [];
    const add = (id, ok, detail, severity) =>
      checks.push({ id, ok: Boolean(ok), detail: detail || '', severity: severity || (ok ? 'ok' : 'blocker') });

    const cfgCheck = rules.validateConfig(cfg);
    add('config', cfgCheck.ok, cfgCheck.errors.map((e) => e.code).join(', '));
    add('entries', entries.length > 0, 'Празен пакет');
    const paths = rules.safePaths(entries.map((e) => e && e.path).filter(Boolean));
    add('paths', paths.ok, [...paths.errors.map((e) => e.reason), ...paths.duplicates.flat()].join(', '));
    add('source-readable', env.sourceReadable !== false, 'Източникът не е достъпен за четене');
    add('destination-writable', env.destWritable !== false, 'Целта не е достъпна за запис');
    add('source-stable', env.sourceStable !== false, 'Източникът се променя по време на четене');
    if (cfg.verifySha256) add('verify-enabled', true, '');
    else {
      const required = rules.requiresVerification(cfg.mode);
      add('verify-enabled', !required, 'Този режим изисква SHA-256', required ? 'blocker' : 'warning');
    }
    if (cfg.location === 'browser' && cfg.readOnly) {
      add('readonly', false, 'Read-only не се поддържа в браузър', 'warning');
    }
    const need = requiredSpace(entries);
    if (env.freeBytes != null) {
      add('space', Number(env.freeBytes) >= need, `Нужни ${need} B, свободни ${env.freeBytes} B`);
    }
    if (Array.isArray(env.exists) && env.exists.length) {
      const policy = cfg.onConflict;
      add('collisions', policy !== 'abort', `Съществуващи файлове: ${env.exists.length}`, policy === 'abort' ? 'blocker' : 'warning');
    }
    const blockers = checks.filter((c) => c.severity === 'blocker' && !c.ok);
    const warnings = checks.filter((c) => c.severity === 'warning' && !c.ok);
    return { ok: blockers.length === 0, checks, blockers, warnings, requiredBytes: need, config: cfg };
  }

  /** Индекс на пакета (PACKAGE_INDEX.json). */
  function buildIndex(entries, meta) {
    const info = meta && typeof meta === 'object' ? meta : {};
    const list = (Array.isArray(entries) ? entries : []).map((e) => {
      const res = rules.safeRelPath(e && e.path);
      return {
        path: res.ok ? res.path : String((e && e.path) || ''),
        size: Number((e && e.size) || 0),
        sha256: String((e && e.sha256) || '').toLowerCase(),
        kind: String((e && e.kind) || 'originals'),
        source: String((e && e.source) || ''),
        verified: e && e.verified === true,
      };
    });
    const invalid = list.filter((e) => !rules.safeRelPath(e.path).ok);
    const badHash = list.filter((e) => e.kind !== 'folder' && !/^[a-f0-9]{64}$/.test(e.sha256));
    return {
      index: {
        schema_version: '1.0',
        package_id: info.packageId || rules.packageId(info.date, info.caseId),
        created_at: nowIso(info.now),
        mode: info.mode || 'evidence',
        complete: info.complete !== false,
        ...(info.notes ? { notes: String(info.notes) } : {}),
        entries: list,
      },
      invalid,
      badHash,
      ok: invalid.length === 0 && badHash.length === 0,
    };
  }

  /** Одитен запис за журнала (download_audit.json). */
  function auditRecord(job, extra) {
    const e = extra && typeof extra === 'object' ? extra : {};
    return {
      timestamp: nowIso(e.now),
      channel: e.channel || 'ingress',
      operation_id: job ? job.operation_id : '',
      mode: job ? job.mode : '',
      source: (job && job.source) || e.source || '',
      destination: (job && job.destination) || e.destination || '',
      size: Number((job && job.size) || 0),
      expected_sha256: (job && job.expected_sha256) || e.expectedSha256 || null,
      written_bytes: Number((job && job.written_bytes) || 0),
      status: job ? job.state : '',
      error: (job && job.error) || null,
      portal: e.portal || null,
      file_id: e.fileId || null,
      user: e.user || null,
      token_id: e.tokenId || null,
      ip: e.ip || null,
      event: e.event || (job && job.state === 'COMPLETED' ? 'export.complete' : 'export.failed'),
    };
  }

  /** Решение за възобновяване: само когато частично записаното е проверимо. */
  function resume(job, env) {
    const e = env && typeof env === 'object' ? env : {};
    if (!job) return { resume: false, reason: 'no-job' };
    if (TERMINAL.includes(job.state)) return { resume: false, reason: 'terminal' };
    if (!['COPYING', 'RECOVERY_REQUIRED', 'VERIFYING'].includes(job.state)) {
      return { resume: false, reason: 'state' };
    }
    if (e.tempExists !== true) return { resume: false, reason: 'no-temp' };
    if (e.sourceUnchanged === false) return { resume: false, reason: 'source-changed' };
    const expected = e.expectedSha256 || job.expected_sha256;
    if (!e.partialSha256 || !expected) return { resume: false, reason: 'unverifiable' };
    if (String(e.partialSha256).toLowerCase() !== String(expected).toLowerCase()) {
      return { resume: false, reason: 'hash-mismatch' };
    }
    return { resume: true, reason: 'verify-only' };
  }

  // ── Файлови операции (Node) ────────────────────────────────────────────────
  function requireFs() {
    if (!NODE) throw new Error('Файловите операции са достъпни само в backend-а (Node)');
  }

  function sha256File(filePath) {
    requireFs();
    return new Promise((resolve, reject) => {
      const hash = cryptoMod.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  function sha256Text(text) {
    requireFs();
    return cryptoMod.createHash('sha256').update(String(text), 'utf8').digest('hex');
  }

  async function fsyncFile(filePath) {
    requireFs();
    const handle = await fsp.open(filePath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function existsSafe(p) {
    try {
      await fsp.access(p);
      return true;
    } catch {
      return false;
    }
  }

  async function resolveTarget(destDir, name, onConflict, overwrite) {
    const base = rules.sanitizeSegment(name) || 'file';
    const target = pathMod.join(destDir, base);
    if (overwrite) return { target, name: base, action: 'overwrite' };
    if (!(await existsSafe(target))) return { target, name: base, action: 'write' };
    if (onConflict === 'skip') return { target, name: base, action: 'skip' };
    if (onConflict === 'abort') return { target, name: base, action: 'abort' };
    const taken = (await fsp.readdir(destDir)).filter((f) => !f.startsWith('.'));
    const unique = rules.uniqueName(taken, base);
    return { target: pathMod.join(destDir, unique), name: unique, action: 'write' };
  }

  /**
   * Проверено копиране: hash на източника → temp запис → flush → hash на копието →
   * сравнение на размер/хеш → атомарно преименуване. При грешка temp файлът се изтрива.
   */
  async function copyVerified(options) {
    requireFs();
    const opt = options && typeof options === 'object' ? options : {};
    const src = String(opt.src || '');
    const destDir = String(opt.destDir || '');
    const verify = opt.verify !== false;
    if (!src || !destDir) return { ok: false, reason: 'missing-args' };

    let stat;
    try {
      stat = await fsp.stat(src);
    } catch (err) {
      return { ok: false, reason: 'source-unreadable', error: err.message };
    }
    if (!stat.isFile()) return { ok: false, reason: 'source-not-file' };
    await fsp.mkdir(destDir, { recursive: true });

    const target = await resolveTarget(destDir, opt.name || pathMod.basename(src), opt.onConflict || 'unique', opt.overwrite === true);
    if (target.action === 'skip') return { ok: true, skipped: true, reason: 'exists', path: null, name: target.name };
    if (target.action === 'abort') return { ok: false, reason: 'exists', path: null, name: target.name };

    const tmp = pathMod.join(destDir, `.${pathMod.basename(target.name)}.${Math.random().toString(36).slice(2, 8)}${opt.tempSuffix || '.part'}`);
    let sourceHash = null;
    try {
      sourceHash = verify ? await sha256File(src) : null;
      await fsp.copyFile(src, tmp, fs.constants.COPYFILE_EXCL);
      await fsyncFile(tmp);

      const copyStat = await fsp.stat(tmp);
      let copyHash = null;
      if (verify) {
        copyHash = await sha256File(tmp);
        const afterHash = await sha256File(src);
        if (afterHash !== sourceHash) {
          await fsp.unlink(tmp).catch(() => {});
          return { ok: false, reason: 'source-changed', path: null };
        }
        if (copyStat.size !== stat.size || copyHash !== sourceHash) {
          await fsp.unlink(tmp).catch(() => {});
          return { ok: false, reason: 'verify-failed', expected: sourceHash, actual: copyHash, path: null };
        }
      } else if (copyStat.size !== stat.size) {
        await fsp.unlink(tmp).catch(() => {});
        return { ok: false, reason: 'size-mismatch', path: null };
      }

      await fsp.rename(tmp, target.target);
      if (opt.readOnly) await fsp.chmod(target.target, 0o444).catch(() => {});
      return {
        ok: true,
        skipped: false,
        reason: '',
        path: target.target,
        name: target.name,
        bytes: copyStat.size,
        sha256: copyHash,
        verified: verify,
      };
    } catch (err) {
      await fsp.unlink(tmp).catch(() => {});
      return { ok: false, reason: 'copy-failed', error: err.message, path: null };
    }
  }

  /**
   * Пълен трансфер на един запис през state machine.
   * opts: { job?, config, entry:{src,name,size}, destDir, env, now }
   */
  async function runTransfer(options) {
    requireFs();
    const opt = options && typeof options === 'object' ? options : {};
    let job = opt.job || createJob(opt.config, { now: opt.now });
    const entry = opt.entry || {};

    const pre = preflight({ config: opt.config, entries: [entry], env: opt.env });
    job = transition(job, 'PREFLIGHT', { now: opt.now }).job;
    if (!pre.ok) {
      const failed = transition(job, 'FAILED', { now: opt.now, error: pre.blockers[0].id }).job;
      return { ok: false, job: failed, preflight: pre };
    }
    job = transition(job, 'COPYING', { now: opt.now, writtenBytes: 0 }).job;

    const cfg = rules.normalizeConfig(opt.config);
    const copy = await copyVerified({
      src: entry.src,
      destDir: opt.destDir || cfg.destination,
      name: entry.name || pathMod.basename(String(entry.src || '')),
      verify: cfg.verifySha256,
      onConflict: cfg.onConflict,
      tempSuffix: rules.DEFAULT_RULES.temp_suffix,
      readOnly: cfg.readOnly,
    });
    if (!copy.ok) {
      const failed = transition(job, 'FAILED', { now: opt.now, error: copy.reason }).job;
      return { ok: false, job: failed, copy };
    }
    job = transition(job, 'VERIFYING', {
      now: opt.now,
      writtenBytes: copy.bytes,
      verified: copy.verified,
    }).job;
    job = Object.assign(job, {
      source: String(entry.src || ''),
      destination: String(copy.path || ''),
      size: Number(copy.bytes || 0),
      expected_sha256: copy.sha256 || null,
    });
    job = transition(job, 'FINALIZING', { now: opt.now }).job;
    job = transition(job, 'COMPLETED', { now: opt.now, verified: copy.verified }).job;
    return { ok: true, job, copy, preflight: pre };
  }

  const API = {
    STATES,
    TERMINAL,
    TRANSITIONS,
    createJob,
    transition,
    progress,
    requiredSpace,
    preflight,
    buildIndex,
    auditRecord,
    resume,
    sha256File,
    sha256Text,
    copyVerified,
    runTransfer,
  };

  if (NODE) module.exports = API;
  globalThis.HapiExportManager = API;
})();
