'use strict';
// Договор на директорията: променливи, правила за домейни, контакти, конфликти, организации, адреси.
// Всяка проверка твърди ОЧАКВАН РЕЗУЛТАТ — стойност, брой, статус на грешката. Правилото на файла:
// и 13-те изнасяни функции имат поне по едно твърдение за успешен и едно за отказващ вход.
const assert = require('node:assert/strict');
const D = require('../hapi_enterprise/directory');
const db = () => ({ variables: {}, directory: undefined });

// Очаквана грешка: съобщение (част от него) и HTTP статус, който сървърът връща.
const throws = (fn, re, status, label) => {
  assert.throws(fn, (e) => {
    assert.match(e.message, re, label + ' · съобщение: ' + e.message);
    assert.equal(e.status, status, label + ' · статус: ' + e.status);
    return true;
  }, label);
};

// ── A. Променливи ─────────────────────────────────────────────────────────────
{
  const d = db();
  const seeded = D.listVariables(d);
  assert.equal(seeded.length, 10, 'A01 при първо докосване се засаждат точно 10 системни променливи');
  assert.equal(seeded.every((v) => v.system === true), true, 'A02 засадените са системни');
  assert.deepEqual(seeded.map((v) => v.key).slice(0, 3), ['name', 'organization', 'department'], 'A03 редът на засаждането е стабилен');
  const v = D.addVariable(d, { key: '  Client_Code ', type: 'text', value: '  abc  ' });
  assert.equal(v.key, 'client_code', 'A04 ключът се нормализира до долен регистър');
  assert.equal(v.value, 'abc', 'A05 стойността се подрязва');
  assert.equal(v.label, 'client_code', 'A06 без етикет се ползва ключът');
  assert.equal(v.system, false, 'A07 новата променлива не е системна');
  assert.equal(D.addVariable(d, { key: 'mail', type: 'email', value: 'A@B.BG' }).value, 'a@b.bg', 'A08 имейл стойността се сваля до долен регистър');
  throws(() => D.addVariable(d, { key: '1bad' }), /Invalid key/, 400, 'A09 ключ с цифра отпред → 400');
  throws(() => D.addVariable(d, { key: 'ok', type: 'nope' }), /Unknown type/, 400, 'A10 непознат тип → 400');
  throws(() => D.addVariable(d, { key: 'ok', value: 'x', type: 'number' }), /Invalid number/, 400, 'A11 невалидна стойност за типа → 400');
  throws(() => D.addVariable(d, { key: 'name' }), /already exists/, 409, 'A12 съществуващ ключ → 409');
  assert.equal(D.patchVariable(d, 'client_code', { value: 'xyz' }).value, 'xyz', 'A13 смяната на стойност минава');
  assert.equal(D.patchVariable(d, 'client_code', { label: 'Код' }).label, 'Код', 'A14 етикетът на потребителска променлива се сменя');
  assert.equal(D.patchVariable(d, 'name', { label: 'Друго' }).label, 'Име', 'A15 етикетът на системна променлива НЕ се сменя');
  throws(() => D.patchVariable(d, 'nope', {}), /not found/, 404, 'A16 непознат ключ → 404');
  assert.deepEqual(D.removeVariable(d, 'client_code'), { deleted: 'client_code' }, 'A17 изтриването връща изтрития ключ');
  throws(() => D.removeVariable(d, 'name'), /System variables/, 409, 'A18 системна променлива не се трие → 409');
  throws(() => D.removeVariable(d, 'client_code'), /not found/, 404, 'A19 повторно изтриване → 404');
  D.addVariable(d, { key: 'client_code', field: true });
  D.addRule(d, { pattern: '@used.test', defaults: { client_code: 'zzz' } });
  throws(() => D.removeVariable(d, 'client_code'), /used by a domain rule/, 409, 'A20 използвана от правило променлива не се трие → 409');
  D.addVariable(d, { key: 'not_a_field' });
  throws(() => D.addRule(d, { pattern: '@fieldless.test', defaults: { not_a_field: 'v' } }), /Create it first as a field variable/, 422, 'A21 подразбиране за променлива без „поле“ → 422');
}

