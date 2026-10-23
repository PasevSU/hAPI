'use strict';
// Публикуване на Evidence View (бач B5): файловете трябва да са на мястото, което
// фронтендът наистина търси. Дефектът W5 беше точно това: публикуваше се само плоската
// подредба (`sample-evidence.json`), а `assets/app.js` при отпаднал API вика
// `./data/demo-evidence.json` — тоест демо страницата даваше 404.
//
// Тестът не вярва на списъка `FILES`: пуска истинско публикуване в изолирана HA папка и
// проверява СЪДЪРЖАНИЕТО на диска (хешове), идемпотентността и поправянето на развален файл.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const portal = require('../hapi_enterprise/evidence-portal.js');

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const cases = [];
const ok = (label) => cases.push(label);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-evidence-'));
// Имитация на HA конфигурация: маркерът е `configuration.yaml`.
fs.writeFileSync(path.join(tmpRoot, 'configuration.yaml'), 'homeassistant:\n');
const env = { EVIDENCE_PORTAL_ROOT: tmpRoot };
const target = path.join(tmpRoot, 'www', 'hapi', 'data');
const src = portal.sourceDir();

try {
  // ── 1. Пакетът съдържа всичко, което фронтендът иска ──────────────────────
  assert.deepEqual(portal.missingSourceFiles(), [], 'пакетът не бива да има липсващи файлове');
  assert.ok(portal.FILES.includes('data/demo-evidence.json'), 'демо данните в `data/` са част от публикуването');
  assert.ok(fs.existsSync(path.join(src, 'data/demo-evidence.json')), 'файлът съществува в пакета');
  // Фронтендът трябва наистина да го търси — иначе „публикуван“ е безсмислено.
  const app = fs.readFileSync(path.join(src, 'assets/app.js'), 'utf8');
  assert.match(app, /\.\/data\/demo-evidence\.json/, 'app.js трябва да пада към ./data/demo-evidence.json');
  assert.match(app, /async function loadManifest\(/, 'app.js трябва да има `loadManifest()`');
  ok('пакетът съдържа data/demo-evidence.json и фронтендът го търси');

  // ── 2. Публикуването копира всичко и съдържанието съвпада ─────────────────
  const first = portal.deploy({ env, roots: [tmpRoot] });
  assert.equal(first.ok, true, 'публикуването трябва да мине: ' + (first.error || ''));
  assert.equal(first.total, portal.FILES.length);
  assert.equal(first.copied.length, portal.FILES.length, 'първият пуск копира всички файлове');
  for (const rel of portal.FILES) {
    const to = path.join(target, rel);
    assert.ok(fs.existsSync(to), 'липсва публикуван файл: ' + rel);
    assert.equal(sha(to), sha(path.join(src, rel)), 'съдържанието на ' + rel + ' трябва да съвпада');
  }
  // Плоската подредба НЕ се публикува като папка — само каноничните пътища.
  assert.ok(!fs.existsSync(path.join(target, 'assets', 'data')), 'няма измислена подредба');
  ok('публикувани са всички файлове, включително data/demo-evidence.json (хешове съвпадат)');

  // ── 3. Идемпотентност: втори пуск не пише нищо ────────────────────────────
  const second = portal.deploy({ env, roots: [tmpRoot] });
  assert.equal(second.ok, true);
  assert.equal(second.copied.length, 0, 'втори пуск не бива да копира нищо');
  assert.equal(second.unchanged.length, portal.FILES.length);
  ok('втори пуск не пише нищо (идемпотентно)');

  // ── 4. Развален файл се поправя ────────────────────────────────────────────
  fs.writeFileSync(path.join(target, 'data', 'demo-evidence.json'), '{"title":"счупено"}');
  const status = portal.status({ env, roots: [tmpRoot] });
  assert.deepEqual(status.outdated, ['data/demo-evidence.json'], 'статусът вижда разваления файл');
  const repaired = portal.deploy({ env, roots: [tmpRoot] });
  assert.deepEqual(repaired.copied, ['data/demo-evidence.json'], 'поправя се само разваленият файл');
  assert.equal(sha(path.join(target, 'data', 'demo-evidence.json')), sha(path.join(src, 'data/demo-evidence.json')));
  ok('развален файл се вижда в статуса и се поправя сам');

  // ── 5. Демо данните са валиден манифест ────────────────────────────────────
  const demo = JSON.parse(fs.readFileSync(path.join(src, 'data/demo-evidence.json'), 'utf8'));
  assert.ok(typeof demo.title === 'string' && demo.title.length > 0, 'има заглавие');
  assert.ok(Array.isArray(demo.items) && demo.items.length > 0, 'има елементи');
  const walk = (nodes) => {
    for (const node of nodes) {
      assert.ok(/^[a-zA-Z0-9_-]+$/.test(node.id), 'валидно id: ' + node.id);
      assert.ok(['file', 'folder'].includes(node.type), 'познат тип: ' + node.type);
      if (node.type === 'file') {
        assert.ok(['free', 'password', 'locked'].includes(node.access), 'познат достъп: ' + node.access);
        assert.match(node.sha256 || '', /^[0-9a-f]{64}$/, 'SHA-256 е 64 hex знака: ' + node.name);
      }
      if (node.children) walk(node.children);
    }
  };
  walk(demo.items);
  ok('демо данните са валиден манифест (id, тип, достъп, SHA-256)');

  console.log('PASS evidence-portal-publish: ' + cases.length + ' проверки — ' + cases.join('; '));
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
