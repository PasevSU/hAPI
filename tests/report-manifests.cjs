'use strict';
// Отчетните манифести са данни, които влизат в изданието — затова се проверяват в монорепото,
// а не само след като build-haoss.cjs ги копира. Тестът пази три неща, които лесно се чупят
// при редакция: точно един слот `generator` между START и STOP, изрична рекурсия и пълнота на
// index.json. Проверява и че в манифестите не се промъкват TSA токени, сертификати или тайни.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '../custom_components/hapi_enterprise/report_manifests');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
// Хешът е върху текста с CRLF → LF, за да не зависи от това кой как е записал файла.
const digest = (name) =>
  crypto.createHash('sha256').update(read(name).replace(/\r\n/g, '\n'), 'utf8').digest('hex');

// Стойностите идват от договора на отчета: report_type трябва да е едно от познатите,
// а обхватът — един от трите режима на обхождане.
const REPORT_TYPES = new Set(['single', 'combo', 'volume']);
const SCOPES = new Set(['single_file', 'current_folder', 'recursive_folder']);
// Същите типове блокове, които рендерърът на Template Lab разбира.
const BLOCK_TYPES = new Set(['header', 'legal_qr', 'section', 'kv', 'table', 'hash_table', 'text', 'note', 'spacer', 'page_break', 'slot']);
const RECURSIVE = new Set(['combo_all.json', 'volume.json']);
const EXPECTED = {
  'single.json': { scope: 'single_file', label: 'HASHREPORT_TYP_SINGLE', type: 'single' },
  'combo.json': { scope: 'current_folder', label: 'HASHREPORT_TYP_COMBO', type: 'combo' },
  'combo_all.json': { scope: 'recursive_folder', label: 'HASHREPORT_TYP_COMBO_ALL', type: 'combo' },
  'volume.json': { scope: 'recursive_folder', label: 'HASHREPORT_TYP_VOLUME', type: 'volume' },
};

assert.ok(fs.existsSync(dir), 'липсва папката с отчетни манифести: ' + dir);
const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
assert.deepEqual(
  files,
  [...Object.keys(EXPECTED), 'index.json'].sort(),
  'папката трябва да съдържа точно четирите манифеста и index.json, намерени: ' + files.join(', '),
);
assert.ok(fs.existsSync(path.join(dir, 'README.md')), 'липсва README.md към манифестите');