// ── B. Правила за домейни ────────────────────────────────────────────────────
{
  const d = db();
  D.state(d);
  const r = D.addRule(d, { pattern: 'Example.BG', defaults: { name: 'Фирма' } });
  assert.equal(r.rule.pattern, '@example.bg', 'B01 шаблонът се нормализира с „@“ и долен регистър');
  assert.deepEqual(r.rule.defaults, { name: 'Фирма' }, 'B02 подразбиранията се пазят');
  assert.equal(r.applied, 0, 'B03 без контакти правилото не пипа никого');
  assert.equal(r.conflicts, 0, 'B04 …и не поражда конфликт');
  throws(() => D.addRule(d, { pattern: 'example.bg' }), /already exists/, 409, 'B05 същият домейн повторно → 409');
  throws(() => D.addRule(d, { pattern: 'not a domain' }), /Invalid domain pattern/, 400, 'B06 невалиден домейн → 400');
  throws(() => D.addRule(d, { pattern: '@x.bg', defaults: { unknown_field: 'v' } }), /Unknown field/, 422, 'B07 подразбиране за несъществуващо поле → 422');
  D.addContact(d, { email: 'ivan@example.bg', fields: { name: 'Иван' } });
  D.addContact(d, { email: 'vasil@sales.test', fields: { name: 'Vasil' } });
  const applied = D.addRule(d, { pattern: '@sales.test', defaults: { department: 'Продажби' } });
  assert.equal(applied.applied, 1, 'B08 новото правило пипа съществуващия контакт');
  assert.equal(applied.conflicts, 0, 'B09 празно поле се пълни без конфликт');
  assert.equal(d.directory.contacts.find((c) => c.email === 'vasil@sales.test').fields.department, 'Продажби', 'B09б стойността се записва в контакта');
  D.addContact(d, { email: 'petar@shop.example.bg', fields: { name: 'Петър' } });
  assert.equal(D.addRule(d, { pattern: '@shop.example.bg', defaults: { name: 'Друго име' } }).conflicts, 1, 'B10 различно подразбиране за заето поле → конфликт, не презапис');
  assert.equal(d.directory.conflicts.length, 1, 'B11 конфликтът влиза в опашката');
  const rid = d.directory.rules[0].id;
  assert.deepEqual(D.removeRule(d, rid), { deleted: rid }, 'B12 изтриването връща ид на премахнатото правило');
  assert.equal(d.directory.rules.some((r) => r.id === rid), false, 'B12б правилото го няма в списъка');
  throws(() => D.removeRule(d, 'nope'), /Rule not found/, 404, 'B13 непознато правило → 404');
}

