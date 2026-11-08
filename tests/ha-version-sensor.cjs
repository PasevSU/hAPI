'use strict';
// DEF-42: сензорът за версията не се създаваше в Home Assistant 2026.11.
//
// Измерено на живата инстанция (2026-11-08, HA 2026.11.0):
//   ERROR [homeassistant.components.sensor] Error adding entity
//   sensor.hapi_enterprise_add_on_version … ValueError: … suggesting precision '0' thus
//   indicating it has a numeric value; however, it has the non-numeric value: '0.69.198'
// Причината: `PortalSensorEntityDescription` имаше `suggested_display_precision: int = 0`
// като подразбиране за ВСЕКИ сензор, включително текстовия „версия“ и enum-а „синхрон“.
// Правилото на файла: нито един сензор с текстово/enum значение не носи прецизия, а
// числовите, на които им трябва закръгляне, я задават изрично.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'custom_components', 'hapi_enterprise', 'sensor.py');
const source = fs.readFileSync(file, 'utf8');

// T01. Подразбирането не е 0 — иначе всеки текстов сензор получава прецизия.
assert.match(source, /suggested_display_precision: int \| None = None/, 'T01 подразбирането е None, не 0');
assert.equal(/suggested_display_precision: int = 0/.test(source), false, 'T02 няма подразбиране 0 в описанието');

// T03. Сензорът за версия не носи прецизия (текст е).
const versionBlock = source.slice(source.indexOf('key="version"'), source.indexOf('key="sync"'));
assert.ok(versionBlock.length > 0, 'T03 намирам блока на сензора за версия');
assert.equal(/suggested_display_precision/.test(versionBlock), false, 'T04 сензорът за версия НЕ задава прецизия');

// T05. Enum сензорът (синхрон) също не носи прецизия.
const syncBlock = source.slice(source.indexOf('key="sync"'), source.indexOf('key="sync"') + 400);
assert.equal(/suggested_display_precision/.test(syncBlock), false, 'T05 enum сензорът НЕ задава прецизия');

// T06. Числовите сензори, които искат закръгляне, го задават изрично — броят им не е нула.
const explicit = (source.match(/suggested_display_precision=0,/g) || []).length
  + (source.match(/suggested_display_precision=2,/g) || []).length;
assert.ok(explicit >= 3, 'T06 има изрично зададени прецизии за числовите сензори (намерени: ' + explicit + ')');

console.log('PASS ha-version-sensor: DEF-42 — текстовият сензор за версия и enum-ът за синхрон не носят прецизия; ' + explicit + ' числови сензора я задават изрично');
