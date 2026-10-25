'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const retention = require('../hapi_enterprise/retention.js');
// §EVIDENCE_NEVER_DELETED, цена: индексът на доказателствата се строи ВЕДНЪЖ за цялото
// прилагане. Вътре в цикъла по файлове това беше O(файлове × ревизии) — при голямо огледало
// десетки хиляди обхождания на манифести, без нито едно да променя резултата.
//
// Тестът брои колко пъти се вика `getQrRegistry` (точно веднъж на извикване на `apply`) и
// проверява, че защитата РАБОТИ и след оптимизацията — иначе „по-бързо“ щеше да значи
// „по-малко сигурно“.
const OLD = new Date(Date.now() - 40 * 86400000).toISOString();
const contentId = require('../hapi_enterprise/content-id.js');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-cost-'));
  try {
    const filesRoot = path.join(dir, 'files');
    const auditPath = path.join(dir, 'audit.jsonl');
    fs.writeFileSync(auditPath, '');

    const portalId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    const PUBLISHED = 7; // индексът в `files`, който съществува и в манифест на ревизия
    const files = [];
    for (let i = 0; i < 300; i++) files.push({ id: 'f' + i, name: 'f' + i + '.txt', uploadedAt: OLD, accessMode: 'FREE', sha256: String(i).padStart(64, 'a'), size: 7 + i });
    // Един от тях е публикуван — той трябва да оцелее.
    const protectedCid = contentId.of({ portalId, sha256: files[PUBLISHED].sha256, size: files[PUBLISHED].size });
    files[PUBLISHED].contentId = protectedCid;
    fs.mkdirSync(path.join(filesRoot, portalId), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(filesRoot, portalId, f.id), 'x');

    // 40 ревизии, всяка с по няколко файла в манифеста — за да има какво да се обхожда.
    const revisions = [];
    for (let i = 0; i < 40; i++) {
      revisions.push({ id: 'QR-' + String(i + 1).padStart(3, '0'), seq: i + 1, archiveId: 'AR-' + i, archivedAt: OLD, manifest: { files: [{ path: 'f' + i + '.txt', content_id: contentId.of({ portalId, sha256: String(i).padStart(64, 'a'), size: 7 + i }), sha256: String(i).padStart(64, 'a') }] } });
    }
    revisions.push({ id: 'QR-041', seq: 41, archiveId: null, archivedAt: null });
    const registry = { [portalId]: { revisions, archives: [] } };

    let calls = 0;
    const r = retention.create({
      filesRoot,
      auditPath,
      getSettings: () => ({ retention: { enabled: true, fileDays: 30, auditDays: null, fileAction: 'delete' } }),
      getQrRegistry: () => { calls++; return registry },
    });

    const portals = [{ id: portalId, files }];
    const out = await r.apply(portals);
    assert.equal(out.applied, true, 'политиката се прилага');

    assert.equal(calls, 1, 'индексът се строи ТОЧНО веднъж за цялото прилагане (беше веднъж на файл): ' + calls);
    assert.ok(out.deleted > 0, 'непубликуваните се трият');
    assert.ok(portals[0].files.some((f) => f.id === 'f' + PUBLISHED), 'публикуваният файл оцелява и след оптимизацията');
    assert.equal(fs.existsSync(path.join(filesRoot, portalId, 'f' + PUBLISHED)), true, 'байтовете му също са на диска');

    console.log('retention-cost OK: индексът се строи веднъж на apply · 300 файла и 41 ревизии · защитата работи');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1) });