// ── C. Контакти и конфликти ──────────────────────────────────────────────────
{
  const d = db();
  D.state(d);
  throws(() => D.addContact(d, { email: 'не-имейл' }), /Invalid email/, 400, 'C01 невалиден имейл → 400');
  const c = D.addContact(d, { email: '  Maria.Petrova@Example.BG ' });
  assert.equal(c.email, 'maria.petrova@example.bg', 'C02 имейлът се подрязва и сваля до долен регистър');
  assert.equal(c.fields.name, 'Maria Petrova', 'C03 името се гадае от адреса');
  assert.match(c.id, /^[0-9a-f]{16}$/, 'C04 идентификаторът е 16 hex знака');
  throws(() => D.addContact(d, { email: 'MARIA.PETROVA@example.bg' }), /already exists/, 409, 'C05 дубликат по регистър → 409');
  const tpl = D.addContact(d, { email: '{{client_code}}@firma.bg' });
  assert.equal(tpl.email, '{{client_code}}@firma.bg', 'C06 шаблон с плейсхолдър се приема');
  throws(() => D.addContact(d, { email: '{{x}}@' }), /Invalid email/, 400, 'C07 шаблон, който не става имейл → 400');
  const filled = D.addContact(d, { email: 'office@firma2.bg', fields: { name: 'Ръчно', phone: '+359 2 123 456', unknown: 'x' } });
  assert.equal(filled.fields.name, 'Ръчно', 'C08 подаденото име има приоритет пред гадането');
  assert.equal(filled.fields.unknown, undefined, 'C09 непознато поле не се записва');
  assert.equal(D.addContact(d, { email: 'info@firma3.bg' }).fields.name, undefined, 'C10 служебен адрес не дава име');
  throws(() => D.addContact(d, { email: 'a@b.bg', organizationId: 'missing' }), /Organization not found/, 422, 'C11 непозната организация → 422');

  const withOrg = D.addContact(d, { email: 'p@q.bg', position: 'Шеф', comment: '  важен  ' });
  assert.equal(withOrg.position, 'Шеф', 'C12 позицията се записва');
  assert.equal(withOrg.comment, 'важен', 'C13 коментарът се подрязва');

  assert.equal(D.patchContact(d, c.id, { name: 'Мария' }).fields.name, 'Мария', 'C14 смяната на поле минава');
  throws(() => D.patchContact(d, 'nope', {}), /Contact not found/, 404, 'C15 непознат контакт → 404');
  throws(() => D.patchContact(d, c.id, { unknown: 'x' }), /Unknown field/, 422, 'C16 непознато поле → 422');
  assert.equal(D.patchContact(d, c.id, { name: '' }).fields.name, undefined, 'C17 празна стойност трие полето');
  assert.deepEqual(D.patchContact(d, c.id, undefined, [{ key: 'x', value: 'y' }]).extras, [{ key: 'x', value: 'y' }], 'C18 допълнителните полета се сменят');
  assert.equal(D.patchContact(d, withOrg.id, undefined, undefined, { position: '' }).position, undefined, 'C19 празна позиция трие полето');

  const rule = D.addRule(d, { pattern: '@conf.test', defaults: { department: 'ИТ' } });
  const conf = D.addContact(d, { email: 'k@conf.test' });
  D.ingest(d, ['k@conf.test']);
  assert.equal(conf.fields.department, 'ИТ', 'C20 правилото пълни празно поле без конфликт');
  assert.equal(d.directory.conflicts.length, 0, 'C21 …тоест опашката е празна');
  D.patchContact(d, conf.id, { department: 'Друго' });
  D.addRule(d, { pattern: '@conf2.test', defaults: { department: 'ИТ' } });
  const c2 = D.addContact(d, { email: 'k@conf2.test', fields: { department: 'Финанси' } });
  D.ingest(d, ['k@conf2.test']);
  assert.equal(d.directory.conflicts.length, 1, 'C22 разминаване при повторен внос → конфликт');
  const conflict = d.directory.conflicts[0];
  assert.equal(conflict.contactId, c2.id, 'C23 конфликтът сочи контакта');
  assert.deepEqual(conflict.candidates.map((x) => x.value), ['Финанси', 'ИТ'], 'C24 кандидатите носят текущото и предложеното');
  throws(() => D.resolveConflict(d, 'nope', 'x'), /Conflict not found/, 404, 'C25 непознат конфликт → 404');
  throws(() => D.resolveConflict(d, conflict.id, '   '), /Value required/, 400, 'C26 празна стойност → 400');
  assert.equal(D.resolveConflict(d, conflict.id, 'ИТ').fields.department, 'ИТ', 'C27 решаването записва избраната стойност');
  assert.equal(d.directory.conflicts.length, 0, 'C28 …и маха конфликта от опашката');
  assert.deepEqual(D.removeContact(d, c.id), { deleted: c.id }, 'C29 изтриването връща ид');
  throws(() => D.removeContact(d, c.id), /Contact not found/, 404, 'C30 повторно изтриване → 404');
  assert.equal(rule.rule.pattern, '@conf.test', 'C31 правилото остава след изтриването на контакта');
}

