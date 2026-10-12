'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { create } = require('../hapi_enterprise/migration-pipeline');

(async () => {
  const m = create();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-mig-pre-'));

  try {
    // 1. missing source -> fail-closed
    const missing = await m.preflight({ source: path.join(tmp, 'nope'), destination: path.join(tmp, 'dst') });
    assert.equal(missing.ok, false);
    assert.ok(missing.blockers.some(b => b.includes('Source does not exist')));

    // 2. source is a file, not a directory
    const file = path.join(tmp, 'plain.txt');
    fs.writeFileSync(file, 'x');
    const notDir = await m.preflight({ source: file, destination: path.join(tmp, 'dst') });
    assert.equal(notDir.ok, false);
    assert.ok(notDir.blockers.some(b => b.includes('real directory')));

    // 3. source nested inside destination -> refused
    const src = path.join(tmp, 'src'); fs.mkdirSync(src);
    const nested = await m.preflight({ source: src, destination: tmp });
    assert.equal(nested.ok, false);
    assert.ok(nested.blockers.some(b => b.includes('nested')));

    // 4. destination parent missing -> refused
    const noParent = await m.preflight({ source: src, destination: path.join(tmp, 'ghost', 'dst') });
    assert.equal(noParent.ok, false);
    assert.ok(noParent.blockers.some(b => b.includes('Destination parent')));

    // 5. valid source + valid destination -> ok
    fs.writeFileSync(path.join(src, 'a.txt'), 'hello');
    const ok = await m.preflight({ source: src, destination: path.join(tmp, 'dst'), minFreeMb: 0 });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.blockers, []);

    // 6. symlink source refused (skip if the platform cannot create symlinks)
    const real = path.join(tmp, 'real'); fs.mkdirSync(real);
    const link = path.join(tmp, 'link');
    let canSymlink = true;
    try { fs.symlinkSync(real, link, 'dir'); } catch (e) { canSymlink = false; }
    if (canSymlink) {
      const sym = await m.preflight({ source: link, destination: path.join(tmp, 'dst2') });
      assert.equal(sym.ok, false);
      assert.ok(sym.blockers.some(b => b.includes('real directory')));
    }

    console.log('PASS migrate-preflight: missing source, file source, nested, missing parent, valid, symlink refusal');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1 });
