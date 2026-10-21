'use strict';
// Помощни функции за изданието на hAPI Enterprise.
//
// Нула външни зависимости: tar.gz и zip се сглобяват на ръка (USTAR + gzip,
// ZIP с deflate), за да може изданието да се построи еднакво на Windows,
// Linux и в CI, без `tar`/`zip`/`7z` в средата.
//
// Версията има един източник на истина — `hapi_enterprise/config.yaml`.
// Интеграцията (`custom_components/hapi_enterprise/manifest.json`) трябва да
// носи същата версия; това се проверява от `scripts/verify-release.cjs`.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const ADDON_DIR = 'hapi_enterprise';
const INTEGRATION_DIR = 'custom_components/hapi_enterprise';
const DIST_DIR = 'dist';
const PRODUCT = 'hAPI Enterprise';

// Никога не влизат в изданието: кешове, локално състояние и тайни.
const SKIP_DIRS = new Set(['__pycache__', 'node_modules', '.git', '.pytest_cache', '.mypy_cache', '.idea', '.vscode']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', 'Desktop.ini', 'options.json', 'admin-token', '.env']);
const SKIP_EXT = new Set(['.pyc', '.pyo', '.tmp', '.log', '.swp', '.bak']);

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** Чете версията на add-on-а от `config.yaml` (единствен източник на истина). */
function readAddonVersion(root = ROOT) {
  const yaml = fs.readFileSync(path.join(root, ADDON_DIR, 'config.yaml'), 'utf8');
  const m = yaml.match(/^version:\s*["']?([0-9]+\.[0-9]+\.[0-9]+)["']?\s*$/m);
  if (!m) throw new Error('config.yaml: липсва version');
  return m[1];
}

/** Чете версията на custom интеграцията от `manifest.json`. */
function readIntegrationVersion(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, INTEGRATION_DIR, 'manifest.json'), 'utf8'));
  return String(manifest.version || '');
}

/** Записва една и съща версия в config.yaml, manifest.json и баджовете в основните документи. */
function writeVersion(version, root = ROOT) {
  if (!SEMVER.test(String(version))) throw new Error('Невалидна версия: ' + version);
  const cfgPath = path.join(root, ADDON_DIR, 'config.yaml');
  const cfg = fs.readFileSync(cfgPath, 'utf8');
  const nextCfg = cfg.replace(/^version:\s*["']?[^"'\n]+["']?\s*$/m, `version: "${version}"`);
  if (nextCfg === cfg && !cfg.includes(`version: "${version}"`)) throw new Error('config.yaml: version не е намерена');
  fs.writeFileSync(cfgPath, nextCfg);

  const manPath = path.join(root, INTEGRATION_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  manifest.version = version;
  fs.writeFileSync(manPath, JSON.stringify(manifest) + '\n');

  // Баджовете за версия в документите се обновяват заедно с кода, за да не изостават.
  const BADGE = /(img\.shields\.io\/badge\/version-)[0-9.]+(-)/;
  for (const doc of ['README.md', 'BG.md', 'DE.md']) {
    const file = path.join(root, doc);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!BADGE.test(text)) continue;
    fs.writeFileSync(file, text.replace(BADGE, `$1${version}$2`));
  }
  return version;
}

const posix = (p) => p.split(path.sep).join('/');

/**
 * Обхожда дърво и връща файловете, които влизат в изданието, сортирани по път.
 * Пътищата са POSIX (с `/`) — така архивите са еднакви на всички платформи.
 */
function walk(dirAbs, prefix, out = []) {
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      walk(abs, prefix + '/' + entry.name, out);
    } else if (entry.isFile()) {
      if (SKIP_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      const st = fs.statSync(abs);
      out.push({
        path: posix(prefix + '/' + entry.name),
        abs,
        size: st.size,
        mode: entry.name.endsWith('.sh') ? 0o755 : 0o644,
        mtime: Math.floor(st.mtimeMs / 1000),
      });
    }
  }
  return out;
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const sha256File = (file) => sha256(fs.readFileSync(file));

// ── tar.gz (USTAR) ────────────────────────────────────────────────────────────
const octal = (value, width) => {
  const s = Math.max(0, Math.floor(value)).toString(8);
  return s.length >= width ? s.slice(-width) : '0'.repeat(width - 1 - s.length) + s + '\0';
};

