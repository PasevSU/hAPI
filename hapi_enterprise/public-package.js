'use strict';
// Еднократни токени за пакет, поискан от ПУБЛИЧНАТА страница.
//
// Защо токен, а не направо адрес на пакета: пакетът се строи от името на посетителя, но
// файловете в него трябва да могат да се свалят само веднъж и само от онзи, който го е
// поискал. Токенът е случаен, живее кратко (по подразбиране 10 минути), пази се само в
// add-on-а (не в адреса на портала) и се „изгаря“ при първото му използване.
//
// Токените се пазят във файл, а не само в паметта: рестарт на add-on-а между „поискай“ и
// „изтегли“ не бива да прави току-що показания линк безполезен.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_TOKENS = 512;
const DEFAULT_TTL_SECONDS = 600;
// Колко време след изтичане/използване записът се пази, преди да се изтрие (за одит).
const KEEP_AFTER_MS = 3600_000;

function create({ dir, ttlSeconds, now } = {}) {
  const file = path.join(dir, 'public-packages.json');
  const clock = typeof now === 'function' ? now : () => Date.now();
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.floor(ttlSeconds) : DEFAULT_TTL_SECONDS;
  const tokens = new Map();

  (function load() {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      // Няма файл (първи старт) или файлът е повреден: започваме с празен набор, вместо
      // да спрем add-on-а. Повреден файл не се пази — следващият запис го замества.
      if (e.code !== 'ENOENT') tokens.clear();
      return;
    }
    for (const [token, entry] of Object.entries((raw && raw.tokens) || {})) {
      if (entry && typeof entry.packageId === 'string' && Number.isFinite(entry.expiresAt)) tokens.set(token, entry);
    }
  })();

  function saveNow() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, tokens: Object.fromEntries(tokens) }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  /** Маха изтеклите и използваните записи, след като е минал час на изчакване. */
  function prune() {
    const at = clock();
    let removed = 0;
    for (const [token, entry] of tokens) {
      const ended = entry.usedAt || entry.expiresAt;
      if (ended <= at - KEEP_AFTER_MS) {
        tokens.delete(token);
        removed++;
      }
    }
    return { removed, kept: tokens.size };
  }

  /** Издава еднократен токен за вече построен пакет. */
  function issue({ packageId, portalId, portalSlug = '', fileName = '', files = 0 } = {}) {
    if (!packageId) throw Object.assign(new Error('Липсва пакет за токена'), { status: 400 });
    prune();
    // Таван на броя живи токени: иначе публичният маршрут би бил начин да се пълни паметта.
    while (tokens.size >= MAX_TOKENS) {
      const oldest = [...tokens.entries()].sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0))[0];
      if (!oldest) break;
      tokens.delete(oldest[0]);
    }
    const token = crypto.randomBytes(24).toString('hex');
    const createdAt = clock();
    const entry = { packageId: String(packageId), portalId: String(portalId || ''), portalSlug: String(portalSlug || ''), fileName: String(fileName || ''), files: Number(files) || 0, createdAt, expiresAt: createdAt + ttl * 1000, usedAt: 0 };
    tokens.set(token, entry);
    saveNow();
    return { token, expiresAt: new Date(entry.expiresAt).toISOString(), ttlSeconds: ttl };
  }

  /**
   * „Изгаря“ токена и връща пакета. Причини за отказ: unknown (няма такъв), used
   * (вече използван), expired (изтекъл), portal (токенът е за друг портал).
   */
  function redeem(token, { portalId } = {}) {
    const key = String(token || '');
    const entry = tokens.get(key);
    if (!entry) return { ok: false, reason: 'unknown' };
    // Чужд токен е „няма такъв“ за този портал: не се издава дали е използван или изтекъл.
    if (portalId && entry.portalId && entry.portalId !== String(portalId)) return { ok: false, reason: 'portal' };
    if (entry.usedAt) return { ok: false, reason: 'used', entry };
    if (entry.expiresAt <= clock()) return { ok: false, reason: 'expired', entry };
    entry.usedAt = clock();
    saveNow();
    return { ok: true, entry };
  }

  return {
    ttlSeconds: ttl,
    issue,
    redeem,
    prune,
    // За тестове и диагностика: колко живи токена има, без да се показват самите те.
    size: () => tokens.size,
  };
}

module.exports = { create, DEFAULT_TTL_SECONDS, MAX_TOKENS };
