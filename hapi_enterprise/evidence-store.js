'use strict';
// Phase 7 — write-once, read-many (WORM) evidence store.
//
// Evidence files are immutable. A file is written with an exclusive `wx` flag
// (never overwritten), fsync'd, hashed (SHA-256 + SHA-512), signed into an
// HMAC receipt, and appended to a hash-chained audit log before the index is
// persisted. On any failure the partially written file is removed so a broken
// upload never leaves an orphaned artifact. Verification re-computes both
// digests and re-checks the receipt signature; the chain records every
// verification outcome, producing a tamper-evident custody log.
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createAuditChain } = require('./audit-chain');

const NAME_RE = /^[A-Za-z0-9_. -]{1,120}$/;
const CASE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ACTOR_RE = /^[A-Za-z0-9_.@: -]{1,120}$/;
const CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SECRET', 'EVIDENCE'];

const digest = (buf, alg) => crypto.createHash(alg).update(buf).digest('hex');

function canonicalReceipt(r) {
  return [
    r.algorithm, r.caseId, r.fileId, r.name, r.sha256, r.sha512,
    r.size, r.uploadedBy, r.uploadedAt, r.classification
  ].join('\n');
}

function create({ dir, secret } = {}) {
  if (!dir) throw Error('Evidence dir is required');
  if (!secret || secret.length < 24) throw Error('Evidence secret must be at least 24 characters');

  const filesDir = path.join(dir, 'files');
  const indexFile = path.join(dir, 'evidence-index.json');
  const chain = createAuditChain(dir);

  let index = [];
  let loaded = false;

  async function loadIndex() {
    if (loaded) return;
    try { index = JSON.parse(await fsp.readFile(indexFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; index = []; }
    if (!Array.isArray(index)) index = [];
    loaded = true;
  }

  async function saveIndex() {
    const tmp = indexFile + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(index), { mode: 0o600 });
    await fsp.rename(tmp, indexFile);
  }

  async function store({ caseId, name, data, uploadedBy, classification = 'EVIDENCE', tags = [], mimeType = 'application/octet-stream' } = {}) {
    if (!Buffer.isBuffer(data)) data = Buffer.from(String(data == null ? '' : data));
    if (!NAME_RE.test(name || '')) throw Object.assign(new Error('Invalid name'), { status: 400 });
    if (!CASE_RE.test(caseId || '')) throw Object.assign(new Error('Invalid caseId'), { status: 400 });
    if (!ACTOR_RE.test(uploadedBy || '')) throw Object.assign(new Error('Invalid uploadedBy'), { status: 400 });
    if (!CLASSIFICATIONS.includes(classification)) throw Object.assign(new Error('Invalid classification'), { status: 400 });
    if (!Array.isArray(tags) || tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 80)) throw Object.assign(new Error('Invalid tags'), { status: 400 });

    const fileId = crypto.randomBytes(16).toString('hex');
    const sha256 = digest(data, 'sha256');
    const sha512 = digest(data, 'sha512');
    const uploadedAt = new Date().toISOString();
    const receipt = { algorithm: 'HMAC-SHA256', caseId, fileId, name, size: data.length, sha256, sha512, uploadedBy, uploadedAt, classification, mimeType, tags: [...new Set(tags.map(t => t.trim()))] };
    receipt.signature = crypto.createHmac('sha256', secret).update(canonicalReceipt(receipt)).digest('hex');

    await fsp.mkdir(filesDir, { recursive: true, mode: 0o700 });
    const dest = path.join(filesDir, fileId);
    let written = false;
    try {
      const fh = await fsp.open(dest, 'wx', 0o600);
      try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
      written = true;
      await chain.append('evidence.upload', { fileId, caseId, name, size: data.length, sha256, sha512, uploadedBy, classification });
      await loadIndex();
      index.push({ algorithm: receipt.algorithm, fileId, caseId, name, size: data.length, sha256, sha512, uploadedBy, uploadedAt, classification, mimeType, tags: receipt.tags, signature: receipt.signature });
      await saveIndex();
    } catch (e) {
      if (written) await fsp.rm(dest, { force: true }).catch(() => {});
      loaded = false; // force a fresh read of the (atomic) index on next access
      throw e;
    }
    return receipt;
  }

  async function list({ caseId } = {}) {
    await loadIndex();
    const rows = caseId ? index.filter(r => r.caseId === caseId) : index.slice();
    return rows.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.fileId.localeCompare(b.fileId));
  }

  async function get(fileId) {
    await loadIndex();
    return index.find(r => r.fileId === fileId) || null;
  }

  async function read(fileId) {
    const rec = await get(fileId);
    if (!rec) throw Object.assign(new Error('Evidence not found'), { status: 404 });
    return { rec, data: await fsp.readFile(path.join(filesDir, fileId)) };
  }

  async function verify(fileId, provided) {
    await loadIndex();
    const rec = index.find(r => r.fileId === fileId);
    if (!rec) return { valid: false, reason: 'NOT_FOUND' };
    const buf = provided === undefined
      ? await fsp.readFile(path.join(filesDir, fileId))
      : (Buffer.isBuffer(provided) ? provided : Buffer.from(String(provided)));
    const sha256 = digest(buf, 'sha256');
    const sha512 = digest(buf, 'sha512');
    const receiptValid = crypto.timingSafeEqual(
      Buffer.from(rec.signature),
      Buffer.from(crypto.createHmac('sha256', secret).update(canonicalReceipt(rec)).digest('hex'))
    );
    const valid = receiptValid && sha256 === rec.sha256 && sha512 === rec.sha512 && buf.length === rec.size;
    let reason;
    if (!receiptValid) reason = 'RECEIPT_SIGNATURE_MISMATCH';
    else if (sha256 !== rec.sha256) reason = 'SHA256_MISMATCH';
    else if (sha512 !== rec.sha512) reason = 'SHA512_MISMATCH';
    else if (buf.length !== rec.size) reason = 'SIZE_MISMATCH';
    await chain.append('evidence.verify', { fileId, caseId: rec.caseId, valid, sha256, sha512, size: buf.length, receiptValid });
    return { valid, reason, sha256, sha512, size: buf.length, receiptValid };
  }

  async function custodyChain(fileId) {
    await loadIndex();
    const file = path.join(dir, 'audit-chain.jsonl');
    let lines = [];
    try { lines = (await fsp.readFile(file, 'utf8')).split('\n').filter(Boolean); } catch (e) { if (e.code !== 'ENOENT') throw e; lines = []; }
    const events = [];
    for (const line of lines) {
      let r;
      try { r = JSON.parse(line); } catch { continue; } // corrupt lines are reported by chain.verify()
      if (r.details && r.details.fileId === fileId) events.push({ seq: r.seq, at: r.at, event: r.event, details: r.details, hash: r.hash, prevHash: r.prevHash });
    }
    return { fileId, events, integrity: await chain.verify() };
  }

  return { store, list, get, read, verify, custodyChain, indexFile, filesDir };
}

module.exports = { create, CLASSIFICATIONS };
