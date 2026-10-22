'use strict';
// ОРАКУЛ: след ВСЕКИ сегмент състоянието е точно това, което очакваме — и след отказ
// състоянието е НЕПРОМЕНЕНО.
//
// Този тест не пита „мина ли“, а сравнява с конкретни стойности: точни полета, точен
// брой, точен код на грешката и точен текст. Отделно проверява АТОМАРНОСТ: неуспешна
// операция не бива да оставя половин запис, а повтореното изтриване не бива да трие
// втори обект.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer } = require('./lib/gui-harness.cjs');

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const clone = (v) => JSON.parse(JSON.stringify(v));
const findPortal = async (server, id) => {
  const list = await server.api('/admin/api/portals');
  return (list.data.portals || []).find((p) => p.id === id) || null;
};

(async () => {
  const server = await startServer();
  try {
    // ── 1. Създаване: точно кои полета и с какви стойности ─────────────────────
    const created = await server.api('/admin/api/portals', 'POST', { slug: 'oracle-life', title: 'Живот на портала' });
    assert.equal(created.status, 201, 'порталът е създаден');
    const portal = created.data;
    assert.match(portal.id, /^[0-9a-f]{24}$/, 'идентификаторът е 24 hex знака');
    assert.equal(portal.slug, 'oracle-life', 'slug е точно подаденият');
    assert.equal(portal.title, 'Живот на портала', 'заглавието е точно подаденото');
    assert.equal(portal.visibility, 'private', 'по подразбиране порталът е ЛИЧЕН, не публичен');
    assert.equal(portal.storage_root, '/share', 'по подразбиране хранилището е /share');
    assert.equal(portal.fileCount, 0, 'нов портал има 0 файла');
    assert.equal(portal.flag, 'none', 'нов портал няма флаг');
    assert.equal(new Date(portal.createdAt).toISOString(), portal.createdAt, 'createdAt е валиден ISO низ');

    // ── 2. Отказ: ДУБЛИКАТ не създава втори портал (атомарност) ────────────────
    const dup = await server.api('/admin/api/portals', 'POST', { slug: 'oracle-life', title: 'Друг' });
    assert.equal(dup.status, 409, 'дубликат на slug се отказва');
    assert.equal(dup.data.error, 'Slug exists', 'точният текст на отказа');
    const afterDup = await server.api('/admin/api/portals');
    assert.equal(afterDup.data.portals.length, 1, 'след отказа има ТОЧНО един портал — няма половин запис');

    // ── 3. Качване: точни имена, размери и отпечатъци; редът е по име ──────────
    const upload = (name, body) => server.authFetch(server.base + '/admin/api/portals/' + portal.id + '/files', {
      method: 'POST',
      headers: { 'x-file-name': name },
      body,
    });
    const a = await (await upload('alpha.txt', 'A')).json();
    const b = await (await upload('beta.txt', 'BB')).json();
    assert.deepEqual([a.name, a.size, a.sha256], ['alpha.txt', 1, sha256(Buffer.from('A'))], 'първият файл: точно име, размер и отпечатък');
    assert.deepEqual([b.name, b.size, b.sha256], ['beta.txt', 2, sha256(Buffer.from('BB'))], 'вторият файл: точно име, размер и отпечатък');
    const list1 = await server.api('/admin/api/portals/' + portal.id + '/files');
    assert.deepEqual(list1.data.files.map((f) => f.name), ['alpha.txt', 'beta.txt'], 'по подразбиране редът е по име');
    assert.equal((await findPortal(server, portal.id)).fileCount, 2, 'порталът отчита ТОЧНО 2 файла');

    // ── 4. Преименуване: сменя се САМО името ───────────────────────────────────
    const renamed = await server.api('/admin/api/portals/' + portal.id + '/files/' + a.id, 'PATCH', { name: 'gamma.txt' });
    assert.equal(renamed.status, 200, 'преименуването минава');
    assert.equal(renamed.data.name, 'gamma.txt', 'новото име е точното');
    assert.equal(renamed.data.sha256, a.sha256, 'отпечатъкът НЕ се променя при преименуване (съдържанието е същото)');
    assert.equal(renamed.data.size, a.size, 'размерът НЕ се променя');
    assert.equal(renamed.data.version, a.version, 'версията НЕ се вдига при преименуване');
    assert.equal(renamed.data.id, a.id, 'идентификаторът остава същият (връзките не се чупят)');
    const list2 = await server.api('/admin/api/portals/' + portal.id + '/files');
    assert.deepEqual(list2.data.files.map((f) => f.name), ['beta.txt', 'gamma.txt'], 'след преименуването редът е по новото име');

    // ── 5. Неуспешна промяна НЕ оставя следа (сравнявам целия запис) ──────────
    const snapshot = clone(await findPortal(server, portal.id));
    const badName = await server.api('/admin/api/portals/' + portal.id + '/files/' + a.id, 'PATCH', { name: '' });
    assert.equal(badName.status, 400, 'празно име се отказва');
    assert.equal(badName.data.error, 'Invalid name', 'точният текст');
    const badVisibility = await server.api('/admin/api/portals/' + portal.id, 'PATCH', { visibility: 'weird' });
    assert.equal(badVisibility.status, 400, 'непозната видимост се отказва');
    assert.equal(badVisibility.data.error, 'Invalid visibility', 'точният текст');
    const badTitle = await server.api('/admin/api/portals/' + portal.id, 'PATCH', { title: '   ' });
    assert.equal(badTitle.status, 400, 'празно заглавие се отказва');
    assert.equal(badTitle.data.error, 'Invalid title', 'точният текст');
    assert.deepEqual(await findPortal(server, portal.id), snapshot, 'след ТРИ отказа порталът е БАЙТ ПО БАЙТ същият (нищо не е наполовина записано)');

    // ── 6. Успешна промяна: сменя се точно едно нещо ──────────────────────────
    const published = await server.api('/admin/api/portals/' + portal.id, 'PATCH', { visibility: 'public' });
    assert.equal(published.status, 200, 'публикуването минава');
    const afterPublish = await findPortal(server, portal.id);
    assert.equal(afterPublish.visibility, 'public', 'видимостта е точно public');
    assert.equal(afterPublish.title, snapshot.title, 'заглавието не е мръднало');
    assert.deepEqual(afterPublish.files.map((f) => f.name), snapshot.files.map((f) => f.name), 'файловете не са мръднали');
    // Връщам я обратно, за да не влияе на следващите проверки.
    await server.api('/admin/api/portals/' + portal.id, 'PATCH', { visibility: 'private' });

    // ── 7. Изтриване: точно един файл, и второто изтриване не трие нищо ───────
    const del = await server.api('/admin/api/portals/' + portal.id + '/files/' + a.id, 'DELETE');
    assert.equal(del.status, 200, 'файлът е изтрит');
    assert.equal(del.data.deleted, a.id, 'отговорът казва КОЙ файл е изтрит');
    const list3 = await server.api('/admin/api/portals/' + portal.id + '/files');
    assert.deepEqual(list3.data.files.map((f) => f.name), ['beta.txt'], 'остана ТОЧНО един файл (другият е непокътнат)');
    assert.equal(list3.data.files[0].sha256, b.sha256, 'останалият файл е със СЪЩИЯ отпечатък');
    assert.equal((await findPortal(server, portal.id)).fileCount, 1, 'броят е 1, не 0 и не 2');
    const delAgain = await server.api('/admin/api/portals/' + portal.id + '/files/' + a.id, 'DELETE');
    assert.equal(delAgain.status, 404, 'повторното изтриване е 404');
    assert.equal(delAgain.data.error, 'File not found', 'точният текст');
    assert.deepEqual((await server.api('/admin/api/portals/' + portal.id + '/files')).data.files.map((f) => f.name), ['beta.txt'], 'повторното изтриване НЕ е изтрило втория файл');

    // ── 8. Потребители: точно полета, без изтичане на хеша ────────────────────
    const user = await server.api('/admin/api/users', 'POST', { username: 'oracle-user', password: 'oracle-pass-123' });
    assert.equal(user.status, 201, 'потребителят е създаден');
    assert.deepEqual(Object.keys(user.data.user).sort(), ['active', 'scopes', 'username'], 'отговорът НЕ връща passwordHash');
    assert.equal(user.data.user.username, 'oracle-user', 'името е точното');
    assert.deepEqual(user.data.user.scopes, ['read', 'download'], 'по подразбиране правата са read+download');
    assert.equal(JSON.stringify(user.data).includes('scrypt$'), false, 'в отговора няма хеш материал');
    const dupUser = await server.api('/admin/api/users', 'POST', { username: 'oracle-user', password: 'oracle-pass-123' });
    assert.equal(dupUser.status, 409, 'дубликат се отказва');
    assert.equal(dupUser.data.error, 'Username exists', 'точният текст');
    const shortPw = await server.api('/admin/api/users', 'POST', { username: 'short-pw', password: '123' });
    assert.equal(shortPw.status, 400, 'къса парола се отказва');
    assert.equal(shortPw.data.error, 'Password must be 8-200 characters', 'точният текст');
    const login = await fetch(server.base + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'oracle-user', password: 'oracle-pass-123' }),
    });
    assert.equal(login.status, 200, 'новият потребител влиза');
    const session = await login.json();
    assert.match(session.token, /^pu_/, 'сесийният токен има познатия префикс');
    assert.deepEqual(session.scopes, ['read', 'download'], 'сесията носи същите права');
    const wrongPw = await fetch(server.base + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'oracle-user', password: 'грешна-парола' }),
    });
    assert.equal(wrongPw.status, 401, 'грешна парола е 401');
    const delUser = await server.api('/admin/api/users/oracle-user', 'DELETE');
    assert.equal(delUser.status, 200, 'потребителят е изтрит');
    const afterDel = await fetch(server.base + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'oracle-user', password: 'oracle-pass-123' }),
    });
    assert.equal(afterDel.status, 401, 'изтрит потребител не влиза дори с вярна парола');

    // ── 9. Променливи: точен обект, точно име на ключ, точно пазене на етикет ──
    const variable = await server.api('/admin/api/variables', 'POST', { key: 'oracle_key', value: 'v1' });
    assert.equal(variable.status, 201, 'променливата е създадена');
    assert.deepEqual(variable.data, { key: 'oracle_key', type: 'text', label: 'oracle_key', value: 'v1', field: false, system: false }, 'обектът е ТОЧНО този (без излишни полета)');
    const dupVar = await server.api('/admin/api/variables', 'POST', { key: 'oracle_key', value: 'v2' });
    assert.equal(dupVar.status, 409, 'дубликат на ключ се отказва');
    assert.equal(dupVar.data.error, 'Variable already exists', 'точният текст');
    const badKey = await server.api('/admin/api/variables', 'POST', { key: '1bad', value: 'x' });
    assert.equal(badKey.status, 400, 'ключ с недопустим формат се отказва');
    assert.equal(badKey.data.error, 'Invalid key: use a-z, 0-9 and _, starting with a letter', 'точният текст');
    const patched = await server.api('/admin/api/variables/oracle_key', 'PATCH', { value: 'v2' });
    assert.equal(patched.status, 200, 'стойността се сменя');
    assert.equal(patched.data.value, 'v2', 'новата стойност е точна');
    assert.equal(patched.data.label, 'oracle_key', 'етикетът НЕ се променя при смяна на стойността');
    const vars = await server.api('/admin/api/variables');
    assert.equal(vars.data.variables.filter((v) => v.key === 'oracle_key').length, 1, 'в списъка има ТОЧНО една такава променлива');

    // ── 10. Групи: две еднакви имена = два РАЗЛИЧНИ записа (документирано) ─────
    // Имената на групите не са уникални по проект (иначе сливането на портали щеше да
    // блокира); важното е, че идентификаторите са различни и нищо не се презаписва.
    const g1 = await server.api('/admin/api/v2/groups', 'POST', { name: 'Oracle група' });
    const g2 = await server.api('/admin/api/v2/groups', 'POST', { name: 'Oracle група' });
    assert.equal(g1.status, 201, 'първата група е създадена');
    assert.equal(g2.status, 201, 'втората група също се създава');
    assert.notEqual(g1.data.id, g2.data.id, 'двете групи имат РАЗЛИЧНИ идентификатори');
    const groups = await server.api('/admin/api/v2/groups');
    assert.equal(groups.data.groups.filter((g) => g.name === 'Oracle група').length, 2, 'и двете се виждат в списъка');

    // ── 11. Крайно състояние: точно каквото очакваме след цялата редица ───────
    const finalPortal = await findPortal(server, portal.id);
    assert.equal(finalPortal.fileCount, 1, 'в портала остана 1 файл');
    assert.deepEqual(finalPortal.files.map((f) => [f.name, f.size, f.sha256]), [['beta.txt', 2, b.sha256]], 'файлът е точно този, с точния отпечатък');
    assert.equal((await server.api('/admin/api/users')).data.users.length, 0, 'не останаха потребители');
    const finalVars = (await server.api('/admin/api/variables')).data.variables;
    assert.equal(finalVars.filter((v) => v.key === 'oracle_key').length, 1, 'променливата е една');
    assert.equal((await server.api('/admin/api/portals')).data.portals.length, 1, 'порталите са точно 1 (без измислени при отказите)');

    console.log(
      'PASS oracle-lifecycle: точни полета при създаване · дубликат/невалидни стойности НЕ променят състоянието · ' +
      'преименуване пази отпечатъка · изтриване веднъж · потребител без изтекъл хеш · променлива с точен обект',
    );
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
