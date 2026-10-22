'use strict';
// КЛЮЧАЛКАТА НА ДАННИТЕ: АТОМАРНА И БЕЗ „КРАЖБА“ НА ПРЯСНА КЛЮЧАЛКА.
//
// Защо този тест съществува: `tests/shared-data-processes.cjs` падаше понякога на CI с
// „не всички 20 едновременни записа са приети“, а на локалната машина минаваше. Причината
// не беше в сървъра, а в начина на създаване на ключалката: файлът се създаваше и после
// се запълваше, тоест имаше прозорец, в който е празен; вторият процес не можеше да го
// парсне, смяташе го за изоставен, изтриваше го и двамата пишеха едновременно.
//
// Правилата, които се пазят тук:
//   • прясна ключалка (дори с нечетимо съдържание) НЕ се отнема — изчаква се и се отказва
//     с ясна грешка `STORE_LOCKED`, вместо да се получи тих паралелен запис;
//   • застояла ключалка (по-стара от `staleLockMs`) се поема, за да не блокира add-on-а;
//   • файлът на ключалката винаги съдържа ЦЯЛОТО съдържание (собственик с pid), а не
//     половин JSON — това е разликата между атомарно създаване и „създай и после пиши“;
//   • след транзакцията ключалката се освобождава и следващата минава.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const shared = require('../hapi_enterprise/shared-data');

// Минимален store: snapshot()/revision()/save() са точно това, което слоят изисква.
function stubStore(payload) {
  let data = payload;
  let revision = 1;
  return {
    snapshot: () => ({ payload: JSON.parse(JSON.stringify(data)), revision }),
    revision: () => revision,
    save: (next) => {
      data = JSON.parse(JSON.stringify(next));
      revision += 1;
      return revision;
    },
  };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-lock-'));
  const lockPath = path.join(dir, 'data.lock');
  try {
    const store = stubStore({ portals: [] });
    const sd = shared.create({ store, lockPath, lockTimeoutMs: 250, staleLockMs: 60000, pollMs: 5 });

    // ── 1. Прясна, но нечетима ключалка не се краде ───────────────────────────
    // Точно състоянието, което старият код смяташе за „изоставено“.
    fs.writeFileSync(lockPath, '{ "pid": 1, "host": "x"');
    let locked = null;
    try {
      await sd.transaction(async () => 'не бива да се стигне');
    } catch (e) {
      locked = e;
    }
    assert.ok(locked, 'прясна нечетима ключалка трябва да откаже, а не да се отнеме');
    assert.equal(locked.code, 'STORE_LOCKED', 'отказът е ясен: STORE_LOCKED, не STORE_CONFLICT');
    assert.equal(locked.status, 503, 'отказът носи 503, за да е ясно, че е временно');
    assert.equal(fs.readFileSync(lockPath, 'utf8'), '{ "pid": 1, "host": "x"', 'чуждата ключалка остава непокътната');
    assert.equal(sd.state().lockTimeouts, 1, 'отказът е отчетен като изчакване на ключалка');

    // ── 2. Застояла ключалка се поема ─────────────────────────────────────────
    const old = new Date(Date.now() - 120000);
    fs.utimesSync(lockPath, old, old);
    const written = await sd.transaction(async (db) => {
      db.portals.push({ id: 'p1', slug: 'zastoyala' });
      return 'ok';
    });
    assert.equal(written, 'ok', 'застояла ключалка се поема и транзакцията минава');
    assert.equal(store.snapshot().payload.portals.length, 1, 'записът е стигнал до store');
    assert.equal(fs.existsSync(lockPath), false, 'след транзакцията ключалката е освободена');

    // ── 3. Докато се държи, файлът е ЦЯЛ (атомарно създаване) ────────────────
    let openGate;
    const gate = new Promise((resolve) => {
      openGate = resolve;
    });
    const holding = sd.transaction(async () => {
      await gate;
      return 'държа';
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assert.equal(Number(owner.pid), process.pid, 'ключалката носи пълния собственик, а не половин JSON');
    assert.equal(typeof owner.at, 'string', 'ключалката носи време на вземане');
    openGate();
    assert.equal(await holding, 'държа', 'транзакцията завършва нормално');

    // ── 4. След освобождаване следващата транзакция минава ───────────────────
    const after = await sd.transaction(async (db) => db.portals.length);
    assert.equal(after, 1, 'следващата транзакция вижда предишния запис');
    assert.deepEqual(sd.state().conflicts, 0, 'няма CAS конфликти при нормална работа');

    console.log('PASS shared-data-lock: пряса ключалка не се краде (503 STORE_LOCKED) · застояла се поема · съдържанието е цяло, докато се държи · освобождаването работи');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
