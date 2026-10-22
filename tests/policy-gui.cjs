'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
// Политиките за достъп живеят в Enterprise Control Center: режими FREE / KEY_REQUIRED /
// DISABLED, издаване на ключ и преглед през /access — в файловия мениджър.
const ui = ['files-manager.js', 'portal-files.js', 'settings-panel.js']
  .map((f) => fs.readFileSync(path.join(root, 'hapi_enterprise/ui', f), 'utf8'))
  .join('\n');
const server = fs.readFileSync(path.join(root, 'hapi_enterprise/server.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'hapi_enterprise/ui/index.html'), 'utf8');
for (const x of ['FREE', 'KEY_REQUIRED', 'DISABLED', 'access-keys', '/access']) assert(ui.includes(x), x);
assert(index.includes('files-manager.js'), 'интерфейсът зарежда files-manager.js');
assert(/parts\[6\] === 'access-keys' && method === 'DELETE'/.test(server), 'няма маршрут за отнемане на ключ');
assert(/accessKeys:\s*\(f\.accessKeys\s*\|\|\s*\[\]\)\.map/.test(server), 'admin key inventory missing');
assert(!/localStorage\.setItem\s*\(\s*['"](?:token|secret|key|password|pass|auth|credential|session|signing|api-?key)/i.test(ui), 'secret must not persist in localStorage');
console.log('PASS: GUI policy controls (FREE/KEY_REQUIRED/DISABLED), key issuing, revoke route and admin key metadata');
