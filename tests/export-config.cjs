'use strict';
// FD-0/PG-0: конфигурационните файлове и модулните default-и не се разминават.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../hapi_enterprise/export-rules.js');
const A = require('../hapi_enterprise/download-access.js');
const GW = require('../hapi_enterprise/public-gateway.js');
const M = require('../hapi_enterprise/export-manager.js');

const root = path.join(__dirname, '..', 'config');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

// 1. download_rules.json = DEFAULT_RULES и е валиден.
const rules = read('rules/download_rules.json');
assert.equal(R.validateRules(rules).ok, true, JSON.stringify(R.validateRules(rules).errors));
assert.deepEqual(rules, R.DEFAULT_RULES);

// 2. export_profiles.json = 12-те режима от модула.
const profiles = read('rules/export_profiles.json');
assert.equal(profiles.profiles.length, R.MODES.length);
for (const profile of profiles.profiles) {
  const mode = R.MODES_BY_ID[profile.id];
  assert.ok(mode, `липсва режим ${profile.id}`);
  assert.equal(profile.format, mode.format, profile.id);
  assert.deepEqual(profile.contents, mode.contents, profile.id);
  assert.equal(profile.permission, mode.permission, profile.id);
  assert.equal(profile.verification || '', mode.verification || '', profile.id);
}

// 3. export_permissions.json: правата и режим→право съвпадат.
const perms = read('rules/export_permissions.json');
assert.deepEqual(perms.permissions.map((p) => p.id), A.PERMISSION_IDS);
for (const [modeId, permission] of Object.entries(perms.mode_permissions)) {
  assert.equal(R.MODES_BY_ID[modeId].permission, permission, modeId);
}

// 4. download_access.json: default политика и РЕД НА СЛОЕВЕТЕ.
// Досега файлът носеше `hierarchy` — подреден списък, който тестът сравняваше с `A.LEVELS`.
// И двете страни бяха еднакви, но никоя не се четеше при вземане на решение: `merge()` е
// независим от реда и взима по-СТРИКТНОТО (ролите се секат, лимитите — по-малките). Затова
// списъкът вече не се обещава във файла, а тук се проверява САМОТО СВОЙСТВО на кода.
const access = read('rules/download_access.json');
assert.equal('hierarchy' in access, false, 'download_access.json не бива да обещава ред на слоевете');
assert.deepEqual([...new Set(A.LEVELS)].sort(), [...A.LEVELS].sort(), 'слоевете са уникални');
assert.equal(A.LEVELS.length, 8, 'слоевете са осем');
assert.equal(A.validatePolicy(access.default_policy).ok, true);
for (const key of ['mode', 'password', 'verify_on_serve', 'audit', 'one_time']) {
  assert.equal(access.default_policy[key], A.DEFAULT_POLICY[key], key);
}
// Редът е без значение, а резултатът не е по-слаб от нито един вход: PRIVATE не изчезва,
// ако е подаден пръв, и ролите са СЕЧЕНИЕ, не обединение.
const strict = { mode: 'PRIVATE', roles: ['admin', 'judge'], max_downloads: 3, rate_per_hour: 10 };
const loose = { mode: 'FREE', roles: ['admin', 'judge', 'viewer'], max_downloads: 50, rate_per_hour: 100 };
const forward = A.merge([loose, strict]);
const backward = A.merge([strict, loose]);
assert.deepEqual(forward, backward, 'merge() не бива да зависи от реда на слоевете');
assert.equal(forward.mode, 'PRIVATE', 'по-стриктният режим печели');
assert.deepEqual(forward.roles, ['admin', 'judge'], 'ролите са сечение, не обединение');
assert.equal(forward.max_downloads, 3, 'по-малкият лимит печели');
assert.equal(forward.rate_per_hour, 10, 'по-малкият лимит на час печели');

// 5. public_gateway.json = нормализираните default-и.
const gatewayCfg = read('rules/public_gateway.json');
assert.deepEqual(GW.normalizeGateway(gatewayCfg), GW.normalizeGateway({}));
assert.equal(GW.normalizeGateway(gatewayCfg).public.published, false, 'публичният порт не се публикува автоматично');

