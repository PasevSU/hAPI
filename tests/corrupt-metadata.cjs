'use strict';
// Повредени метаданни не бива да излизат като гол `SyntaxError` от JSON.parse.
//
// Преди: `load()` хвърляше `SyntaxError: Unexpected token` без контекст — операторът вижда
// само „add-on-ът не стартира“ и не знае кой файл/база е повреден, нито какво да направи.
// Сега: `CORRUPT_METADATA` с обяснение кое е счупено и с какво се възстановява.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require(path.join(__dirname, '..', 'hapi_enterprise', 'sqlite-store.js'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-corrupt-'));
const jsonPath = path.join(dir, 'metadata.json');

// Windows може да държи handle към .sqlite/-wal още миг след close() — почистването
// на временната папка не бива да се превръща в провал на теста.
function removeQuiet(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch { /* временната папка не е резултат от теста */ }
}

try {
  // 1. Нормалният път работи и данните се четат обратно.
  const first = store.open(jsonPath);
  first.save({ portals: [{ id: 'p1', slug: 'p1', title: 'Портал', files: [] }], qrArtifacts: [] });
  first.close();
  const second = store.open(jsonPath);
  assert.equal(second.load().portals.length, 1, 'записаните метаданни се четат');
  second.close();

  // 2. Повреден JSON в SQLite дава ясна грешка, не SyntaxError.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(jsonPath.replace(/\.json$/i, '.sqlite'));
  db.exec("UPDATE metadata SET payload = '{ това не е JSON' WHERE id = 1");
  db.close();
  const third = store.open(jsonPath);
  assert.throws(
    () => third.load(),
    (e) => {
      assert.equal(e.code, 'CORRUPT_METADATA', 'кодът е CORRUPT_METADATA, не SYNTAX_ERR');
      assert.equal(e.status, 500);
      assert.match(e.message, /не са валиден JSON/, 'съобщението казва какво е счупено');
      assert.match(e.message, /Възстанови от архив/, 'съобщението казва какво да се направи');
      return true;
    },
  );
  third.close();

  // 3. Повреден JSON-снимка (когато базата още не съществува) също дава ясна грешка.
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-corrupt-json-'));
  const freshPath = path.join(fresh, 'metadata.json');
  fs.writeFileSync(freshPath, '{ счупено', { mode: 0o600 });
  const fourth = store.open(freshPath);
  assert.throws(
    () => fourth.load(),
    (e) => {
      assert.equal(e.code, 'CORRUPT_METADATA');
      assert.ok(e.message.includes(freshPath), 'съобщението сочи конкретния файл');
      return true;
    },
  );
  fourth.close();
  removeQuiet(fresh);

  console.log('PASS corrupt-metadata: повредени метаданни дават CORRUPT_METADATA с обяснение, не SyntaxError');
} finally {
  removeQuiet(dir);
}
