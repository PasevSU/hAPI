'use strict';
// Указател: фирми/институции с адреси и служители (имейл, име, позиция, коментар) под тях.
const { stopChild } = require('./helpers.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-org-'));
  const token = 'directory-org-test-admin-secret-2026-m7', pub = 18342, B = `http://127.0.0.1:${pub}`;
  const child = spawn(process.execPath, [path.join(__dirname, '../hapi_enterprise/server.js')], { env: { ...process.env, DATA_DIR: dir, ADMIN_TOKEN: token, PORT: String(pub) }, stdio: 'pipe' });
  try {
    let ready = false; for (let i = 0; i < 70; i++) { try { if ((await fetch(B + '/health')).ok) { ready = true; break } } catch { } await new Promise(r => setTimeout(r, 70)) }
    assert(ready);
    const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    const call = async (p, m = 'GET', b) => { const r = await fetch(B + p, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, body: await r.json() } };

    // Нов маршрут изисква автентикация
    assert.equal((await fetch(B + '/admin/api/directory/organizations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    let d = (await call('/admin/api/directory')).body;
    assert.deepEqual(d.organizations, []);

    // Валидация: име, вид, имейли, дубликати
    assert.equal((await call('/admin/api/directory/organizations', 'POST', { kind: 'company' })).status, 400);
    assert.equal((await call('/admin/api/directory/organizations', 'POST', { name: '   ' })).status, 400);
    assert.equal((await call('/admin/api/directory/organizations', 'POST', { name: 'A', kind: 'guild' })).status, 400);
    assert.equal((await call('/admin/api/directory/organizations', 'POST', { name: 'A', employees: [{ email: 'bad@@x' }] })).status, 400);
    assert.equal((await call('/admin/api/directory/organizations', 'POST', { name: 'A', employees: [{ email: 'a@b.de' }, { email: 'A@B.de' }] })).status, 409);

    // Фирма с два адреса и двама служители; празният и „само етикет“ адрес отпадат
    const created = await call('/admin/api/directory/organizations', 'POST', {
      name: 'Martinswerk GmbH', kind: 'company',
      addresses: [
        { label: 'Централа', street: 'Hafenweg 12', city: 'Hamm', postal: '59065', country: 'DE' },
        { street: 'Werk 2', city: 'Bönen' },
        { note: '   ' },
        { label: 'склад' }
      ],
      employees: [
        { email: 'Max.Mustermann@martinswerk.de', name: 'Max Mustermann', position: 'Geschäftsführer', comment: 'подписва договори' },
        { email: 'anna@martinswerk.de', position: 'Buchhaltung' }
      ]
    });
    assert.equal(created.status, 201);
    const org = created.body.organization;
    assert.equal(org.kind, 'company'); assert.equal(org.name, 'Martinswerk GmbH');
    assert.equal(org.addresses.length, 2); assert.equal(org.addresses[0].label, 'Централа'); assert.ok(org.addresses[0].id);
    assert.equal(created.body.employees.length, 2);
    const maxId = created.body.employees[0].id;
    assert.equal(created.body.employees[0].organizationId, org.id);
    assert.equal(created.body.employees[0].position, 'Geschäftsführer');
    assert.equal(created.body.employees[0].comment, 'подписва договори');
    assert.equal(created.body.employees[0].email, 'max.mustermann@martinswerk.de');

    // Институция + отказ при вече съществуващ контакт и при повторено име
    const inst = await call('/admin/api/directory/organizations', 'POST', {
      name: 'Stadt Hamm', kind: 'institution',
      addresses: [{ street: 'Rathausplatz 1', city: 'Hamm' }], employees: [{ email: 'post@stadt-hamm.de', position: 'Poststelle' }]
    });
    assert.equal(inst.status, 201); assert.equal(inst.body.organization.kind, 'institution'); assert.equal(inst.body.organization.addresses.length, 1);
    assert.equal((await call('/admin/api/directory/organizations', 'POST', { name: 'martinswerk gmbh' })).status, 409);
    assert.equal((await call('/admin/api/directory/organizations', 'POST', { name: 'Zweite Firma', employees: [{ email: 'anna@martinswerk.de' }] })).status, 409);

    // Изгледът групира служителите под фирмата
    d = (await call('/admin/api/directory')).body;
    const listed = d.organizations.find(o => o.id === org.id);
    assert.equal(listed.employeeCount, 2);
    assert.equal(d.contacts.filter(c => c.organizationId === org.id).length, 2);
    assert.equal(d.organizations.find(o => o.id === inst.body.organization.id).employeeCount, 1);

    // Редакция на фирма: име, вид, адреси (id се запазва при съществуващ адрес)
    const keepId = org.addresses[0].id;
    const patched = await call('/admin/api/directory/organizations/' + org.id, 'PATCH', {
      name: 'Martinswerk GmbH & Co. KG', kind: 'institution',
      addresses: [{ id: keepId, label: 'Централа', street: 'Hafenweg 12', city: 'Hamm' }, { street: 'Neue Straße 5', city: 'Dortmund' }]
    });
    assert.equal(patched.status, 200); assert.equal(patched.body.name, 'Martinswerk GmbH & Co. KG'); assert.equal(patched.body.kind, 'institution');
    assert.equal(patched.body.addresses.length, 2); assert.equal(patched.body.addresses[0].id, keepId);
    assert.equal((await call('/admin/api/directory/organizations/' + org.id, 'PATCH', { name: 'stadt hamm' })).status, 409);
    assert.equal((await call('/admin/api/directory/organizations/' + org.id, 'PATCH', { name: '' })).status, 400);
    assert.equal((await call('/admin/api/directory/organizations/doesnotexist', 'PATCH', { name: 'X' })).status, 404);

    // Служител: позиция/коментар/преместване и откачване
    const moved = await call('/admin/api/directory/contacts/' + maxId, 'PATCH', { position: 'Prokurist', comment: 'само за подпис', organizationId: inst.body.organization.id });
    assert.equal(moved.status, 200); assert.equal(moved.body.position, 'Prokurist'); assert.equal(moved.body.organizationId, inst.body.organization.id);
    assert.equal((await call('/admin/api/directory/contacts/' + maxId, 'PATCH', { organizationId: 'nope' })).status, 422);
    const freed = await call('/admin/api/directory/contacts/' + maxId, 'PATCH', { organizationId: '' });
    assert.equal(freed.status, 200); assert.equal(freed.body.organizationId, undefined);
    await call('/admin/api/directory/contacts/' + maxId, 'PATCH', { organizationId: org.id });

    // Изтриване: със служители се отказва, с detach се откачват
    assert.equal((await call('/admin/api/directory/organizations/' + org.id, 'DELETE')).status, 409);
    const detached = await call('/admin/api/directory/organizations/' + org.id + '?detach=1', 'DELETE');
    assert.equal(detached.status, 200); assert.equal(detached.body.detached, 2);
    d = (await call('/admin/api/directory')).body;
    assert.equal(d.organizations.some(o => o.id === org.id), false);
    assert.equal(d.contacts.filter(c => c.organizationId === org.id).length, 0);
    assert.equal(d.contacts.find(c => c.email === 'anna@martinswerk.de').position, 'Buchhaltung');

    // Съществуващият поток (имейли → правила) работи и след добавяне на организации
    await call('/admin/api/variables/organization', 'PATCH', { value: 'Martinswerk GmbH' });
    await call('/admin/api/directory/rules', 'POST', { pattern: '@other.org', defaults: { organization: 'Other Org' } });
    const ing = await call('/admin/api/directory/ingest', 'POST', { emails: 'info@other.org' });
    assert.deepEqual(ing.body.created, ['info@other.org']);
    assert.equal((await call('/admin/api/directory')).body.contacts.find(c => c.email === 'info@other.org').fields.organization, 'Other Org');
    console.log('directory-organizations OK');
  } finally { await stopChild(child); fs.rmSync(dir, { recursive: true, force: true }) }
})().catch(e => { console.error(e); process.exit(1) });
