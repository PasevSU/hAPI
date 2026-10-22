'use strict';
// Variables registry + contact directory with domain rules, auto-fill and a conflict queue.
const crypto = require('node:crypto');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const id = () => crypto.randomBytes(8).toString('hex');
const TYPES = ['text', 'email', 'domain', 'phone', 'number', 'date', 'url', 'bool', 'list'];
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const CHECK = {
  text: v => v.length <= 500,
  email: v => /^[^\s@<>"]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/i.test(v),
  domain: v => /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*\.[a-z]{2,}$/i.test(v),
  phone: v => /^\+?[0-9 ()./-]{5,25}$/.test(v),
  number: v => /^-?\d{1,15}([.,]\d{1,6})?$/.test(v),
  date: v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
  url: v => { try { const u = new URL(v); return /^https?:$/.test(u.protocol) } catch { return false } },
  bool: v => /^(true|false)$/i.test(v),
  list: v => v.length <= 1000
};
const SEED = [
  ['name', 'text', 'Име', true], ['organization', 'text', 'Организация', true], ['department', 'text', 'Отдел', true], ['phone', 'phone', 'Телефон', true],
  ['address', 'text', 'Адрес', true], ['city', 'text', 'Град', true], ['country', 'text', 'Държава', true], ['website', 'url', 'Уебсайт', true],
  ['notes', 'text', 'Бележки', true], ['company_domain', 'domain', 'Основен домейн на фирмата', false]
];
const clean = v => typeof v === 'string' ? v.trim() : '';
// Допълнителни полета „по желание“: [{key, value}] — до 20 реда, без контроли.
const EXTRAS_MAX = 20;
function sanitizeExtras(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw err('extras must be an array');
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const key = clean(raw.key).replace(/[\r\n\0]/g, '').slice(0, 60);
    const value = clean(raw.value).replace(/[\r\n\0]/g, ' ').slice(0, 500);
    if (!key) continue;
    out.push({ key, value });
    if (out.length >= EXTRAS_MAX) break;
  }
  return out;
}
// Фирми и институции: един запис държи име, адреси и (под себе си) служители.
const ORG_KINDS = ['company', 'institution'];
const ORG_MAX = 1000, ORG_ADDRESSES_MAX = 10, ORG_EMPLOYEES_MAX = 200;
const ADDRESS_FIELDS = { label: 80, street: 200, city: 120, postal: 24, country: 80, note: 200 };
function cleanLine(v, max) { return clean(v).replace(/[\r\n\t\0]+/g, ' ').replace(/\s{2,}/g, ' ').slice(0, max) }
// Адрес без нито едно съдържателно поле не се пази; id се запазва при редакция.
function sanitizeAddresses(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw err('addresses must be an array');
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const address = {};
    const keep = clean(raw.id);
    if (/^[0-9a-f]{16}$/.test(keep)) address.id = keep;
    let filled = false;
    for (const [key, max] of Object.entries(ADDRESS_FIELDS)) {
      const v = cleanLine(raw[key], max);
      if (!v) continue;
      address[key] = v;
      if (key !== 'label') filled = true;
    }
    if (!filled) continue;
    if (!address.id) address.id = id();
    out.push(address);
    if (out.length >= ORG_ADDRESSES_MAX) break;
  }
  return out;
}
function orgKind(kind) {
  const k = clean(kind).toLowerCase() || ORG_KINDS[0];
  if (!ORG_KINDS.includes(k)) throw err('Unknown organization kind');
  return k;
}
function orgById(db, oid) {
  const o = state(db).directory.organizations.find(x => x.id === oid);
  if (!o) throw err('Organization not found', 404);
  return o;
}
// Позиция и коментар стоят върху контакта; организацията е незадължителна връзка.
function contactMeta(db, meta) {
  const out = {};
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return out;
  if ('organizationId' in meta) {
    const oid = clean(meta.organizationId);
    if (oid && !state(db).directory.organizations.some(o => o.id === oid)) throw err('Organization not found', 422);
    out.organizationId = oid;
  }
  if ('position' in meta) out.position = cleanLine(meta.position, 120);
  if ('comment' in meta) out.comment = cleanLine(meta.comment, 500);
  return out;
}
function applyContactMeta(db, contact, meta) {
  const m = contactMeta(db, meta);
  for (const k of ['organizationId', 'position', 'comment']) if (m[k]) contact[k] = m[k];
  return contact;
}
function state(db) {
  db.variables ??= {}; db.directory ??= { contacts: [], rules: [], conflicts: [], organizations: [] };
  const d = db.directory; d.contacts ??= []; d.rules ??= []; d.conflicts ??= []; d.organizations ??= [];
  for (const [key, type, label, field] of SEED) if (!db.variables[key]) db.variables[key] = { type, label, value: '', field, system: true };
  return db;
}
function validValue(type, value) {
  const v = clean(value); if (!v) return '';
  if (!CHECK[type] || !CHECK[type](v)) throw err(`Invalid ${type} value`);
  return type === 'email' || type === 'domain' ? v.toLowerCase() : v;
}
const listVariables = db => Object.entries(state(db).variables).map(([key, x]) => ({ key, ...x }));
function addVariable(db, { key, type = 'text', label, value = '', field = false }) {
  state(db); key = clean(key).toLowerCase();
  if (!KEY.test(key)) throw err('Invalid key: use a-z, 0-9 and _, starting with a letter');
  if (!TYPES.includes(type)) throw err('Unknown type'); if (db.variables[key]) throw err('Variable already exists', 409);
  if (Object.keys(db.variables).length >= 500) throw err('Too many variables');
  const x = { type, label: clean(label).slice(0, 80) || key, value: validValue(type, value), field: !!field, system: false }; db.variables[key] = x; return { key, ...x };
}
function patchVariable(db, key, { value, label }) {
  state(db); const x = db.variables[key]; if (!x) throw err('Variable not found', 404);
  if (value !== undefined) x.value = validValue(x.type, value); if (label !== undefined && !x.system) x.label = clean(label).slice(0, 80) || key; return { key, ...x };
}
function removeVariable(db, key) {
  state(db); const x = db.variables[key]; if (!x) throw err('Variable not found', 404); if (x.system) throw err('System variables cannot be deleted', 409);
  if (db.directory.rules.some(r => key in r.defaults)) throw err('Variable is used by a domain rule', 409);
  delete db.variables[key]; for (const c of db.directory.contacts) delete c.fields[key]; return { deleted: key };
}
const fieldKeys = db => Object.entries(db.variables).filter(([, v]) => v.field).map(([k]) => k);
const expand = (s, db) => String(s).replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_, k) => db.variables[k] ? db.variables[k].value : '');

