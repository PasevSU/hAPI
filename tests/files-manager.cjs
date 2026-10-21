'use strict';
// F1–F3: модулът за управление на файлове в порталите.
// Проверява договора: 11 действия по план 17 §3.1, реални endpoints, без фиктивни бутони.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const m = require('../ui/files-manager.js');

// 1. Действията: 11 по план 17 §3.1 + „Пакет (ZIP)“ + „Бележка“ (добави/редактирай).
assert.equal(m.ACTIONS.length, 13);
const ids = m.ACTIONS.map((a) => a.id);
assert.deepEqual(
  [...ids].sort(),
  ['access', 'copy', 'delete', 'download', 'encrypt', 'metadata', 'move', 'note', 'package', 'preview', 'rename', 'share', 'versions'].sort(),
);
assert.equal(new Set(ids).size, ids.length);

// 2. Само преместване и копиране са планирани (без backend endpoints).
assert.deepEqual(
  m.ACTIONS.filter((a) => a.planned).map((a) => a.id).sort(),
  ['copy', 'move'],
);
assert.ok(m.ACTIONS.filter((a) => !a.planned).every((a) => typeof a.label === 'string' && a.label.length > 0));

// 3. Нормализация на файл: безопасни default-и.
const f = m.normalizeFile({ id: 'x', name: 'a.pdf' });
assert.equal(f.accessMode, 'FREE');
assert.equal(f.listed, true);
assert.equal(f.version, 1);
assert.deepEqual(f.tags, []);
assert.deepEqual(f.versions, []);

// 4. Изходният код ползва реалните административни endpoints.
//    Порталът е разделен на три модула (контролен панел · папки · файлове),
//    затова src е сборът от тях — проверките важат за целия интерфейс.
const uiSrc = (name) => fs.readFileSync(path.join(__dirname, '..', 'ui', name), 'utf8');
const src = ['files-manager.js', 'portal-control.js', 'portal-folders.js', 'portal-files.js'].map(uiSrc).join('\n');
for (const endpoint of [
  '/preview',
  '/download',
  '/versions',
  '/versions/${vn}/restore',
  '/metadata',
  '/access',
  '/access-keys',
  '/files/bulk-access',
]) {
  assert.ok(src.includes(endpoint), `липсва endpoint ${endpoint}`);
}
assert.match(src, /X-File-Name/);
assert.match(src, /X-Version-Note/);
assert.match(src, /X-File-Encrypt/);
assert.match(src, /hapiAdminToken/);
assert.match(src, /hapi\.apiBase/);

// 5. Демо режимът е честен: file:// не прави мрежови заявки и не твърди трансфер.
assert.match(src, /location\.protocol === 'file:'/);
assert.match(src, /app\|hapi\|hassio/);
assert.match(src, /async function testConnection/);
assert.equal((src.match(/Демо:/g) || []).length >= 3, true);

