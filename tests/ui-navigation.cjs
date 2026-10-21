'use strict';
// GUI навигация и панели: Контакти/Дела, Настройки с токен, публичен адрес за API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
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

// 6. Табелки: еднакъв стил и големина за всички (chip/badge/state-chip) и по-добър контраст на картите.
assert.match(css, /--card: #13233c;/);
assert.match(css, /\.chip,\s*\.flag-badge,\s*\.state-chip,\s*\.badge,\s*\.fm-ico \{/);
assert.match(css, /\.state-chip::before \{|\.chip::before,/);
assert.match(css, /\.pf-portal \{[^}]*border-left: 3px solid var\(--accent-2\)/);
assert.match(filesManager, /class="chip \$\{x\.visibility === 'public' \? 'ok' : ''\}"/);

console.log('ui-navigation OK');
process.exit(0);
