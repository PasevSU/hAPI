'use strict';
// `config/rules/*.json` са ДЕКЛАРАТИВНИ правила, които се публикуват на клиенти през
// `GET /admin/api/v2/export/rules` — тоест всеки ред в тях е обещание навън. Някои от
// ключовете обаче не се четат от backend-а (той взима истината от `rbac.js`,
// `download-access.js` и `export-rules.js`), затова единствената им защита е този тест:
//
//   1. `download_access.json` — `default_policy` минава `download-access.validatePolicy`,
//      а `system` не носи непознат ключ (иначе е обещание, което никой не изпълнява);
//   2. `file_permissions.json` — всеки `access` е реален режим, всяка `visibility` е реална,
//      `roles` съдържа само роли от `rbac.js`, `max_downloads` е цяло число ≥ 1;
//   3. `export_permissions.json` — `permissions[].id` е ТОЧНО наборът на
//      `download-access.PERMISSION_IDS`, `mode_permissions` покрива ТОЧНО режимите на
//      `export-rules.MODES` и сочи към реални права, а `roles` не съдържа измислена роля;
//   4. `rate_limits.json` — числата са положителни (нула би забранила всяко изтегляне тихо);
//   5. вградените копия в `hapi_enterprise/rules` са същите файлове (пази и `rules-parity`).
//
// Защо точно тези проверки: те хващат класа дефекти, които компилаторът не вижда — име на
// роля, което я няма (`portal-guest` беше точно такова), режим без право и право без режим.
// Тестовете идват от КОДА (`require`), а не от преписан списък.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const rulesDir = path.join(root, 'config', 'rules');
const ACC = require(path.join(root, 'hapi_enterprise', 'download-access.js'));
const R = require(path.join(root, 'hapi_enterprise', 'export-rules.js'));
const RBAC = require(path.join(root, 'hapi_enterprise', 'rbac.js'));

const read = (name) => JSON.parse(fs.readFileSync(path.join(rulesDir, name), 'utf8'));
const ROLES = new Set(RBAC.ROLES);
const checks = [];
const ok = (msg) => checks.push(msg);

// ── 1. download_access.json ────────────────────────────────────────────────
const access = read('download_access.json');
assert.equal(access.schema_version, '1.0', 'download_access.json: schema_version');
const policy = ACC.validatePolicy(access.default_policy);
assert.equal(policy.ok, true, 'download_access.json: default_policy е невалидна → ' + JSON.stringify(policy.errors));
// `system` е единственият друг блок, който кодът чете (`Object.assign({}, DEFAULT_SYSTEM, c.system)`).
const SYSTEM_KEYS = ['allow_downloads', 'public_gateway', 'mode'];
const unknownSystem = Object.keys(access.system || {}).filter((k) => !SYSTEM_KEYS.includes(k));
assert.deepEqual(unknownSystem, [], 'download_access.json: system носи ключове, които никой не чете: ' + unknownSystem.join(', '));
assert.ok(ACC.MODES_BY_ID[access.system.mode], 'download_access.json: system.mode е непознат режим');
// `hierarchy` беше ПОРЯДЪК, който внушава „по-дълбокият слой бие“ — а `merge` е
// независим от реда и взима по-СТРИКТНОТО. Затова редът е премахнат, а не преписан.
assert.equal('hierarchy' in access, false, 'download_access.json: редът на слоевете не се чете от кода и не бива да се обещава');
ok(`${ACC.MODES.length} режима · default_policy валидна · system без чужди ключове`);

// ── 2. file_permissions.json ───────────────────────────────────────────────
const files = read('file_permissions.json');
assert.ok(Array.isArray(files.rules) && files.rules.length > 0, 'file_permissions.json: rules');
const visibility = new Set(ACC.VISIBILITY.map((v) => v.id));
for (const rule of files.rules) {
  const where = `file_permissions.json (${rule.portal}/${rule.file})`;
  assert.ok(ACC.MODES_BY_ID[rule.access], `${where}: непознат режим „${rule.access}“`);
  assert.ok(visibility.has(rule.visibility), `${where}: непозната видимост „${rule.visibility}“`);
  const bad = (rule.roles || []).filter((r) => !ROLES.has(r));
  assert.deepEqual(bad, [], `${where}: роли, които не съществуват в rbac.js: ${bad.join(', ')}`);
  if (rule.max_downloads !== undefined && rule.max_downloads !== null) {
    assert.ok(Number.isInteger(rule.max_downloads) && rule.max_downloads >= 1, `${where}: max_downloads`);
  }
  // Собствената политика не бива да е по-слаба от порталната — това е правилото на файла,
  // казано в самото правило. Проверява се с валидатора на кода, не с нов.
  const v = ACC.validatePolicy({ mode: rule.access, roles: rule.roles || [], max_downloads: rule.max_downloads });
  assert.equal(v.ok, true, `${where}: ${JSON.stringify(v.errors)}`);
}
ok(`${files.rules.length} файлови правила · режими, видимости и роли са реални`);

