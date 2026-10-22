'use strict';
// Логически граници — проверява ДАЛИ РЕШЕНИЯТА СА ВЕРНИ, не дали кодът се компилира.
//
// Всеки блок тук е място, където „работи“ и „работи правилно“ се разминават:
// точно на границата (< срещу <=), при сливане на политики (най-строгото печели),
// при дублирани имена, при изтекъл срок в същата секунда. Тези дефекти не хвърлят
// грешка — те просто разрешават или отказват грешното нещо.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const access = require(path.join(ROOT, 'hapi_enterprise', 'download-access.js'));
const vs = require(path.join(ROOT, 'hapi_enterprise', 'virtual-storage.js'));
const st = require(path.join(ROOT, 'hapi_enterprise', 'storage-tree.js'));
const versioning = require(path.join(ROOT, 'hapi_enterprise', 'versioning.js'));
const rbac = require(path.join(ROOT, 'hapi_enterprise', 'rbac.js'));
const { createAuditChain } = require(path.join(ROOT, 'hapi_enterprise', 'audit-chain.js'));
const lock = require(path.join(ROOT, 'hapi_enterprise', 'instance-lock.js'));

const NOW = new Date('2026-10-20T12:00:00.000Z');
const iso = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();

// ── 1. Сливане на политики: най-строгото печели, включително за роли ────────
{
  const merged = access.merge([
    { mode: 'PRIVATE', roles: ['fin'] },
    { mode: 'PRIVATE', roles: ['hr'] },
  ]);
  assert.deepEqual(merged.roles, [], 'ролите се секат: два слоя с различни роли не дават достъп на никого');
  const denied = access.decide({
    layers: [{ mode: 'PRIVATE', roles: ['fin'] }, { mode: 'PRIVATE', roles: ['hr'] }],
    user: { id: 'u1', roles: ['hr'], permissions: ['files.download'] },
    now: NOW,
  });
  assert.equal(denied.allowed, false, 'роля от единия слой не отваря достъп, ако другият слой не я позволява');

  const allowed = access.decide({
    layers: [{ mode: 'PRIVATE', roles: ['hr'] }, { mode: 'PRIVATE', roles: ['hr'] }],
    user: { id: 'u1', roles: ['hr'], permissions: ['files.download'] },
    now: NOW,
  });
  assert.equal(allowed.allowed, true, 'една и съща роля в двата слоя дава достъп');

  // Слой без роли не ограничава: ролите идват от този, който ги задава.
  assert.deepEqual(access.merge([{ mode: 'FREE' }, { mode: 'PRIVATE', roles: ['hr'] }]).roles, ['hr']);
  // Режимът е максимумът по строгост, независимо от реда.
  assert.equal(access.merge([{ mode: 'FREE' }, { mode: 'DISABLED' }]).mode, 'DISABLED');
  assert.equal(access.merge([{ mode: 'DISABLED' }, { mode: 'FREE' }]).mode, 'DISABLED');
}

// ── 2. Прозорец: невалиден не бива да заключва безшумно цялото денонощие ────
{
  const bad = access.validatePolicy({ window: { from: '22:00', to: '06:00' } });
  assert.equal(bad.ok, false, 'прозорец през полунощ се отказва изрично, вместо да спира достъпа тихо');
  assert.match(bad.errors.join(' '), /преди window\.to/);
  assert.equal(access.validatePolicy({ window: { from: '09:00', to: '17:00' } }).ok, true);

  const broken = access.withinWindow({ window: { from: '22:00', to: '06:00' } }, NOW);
  assert.equal(broken.ok, false);
  assert.equal(broken.reason, 'window-invalid', 'причината е „невалиден прозорец“, не „затворено“');

  const open = access.withinWindow({ window: { from: '09:00', to: '17:00' } }, new Date('2026-10-20T09:00:00'));
  assert.equal(open.ok, true, 'началото на прозореца е включено');
  const closing = access.withinWindow({ window: { from: '09:00', to: '17:00' } }, new Date('2026-10-20T17:00:00'));
  assert.equal(closing.ok, false, 'краят на прозореца е изключен (полуотворен интервал)');
}