// Никакви измислени доказателства: оформлението не носи токени, подписи и сертификати.
const FORBIDDEN_KEYS = ['tsaToken', 'tsaTime', 'tsaTimestamp', 'signature', 'signatureValue', 'certificate'];
const SECRETS = [/gh[pousr]_[A-Za-z0-9]{20,}/, /\bsk-[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

for (const [file, expected] of Object.entries(EXPECTED)) {
  const body = read(file);
  const spec = JSON.parse(body);

  assert.equal(spec.id, file.replace(/\.json$/, ''), `${file}: id трябва да съвпада с името на файла`);
  assert.equal(spec.version, 1, `${file}: version трябва да е 1`);
  assert.ok(REPORT_TYPES.has(spec.report_type), `${file}: непознат report_type „${spec.report_type}“`);
  assert.equal(spec.report_type, expected.type, `${file}: report_type`);
  assert.ok(SCOPES.has(spec.input_scope), `${file}: непознат input_scope „${spec.input_scope}“`);
  assert.equal(spec.input_scope, expected.scope, `${file}: input_scope`);
  // Рекурсията не е подразбираща се — само combo_all и volume слизат в подпапки.
  assert.equal(
    spec.input_scope === 'recursive_folder',
    RECURSIVE.has(file),
    `${file}: само combo_all и volume могат да са с обхват recursive_folder`,
  );
  assert.equal(spec.meta.title, 'SHA-256 Hash Report', `${file}: meta.title`);
  assert.equal(spec.meta.report_type_label, expected.label, `${file}: meta.report_type_label`);

  assert.ok(Array.isArray(spec.sections) && spec.sections.length > 0, `${file}: липсват секции`);
  const keys = spec.sections.map((section) => section.key);
  assert.deepEqual(
    keys, [...new Set(keys)],
    `${file}: дублиран ключ на секция (${keys.join(', ')}) — редът трябва да е еднозначен`,
  );
  for (const section of spec.sections) {
    assert.ok(section.key, `${file}: секция без key`);
    assert.ok(BLOCK_TYPES.has(section.block), `${file}: секция „${section.key}“ с непознат block „${section.block}“`);
    if (section.block === 'table') {
      assert.ok(Array.isArray(section.columns) && section.columns.length > 0, `${file}: таблица „${section.key}“ без колони`);
      for (const column of section.columns) assert.ok(column.title, `${file}: колона без title в „${section.key}“`);
    }
    // Всяка секция извън слота трябва да казва от кой ключ на данните чете.
    if (section.block !== 'slot') assert.ok(section.from, `${file}: секция „${section.key}“ без from`);
  }
  for (const required of ['start', 'stop']) {
    assert.ok(keys.includes(required), `${file}: липсва секция „${required}“`);
  }

  const slots = spec.sections.filter((section) => section.block === 'slot');
  assert.equal(slots.length, 1, `${file}: трябва да има точно един слот, намерени ${slots.length}`);
  assert.equal(slots[0].key, 'generator', `${file}: слотът трябва да е с ключ generator`);
  assert.deepEqual(slots[0].between, ['start', 'stop'], `${file}: слотът трябва да е между start и stop`);

  // Съседите на слота се проверяват по заглавие — иначе слотът може да „пълзи“.
  const index = spec.sections.indexOf(slots[0]);
  const above = spec.sections[index - 1];
  const below = spec.sections[index + 1];
  assert.equal(above.title, 'Cryptographic Timestamp START', `${file}: преди слота трябва да е START`);
  assert.equal(below.title, 'Cryptographic Timestamp STOP', `${file}: след слота трябва да е STOP`);

  for (const key of FORBIDDEN_KEYS) {
    assert.ok(!body.includes(`"${key}"`), `${file}: манифестът не бива да съдържа „${key}“ (оформление, не доказателство)`);
  }
  for (const pattern of SECRETS) assert.doesNotMatch(body, pattern, `${file}: възможна тайна в манифеста`);
}

// index.json е единственият вход за потребителя на папката.
const index = JSON.parse(read('index.json'));
assert.equal(index.schema_version, 1, 'index.json: schema_version трябва да е 1');
assert.equal(index.kind, 'hash_report_manifests', 'index.json: kind');
assert.deepEqual(index.slot.between, ['start', 'stop'], 'index.json: слотът трябва да е между start и stop');
assert.equal(index.slot.key, 'generator', 'index.json: слотът трябва да е с ключ generator');
assert.deepEqual(
  index.manifests.map((entry) => entry.file).sort(),
  Object.keys(EXPECTED).sort(),
  'index.json трябва да изброява точно четирите манифеста',
);
for (const entry of index.manifests) {
  const expected = EXPECTED[entry.file];
  assert.ok(expected, `index.json: непознат файл „${entry.file}“`);
  const spec = JSON.parse(read(entry.file));
  assert.equal(entry.id, spec.id, `index.json: id за ${entry.file}`);
  assert.equal(entry.input_scope, expected.scope, `index.json: обхват за ${entry.file}`);
  assert.equal(entry.report_type_label, expected.label, `index.json: етикет за ${entry.file}`);
  assert.equal(entry.report_type, spec.report_type, `index.json: report_type за ${entry.file}`);
  // Хешът прави всяка промяна умишлена: редактираш манифест → опресняваш стойността в индекса.
  assert.equal(entry.sha256, digest(entry.file),
    `index.json: sha256 за ${entry.file} не съвпада — опресни го след промяната`);
}

const readme = read('README.md');
for (const needle of ['generator', 'start', 'stop', 'recursive_folder', 'index.json']) {
  assert.ok(readme.includes(needle), 'README.md на манифестите не споменава „' + needle + '“');
}

console.log(`report-manifests OK: ${Object.keys(EXPECTED).length} манифеста, един слот generator между START и STOP`);
