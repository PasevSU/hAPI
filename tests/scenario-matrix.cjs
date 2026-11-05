'use strict';
// Договор за пълнота на тестовия пакет („всички сценарии“).
//
// Този тест не проверява поведение — той пази КАРТАТА на пакета:
//   1. всяка област (сценарий) има собственик (тестов файл), който наистина ползва
//      маршрутите на областта;
//   2. всеки маршрут, който `server.js` обслужва, се среща в поне един тест —
//      нов маршрут без тест чупи пакета веднага;
//   3. всяка RBAC способност от `rbac.js` се среща в поне един тест;
//   4. всяка опция от `config.yaml` съществува в `schema`, в двата превода и се
//      чете от `start.js`/`server.js`.
//
// Така „цялостен пакет“ не е обещание в документацията, а проверяем инвариант.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const testFiles = fs
  .readdirSync(path.join(root, 'tests'))
  .filter((f) => f.endsWith('.cjs') && f !== 'helpers.cjs')
  .sort();
const testText = new Map(testFiles.map((f) => [f, read('tests/' + f)]));
const allTests = [...testText.values()].join('\n');

// ── 1. Карта на сценариите ───────────────────────────────────────────────────
// Всяка област: човешко име → собственик (тестов файл) + маршрути/маркери, които
// собственикът трябва реално да използва.
const AREAS = [
  { area: 'старт и liveness', owner: 'smoke.cjs', endpoints: ['/health', '/admin/api/portals'] },
  { area: 'потребители и скоупове', owner: 'auth.cjs', endpoints: ['/api/v1/auth/login', '/admin/api/users'] },
  { area: 'RBAC токени и способности', owner: 'rbac.cjs', endpoints: ['/admin/api/portals', '/admin/api/settings', '/admin/api/storage/check'] },
  { area: 'RBAC по подразбиране (Ingress)', owner: 'rbac-sso.cjs', endpoints: ['/admin/api/whoami', 'defaultRole'] },
  { area: 'RBAC матрица роля × метод', owner: 'rbac-default-matrix.cjs', endpoints: ['CAPABILITIES', 'DEFAULT_ROLE'] },
  { area: 'Ingress изолация на listener-и', owner: 'ingress-isolation.cjs', endpoints: ['/ui/', '/admin/api/portals'] },
  { area: 'Ingress авторизация от опции', owner: 'ingress-auth.cjs', endpoints: ['/admin/api/whoami'] },
  { area: 'портали и публичен API', owner: 'portal-page.cjs', endpoints: ['/admin/api/portals', '/api/v1/p/'] },
  { area: 'качване и цялост на файлове', owner: 'integrity.cjs', endpoints: ['/admin/api/portals/', 'integrity'] },
  { area: 'права на файлове и ключове', owner: 'access-policy.cjs', endpoints: ['/admin/api/users', '/api/v1/auth/login'] },
  { area: 'масов достъп', owner: 'bulk-access.cjs', endpoints: ['bulk-access'] },
  { area: 'дърво на хранилището', owner: 'storage-tree-api.cjs', endpoints: ['/tree', '/admin/api/packages'] },
  { area: 'пакети и подписи', owner: 'package-api.cjs', endpoints: ['/admin/api/packages', '/admin/api/pgp/keys'] },
  { area: 'PGP ключове и bundle', owner: 'pgp-bundle.cjs', endpoints: ['/admin/api/pgp/keys/import'] },
  { area: 'PGP и gpg интероп', owner: 'pgp-gpg-interop.cjs', endpoints: ['gpg'] },
  { area: 'RFC 3161 TSA', owner: 'rfc3161-api.cjs', endpoints: ['/admin/api/v2/rfc3161'] },
  { area: 'TSA клиент (DER)', owner: 'tsa-client.cjs', endpoints: ['stamp'] },
  { area: 'крипто опции и TLS', owner: 'crypto-options.cjs', endpoints: ['/admin/api/v2', 'tsa_enabled'] },
  { area: 'шифроване на файлове', owner: 'file-encryption.cjs', endpoints: ['x-file-encrypt', '/admin/api/portals/'] },
  { area: 'одит верига', owner: 'audit-chain.cjs', endpoints: ['/admin/api/audit/verify'] },
  { area: 'одит експорт', owner: 'audit-export.cjs', endpoints: ['/admin/api/audit/export'] },
  { area: 'debug логове', owner: 'logs-api.cjs', endpoints: ['/admin/api/logs', '/admin/api/logs/level'] },
  { area: 'централен error log', owner: 'error-log.cjs', endpoints: ['/admin/api/errors'] },
  { area: 'диагностика', owner: 'diagnostics.cjs', endpoints: ['/admin/api/diagnostics'] },
  { area: 'jobs (опашка)', owner: 'job-manager.cjs', endpoints: ['/admin/api/jobs'] },
  { area: 'сензори', owner: 'sensors.cjs', endpoints: ['/admin/api/sensors'] },
  { area: 'сензори за комуникация и извиквания', owner: 'sensors-telemetry.cjs', endpoints: ['/admin/api/sensors/prometheus', 'observer'] },
  { area: 'backup API', owner: 'backup-api.cjs', endpoints: ['/admin/api/database/backup'] },
  { area: 'backup възстановяване', owner: 'backup-restore.cjs', endpoints: ['/admin/api/database/backups'] },
  { area: 'backup график', owner: 'backup-schedule.cjs', endpoints: ['/admin/api/database/backup-schedule'] },
  { area: 'retention', owner: 'retention.cjs', endpoints: ['/admin/api/retention'] },
  { area: 'retention и одит', owner: 'retention-audit.cjs', endpoints: ['/admin/api/retention', '/admin/api/audit/export'] },
  { area: 'readiness', owner: 'readiness.cjs', endpoints: ['/ready', '/health'] },
  { area: 'публичен gateway', owner: 'public-gateway.cjs', endpoints: ['/p/demo/', 'gatewayRoute'] },
  { area: 'gateway правила', owner: 'gateway-server.cjs', endpoints: ['/admin/api/v2', '/admin/api/cases'] },
  { area: 'правила, връзка и натоварване', owner: 'api-rules-connection.cjs', endpoints: ['/admin/api/rules', '/admin/api/rules/reload', '/admin/api/connection', '/admin/api/load'] },
  { area: 'пълен жизнен цикъл', owner: 'enterprise-lifecycle.cjs', endpoints: ['/admin/api/portals', '/admin/api/audit/verify', '/ready'] },
  { area: 'разполагане извън HA', owner: 'edge-runtime.cjs', endpoints: ['/admin/api/whoami', '/admin/api/metrics'] },
  { area: 'конфигурация на add-on', owner: 'addon-config.cjs', endpoints: ['config.yaml'] },
  { area: 'Home Assistant съвместимост (проект-wide одит)', owner: 'ha-compatibility.cjs', endpoints: ['config.yaml', 'HA-M01'] },
  { area: 'HACS издание (release/haoss)', owner: 'haoss-release.cjs', endpoints: ['hacs.json', 'custom_components/hapi_enterprise'] },
  { area: 'runtime в Docker', owner: 'docker-runtime.cjs', endpoints: ['/ui/'] },
  { area: 'HACS структура', owner: 'hacs-structure.cjs', endpoints: ['hacs.json'] },
  { area: 'документация и версия', owner: 'docs-consistency.cjs', endpoints: ['README.md'] },
  { area: 'release инструменти', owner: 'release-tooling.cjs', endpoints: ['build-release'] },
  { area: 'readiness и цялост на базата', owner: 'readiness-integrity.cjs', endpoints: ['/ready', 'evaluate', 'quickCheck'] },
  { area: 'backup огледало и SHA-256', owner: 'backup-mirror.cjs', endpoints: ['/admin/api/database/backups/verify', '/admin/api/database/backup'] },
  { area: 'TSA предпазител', owner: 'tsa-breaker.cjs', endpoints: ['/admin/api/v2/rfc3161', 'breakerSnapshot'] },
  { area: 'TSA доказателства (живот и проверка)', owner: 'tsa-evidence.cjs', endpoints: ['/admin/api/v2/rfc3161/verify', 'TSA_KEEP'] },
  { area: 'огледало на файловете', owner: 'storage-mirror.cjs', endpoints: ['/admin/api/storage/mirror/verify', 'STORAGE_MIRROR'] },
  { area: 'Raspberry Pi и ARM съвместимост', owner: 'raspberrypi-compat.cjs', endpoints: ['armv7', 'memory_limit_mb'] },
  { area: 'подписване с fallback', owner: 'signing-fallback.cjs', endpoints: ['/admin/api/packages', 'signingFallback'] },
  { area: 'хаос и устойчивост', owner: 'chaos-resilience.cjs', endpoints: ['/admin/api/audit/verify', '/ready'] },
  { area: 'една инстанция на data директория', owner: 'instance-lock.cjs', endpoints: ['INSTANCE_ID', 'INSTANCE_LOCKED', 'instance-lock'] },
  { area: 'тагове и universal links за Companion', owner: 'share-links.cjs', endpoints: ['home-assistant.io/tag', 'api-info', 'tag_scanned'] },
  { area: 'тайни връзки (zero-knowledge)', owner: 'secret-links.cjs', endpoints: ['/secret/', 'reveal', 'ciphertext'] },
  { area: 'версия в GUI-я', owner: 'ui-version.cjs', endpoints: ['HAPI_VERSION', 'ui/bootstrap.js'] },
  { area: 'отчетни манифести (hash report)', owner: 'report-manifests.cjs', endpoints: ['generator', 'recursive_folder', 'index.json'] },
  { area: 'RFC 3161 обхват на отчет (RS-05)', owner: 'report-stamp.cjs', endpoints: ['startUrl', 'stopUrl', 'timestamp-reply', 'Evidence-Set SHA-256'] },
  { area: 'векторен QR в отчет (RS-06)', owner: 'report-qr.cjs', endpoints: ['qrMatrix', 'finder', 're f', 'pdf-writer'] },
  { area: 'токени от отчет в доказателствата (RS-05)', owner: 'report-tsa-e2e.cjs', endpoints: ['reports/render', 'rfc3161/verify', 'x-tsa-status', 'closingDigest'] },
  { area: 'приемка на изданието за HA', owner: 'release-acceptance.cjs', endpoints: ['report_manifests', 'tsa_enabled', 'qrMatrix', 'index.json'] },
];