// 6. Порталът и файловете са един модул: акордеон на портал и на файл.
assert.match(src, /pf-portal/);
assert.match(src, /data-open-portal/);
// Файловете се показват като карти с отделен ред за иконите (без тясна таблица).
assert.match(src, /fm-files/);
assert.match(src, /fm-file-head/);
assert.match(src, /fm-file-name/);
assert.match(src, /fm-detail/);assert.match(src, /Контролен панел на портала/);
assert.match(src, /createPortal/);
assert.match(src, /generateApi/);
assert.match(src, /qrSvg/);
assert.match(src, /Създай и генерирай API \+ QR/);
assert.match(src, /openapi\.json/);
assert.match(src, /fm-bulk/);
assert.match(src, /bulk-access/);
assert.match(src, /Нов ключ/);
// 7. Дата, бележки, категории, теми, id и филтри с тях.
assert.match(src, /createdAt/);
assert.match(src, /notes/);
assert.match(src, /visiblePortals/);
assert.match(src, /portalQuery/);
assert.match(src, /portalSort/);
assert.match(src, /notesOnly/);
assert.match(src, /fm-topic/);
assert.match(src, /fm-category/);
assert.match(src, /Бележки/);
assert.match(src, /sort: '-date'/);
assert.equal(m.normalizeFile({ id: 'x', name: 'a.pdf' }).notes, '');
// 7б. Порталът има категория, флаг и „Относно“ (напр. посещение на лице).
assert.match(src, /const FLAGS =/);
assert.match(src, /flagOf/);
assert.match(src, /name="subject"/);
assert.match(src, /name="category"/);
assert.match(src, /name="flag"/);
assert.match(src, /Относно:/);
assert.match(src, /flag-badge/);
assert.match(src, /посещение на лице/);
// 7в. При създаване на портал може да се посочи папка с файлове.
assert.match(src, /storage_root/);
assert.match(src, /name="storage_root"/);
assert.match(src, /pf-folder/);
assert.match(src, /webkitdirectory/);
assert.match(src, /function folderFiles/);
assert.match(src, /async function uploadFolderFiles/);
// 7г. Контакт: избор от контактите или добавяне на нов.
assert.match(src, /NEW_CONTACT/);
assert.match(src, /function contactSelect/);
assert.match(src, /function newContactFields/);
assert.match(src, /async function ensureContact/);
assert.match(src, /function loadContacts/);
assert.match(src, /name="contact_name"/);
assert.match(src, /name="contact_email"/);
assert.match(src, /const contactOf =/);
assert.match(src, /const contactLabel =/);
// 7д. Дело (case) като втори избор + полета по желание за контакт и за дело.
assert.match(src, /NEW_CASE/);
assert.match(src, /function caseSelect/);
assert.match(src, /function newCaseFields/);
assert.match(src, /async function ensureCase/);
assert.match(src, /async function loadCases/);
assert.match(src, /data-extra-key/);
assert.match(src, /data-extras-add/);
assert.match(src, /function readExtras/);
assert.match(src, /function wireExtras/);
assert.match(src, /\/admin\/api\/cases/);
assert.equal(m.normalizeCase({ id: 'k', number: '1', title: 'T', extras: [{ key: 'a', value: 'b' }, { value: 'x' }] }).extras.length, 1);
assert.equal(m.normalizeContact({ id: 'c', extras: [{ key: 'Роля', value: 'адвокат' }] }).extras[0].key, 'Роля');
// 7е. Стандарт на подредбата: всичко в проценти + фиксиран брой обекти на ред.
const css = fs.readFileSync(path.join(__dirname, '..', 'ui', 'styles.css'), 'utf8');
assert.match(css, /--w-100: 100%/);
assert.match(css, /--grid-gap: 0\.8%/);
assert.match(css, /--per-row-actions:/);
assert.match(css, /--per-row-chips:/);
assert.match(css, /--per-row-fields:/);
assert.match(css, /--cols-pct: calc\(/);
assert.match(css, /--chips-pct: calc\(/);
assert.match(css, /--fields-pct: calc\(/);
assert.match(css, /\.u-grid-actions \{ grid-template-columns: repeat\(var\(--per-row-actions\), var\(--cols-pct\)\)/);
assert.match(css, /\.u-grid-chips \{ grid-template-columns: repeat\(var\(--per-row-chips\), var\(--chips-pct\)\)/);
assert.match(css, /\.u-grid-fields \{ grid-template-columns: repeat\(var\(--per-row-fields\), var\(--fields-pct\)\)/);
assert.match(css, /\.fm-actions \{ display: grid; grid-template-columns: repeat\(var\(--per-row-actions\), var\(--cols-pct\)\)/);
// Панелите от опциите: по-малък мащаб, височина по съдържанието, но НЕ повече от 80% от прозореца.
assert.match(css, /\.fm-modal-box \{\s*width: 42%; min-width: 22em; max-width: 640px;\s*height: auto; max-height: 80vh;/);
assert.match(css, /\.fm-modal-box \{ width: 96%; min-width: 0; max-height: 92vh; font-size: 1em; \}/);
assert.equal(/--cell-min/.test(css), false, 'няма фиксиран праг в px');
// 7з. Равни обекти навсякъде: редовете с бутони и легендата са процентни мрежи, не flex.
assert.equal(/--per-row-legend|--legend-pct/.test(css), false, 'легендата е премахната заедно с токените си');
assert.match(css, /\.u-row \{[^}]*display: grid/);
// 7з. Бутоните са на собствен ред: 1 → 1/4 плътно вдясно, 2 → половинки, 3 → третини.
assert.match(css, /\.u-row-1 \{ grid-template-columns: repeat\(4, calc\(\(var\(--w-100\) - 3 \* var\(--grid-gap\)\) \/ 4\)\); justify-content: end; \}/);
assert.match(css, /\.u-row-1 > \* \{ grid-column: 4; \}/);
assert.match(css, /\.u-row-2 \{ grid-template-columns: repeat\(2, calc\(\(var\(--w-100\) - var\(--grid-gap\)\) \/ 2\)\)/);
assert.match(css, /\.u-row-3 \{ grid-template-columns: repeat\(3, calc\(\(var\(--w-100\) - 2 \* var\(--grid-gap\)\) \/ 3\)\)/);
assert.match(css, /\.u-row-4 \{ grid-template-columns: repeat\(4, calc\(\(var\(--w-100\) - 3 \* var\(--grid-gap\)\) \/ 4\)\)/);
// Падащите менюта във филтрите са максимум 3 на ред.
assert.match(css, /\.fm-toolbar \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(css, /\.fm-ico-row \{[\s\S]*?display: grid[\s\S]*?repeat\(var\(--per-row-chips\), var\(--chips-pct\)\)/);
assert.match(css, /\.pf-extra-row \{ display: grid; grid-template-columns: 36% 1fr 8%/);
assert.match(css, /\.fm-file-head \{[\s\S]*?grid-template-columns: 2\.2em minmax\(0, 1fr\) auto;/);
// Баджовете са ПОД името (втори ред), а ⚙ е в горния десен ъгъл.
assert.match(src, /class="fm-file-title"/);
assert.match(src, /class="fm-file-badges"/);
assert.match(src, /class="fm-ico-btn fm-opts \$\{gear \? 'on' : ''\}" data-file-gear=/);
assert.match(css, /\.fm-file-badges \{ display: flex; flex-wrap: wrap;/);
assert.match(css, /\.fm-opts \{ align-self: start; justify-self: end; \}/);
// ⚙ на файла отваря изскачащо контекстно меню (като при папките), не панела.
assert.match(src, /class="fm-gear fm-file-gear" data-gear-for=/);
assert.match(src, /data-file-act="\$\{esc\(\s*a\.id,/);
assert.match(src, /data-file-id="\$\{esc\(x\.id\)\}"/);
assert.match(src, /fileGear: null/);
assert.match(src, /state\.fileGear = state\.fileGear === id \? null : id;/);
assert.match(src, /ACTIONS: ACTIONS\.concat\(EXTRA_ACTIONS\)/);
assert.match(src, /target\.closest\('\[data-file-gear\]'\)/);
assert.match(css, /\.fm-file \{[\s\S]*?position: relative;/);
assert.match(css, /\.fm-file-gear \{ top: calc\(1\.9em \+ 14px\); right: 1\.2%;/);
assert.match(css, /\.fm-gear-item\.danger:hover/);
// Икони-пряк път: 👁/🚫 видимост и 🔒/🔓 заключване — за файлове и за папки.
assert.match(src, /class="fm-file-icons"/);
assert.match(src, /data-file-listed="\$\{esc\(\s*x\.id,/);
assert.match(src, /data-file-lock="\$\{esc\(\s*x\.id,/);
assert.match(src, /ICON\.eye : ICON\.eyeOff/);
assert.match(src, /async function toggleListed\(fileId\)/);
assert.match(src, /json: \{ listed \}/);
assert.match(src, /data-folder-flag-btn="visible" data-folder-flag-path=/);
assert.match(src, /data-folder-flag-btn="locked" data-folder-flag-path=/);
assert.match(css, /\.fm-file-icons \{ display: flex; align-items: center; gap: 2px;/);
assert.match(css, /\.fm-ico-btn\.off \{ opacity: 0\.55; \}/);
// Копирай е ИКОНА в края на реда — без текстов бутон в адресните редове.
assert.match(src, /class="fm-ico-btn fm-copy-btn" data-copy=/);
assert.equal(/data-copy="\$\{esc\(\s*webLink\(f\),\s*\)\}"[^>]*>Копирай</.test(src), false, 'DL URL редът не носи текстов бутон');
assert.match(css, /\.fm-url \.fm-copy-btn \{ margin-left: auto; flex: 0 0 auto; \}/);
// Иконите са един набор вградени SVG (ui/icons.js) — без шрифт-икони и без CDN.
assert.match(src, /get copy\(\) \{\s*return ico\('copy'\);/);
assert.match(src, /\{ id: 'preview', label: 'Преглед', icon: 'preview' \}/);
assert.match(src, /\{ id: 'share', label: 'Сподели \/ QR', icon: 'share' \}/);
assert.match(src, /\{ id: 'delete', label: 'Изтрий', icon: 'delete' \}/);
assert.equal(/\{ id: '[a-z]+', label: '[^']+', icon: '(⧉|⧈|≡|ⓘ|⚿|⇱|✕|⤓|⤢|↔|🗜|⚑)'/.test(src), false, 'няма символни икони в действията');
assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(src), false, 'няма емоджи-икони в интерфейса на портала');
// Флаговете пазят ТЕКСТОВ маркер — SVG не се рисува в <option> на падащо меню.
assert.match(src, /\{ id: 'important', label: 'важно', icon: '★', cls: 'warn' \}/);
assert.match(src, /\{ id: 'urgent', label: 'спешно', icon: '!', cls: 'err' \}/);
// Спрайтът е отделен модул и се зарежда преди files-manager.js.
assert.ok(fs.readFileSync(path.join(__dirname, '../ui/icons.js'), 'utf8').includes('window.HapiIcons'));
assert.match(fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8'), /<script src="icons\.js"><\/script>/);
// Плочките на действията са наполовина по-малки.
assert.match(css, /\.fm-action \{[\s\S]*?min-height: calc\(var\(--tile-h\) \/ 2\)/);
// Всички табелки са с един стил и големина; разделителни ленти между секциите.
assert.match(css, /\.chip,\s*\.flag-badge,\s*\.state-chip,\s*\.badge,\s*\.fm-ico \{/);
assert.match(css, /\.u-divider \{ border: 0; border-top: 1px solid var\(--line\)/);
assert.match(src, /<hr class="u-divider" \/>/);
// Икона на файла вместо чекбокс + пълен стек с хешове.
assert.match(src, /function fileGlyph/);
assert.match(src, /class="fm-pick /);
assert.equal(/<input type="checkbox" data-pick/.test(src), false, 'няма чекбокс пред файла');
assert.match(src, /function hashStack/);
assert.match(src, /\/hashes`/);
assert.match(src, /data-pkg-portal/);
assert.match(src, /includeStorage: true/);
assert.equal(/class="export-row"[\s\S]{0,80}<button type="button" class="btn/.test(src), false, 'редовете с бутони са u-row, не export-row');
assert.match(src, /class="u-row u-row-2"/);
assert.match(src, /class="u-row u-row-3"/);
assert.match(src, /class="fm-ico-row u-grid u-grid-chips"/);
assert.match(src, /class="u-grid u-grid-fields"/);
// 7и. Шрифтовете също са в проценти: няма нито един font-size в px, има обща скала.assert.equal(/font-size:\s*[\d.]+px/.test(css), false, 'няма font-size в px');
assert.match(css, /html \{ font-size: 100%; \}/);
assert.match(css, /font-size: 87\.5%;/);
assert.match(css, /--fs-10-5: 75%;/);
assert.match(css, /--fs-11-5: 82%;/);
assert.match(css, /--fs-12-5: 89%;/);
assert.match(css, /--fs-14: 100%;/);
assert.match(css, /--fs-20: 143%;/);
assert.match(css, /code, kbd, samp, pre \{ font-family: ui-monospace/);
assert.ok((css.match(/font-size: var\(--fs-/g) || []).length >= 40, 'скалата се ползва навсякъде');
assert.match(css, /\.a4 \{[\s\S]*?font-size: var\(--fs-9-5\)/);
// 7к. Пакет с файловете на портала: само създаване/изтегляне. Автоподписването с PGP
// живее в „Настройки“ — в панела на портала няма чекбокс, ключове и .asc бутони.
assert.match(src, /function buildPackage/);
assert.match(src, /\/admin\/api\/packages/);
assert.doesNotMatch(src, /function packagePane/);
assert.doesNotMatch(src, /function verifyPackage/);
assert.doesNotMatch(src, /function loadPackageState/);
assert.doesNotMatch(src, /id="pf-pkg-sign"/);
assert.doesNotMatch(src, /id="pf-pkg-key"/);
assert.doesNotMatch(src, /id="pf-pkg-build"/);
assert.doesNotMatch(src, /id="pf-pkg-zip"/);
assert.doesNotMatch(src, /id="pf-pkg-asc"/);
assert.doesNotMatch(src, /id="pf-pkg-verify"/);
assert.doesNotMatch(src, /Автоподписване с PGP/);
assert.match(src, /includeStorage/);
assert.ok(m.ACTIONS.some((a) => a.id === 'package' && /Пакет/.test(a.label)));
// 7л. Настройки: прикачане на PGP ключ + падащо меню за автоподписване (без генериране).
const settingsSrc = fs.readFileSync(require('node:path').join(__dirname, '..', 'ui', 'settings-panel.js'), 'utf8');
assert.match(settingsSrc, /\/admin\/api\/pgp\/keys/);
assert.match(settingsSrc, /id="set-pgp-attach"/);
assert.match(settingsSrc, /id="set-pgp-key"/);
assert.match(settingsSrc, /id="set-pgp-autosign"/);
assert.match(settingsSrc, /<select id="set-pgp-autosign"/);
assert.match(settingsSrc, /Изключено/);
assert.match(settingsSrc, /Включено/);
assert.match(settingsSrc, /Автоподписване с PGP/);
assert.match(settingsSrc, /secretArmored/);
assert.doesNotMatch(settingsSrc, /algorithm: *'ed25519'|Генерирай ключ|generate/);
assert.match(settingsSrc, /OpenPGP v\$\{/);
// Експорт центърът също не пита за PGP — само портал и бутони за пакета.
const exportSrc = fs.readFileSync(require('node:path').join(__dirname, '..', 'ui', 'export-center.js'), 'utf8');
assert.doesNotMatch(exportSrc, /ec-pkg-sign|ec-pkg-key|Автоподписване с PGP/);
assert.match(exportSrc, /ec-pkg-build/);
assert.match(exportSrc, /Настройки → PGP ключ и автоподписване/);
// Свързаният режим взима порталите от add-on-а, а не демо данните.
assert.match(src, /async function loadPortals/);
assert.match(src, /then\(loadPortals\)/);
// 7ж. Действията са бутони (както в първоначалната версия), а панелите се отварят в прозорец.
assert.match(src, /class="fm-actions"/);
assert.match(src, /data-act="\$\{/);
assert.match(src, /function openPanelModal/);
assert.match(src, /function refreshPanel/);
assert.match(src, /function closePanel/);
assert.match(src, /const PANEL_TITLES/);
assert.match(src, /function apiMenu/);
assert.match(src, /data-api-copy/);
assert.match(src, /data-api-open/);
assert.match(src, /data-api-dl/);
assert.match(src, /function showModal/);
assert.match(src, /function ensureModal/);
assert.match(src, /m\.id = 'fm-modal'/);
assert.match(src, /function wireMenus/);
assert.equal(/window\.open/.test(src), false, 'прегледът не отваря нов таб');
assert.equal(/target="_blank"/.test(src), false);
assert.equal(/fm-actions-btn/.test(src), false, 'менюто с действия е заменено от бутоните');
const nc = m.normalizeContact({ id: 'c9', email: 'a@b.co', fields: { name: 'Тест', phone: '+1 2' } });
assert.equal(nc.name, 'Тест');
assert.equal(nc.phone, '+1 2');
assert.equal(nc.email, 'a@b.co');
// 8. Сървърът приема и връща бележки (портал и файл).
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'server.js'), 'utf8');assert.match(serverSrc, /notes:p\.notesText\|\|''/);
assert.match(serverSrc, /notes:f\.notes\|\|''/);
assert.match(serverSrc, /meta\.notes=clean\(b\.notes\)/);
assert.match(serverSrc, /if\(b\.notes!==undefined\)p\.notesText=clean\(b\.notes\)/);
assert.match(serverSrc, /category:p\.category\|\|''/);
assert.match(serverSrc, /subject:p\.subject\|\|''/);
assert.match(serverSrc, /flag:p\.flag\|\|'none'/);
assert.match(serverSrc, /const portalFlag=/);
assert.match(serverSrc, /const portalRoot=/);
assert.match(serverSrc, /storage_root:portalRoot\(b\.storage_root\)/);
assert.match(serverSrc, /if\(b\.storage_root!==undefined\)p\.storage_root=portalRoot\(b\.storage_root\)/);
assert.match(serverSrc, /contactId:portalContact\(db,b\.contactId\)/);
assert.match(serverSrc, /if\(b\.contactId!==undefined\)p\.contactId=portalContact\(db,b\.contactId\)/);
assert.match(serverSrc, /if\(b\.caseId!==undefined\)p\.caseId=portalCase\(db,b\.caseId\)/);
assert.match(serverSrc, /parts\[3\]==='contacts'&&parts\.length===4&&method==='POST'/);
const casesSrc = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'cases.js'), 'utf8');
assert.match(casesSrc, /function addCase/);
assert.match(casesSrc, /function caseView/);
assert.match(casesSrc, /sanitizeExtras/);
// Горните табели (Проект/Среда/Криптография/Модули) са премахнати от заглавната лента.
const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
assert.equal(/chip-project|chip-env|chip-modules|class="chips"/.test(indexSrc), false);
// 9. Метаданните се илюстрират с икони: създаден, качен, промяна, хеш, заключване.
// (В Node няма DOM, затова SVG-то е празно — проверяваме, че ключовете съществуват.)
assert.ok(
  m.ICON && 'created' in m.ICON && 'uploaded' in m.ICON && 'modified' in m.ICON && 'hash' in m.ICON && 'locked' in m.ICON,
);
assert.match(src, /fm-ico-row/);
assert.match(src, /function metaChips/);
// Пояснението на иконите е премахнато от интерфейса (иконите са самоописателни).
assert.equal(/iconLegend|fm-icon-legend/.test(src), false, 'няма легенда на иконите');
assert.equal(/\.fm-icon-legend/.test(css), false, 'няма CSS за легендата');
const nf = m.normalizeFile({ id: 'y', name: 'b.pdf', uploadedAt: '2026-01-02T03:04:05.000Z' });
assert.equal(nf.createdAt, '2026-01-02T03:04:05.000Z');
assert.equal(nf.modifiedAt, '2026-01-02T03:04:05.000Z');
assert.equal(nf.locked, false);
assert.equal(nf.lockedBy, '');
assert.equal(m.normalizeFile({ id: 'z', locked: true, lockedBy: 'admin' }).locked, true);
// Заключването е допълнително действие (извън 11-те по план 17 §3.1) и има backend маршрут.
assert.deepEqual(m.EXTRA_ACTIONS.map((a) => a.id), ['lock']);
assert.match(serverSrc, /parts\[6\]==='lock'&&method==='PATCH'/);
assert.match(serverSrc, /locked:!!f\.locked/);
assert.match(serverSrc, /f\.modifiedAt=new Date\(\)\.toISOString\(\)/);
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
assert.match(indexHtml, /qrcode\.js/, 'QR библиотеката се зарежда в GUI-я');

// 7. Сървърът предлага административно изтегляне (иначе „Изтегли“ би бил декоративен).
const server = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'server.js'), 'utf8');
assert.match(server, /parts\[6\]==='download'&&method==='GET'/);
assert.match(server, /file\.download\.admin/);

// 10. Папките на портала: скриващо се меню за всяка папка (отворена е само една).
assert.match(src, /const plural = \(n, one, many\)/);
assert.match(src, /tree: \{ portalId: '', loaded: false, error: '', data: null, open: null \}/, 'open е един път, не Set');
// По подразбиране всичко е СВИТО, а панелът с филтри е изключен.
assert.match(src, /filters: false/);
assert.match(src, /function folderMenu\(node, depth, ctx\)/);
assert.match(src, /function folderMenus\(root\)/);
assert.match(src, /class="fm-folder-head"/);
assert.match(src, /class="fm-folder-tog" data-folder="\$\{esc\(key\)\}"/);
assert.match(src, /aria-expanded="\$\{open\}"/);
// Икона на папка + име + брой файлове + общ обем в заглавието на менюто.
assert.match(src, /fm-folder-ico" aria-hidden="true">\$\{ico\(open \? 'folderOpen' : 'folder'\)\}/);
assert.match(src, /class="fm-folder-name"/);
assert.match(src, /plural\(count, 'файл', 'файла'\)/);
assert.match(src, /esc\(fmtSize\(bytes\)\)/);
// Иконите на реда: добави файл, пакет на папката, разгъни и ⚙ меню с флагове.
assert.match(src, /data-folder-upload="\$\{esc\(key\)\}"/);
assert.match(src, /data-folder-pkg="\$\{esc\(key\)\}"/);
assert.match(src, /data-folder-gear="\$\{esc\(key\)\}"/);
assert.match(src, /data-folder-comment-open="\$\{esc\(key\)\}"/);
// Менюто е контекстно: текстови редове с отметка (вкл./изкл.), не чекбокси.
assert.match(src, /const gearItem = \(flag, label, on\)/);
assert.match(src, /data-folder-flag-btn="\$\{flag\}"/);
// Щракването върху точка от менюто го затваря веднага (null = затворено).
assert.match(src, /state\.gear = null;\s*\n\s*void saveFolderFlag\(rel, \{ \[flag\]: !current\[flag\] \}\);/);
assert.match(src, /const gear = state\.gear !== null && state\.gear === key;/);
assert.match(src, /gearItem\('visible', 'видима', flags\.visible\)/);
assert.match(src, /gearItem\('media', 'медийна', flags\.media\)/);
assert.match(src, /gearItem\('locked', 'заключване', flags\.locked\)/);
assert.match(src, /class="fm-gear" data-gear-for=/);
assert.match(src, /class="fm-gear-sep"/);
assert.equal(/data-folder-flag="visible"/.test(src), false, 'няма чекбокси в менюто');
assert.match(src, /async function saveFolderFlag\(rel, patch\)/);
assert.match(src, /method: 'PATCH', json: \{ path: rel, \.\.\.patch \}/);
assert.match(src, /function folderFlags\(rel\)/);
assert.match(src, /async function packageFolder\(rel\)/);
assert.match(src, /storagePath: treePath\(rel\)/);
// Файловете на папката отиват в „Файлове в портала“ с пълен път (/папка/файл.txt).
assert.match(src, /path: treePath\(tf\.path \|\| name\)/);
assert.match(src, /out\.push\(Object\.assign\(\{\}, reg, \{ storagePath: treePath\(tf\.path \|\| name\) \}\)\)/);
assert.match(src, /class="fm-file-sub">\$\{ICON\.folder\} <code title="\$\{esc\(x\.path\)\}">\$\{esc\(x\.path\)\}<\/code>/);
assert.match(src, /const treePath = \(rel\) => `\/\$\{String\(rel \|\| ''\)/);
// Отваря се само една папка — останалите се затварят; повторно щракване я затваря.
assert.match(src, /state\.tree\.open = state\.tree\.open === rel \? null : rel;/);
assert.equal(/state\.tree\.open\.(add|delete|has)\(/.test(src), false, 'няма много отворени папки (Set)');
assert.equal(/allFolderPaths|data-tree-toggle|fm-tree-expand|fm-tree-filter/.test(src), false, 'няма мъртви манипулатори');
assert.match(src, /data-folder-qr="\$\{esc\(key\)\}"/);
assert.match(src, /#fm-tree-refresh/);
// CSS за папките: редове, отстъп по дълбочина и табелки с еднакъв размер.
assert.match(css, /\.fm-folders \{ display: flex; flex-direction: column/);
assert.match(css, /\.fm-folder-head \{[\s\S]*?font: inherit;/);
const folderHead = (css.match(/\.fm-folder-head \{[^}]*\}/) || [''])[0];
assert.equal(/font-size/.test(folderHead), false, 'табелките в менюто запазват стандартния си размер');
assert.match(css, /\.fm-folder-name \{[\s\S]*?font-size: var\(--fs-12-5\)/);
assert.match(css, /\.fm-folder\[data-depth="1"\] \.fm-folder-name \{ padding-left: 0\.7em; \}/);
// Изобразяването на файловете (картите) не се променя — папките са отделен блок.
assert.match(src, /function portalDetail\(p\)/);
assert.match(
  src,
  /<h5>\$\{ico\('file'\)\} Файлове в портала \(\$\{scoped\.length\}\) · <code>\$\{esc\(treePath\(scope\)\)\}<\/code><\/h5>/,
  'заглавието показва папката и броя файлове',
);
// Икони в заглавния ред: прикачи папка, прикачи файл, панел филтри.
assert.match(src, /data-import-folder title="Прикачи папка с файлове в \$\{esc\(/);
assert.match(src, /data-attach-file title="Прикачи файл в/);
assert.match(src, /data-toggle-filters aria-expanded="\$\{\s*state\.filters\s*\}"/);
assert.match(src, /id="fm-file-input" class="u-hidden" multiple/);
assert.match(src, /id="fm-dir-input" class="u-hidden" webkitdirectory directory multiple/);
assert.match(src, /async function uploadToStorage\(folderRel, fileList\)/);
assert.match(src, /\/tree\/upload\?path=/);
assert.match(src, /webkitRelativePath/);
assert.match(src, /state\.filters = !state\.filters;/);
assert.match(src, /<article class="fm-file /);

// 11. Порталите се отварят един по един: отворен портал се показва сам, а в края
// на страницата има бутон за връщане към списъка.
assert.match(src, /function portalCard\(x, i, single\)/);
assert.match(src, /const openP = state\.openPortal \? state\.portals\.find\(\(x\) => x\.id === state\.openPortal\) \|\| null : null;/);
assert.match(src, /const list = openP \? \[openP\] : visiblePortals\(\);/);
assert.match(src, /data-close-portal>← Списък с портали<\/button>/);
assert.match(src, /host\.querySelectorAll\('\[data-close-portal\]'\)/);
assert.match(src, /state\.openPortal = target\.id;/);
assert.match(src, /class="pf-portal-title"/);
assert.equal(/state\.openPortal = opening \? state\.portals\[i\]\.id : null;/.test(src), false, 'щракването не затваря портала');
// Изходното състояние е списъкът (няма автоматично отваряне).
assert.equal(/state\.openPortal = state\.portals\[0\]\.id;/.test(src), false, 'няма автоматично отваряне на първия портал');
assert.match(src, /Файлове на страницата|Списък с портали/);

// 12. Папки: отделен блок с ясна граница, нова папка и коментар към папка.
assert.match(src, /class="fm-folders-box"/);
assert.match(src, /class="fm-files-box u-mt"/);
assert.match(src, /id="fm-new-folder"/);
assert.match(src, /id="fm-new-folder-form"/);
assert.match(src, /async function createFolder\(name\)/);
assert.match(src, /\/tree\/folder`/);
assert.match(src, /async function saveFolderComment\(rel, text\)/);
assert.match(src, /\/tree\/comment`/);
assert.match(src, /data-folder-comment="\$\{esc\(key\)\}"/);
assert.match(src, /data-folder-comment-save="\$\{esc\(key\)\}"/);
assert.match(src, /data-folder-comment-clear="\$\{esc\(key\)\}"/);
assert.match(src, /state\.folderNotes = \(r\.ok && r\.data && r\.data\.folderNotes\) \|\| \{\};/);
assert.match(src, /const note = state\.folderNotes\[treePath\(key\)\] \|\| null;/);
assert.match(css, /\.fm-folders-box \{[\s\S]*?border: 1px solid var\(--line-strong\)/);
assert.match(css, /\.fm-files-box \{[\s\S]*?border: 1px solid var\(--line-strong\)/);
assert.match(css, /\.fm-folder-comment \{[\s\S]*?border-top: 1px solid var\(--line\)/);
assert.match(css, /\.pf-portal-title \{/);

// 13. Файловете на избраната папка се показват в „Файлове в портала“.
assert.match(src, /function treeNode\(rel\)/);
assert.match(src, /function filesForFolder\(rel\)/);
assert.match(src, /const scope = state\.tree\.open \|\| '';/);
assert.match(src, /scoped: filesForFolder\(scope\),/, 'списъкът идва от папката');
assert.match(src, /let list = filesForFolder\(state\.tree\.open \|\| ''\)\.slice\(\);/, 'филтрите работят върху папката');
assert.equal(/let list = portal\(\) \? portal\(\)\.files\.slice\(\) : \[\];/.test(src), false, 'вече не се показват само регистрираните файлове');
assert.match(src, /\.map\(\(x\) => \(x\.storage \? storageCard\(x, ctx\) : card\(x, ctx\)\)\)/);
assert.match(src, /function card\(x, ctx\)/);
// Порталът е ТРИ самостоятелни контейнера, всеки в собствен JS файл.
assert.match(src, /class="pf-panels"/);
assert.match(src, /data-block="control"/);
assert.match(src, /data-block="folders"/);
assert.match(src, /data-block="files"/);
assert.match(src, /window\.HapiPortalControl = \{ render \};/);
assert.match(src, /window\.HapiPortalFolders = \{ render, folderMenus, folderMenu \};/);
assert.match(src, /window\.HapiPortalFiles = \{ render, card, storageCard \};/);
assert.match(src, /function panelCtx\(p\)/);
assert.match(src, /panel\(window\.HapiPortalControl, ctx\)/);
assert.match(src, /panel\(window\.HapiPortalFolders, ctx\)/);
assert.match(src, /panel\(window\.HapiPortalFiles, ctx\)/);
// Редът на плочките е като в референтния вид: размер · версия · SHA-256 · дати · id · заключване.
assert.match(src, /chip\(ICON\.hash, 'SHA-256', f\.sha256 \|\| '—', sha\)/);
assert.match(src, /const sha = f\.sha256 \? `\$\{String\(f\.sha256\)\.slice\(0, 12\)\}…` : '—';/);
assert.match(src, /const shortId8 = f\.id \? String\(f\.id\)\.slice\(0, 8\) : '—';/);
assert.match(src, /chip\(ICON\.id, 'id на файла', f\.id \|\| '—', shortId8\)/);
assert.match(src, /function storageCard\(x, ctx\)/);
assert.match(src, /class="fm-file fm-file-storage"/);
// Картата на файл само на диска изглежда като останалите: същите плочки с метаданни
// (размер, версия, SHA-256, id, дати, заключване) и бутон за регистриране в портала.
assert.match(src, /chip\(ICON\.size, 'Размер'/);
assert.match(src, /chip\(ICON\.version, 'Версия', '—', '—'\)/);
assert.match(src, /chip\(ICON\.hash, 'SHA-256', 'изчислява се при регистриране', '—'\)/);
assert.match(src, /chip\(ICON\.id, 'id на файла', '—', '—'\)/);
assert.match(src, /chip\(ICON\.created, 'Създаден'/);
assert.match(src, /chip\(ICON\.modified, 'Последна промяна'/);
assert.match(src, /chip\(\s*ICON\.unlocked,\s*'Заключване'/);
assert.match(src, /data-register-file="\$\{esc\(x\.path\)\}"/);
assert.match(src, /async function registerStorageFile\(rel\)/);
assert.match(src, /\/tree\/register`/);
assert.match(src, /if \(!key\) for \(const f of registered\) if \(!used\.has\(f\.id\)\) out\.push\(f\);/, 'коренът включва регистрираните файлове');
assert.match(src, /Папката \$\{esc\(treePath\(scope\)\)\} няма файлове\./);
// В акордеона остава само обобщение + коментар + API/QR (файловете са в списъка).
assert.equal(/class="fm-folder-file"/.test(src), false, 'няма редове с файлове в акордеона');
assert.match(src, /показват се в „Файлове в портала“ по-долу/);
assert.match(css, /\.fm-file-storage \{ border-style: dashed; \}/);
assert.equal(/\.fm-folder-files/.test(css), false, 'стиловете за редовете в акордеона са премахнати');
// ── Компактен режим по подразбиране ─────────────────────────────────────
// 1. Папките са СВИТИ (open: null), филтрите са ИЗКЛЮЧЕНИ (filters: false).
assert.match(src, /tree: \{ portalId: '', loaded: false, error: '', data: null, open: null \}/);
assert.match(src, /\n    filters: false,/);
// 2. Празните стойности не се изписват.
assert.equal(/'<span class="hint">няма бележка<\/span>'/.test(src), false, 'няма плейсхолдър „няма бележка“');
assert.equal(/без тема и категория/.test(src), false, 'няма плейсхолдър „без тема и категория“');
assert.match(src, /taxonomy\.length \? `\$\{esc\(taxonomy\.join\(' \/ '\)\)\} · ` : ''/);
assert.match(src, /x\.notes \? `<hr class="u-divider" \/><p class="fm-file-notes">/);
// 3. Табелките на файла показват само ВКЛЮЧЕНИТЕ опции (публичен = без табелка).
assert.match(src, /st\.id === 'public' \? '' :/);
assert.match(src, /state-chip enc" title="Шифрован/);
// 4. Няма бутон „Генерирай API + QR“ — API/QR се създават с портала.
assert.equal(/pf-generate/.test(src), false, 'бутонът „Генерирай API + QR“ е премахнат');
assert.match(src, /API и QR се създават заедно с портала/);
// 5. „Контролен панел на портала“ се сгъва/разгъва.
assert.match(src, /data-pf-control-tog/);
assert.match(src, /const open = state\.controlOpen !== false;/);
assert.match(src, /state\.controlOpen = state\.controlOpen === false;/);
assert.match(css, /\.pf-block-tog \{/);
assert.match(css, /\.pf-collapsed \.pf-block-head \{ border-bottom: 0;/);

console.log('files-manager OK');
