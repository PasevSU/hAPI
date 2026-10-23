'use strict';
// Съгласуваност на документацията с кода.
//
// Пази това, което лесно се разминава при издаване:
//  - баджовете за версия в README/BG/DE = версията в `hapi_enterprise/config.yaml`;
//  - локалните markdown връзки в основните документи сочат съществуващи файлове;
//  - не се споменават скриптове/инсталатори, които не съществуват в хранилището
//    (освен ако не са изрично отбелязани като отделна дистрибуция);
//  - документът за паритет на функциите описва пренесените модули;
//  - няма „⏳ <текущата версия>“ — това е обещание за ВЕЧЕ излязла версия (остарял маркер);
//  - ръководството за ключовете не описва полета, които `status()` не връща.
//    (В 0.69.67 там стояха `encryptionKeyId`, `hasPrivate`, `passphraseAccepted` — и трите
//    измислени; човек, който ги търси в отговора, стига до „счупен keyring“.)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));
const { readAddonVersion } = require('../scripts/release-lib.cjs');

const version = readAddonVersion(root);
const docs = ['README.md', 'BG.md', 'DE.md'];

// 1. Баджовете за версия.
for (const doc of docs) {
  const text = read(doc);
  const badge = text.match(/img\.shields\.io\/badge\/version-([0-9.]+)-/);
  assert.ok(badge, doc + ': липсва бадж за версия');
  assert.equal(badge[1], version, `${doc}: баджът е ${badge[1]}, а config.yaml е ${version}`);
  assert.ok(
    !/github\.com\/PasevSU\/hAPI-enterprise/.test(text),
    doc + ': баджът/връзката сочи несъществуващо хранилище (hAPI-enterprise)',
  );
}

// 1б. README-то на add-on-а (показва се в add-on store) също носи бадж за версия.
const addonReadme = read('hapi_enterprise/README.md');
const addonBadge = addonReadme.match(/img\.shields\.io\/badge\/version-([0-9.]+)-/);
assert.ok(addonBadge, 'hapi_enterprise/README.md: липсва бадж за версия');
assert.equal(addonBadge[1], version, `hapi_enterprise/README.md: баджът е ${addonBadge[1]}, а config.yaml е ${version}`);
for (const button of ['supervisor_add_addon_repository', 'supervisor_addon', 'hacs_repository']) {
  assert.ok(addonReadme.includes(button), 'hapi_enterprise/README.md: липсва бутон ' + button);
}

// 2. Локалните връзки водят до реален файл.
for (const doc of docs) {
  const text = read(doc);
  const broken = [];
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const link = match[1];
    if (/^(https?:|#|mailto:)/.test(link)) continue;
    const target = decodeURIComponent(link.split('#')[0]);
    if (!target) continue;
    if (!exists(target)) broken.push(link);
  }
  assert.deepEqual(broken, [], doc + ': счупени локални връзки: ' + broken.join(', '));
}

// 3. Споменати скриптове/инсталатори трябва да съществуват, освен ако не са в
//    отделната Windows дистрибуция (тогава документът изрично го казва).
const SEPARATE = [
  /-Windows-Setup\.exe$/,
  /-Windows-Portable\.zip$/,
  /^START_hAPI_Enterprise\.bat$/,
  /^Install_GUI_Dependency\.bat$/,
];
for (const doc of docs) {
  const text = read(doc);
  const mentions = new Set([...text.matchAll(/[A-Za-z0-9_.-]+\.(?:bat|exe)/g)].map((m) => m[0]));
  for (const name of mentions) {
    if (exists(name)) continue;
    assert.ok(
      SEPARATE.some((re) => re.test(name)),
      `${doc}: споменава несъществуващ файл ${name}`,
    );
    assert.match(
      text,
      /отделн[ао]|separate Distribution|separate distribution/,
      `${doc}: ${name} е от отделна дистрибуция, но липсва изрична бележка`,
    );
  }
}

// 4. Паритетът на функциите документира пренесените модули.
const parity = read('documentation/07_RELEASE/FEATURE_PARITY.md');
for (const module of ['config_flow.py', 'coordinator.py', 'sensor.py', 'strings.json']) {
  assert.ok(parity.includes(module), 'FEATURE_PARITY.md: липсва ' + module);
}
assert.match(parity, /portal_enterprise/, 'FEATURE_PARITY.md: трябва да посочва източника');

// 5. Ръководството за HACS описва и двата канала на интеграцията (UI + YAML).
const hacsGuide = read('documentation/08_USER_GUIDES/install-hacs.md');
for (const needle of ['Settings → Devices & Services', 'configuration.yaml', 'сензора', 'hacs.json']) {
  assert.ok(hacsGuide.includes(needle), 'install-hacs.md: липсва „' + needle + '“');
}

// 6. Никъде в документацията не стои „⏳ <текущата версия>“: това значи „предстои в
//    изданието, което вече е излязло“. Бъдещето се пише „⏳ след <версия>“.
const docFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.md$/.test(entry.name)) docFiles.push(full);
  }
})(path.join(root, 'documentation'));
docFiles.push(path.join(root, 'README.md'), path.join(root, 'BG.md'), path.join(root, 'DE.md'));
const staleVersion = new RegExp('⏳\\s*' + version.replace(/[.]/g, '\\.'));
const stale = [];
for (const file of docFiles) {
  const text = fs.readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (staleVersion.test(line)) stale.push(`${path.relative(root, file)}:${i + 1}`);
  });
}
assert.deepEqual(stale, [], 'маркер „⏳ ' + version + '“ за вече излязла версия (пиши „⏳ след ' + version + '“): ' + stale.join(', '));

// 7. Полетата, които ръководството обещава, съществуват в `status()` на ключохранилището.
const keyringCode = read('hapi_enterprise/path-crypto.js');
for (const field of ['available', 'canDecrypt', 'storageKeyId', 'primaryKeyId', 'passphraseSource', 'reason']) {
  // Полетата се срещат и като `field: стойност`, и като съкратен запис `field,`.
  const fieldRe = new RegExp('(^|[\\s{,])' + field + '\\s*[:,}]');
  assert.ok(
    fieldRe.test(keyringCode),
    'path-crypto.js: липсва поле ' + field + ', което ръководството за ключовете обещава',
  );
}
const keyGuide = read('documentation/08_USER_GUIDES/pgp-keys-setup.md');
for (const invented of ['encryptionKeyId', 'hasPrivate', 'passphraseAccepted']) {
  assert.ok(!keyGuide.includes(invented), 'pgp-keys-setup.md: поле ' + invented + ' не съществува в status()');
}

console.log(`docs-consistency OK: ${docs.length} документа на версия ${version}, без счупени връзки`);
