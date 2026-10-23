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

// 7. Таблото е и ВХОД към всички раздели, а не само числа.
// Дефектът, който това пази (0.69.45): таблото показваше 10 карти и нито едно действие —
// изглеждаше, че „опциите липсват“, макар да са в менюто на един клик. Списъкът НЕ се
// дублира в панела: идва от NAV през `HapiUI.nav()`, за да не изостава при нова секция.
assert.match(app, /window\.HapiUI = \{[^}]*nav: \(\) => NAV/, 'app.js трябва да издава NAV през HapiUI.nav()');
assert.match(dashboard, /HapiUI\.nav\(\)/, 'таблото взима списъка на разделите от навигацията');
assert.match(dashboard, /data-goto="/, 'всеки раздел е бутон на таблото');
assert.match(dashboard, /HapiUI\.go\(button\.dataset\.goto\)/, 'бутоните наистина сменят раздела');
const navIds = [...app.matchAll(/\{ id: '([a-z0-9_-]+)',\s*ico:/g)].map((m) => m[1]);
assert.ok(navIds.length >= 15, 'навигацията трябва да има поне 15 секции, а е ' + navIds.length);
assert.ok(dashboard.includes("item.id !== 'dashboard'"), 'таблото не слага бутон към себе си');

// 8. Ресурсите са от РЕАЛЕН маршрут, не измислени.
assert.match(dashboard, /\/admin\/api\/diagnostics/, 'ресурсите идват от /admin/api/diagnostics');
for (const field of ['heapUsedBytes', 'rssBytes', 'activeDownloadStreams', 'effectiveDownloadStreams', 'storage']) {
  assert.ok(dashboard.includes(field), 'таблото показва ' + field + ' от диагностиката');
  assert.ok(dashboard.includes(field) ? true : true);
}
assert.match(dashboard, /badge .*err|'badge ' \+/, 'липсващо хранилище се маркира като проблем');
assert.match(read('hapi_enterprise/ui/styles.css'), /\.quick-grid \{/, 'бързият достъп има стил');

console.log('PASS dashboard: реални данни от API-то · вход към ' + (navIds.length - 1) + ' раздела · ресурси от диагностиката');
