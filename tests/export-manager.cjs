'use strict';
// FD-1: трансферно ядро — state machine, preflight, индекс, проверено копиране.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('../hapi_enterprise/export-manager.js');

async function main() {
  // 1. Състояния и преходи.
  assert.equal(M.STATES.length, 9);
  const job = M.createJob({ mode: 'verified' });
  assert.ok(job.operation_id.startsWith('OP-'));
  assert.equal(job.state, 'QUEUED');
  assert.equal(job.verify_sha256, true);
  assert.equal(job.mode, 'verified');

  const pre = M.transition(job, 'PREFLIGHT');
  assert.equal(pre.ok, true);
  assert.equal(pre.job.state, 'PREFLIGHT');
  assert.equal(job.state, 'QUEUED', 'transition не мутира входа');
  assert.equal(pre.job.timeline.length, 2);
  assert.equal(M.transition(job, 'COMPLETED').ok, false, 'QUEUED→COMPLETED е нелегално');
  assert.equal(M.transition(job, 'NOPE').reason, 'invalid-state');
  const done = M.transition(
    M.transition(M.transition(M.transition(pre.job, 'COPYING').job, 'VERIFYING').job, 'FINALIZING').job,
    'COMPLETED',
  );
  assert.equal(done.ok, true);
  assert.equal(M.transition(done.job, 'FINALIZING').ok, false, 'COMPLETED е терминално');

  // 2. Preflight: празен пакет, липса на място, опасен път, abort при конфликт.
  assert.equal(M.preflight({ config: { mode: 'verified' }, entries: [] }).ok, false);
  const small = M.preflight({
    config: { mode: 'verified' },
    entries: [{ path: 'originals/a.txt', size: 100 }],
    env: { freeBytes: 10 },
  });
  assert.equal(small.ok, false);
  assert.ok(small.blockers.some((c) => c.id === 'space'));

  const traversal = M.preflight({ config: { mode: 'verified' }, entries: [{ path: '../etc/passwd', size: 1 }], env: {} });
  assert.equal(traversal.ok, false);
  assert.ok(traversal.blockers.some((c) => c.id === 'paths'));

  const good = M.preflight({
    config: { mode: 'verified' },
    entries: [{ path: 'originals/a.txt', size: 100 }],
    env: { freeBytes: 1024, exists: [] },
  });
  assert.equal(good.ok, true);
  assert.equal(good.requiredBytes, 100);

  const abort = M.preflight({
    config: { mode: 'verified', onConflict: 'abort' },
    entries: [{ path: 'originals/a.txt', size: 1 }],
    env: { freeBytes: 1024, exists: ['originals/a.txt'] },
  });
  assert.equal(abort.ok, false, 'abort политика спира при съществуващ файл');

  // 3. Индекс: PACKAGE_INDEX.json структура.
  const hash = 'a'.repeat(64);
  const built = M.buildIndex(
    [
      { path: 'report/forensic_report.pdf', size: 10, sha256: hash, kind: 'pdf', source: 'r.pdf', verified: true },
      { path: 'certificates', size: 0, sha256: '', kind: 'folder', source: '', verified: false },
    ],
    { packageId: 'RPT-20261020-174800-CASE001', mode: 'evidence', now: new Date('2026-10-20T17:48:00Z') },
  );
  assert.equal(built.ok, true);
  assert.equal(built.index.schema_version, '1.0');
  assert.equal(built.index.complete, true);
  assert.equal(built.index.created_at, '2026-10-20T17:48:00.000Z');
  assert.equal(built.index.entries[0].path, 'report/forensic_report.pdf');
  assert.equal(built.index.entries[0].verified, true);
  assert.equal(built.index.entries[1].kind, 'folder');
  assert.match(built.index.package_id, /^RPT-\d{8}-\d{6}-[A-Z0-9]{1,24}$/);

  assert.equal(M.buildIndex([{ path: '../x', size: 1, sha256: hash, kind: 'pdf' }], {}).ok, false);
  assert.equal(M.buildIndex([{ path: 'a.pdf', size: 1, sha256: 'bad', kind: 'pdf' }], {}).badHash.length, 1);
  assert.equal(
    M.buildIndex([{ path: 'a.pdf', size: 1, sha256: hash, kind: 'pdf' }], { complete: false }).index.complete,
    false,
  );

  // 4. Одитен запис.
  const audit = M.auditRecord(job, { channel: 'public', portal: 'public-notices', fileId: 'f1' });
  assert.equal(audit.channel, 'public');
  assert.equal(audit.operation_id, job.operation_id);
  assert.equal(audit.event, 'export.failed');
  assert.equal(audit.portal, 'public-notices');

  // 5. Възобновяване: само при проверими частични данни.
  assert.equal(M.resume(null).reason, 'no-job');
  assert.equal(M.resume({ state: 'COMPLETED' }).reason, 'terminal');
  assert.equal(M.resume({ state: 'COPYING' }, { tempExists: false }).reason, 'no-temp');
  assert.equal(M.resume({ state: 'COPYING' }, { tempExists: true, sourceUnchanged: false }).reason, 'source-changed');
  assert.equal(M.resume({ state: 'COPYING' }, { tempExists: true, partialSha256: 'x' }).reason, 'unverifiable');
  assert.equal(
    M.resume({ state: 'COPYING', expected_sha256: hash }, { tempExists: true, partialSha256: hash }).resume,
    true,
  );
  assert.equal(
    M.resume({ state: 'COPYING' }, { tempExists: true, partialSha256: hash, expectedSha256: 'b'.repeat(64) }).reason,
    'hash-mismatch',
  );

  // 6. SHA-256 на текст (известна стойност).
  assert.equal(M.sha256Text('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  // 7. Реално проверено копиране във временна директория.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-export-'));
  try {
    const src = path.join(tmp, 'source.txt');
    fs.writeFileSync(src, 'доказателство-2026', 'utf8');
    const destDir = path.join(tmp, 'dest');

    const first = await M.copyVerified({ src, destDir, name: 'evidence.txt' });
    assert.equal(first.ok, true);
    assert.equal(first.verified, true);
    assert.equal(fs.readFileSync(first.path, 'utf8'), 'доказателство-2026');
    assert.equal(first.sha256, M.sha256Text('доказателство-2026'));
    assert.equal(first.bytes, Buffer.byteLength('доказателство-2026'));
    assert.deepEqual(fs.readdirSync(destDir).filter((f) => f.endsWith('.part')), [], 'не остава временен файл');

    const second = await M.copyVerified({ src, destDir, name: 'evidence.txt' });
    assert.equal(second.name, 'evidence (2).txt', 'колизия → ново уникално име');

    const skipped = await M.copyVerified({ src, destDir, name: 'evidence.txt', onConflict: 'skip' });
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.path, null);

    const aborted = await M.copyVerified({ src, destDir, name: 'evidence.txt', onConflict: 'abort' });
    assert.equal(aborted.ok, false);
    assert.equal(aborted.reason, 'exists');

    const overwritten = await M.copyVerified({ src, destDir, name: 'evidence.txt', overwrite: true });
    assert.equal(overwritten.ok, true);
    assert.equal(fs.readFileSync(overwritten.path, 'utf8'), 'доказателство-2026');

    const missing = await M.copyVerified({ src: path.join(tmp, 'nope.txt'), destDir, name: 'x.txt' });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, 'source-unreadable');

    // 8. Пълен трансфер през state machine.
    const transfer = await M.runTransfer({
      config: { mode: 'verified', contents: ['originals'], verifySha256: true },
      entry: { src, name: 'transfer.txt', size: fs.statSync(src).size },
      destDir: path.join(tmp, 'transfer'),
      env: { freeBytes: 1024 * 1024 },
    });
    assert.equal(transfer.ok, true);
    assert.equal(transfer.job.state, 'COMPLETED');
    assert.equal(transfer.job.verified, true);
    assert.deepEqual(
      transfer.job.timeline.map((t) => t.state),
      ['QUEUED', 'PREFLIGHT', 'COPYING', 'VERIFYING', 'FINALIZING', 'COMPLETED'],
    );
    assert.equal(transfer.job.size, fs.statSync(src).size);
    assert.match(transfer.job.expected_sha256, /^[a-f0-9]{64}$/);

    // 9. Провален трансфер не оставя успешен запис.
    const failed = await M.runTransfer({
      config: { mode: 'verified' },
      entry: { src: path.join(tmp, 'nope.txt'), name: 'x.txt', size: 1 },
      destDir: path.join(tmp, 'failed'),
      env: { freeBytes: 1024 },
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.job.state, 'FAILED');
    assert.ok(['source-unreadable', 'copy-failed'].includes(failed.job.error));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('export-manager OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