// 6. portal_policies.json: всеки портал е валиден и в разрешен storage root.
const portalCfg = read('rules/portal_policies.json');
assert.ok(portalCfg.portals.length >= 3);
for (const portal of portalCfg.portals) {
  const res = GW.validatePortal(portal, gatewayCfg);
  assert.equal(res.ok, true, `${portal.slug}: ${res.errors.join('; ')}`);
  assert.ok(A.MODES_BY_ID[portal.access], portal.slug);
}

// 7. file_permissions.json: валидни режими и никакво отслабване спрямо портала.
const fileCfg = read('rules/file_permissions.json');
for (const rule of fileCfg.rules) {
  const portal = portalCfg.portals.find((p) => p.slug === rule.portal);
  assert.ok(portal, `непознат портал ${rule.portal}`);
  assert.ok(A.MODES_BY_ID[rule.access], `${rule.file}: ${rule.access}`);
  const resolved = GW.resolvePolicy({ portal: { access: portal.access }, file: { access: rule.access } });
  const strictest = Math.max(A.rank(portal.access), A.rank(rule.access));
  assert.equal(A.rank(resolved.policy.mode), strictest, rule.file);
}
// Демонстрационните файлове от спецификацията съществуват.
const names = fileCfg.rules.map((r) => r.file);
for (const name of ['Public_Report.pdf', 'Evidence_Package.zip', 'Internal_Audit.json', 'Revoked_File.pdf']) {
  assert.ok(names.includes(name), name);
}

// 8. token_policies / rate_limits / download_audit.
const tokens = read('rules/token_policies.json');
assert.ok(tokens.reject_patterns.includes('^eyJ'), 'HA JWT не е публичен ключ');
for (const p of tokens.policies) assert.ok(p.ttl_hours >= 1 && p.max_uses >= 1, p.id);

const rate = read('rules/rate_limits.json');
assert.ok(rate.defaults.per_hour > 0 && rate.defaults.concurrent > 0 && rate.defaults.block_minutes > 0);

// `download_audit.json` е справочен договор, НЕ правило — add-on-ът не го зарежда (виж
// `RULE_FILES` в `gateway-api.js`). Затова тук се проверява само това, което файлът има право
// да твърди: че споменава САМО събития, които кодът излъчва. Каталогът е генериран от кода
// (`scripts/audit-events.cjs`), тоест това е сверка с кода, а не с втори списък.
const audit = read('rules/download_audit.json');
const catalogue = fs.readFileSync(
  path.join(__dirname, '..', 'documentation', '04_FUNCTION_SPECIFICATIONS', 'AUDIT_EVENTS.md'),
  'utf8',
);
for (const event of audit.events) {
  assert.ok(catalogue.includes('`' + event + '`'), 'download_audit.json: събитие, което кодът не излъчва → ' + event);
}
// Формата на записа идва от `audit-chain.js` (`{ seq, at, event, details, prevHash }`), не от файла.
for (const field of audit.record) {
  assert.ok(
    new RegExp('(?:^|[{\\s])' + field + '\\s*:').test(fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'audit-chain.js'), 'utf8')),
    'download_audit.json: поле, което записът в audit-chain.js не съдържа → ' + field,
  );
}
assert.equal('retention_days' in audit, false, 'срокът на съхранение е настройка (retention.*), не правило');
assert.equal('channels' in audit, false, 'каналите са в public-gateway.CHANNELS, не в правилата');

// 9. Схеми: JSON Schema 2020-12, enums съответстват на модулите.
const pkg = read('schemas/package_manifest.schema.json');
assert.equal(pkg.$schema, 'https://json-schema.org/draft/2020-12/schema');
assert.deepEqual(pkg.properties.mode.enum, R.MODES.map((m) => m.id));
for (const field of ['path', 'size', 'sha256', 'kind', 'source', 'verified']) {
  assert.ok(pkg.properties.entries.items.required.includes(field), field);
}

const transfer = read('schemas/transfer_state.schema.json');
assert.deepEqual(transfer.properties.state.enum, M.STATES);
assert.ok(transfer.properties.timeline);

// 10. Add-on примерът пази разделението на каналите.
const yaml = fs.readFileSync(path.join(root, 'examples', 'addon-config.yaml'), 'utf8');
assert.match(yaml, /ingress: true/);
assert.match(yaml, /ingress_port: 8099/);
assert.match(yaml, /8088\/tcp/);
assert.match(yaml, /Public API Gateway/);
assert.match(yaml, /НЕ е готова конфигурация/);

console.log('export-config OK');