// ── 3. export_permissions.json ─────────────────────────────────────────────
const perms = read('export_permissions.json');
const declared = perms.permissions.map((p) => p.id).sort();
assert.equal(declared.length, new Set(declared).size, 'export_permissions.json: повторено право');
assert.deepEqual(declared, [...ACC.PERMISSION_IDS].sort(), 'export_permissions.json: правата трябва да са точно тези, които кодът познава');
for (const p of perms.permissions) {
  const bad = (p.roles || []).filter((r) => !ROLES.has(r));
  assert.deepEqual(bad, [], `export_permissions.json (${p.id}): роли, които не съществуват в rbac.js: ${bad.join(', ')}`);
  assert.ok(p.label && String(p.label).trim(), `export_permissions.json (${p.id}): липсва label`);
}
const modeIds = R.MODES.map((m) => m.id).sort();
const mapped = Object.keys(perms.mode_permissions).sort();
assert.deepEqual(mapped, modeIds, 'export_permissions.json: mode_permissions трябва да покрива точно режимите на export-rules.MODES');
for (const [mode, permission] of Object.entries(perms.mode_permissions)) {
  assert.ok(ACC.PERMISSION_IDS.includes(permission), `export_permissions.json (${mode}): непознато право „${permission}“`);
}
assert.equal(perms.public_tokens.inherit_internal_permissions, false, 'export_permissions.json: порталният ключ не наследява вътрешните права');
ok(`${declared.length} права = PERMISSION_IDS · ${mapped.length} режима = MODES · ролите са от rbac.js`);

// ── 4. rate_limits.json ────────────────────────────────────────────────────
const rate = read('rate_limits.json');
const defaults = rate.defaults || {};
for (const key of ['per_hour', 'concurrent']) {
  assert.ok(Number.isFinite(defaults[key]) && defaults[key] > 0, `rate_limits.json: defaults.${key} трябва да е положително число`);
}
if (defaults.block_minutes !== undefined) {
  assert.ok(Number.isFinite(defaults.block_minutes) && defaults.block_minutes >= 0, 'rate_limits.json: defaults.block_minutes');
}
ok(`rate_limits: ${defaults.per_hour}/час · ${defaults.concurrent} едновременно`);

// ── 5. Вградените копия и файловете, които НЕ се зареждат ──────────────────────
// `gateway-api.RULE_FILES` изрежда какво add-on-ът зарежда. В папката има и файлове, които
// не са в него (`download_audit.json`, `portal_policies.json`) — те са договори, не правила.
// Файл в папка „rules“, който никой не зарежда, БЕЗ да го казва, е обещание за настройка,
// която не работи; затова такъв файл е длъжен да носи `note` с обяснението.
const bundled = path.join(root, 'hapi_enterprise', 'rules');
for (const name of ['download_access.json', 'file_permissions.json', 'export_permissions.json', 'rate_limits.json']) {
  assert.ok(fs.existsSync(path.join(bundled, name)), 'липсва вграденото копие на ' + name);
}
const loaded = new Set(
  (fs.readFileSync(path.join(root, 'hapi_enterprise', 'gateway-api.js'), 'utf8').match(/const RULE_FILES = \[([\s\S]*?)\];/)[1].match(/'([a-z_]+\.json)'/g) || []).map((s) => s.replace(/'/g, '')),
);
assert.ok(loaded.size >= 8, 'RULE_FILES трябва да изрежда поне 8 файла, намерени: ' + loaded.size);
const inFolder = fs.readdirSync(rulesDir).filter((n) => n.endsWith('.json')).sort();
for (const name of inFolder) {
  const body = read(name);
  if (loaded.has(name)) continue;
  assert.ok(
    typeof body.note === 'string' && body.note.trim().length > 40,
    `config/rules/${name} не се зарежда от add-on-а и няма note, който да го казва`,
  );
}
ok(`${inFolder.length} файла в папката, ${loaded.size} се зареждат, осталите се обявяват като справочни`);

console.log('PASS rules-declarations: ' + checks.join(' · '));
