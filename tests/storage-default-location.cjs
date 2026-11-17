'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const preflight = require('../hapi_enterprise/storage-preflight');
// §STORAGE_DEFAULT_SHARE: подразбирането е `/share/hAPI/data`, а стара инсталация НЕ бива
// да „изчезне“ при обновяване. Двете неща се проверяват заедно, защото второто е цената на
// първото: смяната на подразбирането без защита би стартирала add-on-а с празна база.
// От 0.69.234 има ДВЕ стари места: `/share/hapi/data` (0.69.87 – 0.69.233, малка буква) и
// `<add-on config>/hapi_enterprise` (до 0.69.87). По-новото печели, ако и двете имат данни.
const OPT = { min_free_mb: 0 };

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-default-'));
  for (const kind of ['addon_config', 'media', 'share']) fs.mkdirSync(path.join(tmp, kind));
  return { tmp, env: { STORAGE_ROOT_OVERRIDE: tmp } };
}

/** Стара инсталация отпреди 0.69.87: маркер + база в `<addon_config>/hapi_enterprise`. */
function legacyInstall(tmp) {
  const dir = path.join(tmp, 'addon_config', 'hapi_enterprise');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.portal-enterprise-storage'), 'portal-enterprise-v1\n');
  fs.writeFileSync(path.join(dir, 'db.json'), '{"portals":[]}');
  return dir;
}

/** Стара инсталация 0.69.87 – 0.69.233: маркер + база в `/share/hapi/data` (малка буква). */
function legacyLowerInstall(tmp) {
  const dir = path.join(tmp, 'share', 'hapi', 'data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.portal-enterprise-storage'), 'portal-enterprise-v1\n');
  fs.writeFileSync(path.join(dir, 'db.json'), '{"portals":[]}');
  return dir;
}

/** Маркер + база на новото място. */
function freshInstall(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.portal-enterprise-storage'), 'portal-enterprise-v1\n');
  fs.writeFileSync(path.join(dir, 'db.json'), '{"portals":[]}');
  return dir;
}

