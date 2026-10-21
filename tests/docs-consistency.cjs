'use strict';
// Съгласуваност на документацията с кода.
//
// Пази това, което лесно се разминава при издаване:
//  - баджовете за версия в README/BG/DE = версията в `hapi_enterprise/config.yaml`;
//  - локалните markdown връзки в основните документи сочат съществуващи файлове;
//  - не се споменават скриптове/инсталатори, които не съществуват в хранилището
//    (освен ако не са изрично отбелязани като отделна дистрибуция);
//  - документът за паритет на функциите описва пренесените модули.
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

console.log(`docs-consistency OK: ${docs.length} документа на версия ${version}, без счупени връзки`);
