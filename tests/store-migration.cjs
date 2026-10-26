'use strict';
// Миграция на ЖИВА база: `CREATE TABLE IF NOT EXISTS` не пипа съществуваща таблица, значи
// всяка нова колона трябва да се добави изрично. До 0.69.87 такива колони нямаше и нито един
// тест не проверяваше този път — тоест първата миграция щеше да е и първата, която никой не е
// виждал. Тук се създава база със СТАРАТА схема (без `max_uses`/`uses`) и се проверява, че:
//   1. отварянето добавя колоните, без да губи данни;
//   2. лимитът на отварянията работи веднага след миграцията;
//   3. вече съществуващ токен остава без лимит (старото поведение не се променя само).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, '..', 'hapi_enterprise', 'sqlite-store.js');
const { open } = require(dbPath);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-store-migration-'));
const jsonPath = path.join(dir, 'db.json');
const sqlitePath = path.join(dir, 'db.sqlite');
const checks = [];
const ok = (msg) => checks.push(msg);
// Дръжките се затварят в `finally`: иначе провалена проверка оставя базата заключена и
// съобщението за грешката се заменя с EPERM при изтриването на временната папка.
const handles = [];

const OLD_SCHEMA = `CREATE TABLE IF NOT EXISTS portal_tokens (id TEXT PRIMARY KEY, portal_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, expires_at TEXT, revoked_at TEXT);`;

try {
  // ── 0. Жива база със старата схема и един ред в нея ─────────────────────────
  const legacy = new DatabaseSync(sqlitePath);
  legacy.exec(OLD_SCHEMA);
  legacy
    .prepare('INSERT INTO portal_tokens(id,portal_id,scopes,label,created_at,token_hash) VALUES(?,?,?,?,?,?)')
    .run('legacy1', 'portal-a', '["read"]', 'стар токен', new Date().toISOString(), 'hash-of-legacy');
  legacy.close();

  // ── 1. Отварянето мигрира, без да губи реда ─────────────────────────────────
  let store;
  try {
    store = open(jsonPath);
  } catch (e) {
    // Липсваща колона се усеща тук, при самото отваряне — съобщението трябва да е ясно,
    // а не EPERM от почистването на временната папка по-долу.
    assert.fail('миграцията не мина: ' + e.message);
  }
  handles.push(store);
  const probe = new DatabaseSync(sqlitePath);
  const columns = probe.prepare('PRAGMA table_info(portal_tokens)').all().map((c) => c.name);
  probe.close();
  assert.ok(columns.includes('max_uses'), 'колоната max_uses е добавена: ' + columns.join(', '));
  assert.ok(columns.includes('uses'), 'колоната uses е добавена: ' + columns.join(', '));
  const kept = store.getPortalTokenByHash('hash-of-legacy');
  assert.ok(kept, 'старият токен е още в базата след миграцията');
  assert.equal(kept.maxUses, null, 'старият токен остава БЕЗ лимит — миграцията не сменя поведение');
  assert.equal(kept.uses, 0, 'броячът тръгва от нула');
  ok('стара база се мигрира, редът е запазен, старият токен е без лимит');

  // ── 2. Лимитът работи веднага след миграцията ───────────────────────────────
  store.createPortalToken({ id: 'new1', portalId: 'portal-a', tokenHash: 'hash-of-new', scopes: ['read'], label: '', expiresAt: null, maxUses: 2 });
  assert.equal(store.usePortalToken('new1'), true, 'първото отваряне минава');
  assert.equal(store.usePortalToken('new1'), true, 'второто отваряне минава');
  assert.equal(store.usePortalToken('new1'), false, 'третото е отказано от условния UPDATE');
  assert.equal(store.getPortalTokenByHash('hash-of-new').uses, 2, 'броячът не прескача лимита');
  // Без лимит броячът пак расте, но нищо не се отказва.
  store.createPortalToken({ id: 'new2', portalId: 'portal-a', tokenHash: 'hash-of-new2', scopes: ['read'], label: '' });
  for (let i = 0; i < 5; i++) assert.equal(store.usePortalToken('new2'), true, 'без maxUses отварянията не се изчерпват');
  assert.equal(store.getPortalTokenByHash('hash-of-new2').uses, 5, 'броячът се вижда и без лимит');
  ok('лимитът се брои в базата и не може да бъде надминат');


  // ── 3. Второ отваряне на същата база не чупи нищо (миграцията е идемпотентна) ──
  const again = open(jsonPath);
  handles.push(again);
  assert.equal(again.getPortalTokenByHash('hash-of-new').uses, 2, 'данните са същите след повторно отваряне');
  assert.equal(again.usePortalToken('new1'), false, 'изчерпаният токен остава изчерпан');

  ok('миграцията е идемпотентна — повторното отваряне не пипа данните');
} finally {
  for (const handle of handles) {
    try { handle.close() } catch { /* вече затворена */ }
  }
  // Почистването е най-добро усилие: при провалена проверка остава заключена дръжка и
  // изтриването пада с EPERM, което би скрило истинската причина.
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* временната папка е за изхвърляне */ }
}

console.log('PASS store-migration: ' + checks.join(' · '));
