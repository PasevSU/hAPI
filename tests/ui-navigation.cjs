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

// 1. Навигация: само реалните панели + Контакти и Дела.
const navBlock = app.slice(app.indexOf('const NAV = ['), app.indexOf('];', app.indexOf('const NAV = [')));
const ids = [...navBlock.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
assert.deepEqual(ids, ['dashboard', 'portals', 'contacts', 'cases', 'gateway', 'export', 'report', 'settings', 'about']);
for (const removed of ['users', 'jobs', 'storage', 'analytics', 'security', 'backups', 'qr']) {
  assert.equal(ids.includes(removed), false, `излишният панел ${removed} трябва да е премахнат`);
}
for (const lang of app.match(/bg: \{[\s\S]*?\n    \},/g)) {
  assert.match(lang, /contacts:/);
  assert.match(lang, /cases:/);
}

// 2. Панелите са заредени и монтирани.
assert.match(index, /<script src="directory-panel\.js"><\/script>/);
assert.match(index, /<script src="settings-panel\.js"><\/script>/);
assert.match(app, /window\.ContactsPanel\.mount\(view\)/);
assert.match(app, /window\.CasesPanel\.mount\(view\)/);
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

// 7. Диалогът „Сподели тайна“ е с класове от таблицата със стилове, не с inline стилове:
//    размерите идват от токените (--radius-sm, --surface-2, --text-dim), за да е съразмерен.
const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'admin.js'), 'utf8');
for (const cls of ['.secret-form', '.secret-link', '.secret-meta', '.secret-note', '.secret-receipt']) {
  assert.ok(adminHtml.includes(cls + ' {'), 'admin.html: липсва стил за ' + cls);
}
assert.ok(adminHtml.includes('.secret-form input,'), 'admin.html: полетата на диалога имат общ стил');
assert.match(adminHtml, /\.secret-form input,[\s\S]{0,400}border-radius: var\(--radius-sm\)/, 'полетата ползват токена за радиус');
const openSecret = adminJs.slice(adminJs.indexOf('function openSecretDialog()'), adminJs.indexOf('const secretShare'));
assert.ok(openSecret.length > 0, 'намирам openSecretDialog');
assert.equal(/\.style\./.test(openSecret), false, 'диалогът за тайна не пише inline стилове');
assert.match(openSecret, /className = 'secret-form'/);
assert.match(openSecret, /className = 'secret-link'/);
// Inline стиловете в admin.js не бива да растат. Базова линия 17: остават в QR/NFC диалога
// и йерархията (стар код); диалогът за тайна вече е изцяло с класове.
const cssTextCount = (adminJs.match(/style\.cssText/g) || []).length;
assert.ok(cssTextCount <= 17, `inline cssText в admin.js е ${cssTextCount}, над базовата линия 17 — ползвай клас`);

console.log('ui-navigation OK');
process.exit(0);