// ── 3. Срок и брой използвания: границата е ИЗКЛЮЧВАЩА ──────────────────────
{
  const policy = (extra) => ({ policy: { mode: 'FREE', ...extra } });
  const base = { permission: 'files.download' };
  assert.equal(access.decide({ ...policy({ expires_at: iso(1) }), ...base, now: NOW }).allowed, true, 'срок в бъдеще пуска');
  assert.equal(access.decide({ ...policy({ expires_at: iso(0) }), ...base, now: NOW }).allowed, false, 'срок „сега“ вече е изтекъл');
  assert.equal(access.decide({ ...policy({ expires_at: iso(-1) }), ...base, now: NOW }).allowed, false, 'изтекъл срок отказва');

  // Токен: 3 от 3 използвания = изчерпан; 2 от 3 = активен.
  const token = { uses: 3, max_uses: 3 };
  assert.equal(access.decide({ ...policy({ mode: 'KEY_REQUIRED' }), ...base, token, now: NOW }).allowed, false);
  assert.equal(access.decide({ ...policy({ mode: 'KEY_REQUIRED' }), ...base, token: { uses: 2, max_uses: 3 }, now: NOW }).allowed, true);
  // max_uses = 0 значи „нула използвания“, не „без ограничение“.
  assert.equal(access.decide({ ...policy({ mode: 'KEY_REQUIRED' }), ...base, token: { uses: 0, max_uses: 0 }, now: NOW }).allowed, false);

  // Отчитането не пипа входа и връща нов обект.
  const used = access.useToken({ uses: 1, max_uses: 5 }, NOW);
  assert.equal(used.ok, true);
  assert.equal(used.token.uses, 2);
  assert.equal(used.token.last_used_at, NOW.toISOString());
  assert.equal(access.useToken({ uses: 5, max_uses: 5 }, NOW).ok, false, 'изчерпан токен не се отчита');

  // Глобална забрана и недостъпно хранилище печелят над всичко останало.
  assert.equal(access.decide({ ...policy({}), ...base, now: NOW, system: { allow_downloads: false } }).allowed, false);
  assert.equal(access.decide({ ...policy({}), ...base, now: NOW, storage: { available: false } }).allowed, false);
  // Анонимният посетител има точно четене и изтегляне — и нищо повече.
  assert.equal(access.decide({ ...policy({}), ...base, now: NOW }).allowed, true, 'анонимен посетител сваля свободен файл');
  assert.equal(
    access.decide({ ...policy({}), now: NOW, permission: 'evidence.export' }).reason,
    'permission',
    'анонимният не може да експортира доказателства',
  );
  // Сесия без право за изтегляне се отказва, със право — минава.
  const readOnly = { id: 'u1', roles: [], permissions: ['files.read'] };
  assert.equal(access.decide({ ...policy({}), ...base, now: NOW, user: readOnly }).reason, 'permission');
  assert.equal(access.decide({ ...policy({}), ...base, now: NOW, user: { id: 'u1', roles: [], permissions: ['files.download'] } }).allowed, true);
}

// ── 4. Виртуално хранилище: дублирани имена получават РАЗЛИЧНИ пътища ───────
{
  const files = [
    { id: 'f1', name: 'договор.pdf', topic: 'Тема', size: 10 },
    { id: 'f2', name: 'договор.pdf', topic: 'Тема', size: 20 },
    { id: 'f3', name: 'скрит.pdf', topic: 'Тема', listed: false },
  ];
  const paths = vs.pathsOf(files);
  assert.equal(Object.keys(paths).length, 2, 'скритите файлове не влизат в пътищата');
  assert.notEqual(paths.f1, paths.f2, 'два файла с еднакво име не могат да имат един адрес');
  assert.deepEqual(Object.values(paths).sort(), ['/Тема/договор (2).pdf', '/Тема/договор.pdf']);

  // Всеки върнат път сочи точно към своя файл.
  const tree = vs.buildTree(files);
  for (const id of Object.keys(paths)) {
    const node = vs.resolve(tree, paths[id]);
    assert.ok(node && node.type === 'file', `пътят ${paths[id]} се разрешава`);
    assert.equal(node.id, id, `пътят ${paths[id]} води до ${id}`);
  }

  // Навигацията отказва изход от дървото.
  for (const bad of ['..', '/./Тема', '/Тема/../..', '/Тема//договор.pdf', 'relative/path']) {
    assert.equal(vs.resolve(tree, bad), null, `пътят ${bad} се отказва`);
  }
}

