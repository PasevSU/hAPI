'use strict';
// Таблото показва РЕАЛНИ данни, не демо числа.
//
// Преди `ui/app.js` имаше обект `DEMO` с измислени стойности („Документи 1 284“,
// „Свободно 412 GB“), който се показваше като състояние на системата. Този тест пази
// правилото: таблото пита административния API, а при липса на връзка казва точно това.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const app = read('hapi_enterprise/ui/app.js');
const dashboard = read('hapi_enterprise/ui/dashboard-panel.js');
const index = read('hapi_enterprise/ui/index.html');

// 1. Няма демо обект и няма помощни функции за рисуване на измислени таблици.
assert.equal(/\bconst DEMO\b/.test(app), false, 'app.js не бива да държи демо данни');
assert.equal(/function statsHtml|function tableHtml/.test(app), false, 'измислените таблици са премахнати');
assert.equal(/\b1 284\b|\b18,4 GB\b|\b412 GB\b/.test(app + dashboard), false, 'няма измислени числа в кода');

// 2. Скриптът е зареден и панелът се монтира за табло и „Относно“.
assert.ok(index.includes('dashboard-panel.js'), 'index.html зарежда dashboard-panel.js');
assert.match(app, /current === 'dashboard' && window\.HapiDashboardPanel/);
assert.match(app, /HapiDashboardPanel\.mount\(view\)/);
assert.match(app, /current === 'about' && window\.HapiDashboardPanel/);
assert.match(app, /HapiDashboardPanel\.mountAbout\(view\)/);

// 3. Данните идват от реалните административни маршрути.
for (const endpoint of ['/admin/api/portals', '/admin/api/sensors', '/admin/api/jobs', '/admin/api/audit/verify']) {
  assert.ok(dashboard.includes(endpoint), 'таблото пита ' + endpoint);
}
assert.match(dashboard, /Authorization: 'Bearer '/, 'ползва администраторския токен от сесията');

// 4. Без връзка не се показват числа — само обяснение къде се настройва.
assert.match(dashboard, /offline: true/);
assert.match(dashboard, /Свържи add-on-а от „Настройки“/);
assert.doesNotMatch(dashboard, /card\('Портали', '4'/, 'няма твърдо зададени стойности');

// 5. Статусната лента казва истината за връзката, а не „ДЕМО данни“.
assert.equal(/ДЕМО данни/.test(app), false, 'статусната лента не казва ДЕМО данни');
assert.match(app, /function updateBar\(\)/);
assert.match(app, /sessionStorage\.getItem\('hapiAdminToken'\)/);
assert.match(app, /t\('barConnected'\)/);

// 6. Няма изключени „планирано“ действия в менютата на файловете.
const portalFiles = read('hapi_enterprise/ui/portal-files.js');
assert.equal(/\ba\.planned\b/.test(portalFiles), false, 'менюто на файла не показва „скоро“');
assert.equal(/soon|скоро<\/small>/.test(portalFiles), false);

console.log('PASS dashboard: реални данни от API-то, без демо числа и без „планирано“ редове');
