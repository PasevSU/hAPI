'use strict';
const assert = require('node:assert/strict');
const { create } = require('../hapi_enterprise/portal-auth');
const secret = 'portal-auth-secret-'.padEnd(32, 'x');

(async () => {
  const a = create({ secret });
  const tok = a.issue({ sub: 'judge@court.bg', role: 'judge', caseIds: ['c1', 'c2'], ttlSeconds: 60 });
  const p = a.verify(tok);
  assert.equal(p.sub, 'judge@court.bg');
  assert.equal(p.role, 'judge');
  assert.deepEqual(p.caseIds, ['c1', 'c2']);
  assert.ok(Number.isSafeInteger(p.exp));

  const bad = tok.slice(0, -2) + (tok.endsWith('aa') ? 'bb' : 'aa');
  assert.equal(a.verify(bad), null);

  let t = 0;
  const a2 = create({ secret, now: () => t });
  const t2 = a2.issue({ sub: 'x@y.z', role: 'clerk', ttlSeconds: 60 });
  assert.ok(a2.verify(t2));
  t = 61 * 1000;
  assert.equal(a2.verify(t2), null);

  assert.throws(() => a.issue({ sub: 'x@y.z', role: 'admin' }), /Invalid role/);
  assert.throws(() => create({ secret: 'short' }), /24 characters/);

  console.log('PASS portal-auth: issue/verify/tamper/expiry + validation');
})().catch(e => { console.error(e); process.exitCode = 1 });
