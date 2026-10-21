'use strict';
// Structured debug logging for the add-on.
//
//   levels   error < warn < info < debug < trace (default: info, option `log_level`)
//   console  error/warn -> stderr, info/debug/trace -> stdout (Home Assistant log)
//   file     <DATA_DIR>/logs/debug-YYYY-MM-DD[.n].jsonl, size-capped, N newest kept
//   memory   bounded ring buffer for GET /admin/api/logs
//
// Every string and object is redacted before it leaves the process: credential-shaped
// keys, bearer tokens and long hex digests never reach the log file. Logging never
// throws — a broken sink must not break the request path.
const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
const NAMES = ['error', 'warn', 'info', 'debug', 'trace'];
const SECRET_KEY =
  /^(authorization|cookie|set-cookie|x-api-key|x-portal-key|token|admin_token|password|passwd|secret|api_key|apikey|portal_key|signature|private_key|key)$/i;
const MAX_STRING = 2048;
const MAX_ARRAY = 50;

function redactText(value) {
  return String(value)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/g, '$1***')
    .replace(/\b[A-Fa-f0-9]{64,}\b/g, '***');
}

// Messages keep readable identifiers (file names, digests) but never a bearer token.
function redactMessage(value) {
  return String(value).replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/g, '$1***');
}

function redact(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '***';
  if (typeof value === 'string') {
    const text = value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…' : value;
    return redactText(text);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message), code: value.code };
  }
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((item) => redact(item, depth + 1, seen));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? '***' : redact(item, depth + 1, seen);
  }
  return out;
}

function format(entry) {
  const extra = [];
  for (const [key, value] of Object.entries(entry.ctx || {})) {
    if (key === 'ns') continue;
    extra.push(key + '=' + (value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value)));
  }
  return (
    '[' +
    entry.at +
    '] ' +
    entry.level.toUpperCase().padEnd(5) +
    ' ' +
    entry.ns +
    ' ' +
    entry.msg +
    (extra.length ? ' ' + extra.join(' ') : '')
  );
}

function create(options = {}) {
  const dir = options.dir ? path.resolve(String(options.dir)) : null;
  const fileSink = options.file !== false && !!dir;
  const logDir = dir ? path.join(dir, 'logs') : null;
  const consoleSink = options.console !== false;
  const maxBytes = Math.max(4 * 1024, Number(options.maxBytes) || 5 * 1024 * 1024);
  const maxFiles = Math.max(1, Number(options.maxFiles) || 5);
  const maxEntries = Math.max(10, Number(options.maxEntries) || 500);

  let level = LEVELS[options.level] !== undefined ? String(options.level) : 'info';
  let currentFile = null;
  let currentBytes = 0;
  let rotation = 0;
  let dirReady = false;
  let total = 0;
  let dropped = 0;
  const ring = [];

  const sizeOf = (file) => {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  };

  function pruneFiles() {
    try {
      const files = fs
        .readdirSync(logDir)
        .filter((name) => /^debug-.*\.jsonl$/.test(name))
        .map((name) => {
          let at = 0;
          try {
            at = fs.statSync(path.join(logDir, name)).mtimeMs;
          } catch {
            at = 0;
          }
          return { name, at };
        })
        .sort((a, b) => b.at - a.at);
      // Keep room for the file that is about to be created by the caller.
      for (const stale of files.slice(Math.max(0, maxFiles - 1))) fs.rmSync(path.join(logDir, stale.name), { force: true });
    } catch {
      /* pruning is best effort */
    }
  }

  function pickFile(size) {
    if (!fileSink) return null;
    const day = new Date().toISOString().slice(0, 10);
    const base = path.join(logDir, 'debug-' + day + '.jsonl');
    if (!currentFile || !currentFile.startsWith(path.join(logDir, 'debug-' + day))) {
      currentFile = base;
      currentBytes = sizeOf(base);
      rotation = 0;
      while (currentBytes >= maxBytes) {
        rotation++;
        currentFile = base.replace(/\.jsonl$/, '.' + rotation + '.jsonl');
        currentBytes = sizeOf(currentFile);
      }
      return currentFile;
    }
    if (currentBytes + size > maxBytes) {
      rotation++;
      currentFile = base.replace(/\.jsonl$/, '.' + rotation + '.jsonl');
      currentBytes = sizeOf(currentFile);
      pruneFiles();
    }
    return currentFile;
  }

  function emit(levelName, message, context) {
    if (LEVELS[levelName] > LEVELS[level]) return false;
    const entry = {
      at: new Date().toISOString(),
      level: levelName,
      ns: context && context.ns ? String(context.ns) : 'app',
      msg: redactMessage(message === undefined ? '' : message),
    };
    const rest = { ...(context || {}) };
    delete rest.ns;
    const safe = redact(rest);
    if (safe && Object.keys(safe).length) entry.ctx = safe;

    ring.push(entry);
    if (ring.length > maxEntries) {
      ring.shift();
      dropped++;
    }
    total++;

    if (consoleSink) {
      const line = format(entry);
      if (LEVELS[levelName] <= LEVELS.warn) console.error(line);
      else console.log(line);
    }

    try {
      const target = pickFile(Buffer.byteLength(JSON.stringify(entry)) + 1);
      if (target) {
        if (!dirReady) {
          fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
          dirReady = true;
        }
        const json = JSON.stringify(entry) + '\n';
        fs.appendFileSync(target, json, { mode: 0o600 });
        currentBytes += Buffer.byteLength(json);
      }
    } catch {
      /* a failing sink must never break the caller */
    }
    return true;
  }

  function setLevel(next) {
    const value = String(next || '').toLowerCase();
    if (!NAMES.includes(value)) throw Object.assign(new Error('Unknown log level: ' + next), { status: 400 });
    level = value;
    emit('info', 'log.level.changed', { ns: 'logger', level: value });
    return value;
  }

  function writer(bindings) {
    const at = (levelName) => (message, context) => emit(levelName, message, { ...(bindings || {}), ...(context || {}) });
    return {
      error: at('error'),
      warn: at('warn'),
      info: at('info'),
      debug: at('debug'),
      trace: at('trace'),
      child: (extra) => writer({ ...(bindings || {}), ...(extra || {}) }),
      level: () => level,
      setLevel,
      enabled: (levelName) => LEVELS[levelName] <= LEVELS[level],
    };
  }

  const root = writer({});
  return Object.assign(root, {
    levels: () => NAMES.slice(),
    entries: ({ limit = 100, level: filter } = {}) => {
      const max = Math.max(1, Math.min(maxEntries, Number(limit) || 100));
      const out = [];
      for (let i = ring.length - 1; i >= 0 && out.length < max; i--) {
        if (filter && ring[i].level !== filter) continue;
        out.push(ring[i]);
      }
      return out;
    },
    files: () => {
      if (!fileSink) return [];
      try {
        return fs
          .readdirSync(logDir)
          .filter((name) => /^debug-.*\.jsonl$/.test(name))
          .sort();
      } catch {
        return [];
      }
    },
    stats: () => ({ level, dir: logDir, file: currentFile, rotations: rotation, total, inMemory: ring.length, dropped }),
    redact,
    close: () => {},
  });
}

module.exports = { create, redact, LEVELS, NAMES };
