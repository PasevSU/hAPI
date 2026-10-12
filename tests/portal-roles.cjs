'use strict';
const assert = require('node:assert/strict');
const { create } = require('../hapi_enterprise/portal-auth');
const secret = 'portal-roles-secret-'.padEnd(32, 'x');

(async () => {
  const a = create({ secret });
  assert.equal(a.can('judge', 'issue'), true);
  assert.equal(a.can('judge', 'upload'), false);
  assert.equal(a.can('prosecutor', 'upload'), true);
  assert.equal(a.can('prosecutor', 'issue'), false);
  assert.equal(a.can('clerk', 'manage'), true);
  assert.equal(a.can('clerk', 'issue'), false);
  assert.equal(a.can('public', 'read'), false);
  assert.equal(a.can('expert', 'verify'), true);

  const inv = a.issue({ sub: 'inv@police.bg', role: 'investigator', caseIds: ['case-1'] });
  assert.equal(a.authorized(inv, 'read', { caseId: 'case-1' }), true);
  assert.equal(a.authorized(inv, 'read', { caseId: 'case-2' }), false);
  assert.equal(a.authorized(inv, 'manage', { caseId: 'case-1' }), false);

  const proc = a.issue({ sub: 'p@court.bg', role: 'prosecutor' });
  assert.equal(a.authorized(proc, 'upload', { caseId: 'any' }), true);

  console.log('PASS portal-roles: permission matrix + per-case scoping');
})().catch(e => { console.error(e); process.exitCode = 1 });
