'use strict';
// Хранилището на DOCFLOW (`core-store.js`) досега НЯМАШЕ нито един тест, който да го назовава —
// 270 реда с SQL схема, транзакции и ключове, които се пре-изчисляват при преместване между
// групи. Точно затова е тук: това е модулът, в който грешката не се вижда, докато данните не
// потрябват.
//
// Проверява се:
//   1. групи и автоматични записи по регистър; създаване на запис със стойности по типове;
//   2. ключът на променливата е `{префикс}-{db}-{група|ORPHAN-id}-{поле}` и се СМЕНЯ при
//      преместване, а стойностите остават същите;
//   3. времето на създаване на стойността ОЦЕЛЯВА при преместване (това е поправката: преди
//      се записваше времето на последната промяна и колоната `created_at` лъжеше);
//   4. шифровано поле се чете само през модула, а подменен шифротекст се съобщава, вместо да
//      се върне боклук;
//   5. търсенето е без значение на регистъра и за КИРИЛИЦА — затова не се ползва SQL `LIKE`
//      (SQLite сгъва регистъра само за ASCII, а продуктът е на български);
//   6. триене на запис и на група не оставя променливи и връзки.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const coreStore = require('../hapi_enterprise/core-store');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-core-'));
const dbPath = path.join(dir, 'core.sqlite');

// Регистър-заготовка: един профил с четири типа полета.
const registry = {
  prefixes: ['doc'],
  getProfile: (prefix) => (prefix === 'doc' ? { prefix } : null),
  fieldsFor: () => [
    { name: 'title', type: 'text' },
    { name: 'amount', type: 'number' },
    { name: 'paid', type: 'bool' },
    { name: 'tags', type: 'list' },
    { name: 'iban', type: 'encrypted' },
  ],
  validateRecord: (prefix, fields) => {
    const defs = new Map(registry.fieldsFor(prefix).map((f) => [f.name, f]));
    const out = {};
    for (const [k, v] of Object.entries(fields || {})) {
      if (!defs.has(k)) throw Object.assign(new Error('Unknown field: ' + k), { status: 400 });
      out[k] = v;
    }
    return out;
  },
};

const store = coreStore.create({ path: dbPath, dbId: '7', secret: 'core-store-test-secret' });

