'use strict';
// ОРАКУЛ: КЪДЕ точно се публикува Evidence порталът.
//
// Историята на този дефект е два пъти сгрешена:
//   0.69.19 — `/homeassistant` се предпочиташе пред `/config`;
//   0.69.29 — `/config` се предпочиташе, а `www/` се броеше за доказателство, че папката е HA
//            конфигурация. Точно това е грешно: в add-on-а `/config` е СОБСТВЕНАТА папка на
//            add-on-а (`app_config`), а HA конфигурацията е на `/homeassistant`. Първото
//            погрешно публикуване създава `/config/www/hapi/data`, след което тази папка
//            печели вечно и порталът остава извън HA (404 на `/local/hapi/data/portal.html`).
//
// Затова тук се проверява точният избор на корен:
//   • HA конфигурация се разпознава САМО по `configuration.yaml` (www/ е само подсказка);
//   • корен само с `www/` НЕ се избира, дори да е пръв в списъка;
//   • корен с `configuration.yaml` без `www/` се избира и `www/hapi/data` се създава;
//   • `/config` е преди `/homeassistant`;
//   • висящ симлинк не се брои за корен;
//   • изричният `EVIDENCE_PORTAL_ROOT` е думата на оператора — приема се без маркери;
//   • публикуването е идемпотентно и връща КОЙ корен е използван (за да го вижда логът).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const evidencePortal = require('../hapi_enterprise/evidence-portal');

const mk = (base, name, { config = false, www = false } = {}) => {
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  if (config) fs.writeFileSync(path.join(dir, 'configuration.yaml'), 'default_config:\n');
  if (www) fs.mkdirSync(path.join(dir, 'www'), { recursive: true });
  return dir;
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-evidence-'));
  try {
    const onlyWww = mk(tmp, 'samo-www', { www: true });
    const full = mk(tmp, 'palna', { config: true, www: true });
    const onlyConfig = mk(tmp, 'samo-konfig', { config: true });

    // ── 1. Пълен корен печели пред „половин“ ────────────────────────────────────
    const pick = evidencePortal.targetDir({ env: {}, roots: [onlyWww, full, onlyConfig] });
    assert.equal(pick.root, full, 'коренът с configuration.yaml + www печели');
    assert.equal(pick.dir, path.join(full, 'www', 'hapi', 'data'), 'целта е <root>/www/hapi/data');

    // ── 2. Само `www/` НЕ прави папката HA конфигурация ──────────────────────
    // Точно това е собствената папка на add-on-а след погрешно публикуване.
    const pick2 = evidencePortal.targetDir({ env: {}, roots: [onlyWww, onlyConfig] });
    assert.equal(
      pick2.root,
      onlyConfig,
      'коренът само с www не се приема за HA конфигурация — избира се този с configuration.yaml',
    );
    assert.equal(pick2.dir, path.join(onlyConfig, 'www', 'hapi', 'data'), 'целта е в избрания корен, не в чуждата www');

    // ── 2б. Корен без `www/` се избира и `www/hapi/data` се създава ──────────
    const deployed = evidencePortal.deploy({ env: {}, roots: [onlyConfig] });
    assert.equal(deployed.ok, true, 'публикува се и когато HA още няма www/: ' + deployed.error);
    assert.ok(
      fs.existsSync(path.join(onlyConfig, 'www', 'hapi', 'data', 'portal.html')),
      'www/hapi/data е създадена под HA конфигурацията',
    );

    // ── 3. Висящ симлинк не е корен ────────────────────────────────────────────
    const dangling = path.join(tmp, 'visiasht');
    let symlinkWorks = true;
    try {
      fs.symlinkSync(path.join(tmp, 'niakade'), dangling, 'dir');
    } catch (e) {
      symlinkWorks = false;
      assert.ok(e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'ENOENT', 'симлинкът не може да се създаде: ' + e.code);
    }
    if (symlinkWorks) {
      const pick3 = evidencePortal.targetDir({ env: {}, roots: [dangling, onlyConfig] });
      assert.equal(pick3.root, onlyConfig, 'висящият симлинк се пропуска, избира се следващият валиден корен');
    }

    // ── 4. `/config` е преди `/homeassistant` ─────────────────────────────────
    const roots = evidencePortal.candidateRoots({});
    assert.deepEqual(roots, ['/config', '/homeassistant'], 'редът по подразбиране: /config преди /homeassistant');
    assert.deepEqual(evidencePortal.candidateRoots({ EVIDENCE_PORTAL_ROOT: '/srv/ha' }), ['/srv/ha', '/config', '/homeassistant'], 'изричният корен е първи');

    // ── 4б. Изричният корен е думата на оператора ─────────────────────────────
    const explicit = mk(tmp, 'izrachen', {}); // без configuration.yaml и без www
    const forced = evidencePortal.targetDir({ env: { EVIDENCE_PORTAL_ROOT: explicit }, roots: [onlyWww] });
    assert.equal(forced.root, explicit, 'EVIDENCE_PORTAL_ROOT се приема дори без маркери');
    assert.equal(forced.dir, path.join(explicit, 'www', 'hapi', 'data'), 'целта е под изричния корен');
    const missingExplicit = evidencePortal.targetDir({ env: { EVIDENCE_PORTAL_ROOT: path.join(tmp, 'niakade') } });
    assert.ok(/липсва/.test(missingExplicit.error), 'липсващ изричен корен се отчита: ' + missingExplicit.error);

    // ── 5. Публикуването е идемпотентно и казва кой корен ползва ───────────────
    const first = evidencePortal.deploy({ env: {}, roots: [full] });
    assert.equal(first.ok, true, 'публикуването минава');
    assert.equal(first.root, full, 'резултатът казва КОЙ корен е използван');
    assert.equal(first.copied.length, first.total, 'първият път се копират всички файлове');
    for (const rel of ['portal.html', 'assets/app.js', 'sample-evidence.json']) {
      assert.ok(fs.existsSync(path.join(first.dir, rel)), 'файлът е на място: ' + rel);
    }
    const second = evidencePortal.deploy({ env: {}, roots: [full] });
    assert.equal(second.copied.length, 0, 'вторият път нищо не се копира');
    assert.equal(second.unchanged.length, second.total, 'всички файлове са непроменени');

    // ── 6. Без корен — ясна причина, без гадаене ──────────────────────────────
    const none = evidencePortal.deploy({ env: {}, roots: [onlyWww, path.join(tmp, 'niakade')] });
    assert.equal(none.ok, false, 'без корен не се публикува');
    assert.ok(/конфигурацията на Home Assistant/.test(none.error), 'причината е разбираема: ' + none.error);
    assert.ok(/configuration\.yaml/.test(none.error), 'грешката казва какво липсва: ' + none.error);
    assert.ok(none.error.includes(onlyWww), 'грешката изрежда и отхвърлените корени: ' + none.error);

    console.log('PASS evidence-portal-root: HA конфигурация се разпознава по configuration.yaml · само www/ не е корен · /config преди /homeassistant · изричният корен печели · идемпотентно и казва кой корен ползва');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
