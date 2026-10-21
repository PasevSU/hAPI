'use strict';
// FD-0: политики за достъп — йерархия, сливане, токени, решение, артефакти.
const assert = require('node:assert/strict');
const A = require('../hapi_enterprise/download-access.js');

// 1. Пет режима, подредени по строгост.
assert.deepEqual(A.MODES.map((m) => m.id), ['FREE', 'KEY_REQUIRED', 'AUTHENTICATED', 'PRIVATE', 'DISABLED']);
assert.deepEqual(A.LEVELS, ['system', 'storage', 'portal', 'folder', 'file', 'user', 'token', 'session']);

// 2. Сливане: най-строгата политика печели, независимо от реда.
assert.equal(A.merge([{ mode: 'FREE' }, { mode: 'KEY_REQUIRED' }]).mode, 'KEY_REQUIRED');
assert.equal(A.merge([{ mode: 'KEY_REQUIRED' }, { mode: 'FREE' }]).mode, 'KEY_REQUIRED');
assert.equal(A.merge([{ mode: 'PRIVATE', roles: ['admin'] }, { mode: 'DISABLED' }]).mode, 'DISABLED');
assert.equal(A.merge([]).mode, 'FREE');

// 3. Числови ограничения: минимум; парола/проверка/одит: всяко „да“ печели.
const merged = A.merge([
  { mode: 'KEY_REQUIRED', max_downloads: 10, concurrency: 4, rate_per_hour: 100 },
  { mode: 'FREE', max_downloads: 3, concurrency: 1, password: true, audit: false },
]);
assert.equal(merged.max_downloads, 3);
assert.equal(merged.concurrency, 1);
assert.equal(merged.rate_per_hour, 100);
assert.equal(merged.password, true);

// 4. Най-ранният срок печели.
const exp = A.merge([
  { expires_at: '2026-12-31T00:00:00.000Z' },
  { expires_at: '2026-11-01T00:00:00.000Z' },
]);
assert.equal(exp.expires_at, '2026-11-01T00:00:00.000Z');

// 5. Прозорци: пресичане; празно пресичане = отказ.
const win = A.merge([{ window: { from: '08:00', to: '18:00' } }, { window: { from: '10:00', to: '16:00' } }]);
assert.deepEqual({ from: win.window.from, to: win.window.to }, { from: '10:00', to: '16:00' });
const emptyWin = A.merge([{ window: { from: '08:00', to: '12:00' } }, { window: { from: '13:00', to: '18:00' } }]);
assert.equal(emptyWin.window.empty, true);
assert.equal(A.withinWindow(emptyWin, new Date('2026-10-20T10:00:00')).ok, false);
assert.equal(A.withinWindow(win, new Date('2026-10-20T12:00:00')).ok, true);
assert.equal(A.withinWindow(win, new Date('2026-10-20T19:00:00')).reason, 'window-closed');

// 6. IP: denylist печели, allowlist ограничава.
const ipPol = A.normalizePolicy({ ip: { allow: ['10.0.0.5'], deny: ['10.0.0.9'] } });
assert.equal(A.ipAllowed(ipPol, '10.0.0.5').ok, true);
assert.equal(A.ipAllowed(ipPol, '10.0.0.6').reason, 'ip-not-allowed');
assert.equal(A.ipAllowed(A.normalizePolicy({ ip: { deny: ['10.0.0.9'] } }), '10.0.0.9').reason, 'ip-denied');

// 7. Токени: състояния и атомарно отчитане без мутация.
const now = new Date('2026-10-20T12:00:00Z');
assert.equal(A.tokenState(null, now), 'missing');
assert.equal(A.tokenState({ expires_at: '2026-10-21T00:00:00Z' }, now), 'active');
assert.equal(A.tokenState({ expires_at: '2026-10-19T00:00:00Z' }, now), 'expired');
assert.equal(A.tokenState({ revoked: true }, now), 'revoked');
assert.equal(A.tokenState({ max_uses: 2, uses: 2 }, now), 'exhausted');
assert.equal(A.tokenState({ not_before: '2026-10-21T00:00:00Z' }, now), 'not_started');

const original = { id: 't1', max_uses: 2, uses: 0 };
const used = A.useToken(original, now);
assert.equal(used.ok, true);
assert.equal(used.token.uses, 1);
assert.equal(original.uses, 0, 'useToken не мутира входа');
assert.equal(A.useToken({ id: 't1', max_uses: 1, uses: 1 }, now).ok, false);
assert.equal(A.revokeToken(original).revoked, true);

// 8. Видимост × достъпност (матрицата от спецификацията).
assert.deepEqual(
  ['public:FREE', 'public:KEY_REQUIRED', 'hidden:KEY_REQUIRED', 'hidden:DISABLED', 'public:DISABLED'].map((k) => {
    const [vis, mode] = k.split(':');
    const b = A.behaviour(vis, mode);
    return `${Number(b.listed)}/${Number(b.downloadable)}`;
  }),
  ['1/1', '1/1', '0/1', '0/0', '1/0'],
);
assert.equal(A.behaviour('public', 'KEY_REQUIRED').requiresKey, true);
assert.equal(A.behaviour('hidden', 'PRIVATE').requiresRole, true);

// 9. Решение: всеки отказ има точна причина.
const base = { now, permission: 'files.download' };
const anon = { id: '', roles: [], permissions: [] };
const admin = { id: 'u1', roles: ['admin'], permissions: ['files.read', 'files.download', 'reports.export', 'evidence.export'] };