function tarHeader(name, size, mtime, mode, type) {
  const buf = Buffer.alloc(512, 0);
  buf.write(name, 0, 100, 'utf8');
  buf.write(octal(mode, 8), 100, 8, 'ascii');
  buf.write(octal(0, 8), 108, 8, 'ascii');
  buf.write(octal(0, 8), 116, 8, 'ascii');
  buf.write(octal(size, 12), 124, 12, 'ascii');
  buf.write(octal(mtime, 12), 136, 12, 'ascii');
  buf.write('        ', 148, 8, 'ascii'); // chksum се смята с осем интервала
  buf.write(type, 156, 1, 'ascii');
  buf.write('ustar\0', 257, 6, 'ascii');
  buf.write('00', 263, 2, 'ascii');
  buf.write('root', 265, 32, 'ascii');
  buf.write('root', 297, 32, 'ascii');
  let sum = 0;
  for (const byte of buf) sum += byte;
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return buf;
}

/** Сглобява .tar.gz от записи `{path, abs|data, mode, mtime}`. */
function buildTarGz(entries) {
  const chunks = [];
  for (const e of entries) {
    const data = e.data || fs.readFileSync(e.abs);
    if (Buffer.byteLength(e.path) > 100) throw new Error('Твърде дълъг път за USTAR: ' + e.path);
    chunks.push(tarHeader(e.path, data.length, e.mtime || 0, e.mode || 0o644, '0'), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(chunks), { level: 9 });
}

/** Разчита .tar.gz обратно до записи (ползва се от проверката на изданието). */
function readTarGz(buf) {
  const raw = zlib.gunzipSync(buf);
  const out = [];
  let offset = 0;
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const size = parseInt(header.toString('ascii', 124, 136).replace(/\0.*$/, '').trim() || '0', 8);
    const mode = parseInt(header.toString('ascii', 100, 108).replace(/\0.*$/, '').trim() || '0', 8);
    const type = header.toString('ascii', 156, 157);
    offset += 512;
    const data = raw.subarray(offset, offset + size);
    offset += size + ((512 - (size % 512)) % 512);
    if (type === '0' || type === '\0') out.push({ path: name, size, mode, data });
  }
  return out;
}

// ── zip (deflate) ─────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const dosTime = (mtime) => {
  const d = new Date((mtime || 0) * 1000);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
};

/** Сглобява .zip (deflate) от записи `{path, abs|data, mode, mtime}`. */
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const data = e.data || fs.readFileSync(e.abs);
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const name = Buffer.from(e.path, 'utf8');
    const crc = crc32(data);
    const { time, date } = dosTime(e.mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 имена
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // Unix, zip 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(((e.mode || 0o644) & 0o777) << 16, 38); // външни атрибути (права)
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** Разчита .zip обратно до записи (deflate или store). */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: липсва central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let cursor = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) throw new Error('zip: счупен central directory');
    const method = buf.readUInt16LE(cursor + 10);
    const compSize = buf.readUInt32LE(cursor + 20);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const extAttr = buf.readUInt32LE(cursor + 38);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.toString('utf8', cursor + 46, cursor + 46 + nameLen);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const packed = buf.subarray(start, start + compSize);
    const data = method === 8 ? zlib.inflateRawSync(packed) : Buffer.from(packed);
    out.push({ path: name, size: data.length, mode: (extAttr >>> 16) & 0o777, data });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Разчита архив по разширение — еднакъв интерфейс за проверките. */
function readArchive(buf, name) {
  return name.endsWith('.zip') ? readZip(buf) : readTarGz(buf);
}

const fmtBytes = (n) => {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  if (v < 1048576) return (v / 1024).toFixed(1) + ' KB';
  return (v / 1048576).toFixed(2) + ' MB';
};

module.exports = {
  ROOT,
  PRODUCT,
  ADDON_DIR,
  INTEGRATION_DIR,
  DIST_DIR,
  SEMVER,
  readAddonVersion,
  readIntegrationVersion,
  writeVersion,
  walk,
  sha256,
  sha256File,
  crc32,
  buildTarGz,
  readTarGz,
  buildZip,
  readZip,
  readArchive,
  fmtBytes,
};