// ── 5. Пътища в хранилището: нормализация и граници ─────────────────────────
{
  assert.equal(st.normRel(''), '');
  assert.equal(st.normRel('/'), '');
  assert.equal(st.normRel('/a/b/'), 'a/b');
  assert.equal(st.normRel('a\\b'), 'a/b', 'обратните наклонени черти се нормализират');
  assert.equal(st.normRel('a//b'), null, 'двойна наклонена черта не се приема');
  assert.equal(st.normRel('../a'), null);
  assert.equal(st.normRel('a/../../b'), null);
  assert.equal(st.normRel('a/./b'), null);
  assert.equal(st.normRel('a\u0000b'), null, 'NUL байт се отказва');
  assert.equal(st.normRel(Array(13).fill('d').join('/')), null, 'твърде дълбок път (13 нива) се отказва');
  assert.equal(st.normRel(Array(12).fill('d').join('/')), Array(12).fill('d').join('/'), '12 нива минават');
  // Водеща наклонена черта се маха — абсолютният път не се приема за относителен.
  assert.equal(st.normRel('/etc/passwd'), 'etc/passwd');
}

// ── 6. Версии: границата на подрязването ────────────────────────────────────
{
  const file = (n) => ({
    version: n,
    size: 1,
    sha256: 'x',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    versions: Array.from({ length: n - 1 }, (_, i) => ({ version: i + 1, size: 1, sha256: 'x', uploadedAt: '2026-01-01T00:00:00.000Z' })),
  });
  assert.equal(versioning.nextVersion({ version: 1 }), 2);
  assert.equal(versioning.nextVersion({}), 2, 'липсваща версия се приема за 1');
  assert.equal(versioning.history(file(1)).length, 1, 'историята винаги съдържа текущата версия');
  assert.equal(versioning.history(file(3)).length, 3);

  const max = versioning.MAX_VERSIONS;
  assert.deepEqual(versioning.pruneTargets(file(max), max), [], 'точно на границата нищо не се реже');
  assert.deepEqual(versioning.pruneTargets(file(max + 1), max), [1], 'една над границата реже най-старата');
  assert.deepEqual(versioning.pruneTargets(file(max + 2), max), [1, 2]);
  // Историята е подредена по версия, дори ако записите са разбъркани.
  const shuffled = { version: 3, size: 1, sha256: 'x', uploadedAt: iso(0), versions: [{ version: 2 }, { version: 1 }] };
  assert.deepEqual(versioning.history(shuffled).map((v) => v.version), [1, 2, 3]);
}

// ── 7. RBAC: непознато право се отказва, администраторът не се заключва ─────
{
  const r = rbac.create({ adminToken: 'a'.repeat(16), viewerToken: 'v'.repeat(16), userRoles: { bob: 'viewer' } });
  assert.equal(r.allowed('admin', 'portals', 'POST'), true, 'администраторът минава винаги');
  assert.equal(r.allowed('viewer', 'portals', 'POST'), false, 'viewer не пише');
  assert.equal(r.allowed('viewer', 'portals', 'GET'), true, 'viewer чете');
  assert.equal(r.allowed('nobody', 'portals', 'GET'), false, 'непозната роля се отказва');
  assert.equal(r.allowed('admin', 'no.such.capability', 'GET'), true, 'администраторът не зависи от таблицата');
  assert.equal(r.allowed('viewer', 'no.such.capability', 'GET'), false, 'непознато право не се разрешава случайно');
  assert.equal(r.allowed('operator', 'no.such.capability', 'GET'), false);
  // Ingress заявка носи идентичност в заглавки; без профил ролята е по подразбиране.
  assert.equal(
    r.resolve({ ingress: true, headers: { 'x-remote-user-name': 'bob' } }),
    'viewer',
    'профилът сваля ролята до viewer',
  );
  assert.equal(r.resolve({ ingress: true, headers: { 'x-remote-user-name': 'непознат' } }), 'admin', 'без профил ролята е по подразбиране');
  assert.equal(r.resolve({ headers: { 'authorization': 'Bearer ' + 'v'.repeat(16) } }), 'viewer', 'токенът дава роля');
  assert.equal(r.resolve({ ingress: true, headers: { 'authorization': 'Bearer ' + 'x'.repeat(16) } }), 'admin', 'невалиден токен не дава права');
}