// ── D. Организации ───────────────────────────────────────────────────────────
{
  const d = db();
  D.state(d);
  throws(() => D.addOrganization(d, { name: '   ' }), /name is required/, 400, 'D01 празно име → 400');
  throws(() => D.addOrganization(d, { name: 'А', kind: 'nope' }), /Unknown organization kind/, 400, 'D02 непознат вид → 400');
  const o = D.addOrganization(d, { name: '  Acme  ООД ', addresses: [{ street: 'ул. А 1', city: 'София' }, { label: 'само етикет' }, null] });
  assert.equal(o.organization.name, 'Acme ООД', 'D03 името се подрязва и интервалите се свиват');
  assert.equal(o.organization.kind, 'company', 'D04 без вид → „company“');
  assert.equal(o.organization.addresses.length, 1, 'D05 адрес само с етикет се изхвърля');
  assert.match(o.organization.addresses[0].id, /^[0-9a-f]{16}$/, 'D06 на запазения адрес се дава ид');
  assert.deepEqual(o.employees, [], 'D07 без служители → празен списък');
  throws(() => D.addOrganization(d, { name: 'acme оод' }), /already exists/, 409, 'D08 същото име по регистър → 409');
  throws(() => D.addOrganization(d, { name: 'B', employees: [{ email: 'bad' }] }), /Invalid employee email/, 400, 'D09 невалиден имейл на служител → 400');
  const withStaff = D.addOrganization(d, { name: 'Beta', kind: 'institution', employees: [{ email: 'i@beta.bg', name: 'Иван' }, { email: 'p@beta.bg' }] });
  assert.equal(withStaff.employees.length, 2, 'D10 двамата служители се създават');
  assert.equal(withStaff.employees[0].organizationId, withStaff.organization.id, 'D11 служителят сочи организацията');
  assert.equal(withStaff.employees[0].fields.name, 'Иван', 'D12 полетата на служителя се пазят');
  throws(() => D.addOrganization(d, { name: 'Gamma', employees: [{ email: 'dup@gamma.bg' }, { email: 'dup@gamma.bg' }] }), /Duplicate employee email/, 409, 'D13 повторен имейл в една организация → 409');
  throws(() => D.addOrganization(d, { name: 'Delta', employees: [{ email: 'i@beta.bg' }] }), /Contact already exists/, 409, 'D14 съществуващ контакт като служител → 409');

  assert.equal(D.patchOrganization(d, o.organization.id, { name: 'Acme Group' }).name, 'Acme Group', 'D15 преименуването минава');
  throws(() => D.patchOrganization(d, o.organization.id, { name: 'beta' }), /already exists/, 409, 'D16 преименуване към заето име → 409');
  throws(() => D.patchOrganization(d, o.organization.id, { name: '' }), /name is required/, 400, 'D17 празно име → 400');
  assert.equal(D.patchOrganization(d, o.organization.id, { kind: 'institution' }).kind, 'institution', 'D18 видът се сменя');
  assert.deepEqual(D.patchOrganization(d, o.organization.id, { addresses: [] }).addresses, [], 'D19 адресите се изчистват');
  throws(() => D.patchOrganization(d, 'nope', {}), /Organization not found/, 404, 'D20 непозната организация → 404');

  throws(() => D.removeOrganization(d, withStaff.organization.id), /still has employees/, 409, 'D21 организация със служители не се трие → 409');
  const detached = D.removeOrganization(d, withStaff.organization.id, { detach: true });
  assert.equal(detached.detached, 2, 'D22 откачането връща броя служители');
  assert.equal(d.directory.contacts.filter((c) => c.email === 'i@beta.bg')[0].organizationId, undefined, 'D23 служителят остава контакт, но без организация');
  assert.deepEqual(D.removeOrganization(d, o.organization.id), { deleted: o.organization.id, detached: 0 }, 'D24 празна организация се трие с нула откачени');
  throws(() => D.removeOrganization(d, 'nope'), /Organization not found/, 404, 'D25 повторно изтриване → 404');
}

// ── E. Адреси (sanitizeAddresses) ────────────────────────────────────────────
{
  assert.deepEqual(D.sanitizeAddresses(null), [], 'E01 null → празен списък');
  assert.deepEqual(D.sanitizeAddresses(undefined), [], 'E02 undefined → празен списък');
  throws(() => D.sanitizeAddresses('ул. А 1'), /must be an array/, 400, 'E03 низ вместо масив → 400');
  assert.deepEqual(D.sanitizeAddresses(['боклук', 5, null]), [], 'E04 непреводимите записи се изхвърлят');
  assert.equal(D.sanitizeAddresses([{ id: '0123456789abcdef', street: 'ул. Б 2' }])[0].id, '0123456789abcdef', 'E05 валидното ид се запазва при редакция');
  assert.notEqual(D.sanitizeAddresses([{ id: 'късо', street: 'ул. Б 2' }])[0].id, 'късо', 'E06 невалидното ид се подменя');
  const long = D.sanitizeAddresses(Array.from({ length: 15 }, (_, i) => ({ street: 'ул. ' + i })));
  assert.equal(long.length, 10, 'E07 адресите се ограничават до 10');
  const trimmed = D.sanitizeAddresses([{ street: '  ул. В 3\r\nапартамент 4  ', postal: '1000' }])[0];
  assert.equal(trimmed.street, 'ул. В 3 апартамент 4', 'E08 контролите в адреса стават интервал');
  assert.equal(trimmed.postal, '1000', 'E09 пощенският код се пази');
  assert.equal(trimmed.label, undefined, 'E10 празните полета не се записват');
}

console.log('PASS directory-contract: 13 функции · променливи, правила, контакти, конфликти, организации, адреси');