const cases = [];
try {
  // ── 1. Ново подразбиране: /share/hAPI/data ───────────────────────────────
  {
    const { tmp, env } = fixture();
    const base = preflight.check({ ...OPT }, env);
    assert.equal(base, path.join(tmp, 'share', 'hAPI', 'data'), 'подразбирането е share/hAPI/data: ' + base);
    assert.ok(fs.existsSync(path.join(base, '.portal-enterprise-storage')), 'маркерът се създава там');
    cases.push('/share/hAPI/data по подразбиране');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ── 1б. Старото подразбиране (малка буква) се спасява ─────────────────────
  // На Windows/macOS `hapi` и `hAPI` са ЕДНА И СЪЩА папка, затова там данните се намират
  // направо на новия път (без клон за миграция). На Linux (там живее Home Assistant) това
  // са две различни папки и клонът за стари места е единственото, което пази базата.
  {
    const { tmp, env } = fixture();
    const legacy = legacyLowerInstall(tmp);
    const errors = [];
    const original = console.error;
    console.error = (msg) => errors.push(String(msg));
    let base;
    try { base = preflight.check({ ...OPT }, env) } finally { console.error = original }
    const sameFolder = path.resolve(base).toLowerCase() === path.resolve(legacy).toLowerCase();
    assert.equal(fs.existsSync(path.join(base, 'db.json')), true, 'данните от /share/hapi/data не се изоставят');
    assert.equal(fs.existsSync(path.join(base, '.portal-enterprise-storage')), true, 'маркерът остава на мястото си');
    if (sameFolder) cases.push('hapi/data = hAPI/data на тази ФС → без миграция');
    else {
      assert.equal(base, legacy, 'на Linux двете имена са различни папки — печели старата с данни');
      assert.equal(fs.existsSync(path.join(tmp, 'share', 'hAPI', 'data')), false, 'не се създава празна нова папка');
      assert.match(errors.join('\n'), /STORAGE_LEGACY_LOCATION/, 'логът казва какво е станало');
      cases.push('hapi/data (малка буква) → стария път + STORAGE_LEGACY_LOCATION');
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ── 1в. Двете стари места имат данни → печели по-новото ──────────────────
  {
    const { tmp, env } = fixture();
    const older = legacyInstall(tmp);
    const lower = legacyLowerInstall(tmp);
    const original = console.error;
    console.error = () => {};
    let base;
    try { base = preflight.check({ ...OPT }, env) } finally { console.error = original }
    assert.equal(path.resolve(base).toLowerCase(), path.resolve(lower).toLowerCase(), 'редът на старите места е от ново към старо');
    assert.notEqual(path.resolve(base), path.resolve(older), 'по-старото място не бива да печели');
    cases.push('две стари места → по-новото');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ── 2. Миграционна защита: старите данни печелят, докато новото място е празно ──
  {
    const { tmp, env } = fixture();
    const legacy = legacyInstall(tmp);
    const errors = [];
    const original = console.error;
    console.error = (msg) => errors.push(String(msg));
    let base;
    try { base = preflight.check({ ...OPT }, env) } finally { console.error = original }
    assert.equal(base, legacy, 'ползва се старото място, а не ново празно');
    assert.equal(fs.existsSync(path.join(tmp, 'share', 'hAPI', 'data')), false, 'не се създава празна нова папка');
    assert.match(errors.join('\n'), /STORAGE_LEGACY_LOCATION/, 'логът казва какво е станало');
    cases.push('стара инсталация → стария път + STORAGE_LEGACY_LOCATION');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ── 3. След преместване на данните новото място печели ────────────────────
  {
    const { tmp, env } = fixture();
    legacyInstall(tmp); // старото остава, но вече е копие
    const fresh = freshInstall(path.join(tmp, 'share', 'hAPI', 'data'));
    assert.equal(preflight.check({ ...OPT }, env), fresh, 'когато новото място има данни, то печели');
    cases.push('данни и на двете места → новото');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ── 4. Изричен избор на add-on папката не се „поправя“ мълчаливо ──────────
  {
    const { tmp, env } = fixture();
    const base = preflight.check({ ...OPT, storage_location: 'addon_config', storage_subdirectory: 'hapi_enterprise' }, env);
    assert.equal(base, path.join(tmp, 'addon_config', 'hapi_enterprise'), 'изричната настройка се спазва');
    cases.push('изричен addon_config → без намеса');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ── 5. Подпапка: до три нива, без излизане навън ──────────────────────────
  {
    const { tmp, env } = fixture();
    assert.equal(preflight.check({ ...OPT, storage_subdirectory: 'documents/hapi/data' }, env), path.join(tmp, 'share', 'documents', 'hapi', 'data'));
    for (const bad of ['../escape', 'a/../../b', 'a/b/c/d', '/absolute', 'a//b', 'a/']) {
      assert.equal(preflight.validSub(bad), false, 'трябва да се откаже: ' + bad);
      assert.throws(() => preflight.check({ ...OPT, storage_subdirectory: bad }, env), /Invalid storage subdirectory/, 'и то с ясна грешка: ' + bad);
    }
    assert.equal(preflight.validSub('hAPI/data'), true);
    assert.equal(preflight.validSub('hapi_enterprise'), true, 'старият вид име остава валиден');
    cases.push('hAPI/data валидно · ../escape и 4 нива → отказ');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ── 6. Празна папка на старото място НЕ се брои за инсталация ─────────────
  {
    const { tmp, env } = fixture();
    const empty = path.join(tmp, 'addon_config', 'hapi_enterprise');
    fs.mkdirSync(empty, { recursive: true });
    fs.writeFileSync(path.join(empty, '.portal-enterprise-storage'), 'portal-enterprise-v1\n');
    assert.equal(preflight.check({ ...OPT }, env), path.join(tmp, 'share', 'hAPI', 'data'), 'само маркер без база не е „данни“');
    cases.push('маркер без база → не блокира новото място');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} finally {
  /* всяка проверка чисти след себе си */
}

console.log('storage-default OK: /share/hAPI/data · ' + cases.length + ' случая — ' + cases.join(' · '));