// ── 8. Одитен ланец: подправка на всеки ред се хваща ───────────────────────
// (async, защото ланецът работи с файлове)
async function chainSection() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-chain-'));
  const chain = createAuditChain(dir);
  assert.deepEqual(await chain.verify(), { valid: true, count: 0, lastHash: '0'.repeat(64) }, 'празен ланец е валиден');

  for (let i = 1; i <= 4; i++) await chain.append('e' + i, { i });
  const ok = await chain.verify();
  assert.equal(ok.valid, true);
  assert.equal(ok.count, 4);

  const file = path.join(dir, 'audit-chain.jsonl');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  // Подправка на първи, среден и последен ред — и трите трябва да се хванат.
  for (const index of [0, 2, 3]) {
    const copy = lines.slice();
    const record = JSON.parse(copy[index]);
    record.event = 'подправено';
    copy[index] = JSON.stringify(record);
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-chain-bad-'));
    fs.writeFileSync(path.join(probe, 'audit-chain.jsonl'), copy.join('\n') + '\n');
    const result = await createAuditChain(probe).verify();
    assert.equal(result.valid, false, `подправка на ред ${index + 1} се хваща`);
    assert.equal(result.reason, 'CHAIN_MISMATCH');
    fs.rmSync(probe, { recursive: true, force: true });
  }
  // Премахнат ред също чупи ланца.
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-chain-gap-'));
  fs.writeFileSync(path.join(probe, 'audit-chain.jsonl'), [lines[0], lines[2], lines[3]].join('\n') + '\n');
  assert.equal((await createAuditChain(probe).verify()).valid, false, 'липсващ ред се хваща');
  fs.rmSync(probe, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 9. Заключване на инстанция: границата на изоставеност ───────────────────
function lockSection() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-lock-'));
  const file = lock.lockPath(dir);

  // Собственик от ДРУГ host: решава само пресният heartbeat, а не pid (pid на друг
  // host не се проверява). Така границата е една и съща на Windows и на Linux —
  // на Linux `/proc/<pid>/stat` различава преизползван pid и тестът би минавал
  // по друга причина, тоест нямаше да проверява границата, която твърди.
  const foreign = (heartbeatAt) =>
    fs.writeFileSync(
      file,
      JSON.stringify({ id: 'remote', pid: 1, host: 'another-container', startedAt: heartbeatAt, heartbeatAt }),
    );

  foreign(new Date(1000).toISOString());
  const fresh = lock.acquire({ dir, id: 'p1', now: 5999, staleMs: 5000 });
  assert.equal(fresh.ok, false, 'сърце на 4 999 ms е още прясно при праг 5 000 ms');
  assert.equal(fresh.reason, 'INSTANCE_LOCKED');

  // Точно на границата (възраст === прага) заключването е изоставено.
  const atBoundary = lock.acquire({ dir, id: 'p2', now: 6000, staleMs: 5000 });
  assert.equal(atBoundary.ok, true, 'на самата граница се поема');
  assert.equal(atBoundary.tookOver, true);
  assert.equal(atBoundary.previous.id, 'remote');
  assert.equal(lock.release(dir, 'p1'), false, 'чужд id не освобождава');

  // Жив собственик на същия host блокира втория.
  const mine = lock.acquire({ dir, id: 'p3' });
  assert.equal(mine.ok, true, 'след поемането заключването е наше');
  const second = lock.acquire({ dir, id: 'p4' });
  assert.equal(second.ok, false, 'втори жив собственик не се допуска');
  assert.equal(second.holder.id, 'p3');
  assert.equal(lock.release(dir, 'p3'), true);
  assert.equal(lock.inspect(dir), null, 'освободеното заключване изчезва');

  fs.rmSync(dir, { recursive: true, force: true });
}

(async () => {
  await chainSection();
  lockSection();
  console.log('PASS logic-boundaries: политики, срокове, пътища, версии, права, ланец и ключалка — на границите');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
