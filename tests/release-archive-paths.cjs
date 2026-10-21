'use strict';
// Архивът на изданието се разопакова от потребителя — затова всеки запис трябва да е
// относителен и да остава в папката. Проверката е обща за build-release и verify-release,
// а тестът пази и двете посоки: опасните пътища падат, нормалните минават.
const assert = require('node:assert/strict');
const path = require('node:path');
const lib = require('../scripts/release-lib.cjs');

const good = [
  'hapi_enterprise/start.js',
  'custom_components/hapi_enterprise/manifest.json',
  'custom_components/hapi_enterprise/report_manifests/index.json',
  'custom_components/hapi_enterprise/translations/bg.json',
];
assert.deepEqual(lib.assertSafeEntryPaths(good.map((p) => ({ path: p })), 'добър'), good.map((p) => ({ path: p })));

const bad = {
  'изход с ..': '../evil.js',
  'изход по средата': 'hapi_enterprise/../../evil.js',
  'абсолютен път': '/etc/passwd',
  'Windows буква': 'C:/Windows/system32/evil.js',
  'обратни наклонени': 'hapi_enterprise\\..\\evil.js',
  'празен сегмент': 'hapi_enterprise//start.js',
  'текуща папка': 'hapi_enterprise/./start.js',
  'празно име': '',
  'без име': null,
};

for (const [why, name] of Object.entries(bad)) {
  assert.throws(
    () => lib.assertSafeEntryPaths([{ path: name }], 'лош'),
    /лош:/,
    `трябва да откаже: ${why}`,
  );
}

// Празен архив е валиден — няма какво да излезе извън папката.
assert.deepEqual(lib.assertSafeEntryPaths([], 'празен'), []);

console.log(`release-archive-paths OK: ${good.length} нормални пътя минават, ${Object.keys(bad).length} опасни се отхвърлят`);
