import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertUniqueObjectId(manifest, objectId) {
  invariant(objectId, 'object_id required');
  invariant(!manifest.objects.some(object => object.object_id === objectId), `duplicate object_id ${objectId}`);
}

export function atomicWriteNew(file, bytes, mode = 0o600) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode });
    fs.linkSync(temporary, target);
    return target;
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export function atomicWriteReplace(file, bytes, mode = 0o600) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode });
    fs.renameSync(temporary, target);
    return target;
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export function clone(value) {
  return structuredClone(value);
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

export function ensureObjectPath(root, path) {
  let cur = root;
  for (const key of path) {
    if (!cur[key] || typeof cur[key] !== 'object' || Array.isArray(cur[key])) cur[key] = {};
    cur = cur[key];
  }
  return cur;
}

export function setAt(root, path, value) {
  invariant(Array.isArray(path) && path.length, 'path must be a non-empty array');
  const parent = ensureObjectPath(root, path.slice(0, -1));
  parent[path.at(-1)] = value;
  return root;
}

export function pushAt(root, path, value) {
  const parent = ensureObjectPath(root, path.slice(0, -1));
  const key = path.at(-1);
  if (!Array.isArray(parent[key])) parent[key] = [];
  parent[key].push(value);
  return root;
}

export function stableSortObject(value) {
  if (Array.isArray(value)) return value.map(stableSortObject);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stableSortObject(value[k])]));
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableSortObject(value));
}

export function hashBytes(algorithm, bytes) {
  return crypto.createHash(algorithm).update(bytes).digest('hex');
}

export function sha256Bytes(bytes) { return hashBytes('sha256', bytes); }
export function sha512Bytes(bytes) { return hashBytes('sha512', bytes); }
export function sha1Bytes(bytes) { return hashBytes('sha1', bytes); }
export function md5Bytes(bytes) { return hashBytes('md5', bytes); }
export function sha256Stable(value) { return sha256Bytes(Buffer.from(stableStringify(value), 'utf8')); }

let crcTable;
function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = Array.from({length: 256}, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  });
  return crcTable;
}
export function crc32(bytes) {
  let crc = 0 ^ (-1);
  const table = getCrcTable();
  for (const b of bytes) crc = (crc >>> 8) ^ table[(crc ^ b) & 0xff];
  return ((crc ^ (-1)) >>> 0).toString(16).padStart(8, '0');
}

export function fullHashSet(bytes) {
  return {
    crc32: crc32(bytes),
    md5: md5Bytes(bytes),
    sha1: sha1Bytes(bytes),
    sha256: sha256Bytes(bytes),
    sha512: sha512Bytes(bytes)
  };
}

export function normalizeBBox(bbox) {
  invariant(bbox && ['x','y','w','h'].every(k => Number.isFinite(bbox[k])), 'bbox requires finite x,y,w,h');
  invariant(bbox.w >= 0 && bbox.h >= 0, 'bbox w/h must be >= 0');
  return {x:+bbox.x, y:+bbox.y, w:+bbox.w, h:+bbox.h};
}

export function bboxArea(b) { return Math.max(0, b.w) * Math.max(0, b.h); }
export function bboxIntersection(a,b) {
  const x1=Math.max(a.x,b.x), y1=Math.max(a.y,b.y);
  const x2=Math.min(a.x+a.w,b.x+b.w), y2=Math.min(a.y+a.h,b.y+b.h);
  if (x2<=x1 || y2<=y1) return null;
  return {x:x1,y:y1,w:x2-x1,h:y2-y1};
}
export function bboxIoU(a,b) {
  const i=bboxIntersection(a,b); if(!i) return 0;
  const ia=bboxArea(i); return ia/(bboxArea(a)+bboxArea(b)-ia || 1);
}
export function bboxCenter(b) { return {x:b.x+b.w/2,y:b.y+b.h/2}; }

export function normalizeTextConservative(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\f+$/g, '');
}

export function isoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function unique(values) { return [...new Set(values.filter(v => v != null && v !== ''))]; }