// ── 2. Всеки собственик съществува и ползва своите маршрути ──────────────────
const problems = [];
for (const { area, owner, endpoints } of AREAS) {
  if (!testText.has(owner)) {
    problems.push(`област „${area}“: липсва тестов файл ${owner}`);
    continue;
  }
  const text = testText.get(owner);
  for (const endpoint of endpoints) {
    if (!text.includes(endpoint)) {
      problems.push(`област „${area}“: ${owner} вече не споменава „${endpoint}“`);
    }
  }
}
// Всички проблеми наведнъж — за да не се поправя по един на пускане.
assert.deepEqual(problems, [], `картата на сценариите не съвпада с тестовете:\n  ${problems.join('\n  ')}`);

// ── 3. Всеки маршрут на server.js има поне един тест ─────────────────────────
const serverSrc = read('hapi_enterprise/server.js');
const routes = new Set();
for (const m of serverSrc.matchAll(/url\.pathname\s*(?:===|==)\s*'([^']+)'/g)) routes.add(m[1]);
for (const m of serverSrc.matchAll(/\/\^\\\/((?:admin|api|ui|hapi_enterprise)(?:\\\/[A-Za-z0-9_.-]*)*)/g)) {
  const fixed = ('/' + m[1].replace(/\\\//g, '/')).replace(/\/+$/, '');
  if (fixed.length > 1) routes.add(fixed);
}
const covered = (route) => {
  const key = route.replace(/\/+$/, '');
  return allTests.includes(key);
};
const orphanRoutes = [...routes].filter((r) => !covered(r)).sort();
assert.deepEqual(
  orphanRoutes,
  [],
  `маршрути без нито един тест: ${orphanRoutes.join(', ')} — добави сценарий или обнови картата`,
);

// ── 4. Всяка RBAC способност е проверена ────────────────────────────────────
const rbacSrc = read('hapi_enterprise/rbac.js');
const capsStart = rbacSrc.indexOf('const CAPABILITIES');
const capsBlock = rbacSrc.slice(capsStart, rbacSrc.indexOf('};', capsStart));
const capabilities = [...capsBlock.matchAll(/([a-z*]+)\s*:\s*\{/g)].map((m) => m[1]);
assert.ok(capabilities.length >= 20, `очаквам поне 20 RBAC способности, намерих ${capabilities.length}`);
const orphanCaps = capabilities.filter((c) => c !== '*' && !allTests.includes(c));
assert.deepEqual(orphanCaps, [], `RBAC способности без тест: ${orphanCaps.join(', ')}`);

// ── 5. Всяка опция от config.yaml е в schema, в двата превода и се чете ─────
const cfgText = read('hapi_enterprise/config.yaml');
// YAML блоковете се режат по редове: ключ от първа колона започва нов блок.
const cfgLines = cfgText.split('\n');
const blockOf = (name) => {
  const start = cfgLines.indexOf(`${name}:`);
  assert.ok(start >= 0, `config.yaml: липсва блок ${name}`);
  const out = [];
  for (let i = start + 1; i < cfgLines.length; i++) {
    if (/^[A-Za-z_]/.test(cfgLines[i])) break;
    out.push(cfgLines[i]);
  }
  return out;
};
const optionsBlock = blockOf('options');
const schemaBlock = blockOf('schema').join('\n');
const options = optionsBlock
  .filter((line) => /^ {2}[a-z0-9_]+:/.test(line))
  .map((line) => line.trim().split(':')[0]);
assert.ok(options.length >= 25, `очаквам поне 25 опции, намерих ${options.length}`);
const en = read('hapi_enterprise/translations/en.yaml');
const bg = read('hapi_enterprise/translations/bg.yaml');
// Кой консумира опцията: целият код на add-on-а (env в start.js, options.json в
// storage-preflight/runtime-config, директно в server.js).
const addonSource = fs
  .readdirSync(path.join(root, 'hapi_enterprise'))
  .filter((f) => /\.(js|cjs|sh)$/.test(f) || f === 'Dockerfile')
  .map((f) => read('hapi_enterprise/' + f))
  .join('\n');
for (const option of options) {
  assert.ok(schemaBlock.includes(`${option}:`), `опция ${option} липсва в schema`);
  assert.ok(en.includes(`${option}:`), `опция ${option} липсва в translations/en.yaml`);
  assert.ok(bg.includes(`${option}:`), `опция ${option} липсва в translations/bg.yaml`);
  const upper = option.toUpperCase();
  // Опцията трябва да се консумира: или като env в start.js, или в server.js.
  assert.ok(
    addonSource.includes(option) || addonSource.includes(upper),
    `опция ${option} не се чете никъде в кода на add-on-а (нито като option, нито като env)`,
  );
}

// ── 6. ВСЕКИ тестов файл е ПРАВИЛО с идентификатор ──────────────────────────
// Дотук тук имаше вратичка: файл, който не е в картата, се допускаше „ако съдържа
// assert“ — тоест ~290 от ~356 файла нямаха нито име, нито дом и нов тест можеше да
// влезе, без никой да го регистрира. Сега каталогът `tests/test-rules.cjs` (произвеждан от
// scripts/gen-test-rules.cjs) е ЕДИНСТВЕНИЯТ списък на правилата и трябва да съвпада с
// папката в двете посоки.
const { RULES } = require('./lib/test-rules.cjs');
const ruleIds = RULES.map((r) => r.id);
assert.equal(new Set(ruleIds).size, ruleIds.length, 'дублирани идентификатори на правила');
assert.deepEqual(ruleIds, [...ruleIds].sort(), 'правилата не са подредени по id — пусни gen-test-rules.cjs');

const byOwner = new Map(RULES.map((r) => [r.owner, r]));
for (const file of testFiles) {
  if (file === 'test-rules.cjs') continue;
  assert.ok(
    byOwner.has('tests/' + file),
    `тестовият файл ${file} не е правило — пусни: node scripts/gen-test-rules.cjs (после прегледай областта му)`,
  );
}
for (const rule of RULES) {
  assert.ok(fs.existsSync(path.join(root, rule.owner)), `правило ${rule.id}: липсва ${rule.owner}`);
  assert.ok(rule.area, `правило ${rule.id}: липсва област`);
  // Не всяко правило ползва `assert` буквално: ha-compatibility има свои `need()`/`check()`.
  // Затова се приема всеки от трите проверяващи примитива.
  assert.ok(
    /assert|need\(|check\('/.test(testText.get(path.basename(rule.owner))),
    `правило ${rule.id}: ${rule.owner} не проверява нищо (няма assert/need/check)`,
  );
}
// Курираната карта по-горе трябва да е ПОДМНОЖЕСТВО на каталога — иначе две истини.
for (const area of AREAS) {
  assert.ok(byOwner.has('tests/' + area.owner), `област „${area.area}“: ${area.owner} липсва в каталога на правилата`);
}

console.log(
  `PASS scenario matrix: ${AREAS.length} курирани области, ${RULES.length} правила (= тестови файлове), ` +
  `${routes.size} маршрута, ${capabilities.length} RBAC способности, ${options.length} опции`,
);
