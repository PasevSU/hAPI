'use strict';
// GUI навигация и панели: Контакти/Дела, Настройки с токен, публичен адрес за API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', rel), 'utf8');
const app = read('ui/app.js');
const index = read('ui/index.html');
const settings = read('ui/settings-panel.js');
const directory = read('ui/directory-panel.js');
const filesManager = read('ui/files-manager.js');
const css = read('ui/styles.css');

// 1. Навигация: панелите по плана (UI-01, §6.11) — 13 панела + Контакти, Дела и Кой влиза.
//    Панел без собствена логика не е забранен, стига да води към РЕАЛНА секция
//    (вж. проверката по-долу) — така няма празни екрани.
const navBlock = app.slice(app.indexOf('const NAV = ['), app.indexOf('];', app.indexOf('const NAV = [')));
const ids = [...navBlock.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
const PLANNED = [
  'dashboard', 'portals', 'contacts', 'cases', 'gateway', 'export',
  'users', 'jobs', 'storage', 'analytics', 'visitors', 'security', 'backups', 'qr',
  'report', 'settings', 'about',
];
assert.deepEqual(ids, PLANNED, 'навигацията следва плана: ' + PLANNED.length + ' панела');

// Всеки панел, който няма собствен модул, трябва да сочи към съществуваща секция.
const sections = ['general'].concat(
  (settings.match(/\{ id: '([a-z]+)', label:/g) || []).map((s) => s.match(/'([a-z]+)'/)[1]),
);
for (const item of navBlock.matchAll(/id: '([a-z]+)'[^}]*section: '([a-z]+)'/g)) {
  assert.ok(sections.includes(item[2]), `панелът ${item[1]} сочи към липсваща секция ${item[2]}`);
}
for (const lang of app.match(/bg: \{[\s\S]*?\n    \},/g)) {
  assert.match(lang, /contacts:/);
  assert.match(lang, /cases:/);
  // Заглавията на всички панели са преведени (BG/EN/DE), не са сурови id-та.
  for (const id of PLANNED) assert.match(lang, new RegExp('\\n\\s+' + id + ':'), 'липсва превод за ' + id);
}

// 2. Панелите са заредени и монтирани.
assert.match(index, /<script src="directory-panel\.js"><\/script>/);
assert.match(index, /<script src="visitors-panel\.js"><\/script>/);
assert.match(index, /<script src="settings-panel\.js"><\/script>/);
assert.match(app, /window\.ContactsPanel\.mount\(view\)/);
assert.match(app, /window\.CasesPanel\.mount\(view\)/);
assert.match(app, /window\.HapiVisitorsPanel\.mount\(view\)/);
assert.match(app, /window\.SettingsPanel\.mount\(view\)/);

// 3. Настройки: поле за токен + публичен адрес (сървърна настройка).
assert.match(settings, /id="set-token"/);
assert.match(settings, /type="password"/);
assert.match(settings, /sessionStorage\.setItem\('hapiAdminToken'/);
assert.match(settings, /localStorage\.setItem\('hapi\.apiBase'/);
assert.match(settings, /\/admin\/api\/connection/);
assert.match(settings, /\/admin\/api\/settings/);
assert.match(settings, /publicBaseUrl/);
assert.match(settings, /id="set-public-save"/);
assert.match(settings, /id="set-pgp-import"/);
assert.match(settings, /\/admin\/api\/pgp\/keys\/import/);
assert.match(settings, /k\.source === 'bundle'/);
assert.match(settings, /k\.roles/);

// 4. Контакти и дела: реалните административни маршрути + полета по желание.
assert.match(directory, /\/admin\/api\/directory/);
assert.match(directory, /\/admin\/api\/directory\/contacts/);
assert.match(directory, /\/admin\/api\/cases/);
assert.match(directory, /data-extra-key/);
assert.match(directory, /data-contact/);
assert.match(directory, /data-case/);
assert.match(directory, /class="u-row u-row-2/);

// 5. Публичните препратки ползват публичния адрес, а не Ingress пътя.
assert.match(filesManager, /const publicBase = \(\) => \(state\.publicBaseUrl \|\| base\(\)/);
assert.match(filesManager, /buildApiRecord\(portalObj, \{ baseUrl: publicBase\(\) \}\)/);
assert.match(filesManager, /return `\$\{publicBase\(\)\}\/api\/public\/v1\/files/);
assert.match(filesManager, /\/admin\/api\/connection/);

// 5б. RFC 3161 START / STOP блокът (порт от HASH_REPORT): TSA URL-и, два бутона
// и резултат; токенът идва само от сървъра, никога от интерфейса.
const reportStudio = read('ui/report-studio.js');
for (const marker of ['rs-tsa-start-url', 'rs-tsa-stop-url', 'rs-tsa-start', 'rs-tsa-stop', 'rs-tsa-result']) {
  assert.ok(reportStudio.includes(marker), 'Report Studio: липсва ' + marker);
}
assert.match(reportStudio, /https:\/\/zeitstempel\.dfn\.de\//);
assert.match(reportStudio, /http:\/\/timestamp\.digicert\.com/);
assert.match(reportStudio, /\/admin\/api\/v2\/rfc3161/);
assert.match(reportStudio, /JSON\.stringify\(\{ phase, manifest: result\.manifest, url \}\)/);
assert.equal(/token\s*[:=]\s*['"][a-f0-9]{40,}/i.test(reportStudio), false, 'интерфейсът не измисля токени');

// 6. Табелки: еднакъв стил и големина за всички (chip/badge/state-chip) и по-добър контраст на картите.
assert.match(css, /--card: #13233c;/);
assert.match(css, /\.chip,\s*\.flag-badge,\s*\.state-chip,\s*\.badge,\s*\.fm-ico \{/);
assert.match(css, /\.state-chip::before \{|\.chip::before,/);
assert.match(css, /\.pf-portal \{[^}]*border-left: 3px solid var\(--accent-2\)/);
assert.match(filesManager, /class="chip \$\{x\.visibility === 'public' \? 'ok' : ''\}"/);

// 7. Новият интерфейс държи всички размери и цветове в styles.css: без inline стилове
//    в HTML и без style.cssText в скриптовете (старият панел ги имаше — той е премахнат).
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', 'index.html'), 'utf8');
const settingsPanel = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', 'settings-panel.js'), 'utf8');
assert.ok(indexHtml.includes('href="styles.css"'), 'index.html зарежда styles.css');
assert.equal(/<style[\s>]/.test(indexHtml), false, 'index.html няма вграден <style> блок');
assert.ok(settingsPanel.includes('class="set-tabs"'), 'табовете ползват клас от styles.css');
assert.match(css, /\.set-tabs \{/, 'styles.css описва .set-tabs');
assert.match(css, /\.set-tab\.active \{/, 'styles.css описва активния таб');
const inlineStyles = fs
  .readdirSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'ui', f), 'utf8'))
  .join('\n');
const cssTextCount = (inlineStyles.match(/style\.cssText/g) || []).length;
assert.equal(cssTextCount, 0, `интерфейсът пише inline cssText (${cssTextCount} места) — ползвай клас`);

console.log('ui-navigation OK');
process.exit(0);