try {
  // ── 1. Група и автоматични записи ────────────────────────────────────────
  const group = store.createGroup({ name: 'Договори', description: 'тест', registry });
  assert.ok(group.id, 'групата има id');
  const auto = store.listRecords(group.id);
  assert.equal(auto.length, 1, 'по регистъра се създава по един запис на префикс');
  assert.equal(auto[0].prefix, 'doc');

  // ── 2. Запис със стойности по типове ─────────────────────────────────────
  const rec = store.createRecord({
    prefix: 'doc',
    group_id: group.id,
    registry,
    fields: { title: 'Договор за наем', amount: '1 234,50', paid: 'true', tags: 'а, б', iban: 'BG00TEST00000000000000' },
  });
  assert.equal(rec.fields.title, 'Договор за наем');
  assert.equal(rec.fields.amount, 1234.5, 'числото се разбира и с десетична запетая');
  assert.equal(rec.fields.paid, true);
  assert.deepEqual(rec.fields.tags, ['а', 'б'], 'списъкът се пази и като JSON');
  assert.equal(rec.fields.iban, 'BG00TEST00000000000000', 'шифрованото поле се чете обратно');

  // Шифрованото НЕ стои в открит вид на диска.
  const raw = fs.readFileSync(dbPath);
  assert.ok(!raw.includes(Buffer.from('BG00TEST00000000000000')), 'IBAN-ът не е в открит вид в базата');

  // Ключът носи префикс, номера на базата, областта и полето, а ОБЛАСТТА е записът.
  const scopedKey = (groupId, recordId, field) => `${'doc'}-7-${groupId}.${recordId}-${field}`;
  assert.ok(store.getVariable(scopedKey(group.id, rec.id, 'title')), 'ключът е {префикс}-{db}-{група}.{запис}-{поле}');

  // ── 2в. Два записа в ЕДНА група не си делят стойностите (това е поправката) ──
  // Дотук областта беше групата: вторият запис със същото поле презаписваше стойността на
  // първия, а `record_id` оставаше на първия — стойността се местеше безшумно между записи.
  const second = store.createRecord({ prefix: 'doc', group_id: group.id, registry, fields: { title: 'Втори договор', amount: '10' } });
  assert.equal(store.getRecord(rec.id).fields.title, 'Договор за наем', 'първият запис пази своята стойност');
  assert.equal(store.getRecord(second.id).fields.title, 'Втори договор', 'вторият запис има своята');
  store.setVariable(second.id, 'title', 'Втори договор (редакция)', registry.fieldsFor('doc').find((f) => f.name === 'title'));
  assert.equal(store.getRecord(rec.id).fields.title, 'Договор за наем', 'промяната на единия не пипа другия');
  assert.equal(store.getRecord(second.id).fields.title, 'Втори договор (редакция)');
  store.deleteRecord(second.id);

  // ── 2б. Числото се разбира както го пише човек (това е поправката) ───────
  // Дотук `Number(String(v).replace(',','.'))` даваше NaN за интервал и за две точки, а NaN се
  // записваше мълчаливо. Сега: разбираемите форми дават число, а неразбираемото е 400.
  const num = (value) => store.createRecord({ prefix: 'doc', group_id: group.id, registry, fields: { amount: value } }).fields.amount;
  assert.equal(num('1 234,50'), 1234.5, 'интервал за хиляди + десетична запетая');
  assert.equal(num('1\u00a0234,50'), 1234.5, 'неразделящ интервал (както го слага Word)');
  assert.equal(num('1.234,56'), 1234.56, 'точка за хиляди, запетая за десетична');
  assert.equal(num('1,234.56'), 1234.56, 'запетая за хиляди, точка за десетична');
  assert.equal(num('1,5'), 1.5, 'само запетая е десетична');
  assert.equal(num('1,234'), 1234, 'три знака след запетаята са хиляди, не дроб');
  assert.equal(num('-2,75'), -2.75, 'отрицателно число');
  assert.equal(num(''), 0, 'празното е нула, както Number("")');
  assert.throws(() => num('дванайсет'), (e) => e.status === 400, 'неразбираемо число е грешка на входа, не NaN в базата');
  assert.throws(() => num('12,3,4'), (e) => e.status === 400, 'две десетични запетаи не се приемат');

  // ── 3. Преместване сменя КЛЮЧА, не стойността и не времето на създаване ──
  const titleKey = scopedKey(group.id, rec.id, 'title');
  // Стойността е била променяна след създаването си — иначе двете времена съвпадат и поправката
  // не се вижда. Датата се задава изрично, за да не зависи тестът от милисекундата.
  const editedAt = '2020-01-02T03:04:05.000Z';
  store.db.prepare('UPDATE variables SET updated_at=? WHERE key=?').run(editedAt, titleKey);
  const before = store.db.prepare('SELECT created_at,updated_at FROM variables WHERE key=?').get(titleKey);
  assert.ok(before.created_at, 'стойността има време на създаване');
  assert.notEqual(before.created_at, before.updated_at, 'двете времена са различни преди преместването');
  const otherGroup = store.createGroup({ name: 'Архив', registry: { prefixes: [], getProfile: () => null } });

  // Записът се мести в друга група → ключовете се пре-изчисляват.
  const moved = store.associateRecord(rec.id, otherGroup.id);
  assert.equal(moved.fields.title, 'Договор за наем', 'стойността оцелява при преместване');
  assert.ok(store.getVariable(scopedKey(otherGroup.id, rec.id, 'title')), 'ключът сочи новата група');
  assert.equal(store.getVariable(scopedKey(group.id, rec.id, 'title')), null, 'старият ключ вече не съществува');

  // Поправката: `created_at` НЕ се подменя с времето на последната промяна.
  const afterMove = store.db.prepare('SELECT created_at,updated_at FROM variables WHERE key=?').get(scopedKey(otherGroup.id, rec.id, 'title'));
  assert.equal(afterMove.created_at, before.created_at, 'времето на създаване оцелява при преместване');
  assert.equal(afterMove.updated_at, editedAt, 'времето на последната промяна също не се пипа от преместването');

  // Обратно към първата група и пак същото.
  store.associateRecord(rec.id, group.id);
  const afterBack = store.db.prepare('SELECT created_at FROM variables WHERE key=?').get(scopedKey(group.id, rec.id, 'title'));
  assert.equal(afterBack.created_at, before.created_at, 'времето на създаване оцелява и при връщане');

  // Откачане → „сирак“ със собствена област.
  const detached = store.detachRecord(rec.id);
  assert.equal(detached.fields.title, 'Договор за наем');
  assert.ok(store.getVariable(`doc-7-ORPHAN-${rec.id}-title`), 'сиракът има собствена област');
  assert.equal(store.listRecords(group.id).filter((r) => r.id === rec.id).length, 0, 'сиракът не е в групата');

  // ── 4. Подменен шифротекст се съобщава, вместо да върне боклук ───────────
  const ibanKey = `doc-7-ORPHAN-${rec.id}-iban`;
  store.db.prepare('UPDATE variables SET value_text=? WHERE key=?').run('enc:v1:' + Buffer.alloc(40).toString('base64'), ibanKey);
  assert.throws(() => store.getRecord(rec.id), 'подмененият шифротекст не се връща като стойност');

  // ── 5. Търсене: без значение на регистъра, включително кирилица ─────────
  const probe = store.createRecord({ prefix: 'doc', group_id: group.id, registry, fields: { title: 'Анекс към Договора' } });
  assert.equal(store.search('doc', 'анекс').length, 1, 'кирилицата се търси без значение на регистъра');
  assert.equal(store.search('doc', 'АНЕКС').length, 1, 'главните букви също намират');
  assert.equal(store.search('doc', 'анекс')[0].id, probe.id);
  assert.equal(store.search('', 'анекс').length, 1, 'празен префикс търси навсякъде');
  assert.equal(store.search('doc', 'няма-такава-дума').length, 0);
  assert.deepEqual(store.search('doc', '   '), [], 'празна заявка не връща всичко');

  // ── 6. Триене: запис и група не оставят променливи и връзки ─────────────
  const varsOf = (recordId) => store.db.prepare('SELECT COUNT(*) AS n FROM variables WHERE record_id=?').get(recordId).n;
  assert.ok(varsOf(probe.id) > 0);
  store.deleteRecord(probe.id);
  assert.equal(store.getRecord(probe.id), null, 'записът е изтрит');
  assert.equal(varsOf(probe.id), 0, 'променливите на записа са изтрити');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM links WHERE record_id=?').get(probe.id).n, 0, 'връзките са изтрити');

  const deleteGroup = store.createGroup({ name: 'За триене', registry });
  const inGroup = store.listRecords(deleteGroup.id);
  assert.ok(inGroup.length > 0);
  store.deleteGroup(deleteGroup.id);
  assert.equal(store.getGroup(deleteGroup.id), null, 'групата е изтрита');
  for (const r of inGroup) {
    assert.equal(store.getRecord(r.id), null, 'записите на групата са изтрити');
    assert.equal(varsOf(r.id), 0, 'променливите им са изтрити');
  }
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM links WHERE group_id=?').get(deleteGroup.id).n, 0, 'връзките на групата са изтрити');

  // ── 7. Метаданни ──────────────────────────────────────────────────────────
  store.setMeta('migration', 3);
  assert.equal(store.getMeta('migration'), '3', 'метаданните се пазят като текст');
  assert.equal(store.getMeta('липсва'), null);

  // ── 8. Миграция: стар ключ (област = група) се пренарежда при отваряне ────
  // База, писана преди поправката, има ключове без идентификатор на записа. Те не бива да
  // остават сираци (и не бива да продължават да делят един ключ), затова отварянето ги мести.
  const migDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-core-mig-'));
  try {
    const migPath = path.join(migDir, 'core.sqlite');
    const first = coreStore.create({ path: migPath, dbId: '7', secret: 'core-store-test-secret' });
    const migGroup = first.createGroup({ name: 'Миграция', registry });
    const migRec = first.createRecord({ prefix: 'doc', group_id: migGroup.id, registry, fields: { title: 'стар запис' } });
    const createdAt = first.db.prepare('SELECT created_at FROM variables WHERE record_id=?').get(migRec.id).created_at;
    first.db.prepare('UPDATE variables SET key=? WHERE record_id=?').run(`doc-7-${migGroup.id}-title`, migRec.id);
    assert.equal(first.getRecord(migRec.id).fields.title, 'стар запис', 'старият ключ още се чете по record_id');
    first.close();

    const reopened = coreStore.create({ path: migPath, dbId: '7', secret: 'core-store-test-secret' });
    assert.equal(reopened.getRecord(migRec.id).fields.title, 'стар запис', 'стойността оцелява при миграцията');
    assert.ok(reopened.getVariable(`doc-7-${migGroup.id}.${migRec.id}-title`), 'ключът е пренареден към записа');
    assert.equal(reopened.getVariable(`doc-7-${migGroup.id}-title`), null, 'старият ключ не остава');
    assert.equal(reopened.db.prepare('SELECT created_at FROM variables WHERE record_id=?').get(migRec.id).created_at, createdAt, 'времето на създаване оцелява и при миграция');
    reopened.close();
  } finally {
    fs.rmSync(migDir, { recursive: true, force: true });
  }

  console.log('PASS core-store: групи/записи/типове · ключ = префикс-db-група.запис-поле · записите в една група не си делят стойности · преместване пази стойността И created_at · шифровано поле · търсене с кирилица · каскадно триене · миграция на стар ключ · мета');
} finally {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