assert.equal(A.decide({ ...base, policy: { mode: 'FREE' }, user: anon }).allowed, true);
assert.equal(A.decide({ ...base, policy: { mode: 'FREE' }, user: anon, system: { allow_downloads: false } }).reason, 'system-allow');
assert.equal(A.decide({ ...base, policy: { mode: 'DISABLED' }, user: admin }).reason, 'mode-enabled');
assert.equal(A.decide({ ...base, policy: { mode: 'FREE' }, user: anon, storage: { available: false } }).reason, 'storage-available');
assert.equal(A.decide({ ...base, policy: { mode: 'FREE' }, user: anon, permission: 'evidence.export' }).reason, 'permission');
assert.equal(A.decide({ ...base, policy: { mode: 'KEY_REQUIRED' }, user: anon }).reason, 'token-active');
assert.equal(
  A.decide({ ...base, policy: { mode: 'KEY_REQUIRED' }, user: anon, token: { id: 't', uses: 0, max_uses: 5, expires_at: '2026-10-21T00:00:00Z' } }).allowed,
  true,
);
assert.equal(A.decide({ ...base, policy: { mode: 'AUTHENTICATED' }, user: anon }).reason, 'authenticated');
assert.equal(A.decide({ ...base, policy: { mode: 'AUTHENTICATED' }, user: admin }).allowed, true);
assert.equal(A.decide({ ...base, policy: { mode: 'PRIVATE', roles: ['judge'] }, user: admin }).reason, 'role');
assert.equal(A.decide({ ...base, policy: { mode: 'PRIVATE', roles: ['admin'] }, user: admin }).allowed, true);
assert.equal(A.decide({ ...base, policy: { mode: 'FREE', expires_at: '2026-10-19T00:00:00Z' }, user: anon }).reason, 'expiry');
assert.equal(A.decide({ ...base, policy: { mode: 'FREE', max_downloads: 2 }, user: anon, token: { uses: 2 } }).reason, 'quota');
assert.equal(A.decide({ ...base, policy: { mode: 'FREE', one_time: true }, user: anon, token: { uses: 1 } }).reason, 'quota');
assert.equal(A.decide({ ...base, policy: { mode: 'FREE', rate_per_hour: 5 }, user: anon, session: { downloadsThisHour: 5 } }).reason, 'rate');
assert.equal(A.decide({ ...base, policy: { mode: 'FREE', concurrency: 2 }, user: anon, session: { concurrent: 2 } }).reason, 'concurrency');
assert.equal(A.decide({ ...base, policy: { mode: 'FREE', password: true }, user: anon }).reason, 'password');
assert.equal(A.decide({ ...base, policy: { mode: 'FREE', password: true }, user: anon, passwordOk: true }).allowed, true);

// 10. Всяко решение носи пълния списък проверки.
const decision = A.decide({ ...base, policy: { mode: 'KEY_REQUIRED' }, user: anon });
assert.ok(decision.checks.length >= 8);
assert.ok(decision.checks.every((c) => typeof c.id === 'string' && typeof c.ok === 'boolean'));

// 11. Състояния за GUI.
assert.equal(A.stateOf({ mode: 'DISABLED' }, {}), 'disabled');
assert.equal(A.stateOf({ mode: 'FREE' }, {}), 'public');
assert.equal(A.stateOf({ mode: 'KEY_REQUIRED' }, {}), 'key');
assert.equal(A.stateOf({ mode: 'PRIVATE' }, {}), 'restricted');
assert.equal(A.stateOf({ mode: 'FREE', expires_at: '2020-01-01T00:00:00Z' }, { now }), 'expired');
assert.equal(A.stateOf({ mode: 'KEY_REQUIRED' }, { token: { revoked: true }, now }), 'revoked');
assert.equal(A.stateOf({ mode: 'KEY_REQUIRED', max_downloads: 1 }, { token: { uses: 1 }, now }), 'exhausted');

// 12. Валидация.
assert.equal(A.validatePolicy({ mode: 'PRIVATE', roles: [] }).ok, false);
assert.equal(A.validatePolicy({ mode: 'PRIVATE', roles: ['admin'] }).ok, true);
assert.equal(A.validatePolicy({ mode: 'FREE', window: { from: '25:00', to: '18:00' } }).ok, false);
assert.equal(A.validatePolicy({ mode: 'NOPE' }).ok, false);
assert.equal(A.validatePolicy({ mode: 'FREE', max_downloads: 0 }).ok, false);

// 13. Report Studio артефакти: непроверен PDF не е удостоверен.
assert.equal(A.artifactAccess({ kind: 'draft-pdf' }).status, 'DRAFT');
assert.equal(A.artifactAccess({ kind: 'final-pdf', verified: false }).blocked, true);
assert.equal(A.artifactAccess({ kind: 'final-pdf', verified: false }).status, 'INCOMPLETE');
assert.equal(A.artifactAccess({ kind: 'final-pdf', verified: true }).status, 'READY');
assert.equal(A.artifactAccess({ kind: 'tsa-token', hasStart: true, hasStop: false }).blocked, true);
assert.equal(A.artifactAccess({ kind: 'evidence-package', verified: true, hasStart: true, hasStop: true }).status, 'READY');
assert.equal(A.artifactAccess({ kind: 'evidence-package', verified: true, hasStart: true, hasStop: false }).status, 'INCOMPLETE');
assert.equal(A.artifactAccess({ kind: 'originals' }).permission, 'evidence.export');
assert.equal(A.artifactAccess({ kind: 'nope' }).blocked, true);

console.log('download-access OK');
