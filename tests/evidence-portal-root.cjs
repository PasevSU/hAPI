'use strict';
// ОРАКУЛ: КЪДЕ точно се публикува Evidence порталът.
//
// Дефектът от 0.69.19: `/homeassistant` се предпочиташе пред `/config`, затова порталът
// отиваше на място, което Home Assistant НЕ сервира (`/local/...` идва от `<config>/www`),
// а след рестарт копирането гръмна с ENOENT. Затова тук се проверява точният избор на корен:
//   • корен с `configuration.yaml` И `www/` печели пред „половин“ корен;
//   • `/config` е преди `/homeassistant`;
//   • висящ симлинк не се брои за корен;
//   • изричната настройка `EVIDENCE_PORTAL_ROOT` винаги е първа;
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

    // ── 2. Само www бие само configuration.yaml ────────────────────────────────
    const pick2 = evidencePortal.targetDir({ env: {}, roots: [onlyConfig, onlyWww] });
    assert.equal(pick2.root, onlyWww, 'коренът с www е по-важен за публикуване от този само с конфигурация');

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
    const none = evidencePortal.deploy({ env: {}, roots: [path.join(tmp, 'niakade')] });
    assert.equal(none.ok, false, 'без корен не се публикува');
    assert.ok(/конфигурацията на Home Assistant/.test(none.error), 'причината е разбираема: ' + none.error);

    console.log('PASS evidence-portal-root: /config преди /homeassistant · пълният корен печели · висящ симлинк се пропуска · публикуването е идемпотентно и казва кой корен ползва');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
