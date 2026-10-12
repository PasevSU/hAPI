'use strict';
// Persistent Notification Center (Phase 5). A bounded ring buffer of process and
// operational events shown in the admin UI. Entries live in memory and are
// snapshotted atomically to disk so the most recent notifications survive a
// restart. A job transitions through one entry (running -> succeeded/failed/
// cancelled) via upsert so progress is shown in place rather than spamming the log.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LEVELS = new Set(['info', 'success', 'warn', 'error']);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'done']);

function create({ dir, max = 200 } = {}) {
  const hasDir = typeof dir === 'string' && dir.length > 0;
  const file = hasDir ? path.join(dir, 'notifications.json') : null;
  let seq = 0;
  let items = [];

  if (hasDir) {
    fs.mkdirSync(dir, { recursive: true });
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(raw)) {
        for (const it of raw) {
          if (!it || typeof it.id !== 'string') continue;
          items.push(it);
          seq = Math.max(seq, Number(it.seq) || 0);
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('notification center load failed', e.code || e.message);
    }
    if (items.length > max) items = items.slice(items.length - max);
  }

  const normalizeLevel = level => (LEVELS.has(level) ? level : 'info');

  function persist() {
    if (!hasDir) return;
    const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(items), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch {}
      console.error('notification center persist failed', e.code || e.message);
    }
  }

  function push(entry) {
    items.push(entry);
    if (items.length > max) items.splice(0, items.length - max);
    persist();
    return entry;
  }

  function record(p = {}) {
    const entry = {
      id: crypto.randomUUID(),
      seq: ++seq,
      at: p.at || new Date().toISOString(),
      level: normalizeLevel(p.level),
      kind: p.kind || 'info',
      status: p.status || null,
      title: p.title || '',
      message: p.message || '',
      progress: p.progress || null,
      key: p.key || null,
      meta: p.meta || null
    };
    return push(entry);
  }

  function upsert(key, p = {}) {
    if (typeof key === 'string' && key) {
      const live = items.find(it => it.key === key && it.status && !TERMINAL.has(it.status));
      if (live) {
        if (p.level) live.level = normalizeLevel(p.level);
        if (p.kind) live.kind = p.kind;
        if (p.status) live.status = p.status;
        if (p.title !== undefined) live.title = p.title;
        if (p.message !== undefined) live.message = p.message;
        if (p.progress !== undefined) live.progress = p.progress;
        if (p.meta !== undefined) live.meta = p.meta;
        live.at = p.at || new Date().toISOString();
        persist();
        return live;
      }
    }
    return record({ key, ...p });
  }

  function list({ since, limit = 100, level, kind, status } = {}) {
    let out = items;
    if (since !== undefined && since !== null && since !== '') {
      const s = Number(since);
      if (Number.isFinite(s)) out = out.filter(it => it.seq > s);
    }
    if (level) out = out.filter(it => it.level === level);
    if (kind) out = out.filter(it => it.kind === kind);
    if (status) out = out.filter(it => it.status === status);
    out = out.slice().reverse();
    const n = Number(limit);
    if (Number.isFinite(n)) out = out.slice(0, Math.max(0, n));
    return out;
  }

  function stats() {
    const byLevel = {}, byStatus = {};
    for (const it of items) {
      byLevel[it.level] = (byLevel[it.level] || 0) + 1;
      if (it.status) byStatus[it.status] = (byStatus[it.status] || 0) + 1;
    }
    return {
      total: items.length,
      lastSeq: seq,
      active: byStatus.running || 0,
      failed: (byStatus.failed || 0) + (byStatus.interrupted || 0),
      byLevel,
      byStatus
    };
  }

  function clear({ finishedOnly = true } = {}) {
    const before = items.length;
    if (finishedOnly) items = items.filter(it => !(it.status && TERMINAL.has(it.status)));
    else items = [];
    persist();
    return before - items.length;
  }

  function subscribe(bus) {
    const map = {
      'job.running': p => upsert('job:' + p.job.id, { level: 'info', kind: 'job', status: 'running', title: 'Job · ' + p.job.type, message: 'In progress', progress: p.job.progress, meta: p.job }),
      'job.succeeded': p => upsert('job:' + p.job.id, { level: 'success', status: 'succeeded', message: 'Completed successfully', progress: p.job.progress, meta: p.job }),
      'job.failed': p => upsert('job:' + p.job.id, { level: 'error', status: 'failed', message: p.job.error || 'Failed', progress: p.job.progress, meta: p.job }),
      'job.cancelled': p => upsert('job:' + p.job.id, { level: 'warn', status: 'cancelled', message: 'Cancelled', progress: p.job.progress, meta: p.job }),
      'job.interrupted': p => record({ level: 'error', kind: 'job', status: 'failed', title: 'Job · ' + p.job.type, message: 'Interrupted by restart' }),
      'settings_changed': p => record({ level: 'info', kind: 'settings', status: 'done', title: 'Settings', message: 'Settings updated' }),
      'backup.created': p => record({ level: 'success', kind: 'backup', status: 'done', title: 'Backup', message: 'Metadata backup created' }),
      'config.profile.saved': p => record({ level: 'info', kind: 'profile', status: 'done', title: 'Profile', message: 'Profile saved' }),
      'config.profile.applied': p => record({ level: 'info', kind: 'profile', status: 'done', title: 'Profile', message: 'Profile applied' }),
      'integrity.verified': p => record({ level: p.valid ? 'success' : 'error', kind: 'integrity', status: 'done', title: 'Integrity', message: p.valid ? 'Audit chain valid' : 'Audit chain verification failed' }),
      'storage.warning': p => record({ level: 'warn', kind: 'storage', status: 'warn', title: 'Storage', message: p.message || 'Storage check reported a problem' }),
      'evidence.uploaded': p => record({ level: 'success', kind: 'evidence', status: 'done', title: 'Evidence', message: 'Evidence uploaded · ' + (p.caseId || '') }),
      'portal.credential.issued': p => record({ level: 'info', kind: 'portal', status: 'done', title: 'Portal', message: 'Portal credential issued for ' + (p.role || '') }),
      'portal.access': p => record({ level: 'info', kind: 'portal', status: 'done', title: 'Portal', message: 'Portal access · ' + (p.action || '') })
    };
    for (const [event, fn] of Object.entries(map)) bus.on(event, fn);
  }

  return { record, upsert, list, stats, clear, subscribe };
}
module.exports = { create, TERMINAL };
