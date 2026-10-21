'use strict';
// Зареждане на правилата: приоритет на директориите, fallback, reload и seed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bundled = path.join(__dirname, '..', 'hapi_enterprise', 'rules');
const rulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-rules-'));
const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-rules-seed-'));

function copyRules(target) {
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(bundled)) fs.copyFileSync(path.join(bundled, name), path.join(target, name));
}

copyRules(rulesDir);

// HAPI_CONFIG_DIR трябва да е зададен преди require (CONFIG_DIR се изчислява при зареждане).
process.env.HAPI_CONFIG_DIR = rulesDir;
const gw = require('../hapi_enterprise/gateway-api');

const quiet = { warn() {}, info() {}, error() {} };
gw.setLogger(quiet);

try {
  // 1. Всички файлове се зареждат от зададената директория — без fallback.
  let status = gw.status();
  assert.equal(status.dirs[0], rulesDir, 'първата директория е HAPI_CONFIG_DIR');
  assert.equal(status.missing.length, 0, 'липсващи: ' + status.missing.join(', '));
  for (const [name, source] of Object.entries(status.files)) {
    assert.equal(source, path.join(rulesDir, name), `${name} не е зареден от HAPI_CONFIG_DIR`);
  }

  // 2. Кешът е замразен: промяна на файла не се вижда без reload.
  const gatewayFile = path.join(rulesDir, 'public_gateway.json');
  const original = JSON.parse(fs.readFileSync(gatewayFile, 'utf8'));
  const changed = { ...original, public: { ...(original.public || {}), published: true, domain: 'rules.example', relative: true } };
  fs.writeFileSync(gatewayFile, JSON.stringify(changed, null, 2));
  assert.equal(gw.config().gateway.public.published, original.public?.published === true, 'без reload кешът не се променя');

  // 3. reload() прилага новата стойност и връща актуален статус.
  status = gw.reload();
  assert.equal(gw.config().gateway.public.published, true, 'reload вдига published');
  assert.equal(gw.config().gateway.public.domain, 'rules.example');
  assert.ok(status.loadedAt, 'статусът носи време на зареждане');

  // 4. Липсващ override файл → взима се вграденото копие (без да се брои за липсващ).
  fs.rmSync(path.join(rulesDir, 'rate_limits.json'));
  status = gw.reload();
  assert.equal(
    status.files['rate_limits.json'],
    path.join(bundled, 'rate_limits.json'),
    'липсващият override се взима от вградените правила',
  );
  assert.ok(!status.missing.includes('rate_limits.json'), 'вграденото копие покрива липсата');

  // 4б. Файл, който липсва навсякъде → вграденият fallback и предупреждение.
  assert.deepEqual(gw.readJson('does-not-exist.json', { ok: false }), { ok: false });
  assert.equal(gw.readJson('does-not-exist.json', { ok: false }).ok, false);

  // 5. seedRules копира липсващите файлове, без да презаписва съществуващите.
  const seeded = gw.seedRules(otherDir);
  assert.equal(seeded.copied.length, 8, 'копират се осемте вградени файла');
  const again = gw.seedRules(otherDir);
  assert.equal(again.copied.length, 0, 'съществуващите файлове не се презаписват');
  for (const name of gw.RULE_FILES) assert.ok(fs.existsSync(path.join(otherDir, name)), 'липсва ' + name);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(otherDir, 'download_rules.json')).mode & 0o777, 0o600);
  }

  console.log('PASS rules loading: HAPI_CONFIG_DIR приоритет, замразен кеш, reload, fallback, seed без презапис');
} finally {
  fs.rmSync(rulesDir, { recursive: true, force: true });
  fs.rmSync(otherDir, { recursive: true, force: true });
}
