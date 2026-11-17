'use strict';
// ДОГОВОР ЗА ФАЙЛА НА ДИСКА: четене, запис с `revision`, чекпойнт по `hash`, регистър на папките.
//
// Какво пази този тест: `configuration.yaml` е единственият източник на опциите на портала, а
// панелът пише през него. Затова записът е АТОМАРЕН (временен файл + преименуване), `revision`
// расте с единица, а запис върху чужда промяна се ОТКАЗВА с текущия хеш и разлика — това е
// „чекпойнтът“, който пази два отворени таба да не си затрупат работата.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const config = require(path.join(__dirname, '..', 'hapi_enterprise', 'portal-config.js'));

// Хешът се подава отвън — в сървъра това е глобалната `core.api.hash.digest`, а не втори начин
// за смятане. Тестът дава същата функция, за да провери договора, не реализацията.
const digest = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-config-'));
const abs = path.join(dir, 'portals', 'dogovor', 'configuration.yaml');

// ── 1. Нов портал: начален файл, който минава проверката ───────────────────────
const first = config.write(abs, config.initial({ slug: 'dogovor', title: 'Договор' }), { digest, slug: 'dogovor' });
assert.ok(fs.existsSync(abs), 'файлът е създаден заедно с папката си');
assert.equal(first.revision, 1, 'първият запис е ревизия 1');
assert.match(first.hash, /^[0-9a-f]{64}$/, 'записът връща хеша, който панелът пази като чекпойнт');

const onDisk = config.read(abs, { digest, slug: 'dogovor' });
assert.deepEqual(onDisk.problems, [], 'написаното се чете обратно без проблеми: ' + JSON.stringify(onDisk.problems));
assert.equal(onDisk.hash, first.hash, 'хешът от записа съвпада с хеша от четенето');

// ── 2. Ревизия и атомарност ────────────────────────────────────────────────────
const data = JSON.parse(JSON.stringify(onDisk.data));
data.portal.notes = 'първа бележка';
const second = config.write(abs, data, { digest, slug: 'dogovor', expectHash: onDisk.hash });
assert.equal(second.revision, 2, 'вторият запис вдига ревизията с единица');
const leftovers = fs.readdirSync(path.dirname(abs)).filter((name) => name.endsWith('.tmp'));
assert.deepEqual(leftovers, [], 'няма останали временни файлове: ' + JSON.stringify(leftovers));
assert.match(fs.readFileSync(abs, 'utf8'), /notes: първа бележка/, 'промяната е на диска, не само в паметта');

// ── 3. Чекпойнт: запис върху чужда промяна се отказва с текущия хеш ────────────
const stale = () => config.write(abs, { ...data, portal: { ...data.portal, title: 'Чужд запис' } }, {
  digest,
  slug: 'dogovor',
  expectHash: onDisk.hash, // хешът от ПРЕДИ втория запис — точно това вижда втори отворен таб
});
assert.throws(stale, (error) => {
  assert.equal(error.code, 'PORTAL_CONFIG_CONFLICT', 'кодът е отделен, за да го разпознае HTTP слоят');
  assert.equal(error.currentHash, second.hash, 'отказът носи ТЕКУЩИЯ хеш, за да се презареди панелът');
  assert.ok(Array.isArray(error.diff) && error.diff.length > 0, 'отказът носи и разликата');
  return true;
});
assert.equal(config.read(abs, { digest }).data.portal.title, 'Договор', 'отказаният запис НЕ е променил файла');

// ── 4. Невалидно описание не стига до диска ────────────────────────────────────
const before = fs.readFileSync(abs, 'utf8');
assert.throws(
  () => config.write(abs, { ...data, portal: { ...data.portal, title: '' } }, { digest, slug: 'dogovor' }),
  (error) => {
    assert.equal(error.code, 'PORTAL_CONFIG_INVALID', 'невалидното има свой код');
    assert.ok(error.issues.some((i) => i.path === 'portal.title'), 'issues казват КОЕ поле: ' + JSON.stringify(error.issues));
    return true;
  },
);
assert.equal(fs.readFileSync(abs, 'utf8'), before, 'файлът е непокътнат след отказан запис');

// ── 5. Регистър на папките: подразбирания + изключения, заключената иска причина ─
const withFolders = {
  ...config.parse(before).data,
  revision: 2,
  folders: {
    defaults: { visible: true, media: false, locked: false },
    items: { '/Договори': { visible: false, media: true, locked: true, reason: 'лични данни' } },
  },
};
assert.deepEqual(config.validate(withFolders, { slug: 'dogovor' }), [], 'регистърът с причина е валиден');
const noReason = JSON.parse(JSON.stringify(withFolders));
delete noReason.folders.items['/Договори'].reason;
assert.ok(
  config.validate(noReason, { slug: 'dogovor' }).some((i) => i.path === 'folders.items'),
  'заключена папка без причина се отказва',
);
const badFlag = JSON.parse(JSON.stringify(withFolders));
badFlag.folders.items['/Договори'].непознат = true;
assert.ok(config.validate(badFlag, { slug: 'dogovor' }).some((i) => i.path === 'folders.items'), 'непознат флаг се отказва');
const esc = JSON.parse(JSON.stringify(withFolders));
esc.folders.items['/../извън'] = { visible: true };
assert.ok(config.validate(esc, { slug: 'dogovor' }).some((i) => i.path === 'folders.items'), 'път с „..“ се отказва');

// Ефективните флагове: какво вижда човек за папка, която няма собствен запис.
const eff = config.effective(withFolders);
const folderFlags = (rel) => ({ ...eff.folders.defaults, ...(eff.folders.items[rel] || {}) });
assert.deepEqual(
  { visible: folderFlags('/неописана').visible, media: folderFlags('/неописана').media },
  { visible: true, media: false },
  'неописаната папка следва подразбиранията',
);
assert.deepEqual(
  { visible: folderFlags('/Договори').visible, locked: folderFlags('/Договори').locked },
  { visible: false, locked: true },
  'описаната папка носи своето изключение',
);

console.log(
  'PASS portal-config-registry: начален файл · revision 1→2 · атомарен запис без .tmp · ' +
    'чекпойнт отказва чужд запис с hash и diff · невалидно не стига до диска · ' +
    'регистър на папките (подразбирания + изключения, заключена иска причина)',
);
