'use strict';
// ОРАКУЛ: проектът има ЕДНО дърво. Второ копие на UI-я не бива да съществува.
//
// Защо: до 0.69.19 в корена стоеше папка `ui/` — снимка от 0.54.0. Add-on-ът обаче сервира
// `hapi_enterprise/ui/` (Dockerfile: `COPY ui /app/ui/` в контекста на hapi_enterprise/,
// server.js: пътят се строи спрямо `__dirname`). Затова промяна в корена не променяше
// нищо: „прилагаме настройка, а тя не действа“ — защото се прилага на мъртво копие.
//
// Тестът пази три неща:
//   • в корена НЯМА папка `ui/` (единственото място е `hapi_enterprise/ui/`);
//   • нито един ресурс на UI-я (js/css/html) не съществува още веднъж в корена;
//   • скенерите и изданието гледат същото дърво (Dockerfile копира ui/, одитът не сканира
//     корена) — иначе „зелено“ може да значи „проверено някъде другаде“.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const addon = path.join(root, 'hapi_enterprise');
const ui = path.join(addon, 'ui');

// 1. Няма второ дърво на UI-я в корена.
assert.equal(
  fs.existsSync(path.join(root, 'ui')),
  false,
  'в корена има папка ui/ — това е второ копие; единственото място е hapi_enterprise/ui/'
);

// 2. Копието, което пазим, е това, което изданието копира.
assert.equal(fs.existsSync(path.join(ui, 'index.html')), true, 'липсва hapi_enterprise/ui/index.html');
assert.equal(fs.existsSync(path.join(addon, 'config.yaml')), true, 'config.yaml определя папката на add-on-а');
const dockerfile = fs.readFileSync(path.join(addon, 'Dockerfile'), 'utf8');
assert.match(dockerfile, /^COPY ui \/app\/ui\/$/m, 'Dockerfile не копира ui/ в образа');

// 3. Нито един ресурс на UI-я не съществува още веднъж в корена.
const ASSET = /\.(?:js|css|html)$/;
const uiAssets = fs.readdirSync(ui).filter((f) => ASSET.test(f));
const twins = uiAssets.filter((f) => fs.existsSync(path.join(root, f)));
assert.deepEqual(twins, [], 'ресурси на UI-я, дублирани в корена: ' + twins.join(', '));

// 4. Нито един модул на add-on-а не съществува още веднъж в корена.
const moduleTwins = fs.readdirSync(addon).filter((f) => f.endsWith('.js') && fs.existsSync(path.join(root, f)));
assert.deepEqual(moduleTwins, [], 'модули на add-on-а, дублирани в корена: ' + moduleTwins.join(', '));

// 5. Скенерите гледат същото дърво.
const logic = fs.readFileSync(path.join(root, 'scripts', 'logic-audit.cjs'), 'utf8');
const scanDirs = /SCAN_DIRS\s*=\s*\[([^\]]*)\]/.exec(logic);
assert(scanDirs, 'logic-audit.cjs: липсва SCAN_DIRS');
assert.match(scanDirs[1], /'hapi_enterprise'/, 'логическият одит не сканира add-on-а');
assert.doesNotMatch(scanDirs[1], /'ui'/, 'логическият одит сканира корен ui/, което вече не съществува');
const badCode = fs.readFileSync(path.join(root, 'scripts', 'bad-code-scan.cjs'), 'utf8');
assert.match(badCode, /'hapi_enterprise\/ui'/, 'скенерът за лош код не гледа hapi_enterprise/ui');

const count = fs.readdirSync(ui).length;
console.log(
  'PASS single-source: едно дърво — hapi_enterprise/ui/ (' +
  count +
  ' файла) · без копие в корена · Dockerfile копира същото · скенерите гледат него'
);
