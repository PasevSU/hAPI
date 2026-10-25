'use strict';
// ВСИЧКИ ОБЯВЕНИ СЪБИТИЯ СЕ ИЗЛЪЧВАТ — договорът от
// `documentation/04_FUNCTION_SPECIFICATIONS/WEBHOOKS.md`.
//
// Защо съществува: `EVENTS` в `webhooks.js` е ДОГОВОР. Докато кодът викаше `publish(…)` само
// за `document.finalized`, останалите три имена се приемаха при абониране и мълчаха — тоест
// абонаментът беше валиден, а събитието никога не идваше. Този тест пада, ако обявено име
// остане без излъчване, и ако излъчено име липсва в договора.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EVENTS } = require('../hapi_enterprise/webhooks.js');

const ROOT = path.join(__dirname, '..');
const cases = [];
const ok = (label) => cases.push(label);

/** Къде се вика `publish('име'` в кода (без тестовете). */
function emitSites() {
  const found = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'ui', 'tests', 'dist', 'release', 'archive'].includes(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue }
      if (!entry.name.endsWith('.js')) continue;
      const src = fs.readFileSync(abs, 'utf8');
      for (const m of src.matchAll(/\bpublish\(\s*'([a-z][a-z0-9_.]*)'/g)) {
        if (!found.has(m[1])) found.set(m[1], []);
        found.get(m[1]).push(path.relative(ROOT, abs).replace(/\\/g, '/'));
      }
    }
  };
  walk(path.join(ROOT, 'hapi_enterprise'));
  return found;
}

const sites = emitSites();

// ── 1. Всяко ОБЯВЕНО събитие има поне едно място, което го излъчва ─────────
{
  const silent = EVENTS.filter((name) => !sites.has(name));
  assert.deepEqual(silent, [], 'обявени, но НИКОГА не излъчвани събития: ' + silent.join(', '));
  ok('всяко обявено събитие има излъчващ го код (' + EVENTS.length + ' имена)');
}

// ── 2. Всяко ИЗЛЪЧВАНО събитие е в договора ───────────────────────────────
{
  const undeclared = [...sites.keys()].filter((name) => !EVENTS.includes(name) && name !== 'webhook.test');
  assert.deepEqual(undeclared, [], 'излъчвани, но необявени събития: ' + undeclared.join(', '));
  ok('никое излъчвано събитие не е извън договора');
}

// ── 3. Всяко събитие се излъчва от очакваното място (не „някъде“) ─────────
{
  const expected = {
    'document.finalized': ['hapi_enterprise/server.js', 'hapi_enterprise/routes/file-transfer.js'],
    'job.completed': ['hapi_enterprise/server.js'],
    'access.created': ['hapi_enterprise/routes/portal-tokens.js'],
    'report.packaged': ['hapi_enterprise/routes/reports.js'],
  };
  for (const [name, where] of Object.entries(expected)) {
    const got = sites.get(name) || [];
    for (const file of where) {
      assert.ok(got.includes(file), name + ' трябва да се излъчва от ' + file + ', а е от: ' + (got.join(', ') || 'никъде'));
    }
  }
  ok('всяко събитие се излъчва от мястото, което наистина знае какво е станало');
}

// ── 4. Излъчването е СЛЕД записа, не преди ────────────────────────────────
{
  // `job.completed` се вика от `onTerminal`, който `job-manager` вика в `finally` СЛЕД
  // `record(...)`. Ако някой премести извикването преди записа, получателят щеше да види
  // „в ход“ вместо „готово“.
  const manager = fs.readFileSync(path.join(ROOT, 'hapi_enterprise/job-manager.js'), 'utf8');
  const recordAt = manager.indexOf("record(job, { finishedAt: new Date().toISOString() })");
  const notifyAt = manager.indexOf('notify({ id: job.id');
  assert.ok(recordAt > 0 && notifyAt > 0, 'и записът, и известието съществуват');
  assert.ok(notifyAt > recordAt, 'известието идва СЛЕД записа на `finishedAt`');
  ok('job.completed се излъчва след записа, не преди него');
}

// ── 5. Договорът в документа изброява същите имена ────────────────────────
{
  const doc = fs.readFileSync(path.join(ROOT, 'documentation/04_FUNCTION_SPECIFICATIONS/WEBHOOKS.md'), 'utf8');
  for (const name of EVENTS) assert.ok(doc.includes('`' + name + '`'), 'договорът описва ' + name);
  ok('WEBHOOKS.md изброява същите имена като кода');
}

console.log('PASS webhook-events: ' + cases.length + ' проверки — ' + cases.join('; '));
