'use strict';
// Дела (cases): номер, заглавие, категория, „относно“, контакт и полета по желание.
// Пази се в db.cases (същата база като порталите) и се използва от порталите чрез caseId.
const crypto = require('node:crypto');
const { sanitizeExtras } = require('./directory');

const id = () => crypto.randomBytes(8).toString('hex');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const clean = (v) => (typeof v === 'string' ? v.trim().replace(/[\r\n\0]/g, ' ') : '');
const MAX_CASES = 2000;

function state(db) {
  db.cases ??= [];
  return db;
}

/** Контактът трябва да съществува в директорията (или да е празен). */
function contactRef(db, value) {
  const id = clean(value);
  if (!id) return '';
  const list = (db.directory && db.directory.contacts) || [];
  if (!list.some((c) => c.id === id)) throw err('Unknown contact');
  return id;
}

const list = (db) => {
  state(db);
  return { cases: db.cases };
};

function addCase(db, input) {
  state(db);
  const b = input && typeof input === 'object' ? input : {};
  const number = clean(b.number || b.title).slice(0, 80);
  if (!number) throw err('Invalid case number');
  if (db.cases.length >= MAX_CASES) throw err('Too many cases');
  if (db.cases.some((c) => c.number.toLowerCase() === number.toLowerCase()))
    throw err('Case already exists', 409);
  const c = {
    id: id(),
    number,
    title: clean(b.title).slice(0, 160) || number,
    category: clean(b.category).slice(0, 120),
    subject: clean(b.subject).slice(0, 200),
    contactId: contactRef(db, b.contactId),
    extras: sanitizeExtras(b.extras),
    createdAt: new Date().toISOString(),
  };
  db.cases.push(c);
  return c;
}

function patchCase(db, cid, input) {
  state(db);
  const c = db.cases.find((x) => x.id === cid);
  if (!c) throw err('Case not found', 404);
  const b = input && typeof input === 'object' ? input : {};
  if (b.number !== undefined) {
    const n = clean(b.number).slice(0, 80);
    if (!n) throw err('Invalid case number');
    if (db.cases.some((x) => x !== c && x.number.toLowerCase() === n.toLowerCase()))
      throw err('Case already exists', 409);
    c.number = n;
  }
  if (b.title !== undefined) c.title = clean(b.title).slice(0, 160) || c.number;
  if (b.category !== undefined) c.category = clean(b.category).slice(0, 120);
  if (b.subject !== undefined) c.subject = clean(b.subject).slice(0, 200);
  if (b.contactId !== undefined) c.contactId = contactRef(db, b.contactId);
  if (b.extras !== undefined) c.extras = sanitizeExtras(b.extras);
  return c;
}

function removeCase(db, cid) {
  state(db);
  const n = db.cases.length;
  db.cases = db.cases.filter((x) => x.id !== cid);
  if (db.cases.length === n) throw err('Case not found', 404);
  return { deleted: cid };
}

const caseById = (db, cid) => (cid && db.cases ? db.cases.find((c) => c.id === cid) || null : null);

function caseView(db, cid) {
  const c = caseById(db, cid);
  if (!c) return null;
  return {
    id: c.id,
    number: c.number,
    title: c.title,
    category: c.category,
    subject: c.subject,
    contactId: c.contactId,
    extras: Array.isArray(c.extras) ? c.extras.map((x) => ({ key: x.key, value: x.value })) : [],
  };
}

module.exports = { state, list, addCase, patchCase, removeCase, caseById, caseView };
