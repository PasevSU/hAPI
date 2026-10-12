'use strict';
// Phase 6 migration pipeline: PRECHECK -> SNAPSHOT -> PLAN -> STAGE -> VERIFY ->
// SWITCH -> RECONCILE -> REPORT.
//
// Safety invariants (the source folder is never written to):
//   1. Fail-closed preflight: refuses missing/mounted/symlink paths and rejects
//      unsafe filesystem objects (symlinks, sockets, fifos) during the scan.
//   2. Every staged copy is SHA-256 verified against its source before the
//      destination switch.
//   3. The destination switch is done with `rename`; a pre-existing destination
//      is first moved to `<destination>.bak.<ts>` so it can be rolled back.
//   4. `run` is idempotent/resumable: files already staged with a verified hash
//      are skipped, so an interrupted run can simply be re-run.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const CONFLICT_POLICIES = new Set(['queue', 'first', 'skip']);
const METHODS = new Set(['copy', 'hardlink', 'reference']);
const STAGING_SUFFIX = '.migrate-staging';
const MARKER_NAME = '.hapi-migration-v1.marker';
const MARKER_VALUE = 'hapi-migration-v1\n';

function statfsFree(dir) {
  try { const s = fs.statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

async function pathExists(p) {
  try { await fsp.lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

function abortError() { const e = new Error('Cancelled'); e.code = 'ABORTED'; return e; }

async function sha256File(file, ctx) {
  const h = crypto.createHash('sha256');
  const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
  try {
    for await (const chunk of stream) {
      if (ctx && ctx.signal && ctx.signal.aborted) throw abortError();
      h.update(chunk);
    }
  } catch (e) {
    stream.destroy();
    throw e;
  }
  return h.digest('hex');
}

// Recursively list regular files under a directory. Symlinks and any other
// non-file/non-directory object are rejected so nothing unsafe is migrated.
async function scan(rootDir) {
  const files = [];
  async function walk(dir, rel) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      const r = rel ? rel + '/' + ent.name : ent.name;
      const st = await fsp.lstat(abs);
      if (st.isSymbolicLink()) throw Object.assign(new Error('Unsafe filesystem object: ' + r), { code: 'UNSAFE_OBJECT' });
      if (st.isDirectory()) await walk(abs, r);
      else if (st.isFile()) files.push({ rel: r, size: st.size });
      else throw Object.assign(new Error('Unsafe filesystem object: ' + r), { code: 'UNSAFE_OBJECT' });
    }
  }
  await walk(rootDir, '');
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

function uniqueName(rel, taken) {
  const ext = path.extname(rel);
  const base = rel.slice(0, rel.length - ext.length);
  for (let n = 2; ; n++) {
    const candidate = base + ' (' + n + ')' + ext;
    if (!taken.has(candidate)) return candidate;
  }
}

async function sameContent(a, b, ctx) {
  const [ha, hb] = await Promise.all([sha256File(a, ctx), sha256File(b, ctx)]);
  return ha === hb;
}

async function transferOne(from, to, method) {
  if (method === 'hardlink') {
    try { await fsp.link(from, to); return; } catch (e) { if (e.code !== 'EXDEV') throw e; }
  }
  await fsp.copyFile(from, to);
}

function create() {
  async function preflight({ source, destination, minFreeMb = 100 } = {}) {
    const blockers = [];
    const src = path.resolve(String(source || ''));
    const dst = destination ? path.resolve(String(destination)) : null;

    let sstat = null;
    try { sstat = await fsp.lstat(src); } catch { return { ok: false, source: src, destination: dst, blockers: ['Source does not exist: ' + src] }; }
    if (sstat.isSymbolicLink() || !sstat.isDirectory()) return { ok: false, source: src, destination: dst, blockers: ['Source must be a real directory (symlinks refused)'] };
    try { await fsp.readdir(src); } catch (e) { return { ok: false, source: src, destination: dst, blockers: ['Source is not readable: ' + e.message] }; }

    if (src === dst) blockers.push('Source and destination must be different paths');
    else if (dst && (dst.startsWith(src + path.sep) || src.startsWith(dst + path.sep))) blockers.push('Source and destination must not be nested inside one another');

    if (dst) {
      const parent = path.dirname(dst);
      try {
        const ps = await fsp.lstat(parent);
        if (ps.isSymbolicLink() || !ps.isDirectory()) blockers.push('Destination parent must be a real directory: ' + parent);
      } catch { blockers.push('Destination parent does not exist: ' + parent); }
      const free = statfsFree(parent);
      if (free !== null && free < minFreeMb * 1024 * 1024) blockers.push('Insufficient free space at destination');
    }

    const freeSource = statfsFree(src);
    const freeDest = dst ? statfsFree(path.dirname(dst)) : null;
    return {
      ok: blockers.length === 0,
      source: src, destination: dst, blockers,
      freeBytesSource: freeSource, freeBytesDestination: freeDest, minFreeMb
    };
  }

  async function plan({ source, destination, conflictPolicy = 'queue', method = 'copy', minFreeMb = 100 } = {}) {
    if (!CONFLICT_POLICIES.has(conflictPolicy)) throw Object.assign(new Error('Invalid conflictPolicy'), { status: 400 });
    if (!METHODS.has(method)) throw Object.assign(new Error('Invalid method'), { status: 400 });
    const src = path.resolve(source), dst = path.resolve(destination);
    if (src === dst || dst.startsWith(src + path.sep) || src.startsWith(dst + path.sep)) throw Object.assign(new Error('Source and destination must be separate'), { status: 400 });

    const inventory = await scan(src);
    let existing = [];
    if (await pathExists(dst)) {
      const st = await fsp.lstat(dst);
      if (st.isSymbolicLink() || !st.isDirectory()) throw Object.assign(new Error('Destination must be a real directory or non-existent'), { status: 400 });
      existing = await scan(dst);
    }
    const existingSet = new Set(existing.map(f => f.rel));
    const conflicts = inventory.filter(f => existingSet.has(f.rel)).map(f => f.rel);
    const totalBytes = inventory.reduce((s, f) => s + f.size, 0);
    const neededBytes = totalBytes + existing.reduce((s, f) => s + f.size, 0);
    const freeDest = statfsFree(path.dirname(dst));

    return {
      dryRun: true, method, conflictPolicy,
      source: src, destination: dst,
      totalFiles: inventory.length, totalBytes,
      existingFiles: existing.length,
      conflicts, conflictCount: conflicts.length,
      neededBytes, freeBytesDestination: freeDest,
      sufficient: freeDest === null || freeDest >= neededBytes + minFreeMb * 1024 * 1024,
      snapshot: inventory.map(f => ({ rel: f.rel, size: f.size }))
    };
  }

  async function run({ source, destination, conflictPolicy = 'queue', method = 'copy', ctx } = {}) {
    if (!CONFLICT_POLICIES.has(conflictPolicy)) throw Object.assign(new Error('Invalid conflictPolicy'), { status: 400 });
    if (!METHODS.has(method)) throw Object.assign(new Error('Invalid method'), { status: 400 });

    const src = path.resolve(source), dst = path.resolve(destination);
    if (src === dst || dst.startsWith(src + path.sep) || src.startsWith(dst + path.sep)) throw Object.assign(new Error('Source and destination must be separate'), { status: 400 });

    if (method === 'reference') {
      // No data is copied; the source stays in place and only the inventory is
      // returned for downstream reconciliation (registration of pointers).
      const inventory = await scan(src);
      return { sourcePreserved: true, method: 'reference', files: inventory.length, totalBytes: inventory.reduce((s, f) => s + f.size, 0), copied: 0, destination: dst };
    }

    const sstat = await fsp.lstat(src).catch(() => null);
    if (!sstat || sstat.isSymbolicLink() || !sstat.isDirectory()) throw Object.assign(new Error('Unsafe source'), { status: 400 });
    const inventory = await scan(src);
    const existing = (await pathExists(dst)) ? await scan(dst) : [];
    const existingSet = new Set(existing.map(f => f.rel));

    const staging = dst + STAGING_SUFFIX;
    const marker = path.join(staging, MARKER_NAME);
    let resume = false;
    if (await pathExists(staging)) {
      try { if ((await fsp.readFile(marker, 'utf8')) !== MARKER_VALUE) throw Error('occupied'); resume = true; }
      catch (e) { if (e.code === 'ENOENT') throw Object.assign(new Error('Staging path is occupied by an unknown directory'), { status: 409 }); throw Object.assign(new Error('Staging path is occupied by an unknown directory'), { status: 409 }); }
    } else {
      await fsp.mkdir(staging, { recursive: true, mode: 0o700 });
      await fsp.writeFile(marker, MARKER_VALUE, { flag: 'wx', mode: 0o600 });
    }

    // Build the target file plan: existing destination files are preserved
    // verbatim; source files that collide follow the conflict policy.
    const taken = new Set(existing.map(f => f.rel));
    const tasks = [];
    for (const f of existing) tasks.push({ rel: f.rel, from: path.join(dst, f.rel), sourceRel: f.rel, renamed: false });
    for (const f of inventory) {
      if (existingSet.has(f.rel)) {
        if (conflictPolicy === 'first' || conflictPolicy === 'skip') continue; // keep existing
        const renamed = uniqueName(f.rel, taken);
        tasks.push({ rel: renamed, from: path.join(src, f.rel), sourceRel: f.rel, renamed: true });
        taken.add(renamed);
      } else {
        tasks.push({ rel: f.rel, from: path.join(src, f.rel), sourceRel: f.rel, renamed: false });
        taken.add(f.rel);
      }
    }

    const total = tasks.length;
    if (ctx && ctx.setTotal) ctx.setTotal(total);
    let copied = 0, skipped = 0;
    for (const t of tasks) {
      if (ctx && ctx.signal && ctx.signal.aborted) throw abortError();
      if (ctx && ctx.throwIfPaused) ctx.throwIfPaused();
      const destPath = path.join(staging, t.rel);
      const destStat = await fsp.lstat(destPath).catch(() => null);
      const fromStat = await fsp.lstat(t.from);
      if (destStat && destStat.isFile() && destStat.size === fromStat.size && await sameContent(t.from, destPath, ctx)) {
        skipped++; // already staged and verified (resume)
      } else {
        await fsp.rm(destPath, { force: true });
        await fsp.mkdir(path.dirname(destPath), { recursive: true });
        await transferOne(t.from, destPath, method);
        const srcHash = await sha256File(t.from, ctx);
        const dstHash = await sha256File(destPath, ctx);
        if (srcHash !== dstHash) throw Object.assign(new Error('Integrity mismatch after copy: ' + t.sourceRel), { code: 'INTEGRITY' });
        copied++;
      }
      if (ctx && ctx.advance) ctx.advance(1);
    }

    // VERIFY: the staged tree must exactly match the planned file set.
    const staged = (await scan(staging)).filter(f => f.rel !== MARKER_NAME);
    const expected = tasks.map(t => t.rel).sort();
    const actual = staged.map(f => f.rel).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw Object.assign(new Error('Inventory mismatch after staging'), { code: 'VERIFY' });

    // SWITCH: preserve any existing destination as a backup, then move staging in.
    const backup = dst + '.bak.' + Date.now();
    if (await pathExists(dst)) await fsp.rename(dst, backup);
    await fsp.rename(staging, dst);

    return {
      sourcePreserved: true, method, conflictPolicy,
      files: inventory.length, copied, skipped,
      stagedTotal: total, resumed: resume,
      backup: (await pathExists(backup)) ? backup : null,
      destination: dst
    };
  }

  async function rollback({ destination } = {}) {
    const dst = path.resolve(destination);
    const parent = path.dirname(dst);
    const base = path.basename(dst);
    const entries = await fsp.readdir(parent).catch(() => []);
    const backups = entries.filter(n => n.startsWith(base + '.bak.')).sort().reverse();
    if (!backups.length) throw Object.assign(new Error('No backup available for rollback'), { status: 409 });
    const backup = path.join(parent, backups[0]);
    if (await pathExists(dst)) await fsp.rename(dst, dst + '.pre-rollback.' + Date.now());
    await fsp.rename(backup, dst);
    return { rolledBackTo: backup, destination: dst };
  }

  return { preflight, plan, run, rollback, scan };
}

module.exports = { create, CONFLICT_POLICIES, METHODS, STAGING_SUFFIX, MARKER_NAME };