const normPattern = p => { p = clean(p).toLowerCase(); if (!p.startsWith('@')) p = '@' + p; if (!CHECK.domain(p.slice(1))) throw err('Invalid domain pattern, e.g. @example.com'); return p };
function ruleDefaults(db, defaults) {
  const out = {}; if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) throw err('Invalid defaults');
  for (const [k, raw] of Object.entries(defaults)) {
    const def = db.variables[k]; if (!def || !def.field) throw err(`Unknown field "${k}". Create it first as a field variable.`, 422);
    const v = clean(String(raw)); if (!v) continue; if (!/\{\{/.test(v)) validValue(def.type, v); out[k] = v;
  }
  return out;
}
const domainOf = e => e.slice(e.lastIndexOf('@') + 1).toLowerCase();
const matches = (rule, email) => { const d = domainOf(email), p = rule.pattern.slice(1); return d === p || d.endsWith('.' + p) };
function guessName(email) {
  const local = email.split('@')[0].replace(/\+.*$/, ''); if (/^(info|office|kontakt|contact|admin|support|sales|noreply|no-reply)$/i.test(local)) return '';
  const parts = local.split(/[._-]+/).filter(p => /^[a-zA-ZÀ-ž]+$/.test(p)); if (!parts.length) return '';
  return parts.map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}
function candidates(db, email) {
  const per = new Map(); const g = guessName(email); if (g) per.set('name', [{ source: 'email', value: g }]);
  for (const r of db.directory.rules.filter(r => matches(r, email))) {
    for (const [k, v] of Object.entries(r.defaults)) { const val = expand(v, db); if (!val) continue; const a = per.get(k) || []; if (!a.some(x => x.value === val)) a.push({ source: 'rule ' + r.pattern, value: val }); per.set(k, a) }
  }
  return per;
}
function openConflict(db, contact, field, cands) {
  let c = db.directory.conflicts.find(x => x.contactId === contact.id && x.field === field);
  if (!c) { c = { id: id(), contactId: contact.id, email: contact.email, field, candidates: [], createdAt: new Date().toISOString() }; db.directory.conflicts.push(c) }
  for (const x of cands) if (!c.candidates.some(y => y.value === x.value)) c.candidates.push(x); return c;
}
function ingest(db, input, opts = {}) {
  const policy = opts.conflictPolicy || 'queue';
  state(db); const emails = [...new Set((Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/)).map(x => clean(x).toLowerCase()).filter(Boolean))];
  if (!emails.length) throw err('No email addresses'); if (emails.length > 500) throw err('Too many addresses at once');
  const res = { created: [], updated: [], conflicts: 0, invalid: [], unmatched: [] };
  for (const email of emails) {
    if (!CHECK.email(email)) { res.invalid.push(email); continue }
    let contact = db.directory.contacts.find(c => c.email === email), isNew = false;
    if (!contact) { contact = { id: id(), email, fields: {}, createdAt: new Date().toISOString() }; db.directory.contacts.push(contact); isNew = true }
    const per = candidates(db, email); let changed = isNew;
    if (!db.directory.rules.some(r => matches(r, email))) res.unmatched.push(email);
    for (const [field, cands] of per) {
      const cur = contact.fields[field];
      if (!cur && cands.length === 1) { contact.fields[field] = cands[0].value; changed = true }
      else if (!cur && cands.length > 1) { if (policy === 'first') { contact.fields[field] = cands[0].value; changed = true } else if (policy === 'queue') { openConflict(db, contact, field, cands); res.conflicts++ } }
      else if (cur && !cands.some(x => x.value === cur) && policy === 'queue') { openConflict(db, contact, field, [{ source: 'current', value: cur }, ...cands]); res.conflicts++ }
    }
    (isNew ? res.created : res.updated).push(email); if (!isNew && !changed) res.updated.pop();
  }
  return res;
}
function addRule(db, { pattern, defaults }, opts = {}) {
  state(db); const p = normPattern(pattern); if (db.directory.rules.some(r => r.pattern === p)) throw err('Rule already exists', 409);
  if (db.directory.rules.length >= 200) throw err('Too many rules');
  const rule = { id: id(), pattern: p, defaults: ruleDefaults(db, defaults), createdAt: new Date().toISOString() }; db.directory.rules.push(rule);
  const touched = db.directory.contacts.filter(c => matches(rule, c.email)).map(c => c.email); const r = touched.length ? ingest(db, touched, opts) : { conflicts: 0, updated: [] };
  return { rule, applied: touched.length, conflicts: r.conflicts };
}
function removeRule(db, rid) { state(db); const n = db.directory.rules.length; db.directory.rules = db.directory.rules.filter(r => r.id !== rid); if (db.directory.rules.length === n) throw err('Rule not found', 404); return { deleted: rid } }
// Нов контакт (ръчно добавен): email е задължителен и уникален, полетата минават през TYPES.
// Имейлът може да е ШАБЛОН с `{{променлива}}` (BUG-04): тогава формата се проверява след
// махане на плейсхолдърите, за да не мине произволен текст. Стойността се разгъва при
// публичния изглед (`withVars` в server.js), а не при записа.
const emailTemplate = v => {
  const s = clean(v);
  if (!s.includes('{{')) return null;
  const PH = /\{\{[a-z][a-z0-9_]{0,39}\}\}/g;
  // Или целият адрес е един плейсхолдър (стойността ще е имейл), или остатъкът има
  // формата на имейл, след като плейсхолдърите се заместят с „x“.
  return { onlyPlaceholders: s.replace(PH, '').trim() === '', stripped: s.replace(PH, 'x') };
};
function addContact(db, input) {
  state(db); const b = input && typeof input === 'object' ? input : {};
  const email = clean(b.email).toLowerCase();
  const tpl = emailTemplate(email);
  if (!CHECK.email(email) && !(tpl && (tpl.onlyPlaceholders || CHECK.email(tpl.stripped)))) throw err('Invalid email');
  if (db.directory.contacts.some(c => c.email === email)) throw err('Contact already exists', 409);
  if (db.directory.contacts.length >= 5000) throw err('Too many contacts');
  const contact = { id: id(), email, fields: {}, createdAt: new Date().toISOString() };
  const fields = b.fields && typeof b.fields === 'object' && !Array.isArray(b.fields) ? b.fields : b;
  for (const [k, raw] of Object.entries(fields)) {
    if (k === 'email' && String(raw || '').trim() === email) continue;
    const def = db.variables[k]; if (!def || !def.field) continue;
    const v = validValue(def.type, raw); if (v) contact.fields[k] = v;
  }
  if (!contact.fields.name) { const g = guessName(email); if (g) contact.fields.name = g }
  const extras = sanitizeExtras(b.extras); if (extras.length) contact.extras = extras;
  applyContactMeta(db, contact, b);
  db.directory.contacts.push(contact); return contact;
}
function patchContact(db, cid, fields, extras, meta) {
  state(db); const c = db.directory.contacts.find(x => x.id === cid); if (!c) throw err('Contact not found', 404);
  if (fields !== undefined) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw err('Invalid fields');
    for (const [k, raw] of Object.entries(fields)) {
      const def = db.variables[k]; if (!def || !def.field) throw err(`Unknown field "${k}"`, 422); const v = validValue(def.type, raw); if (v) c.fields[k] = v; else delete c.fields[k];
      db.directory.conflicts = db.directory.conflicts.filter(x => !(x.contactId === cid && x.field === k))
    }
  }
  if (extras !== undefined) c.extras = sanitizeExtras(extras);
  if (meta !== undefined && meta !== null) {
    if (typeof meta !== 'object' || Array.isArray(meta)) throw err('Invalid contact metadata');
    const m = contactMeta(db, meta);
    for (const k of ['organizationId', 'position', 'comment']) if (k in m) { if (m[k]) c[k] = m[k]; else delete c[k] }
  }
  return c;
}
function removeContact(db, cid) { state(db); const n = db.directory.contacts.length; db.directory.contacts = db.directory.contacts.filter(c => c.id !== cid); if (db.directory.contacts.length === n) throw err('Contact not found', 404); db.directory.conflicts = db.directory.conflicts.filter(x => x.contactId !== cid); return { deleted: cid } }
function resolveConflict(db, cid, value) {
  state(db); const c = db.directory.conflicts.find(x => x.id === cid); if (!c) throw err('Conflict not found', 404);
  const contact = db.directory.contacts.find(x => x.id === c.contactId); if (!contact) { db.directory.conflicts = db.directory.conflicts.filter(x => x !== c); throw err('Contact not found', 404) }
  const def = db.variables[c.field]; const v = validValue(def ? def.type : 'text', value); if (!v) throw err('Value required');
  contact.fields[c.field] = v; db.directory.conflicts = db.directory.conflicts.filter(x => x !== c); return contact;
}
// Нова фирма/институция. Служителите се проверяват предварително, за да няма частично записан запис.
function addOrganization(db, input) {
  state(db); const b = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const name = cleanLine(b.name, 160);
  if (!name) throw err('Organization name is required');
  const kind = orgKind(b.kind);
  if (db.directory.organizations.length >= ORG_MAX) throw err('Too many organizations');
  if (db.directory.organizations.some(o => o.name.toLowerCase() === name.toLowerCase())) throw err('Organization already exists', 409);
  const employees = Array.isArray(b.employees) ? b.employees : [];
  if (employees.length > ORG_EMPLOYEES_MAX) throw err('Too many employees');
  const seen = new Set();
  for (const raw of employees) {
    if (!raw || typeof raw !== 'object') throw err('Invalid employee entry');
    const email = clean(raw.email).toLowerCase();
    if (!CHECK.email(email)) throw err(`Invalid employee email: ${email || '(empty)'}`);
    if (seen.has(email)) throw err(`Duplicate employee email in this organization: ${email}`, 409);
    seen.add(email);
    if (db.directory.contacts.some(c => c.email === email)) throw err(`Contact already exists: ${email}`, 409);
  }
  const now = new Date().toISOString();
  const organization = { id: id(), name, kind, addresses: sanitizeAddresses(b.addresses), extras: sanitizeExtras(b.extras), createdAt: now, updatedAt: now };
  db.directory.organizations.push(organization);
  const created = [];
  for (const raw of employees) created.push(addContact(db, { ...raw, organizationId: organization.id }));
  return { organization, employees: created };
}
function patchOrganization(db, oid, patch) {
  state(db); const o = orgById(db, oid); const b = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  if ('name' in b) {
    const name = cleanLine(b.name, 160);
    if (!name) throw err('Organization name is required');
    if (db.directory.organizations.some(x => x.id !== o.id && x.name.toLowerCase() === name.toLowerCase())) throw err('Organization already exists', 409);
    o.name = name;
  }
  if ('kind' in b) o.kind = orgKind(b.kind);
  if ('addresses' in b) o.addresses = sanitizeAddresses(b.addresses);
  if ('extras' in b) o.extras = sanitizeExtras(b.extras);
  o.updatedAt = new Date().toISOString();
  return o;
}
// Изтриването е fail-closed: със служители се отказва, освен при изрично откачване.
function removeOrganization(db, oid, opts = {}) {
  state(db); const o = orgById(db, oid);
  const employees = db.directory.contacts.filter(c => c.organizationId === o.id);
  if (employees.length && !opts.detach) throw err('Organization still has employees; detach them first', 409);
  if (opts.detach) for (const c of employees) delete c.organizationId;
  db.directory.organizations = db.directory.organizations.filter(x => x.id !== o.id);
  return { deleted: o.id, detached: opts.detach ? employees.length : 0 };
}
const view = db => {
  state(db); return {
    contacts: db.directory.contacts, rules: db.directory.rules, conflicts: db.directory.conflicts,
    organizations: db.directory.organizations.map(o => ({ ...o, employeeCount: db.directory.contacts.filter(c => c.organizationId === o.id).length })),
    fields: fieldKeys(db).map(k => ({ key: k, label: db.variables[k].label, type: db.variables[k].type }))
  }
};
module.exports = {
  TYPES, ORG_KINDS, state, listVariables, addVariable, patchVariable, removeVariable, ingest, addRule, removeRule, addContact, patchContact, removeContact, resolveConflict,
  addOrganization, patchOrganization, removeOrganization, view, sanitizeExtras, sanitizeAddresses
};
