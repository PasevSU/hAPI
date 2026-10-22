'use strict';
// ОРАКУЛ: ВСЯКА ФУНКЦИЯ ВИЖДА ВСИЧКИ ДАННИ (един източник на истина, без частни копия).
//
// Две неща се проверяват:
//   1. СТАТИЧНО (по кода): има точно един слой за данните (`shared-data`) и точно едно място,
//      което обвързва `db` с него; няма втори, тайно зареден екземпляр (`metadataStore.load()`)
//      и няма запис, който да заобикаля транзакцията (`metadataStore.save(`). Ако някой добави
//      частно копие на данните, този тест пада.
//   2. ЖИВО (по поведение): портал може да сочи контакт от картотеката и дело от делата, а
//      заглавието му ползва променлива от променливите — тоест един обект на данните стига до
//      всички слоеве наведнъж, а не слой по слой през отделни копия.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'server.js'), 'utf8');
const count = (re) => (serverSource.match(re) || []).length;

(async () => {
  // ── 1. Един източник на истина (статично) ────────────────────────────────────
  assert.equal(count(/require\('\.\/shared-data'\)/g), 1, 'shared-data се внася точно веднъж');
  assert.equal(count(/bind:\s*\(payload\)\s*=>\s*\{\s*db\s*=\s*payload\s*\}/g), 1, 'има точно едно място, което обвързва db със споделените данни');
  assert.equal(count(/metadataStore\.save\(/g), 0, 'няма запис, който да заобикаля транзакцията');
  assert.equal(count(/metadataStore\.load\(/g), 0, 'няма частно зареждане на данните извън слоя');
  assert.equal(count(/metadataStore\.restoreFrom\(/g), 1, 'възстановяването от архив е единственото изключение');
  // `db` се присвоява само при създаването си и от `bind` — никъде другаде.
  assert.equal(count(/[{;\s]db = (?!payload)/g), 1, 'db се присвоява само веднъж (при създаването)');

  // ── 2. Живо: един обект на данните стига до всички слоеве ───────────────────
  const server = await startServer();
  try {
    const contact = await server.api('/admin/api/directory/contacts', 'POST', { email: 'ivan@example.org', name: 'Иван Петров', organization: 'Община Тест' });
    assert.equal(contact.status, 201, 'контактът е създаден в картотеката');
    const caseItem = await server.api('/admin/api/cases', 'POST', { number: '2026-77', title: 'Дело за проверка' });
    assert.equal(caseItem.status, 201, 'делото е създадено в делата');
    const variable = await server.api('/admin/api/variables', 'POST', { key: 'organizacia', type: 'text', label: 'Организация', value: 'Община Тест' });
    assert.equal(variable.status, 201, 'променливата е създадена в променливите');

    const portal = await server.api('/admin/api/portals', 'POST', {
      slug: 'vsichki-danni',
      title: 'Договор за {{organizacia}}',
      visibility: 'public',
      contactId: contact.data.id,
      caseId: caseItem.data.id,
    });
    assert.equal(portal.status, 201, 'порталът приема връзки към ДРУГИ слоеве (контакт и дело)');
    assert.equal(portal.data.contactId, contact.data.id, 'връзката към контакта е записана');
    assert.equal(portal.data.caseId, caseItem.data.id, 'връзката към делото е записана');

    // Публичният изглед се строи от ТРИ различни слоя наведнъж: портали, картотека, променливи.
    const publicView = await (await fetch(server.base + '/api/v1/p/vsichki-danni')).json();
    assert.equal(publicView.contact.name, 'Иван Петров', 'публичният изглед вижда контакта от картотеката');
    assert.equal(publicView.contact.organization, 'Община Тест', 'и организацията му');
    assert.equal(publicView.title, 'Договор за Община Тест', 'заглавието е интерполирано с променливата (трети слой)');

    // Връзка към несъществуващ запис се отказва — значи проверката наистина чете другия слой.
    const badContact = await server.api('/admin/api/portals', 'POST', { slug: 'losha', title: 'Лоша', contactId: 'няма-такъв' });
    assert.equal(badContact.status, 400, 'несъществуващ контакт се отказва');
    assert.equal(badContact.data.error, 'Unknown contact', 'с точния текст на отказа');
    const badCase = await server.api('/admin/api/portals', 'POST', { slug: 'losha2', title: 'Лоша', caseId: 'няма-такова' });
    assert.equal(badCase.status, 400, 'несъществуващо дело се отказва');
    assert.equal(badCase.data.error, 'Unknown case', 'с точния текст на отказа');

    // Промяна в един слой веднага се вижда в изгледа, който се строи от друг слой.
    const patched = await server.api('/admin/api/variables/organizacia', 'PATCH', { value: 'Община Нова' });
    assert.equal(patched.status, 200, 'променливата е сменена');
    const afterPatch = await (await fetch(server.base + '/api/v1/p/vsichki-danni')).json();
    assert.equal(afterPatch.title, 'Договор за Община Нова', 'порталът вече показва новата стойност, без рестарт');

    // Изтриване в един слой също се вижда: контактът изчезва от публичния изглед.
    const removed = await server.api('/admin/api/directory/contacts/' + contact.data.id, 'DELETE');
    assert.equal(removed.status, 200, 'контактът е изтрит');
    const afterDelete = await (await fetch(server.base + '/api/v1/p/vsichki-danni')).json();
    assert.equal(afterDelete.contact, null, 'публичният изглед вече не показва изтрития контакт');

    // Данните на всички слоеве живеят в ЕДНА база — проверяваме ги на диска заедно.
    const snapshot = JSON.parse(fs.readFileSync(path.join(server.dir, 'db.json'), 'utf8'));
    assert.ok(Array.isArray(snapshot.portals) && snapshot.portals.length === 1, 'базата пази порталите');
    assert.ok(Array.isArray(snapshot.cases) && snapshot.cases.length === 1, 'базата пази делата');
    assert.ok(snapshot.variables && snapshot.variables.organizacia && snapshot.variables.organizacia.value === 'Община Нова', 'базата пази променливите');
    assert.ok(snapshot.directory && Array.isArray(snapshot.directory.contacts), 'базата пази картотеката');

    console.log('PASS shared-data-access: един слой за данните (без частни копия и без записи извън транзакцията) · портал сочи контакт и дело · заглавие се строи от променлива · промяна и изтриване в един слой веднага се виждат в другия');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
