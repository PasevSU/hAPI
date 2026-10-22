'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
// Приемен тест за §8.7: йерархията (група → профил → записи) трябва да е достъпна от
// интерфейса и да дава контроли за създаване на група, свързване на запис и списък с профили.
// След премахването на стария панел всичко това живее в секция „Йерархия“ на Настройки.
(async () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const panel = read('hapi_enterprise/ui/settings-panel.js');
  const index = read('hapi_enterprise/ui/index.html');

  // Входна точка: секцията е част от навигацията на Настройки и се зарежда от индекса.
  assert.match(panel, /data-section=/, 'табовете носят data-section');
  assert.ok(panel.includes("{ id: 'hierarchy', label: 'section.hierarchy' }"), 'табът пази ключ за „Йерархия“ (преводът е в ui/i18n.js)');
  assert.ok(index.includes('settings-panel.js'), 'интерфейсът зарежда панела с настройки');

  // Създаване на група.
  assert.ok(panel.includes('set-group-input'), 'има поле за име на група');
  assert.ok(panel.includes("form('group'"), 'има бутон за създаване на група');
  assert.ok(panel.includes('/admin/api/v2/groups'), 'групите се четат и пишат през v2 API-то');

  // Свързване и отделяне на запис (група → записи).
  assert.match(panel, /data-record-assoc/, 'има контрол за свързване на запис');
  assert.match(panel, /data-record-detach/, 'има контрол за отделяне на запис');
  assert.ok(panel.includes("'/associate'"), 'свързването вика /associate');
  assert.ok(panel.includes("'/detach'"), 'отделянето вика /detach');
  assert.ok(panel.includes('set-record-group'), 'има избор на група за свързване');

  // Профили на настройките (снимки на конфигурацията) се виждат от „Основни“.
  assert.ok(panel.includes('id="set-profiles"'), 'има контейнер за профили');
  assert.ok(panel.includes('/admin/api/config-profiles'), 'профилите се четат през API-то');

  console.log('admin-hierarchy OK: йерархия · групи · свързване на записи · профили');
})().catch((e) => { console.error(e); process.exit(1) });
