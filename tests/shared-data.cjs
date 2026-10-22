'use strict';
// ОРАКУЛ: слоят за споделени данни (hapi_enterprise/shared-data.js) — без сървър.
//
// Проверяваме точните обещания, а не „не гърми“:
//   • `sync()` чете САМО ревизията и презарежда само при чужда промяна, без да подменя обекта;
//   • `data()`/`keys()` връщат ЦЕЛИЯ набор данни, не отрязък;
//   • `transaction` работи върху живия обект, под междупроцесна ключалка, и записва точно веднъж;
//   • провал връща състоянието назад — и в паметта, и на диска;
//   • ключалката е взаимно изключваща между ДВА слоя върху една папка, поема се, ако е
//     изоставена, и след изтичане на изчакването дава ясна грешка STORE_LOCKED;
//   • `reconcile` обновява съдържанието, но запазва идентичността на обектите.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharedData = require('../hapi_enterprise/shared-data');

// Малка „база“: пази JSON и ревизия и (като истинската) отказва запис с остаряла ревизия.
function fakeStore(initial) {
  const state = { payload: structuredClone(initial), revision: 0, saves: 0 };
  return {
    state,
    snapshot() {
      return { payload: structuredClone(state.payload), revision: state.revision };
    },
    revision() {
      return state.revision;
    },
    save(payload, expectedRevision) {
      if (expectedRevision !== undefined && expectedRevision !== null && expectedRevision !== state.revision) {
        throw Object.assign(new Error('конфликт'), { code: 'STORE_CONFLICT' });
      }
      state.payload = structuredClone(payload);
      state.revision += 1;
      state.saves += 1;
      return state.revision;
    },
  };
}

const lockPathIn = (dir) => path.join(dir, '.hapi-store-lock');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-sd-'));
  try {
    // ── 1. sync(): една ревизионна заявка, без излишно презареждане ───────────────
    {
      const store = fakeStore({ portals: [{ id: 'p1', title: 'Първи' }], variables: [] });
      let bound = null;
      const data = sharedData.create({ store, bind: (payload) => { bound = payload } });
      const first = data.sync();
      assert.equal(first.portals[0].title, 'Първи', 'sync връща данните');
      assert.equal(bound, first, 'bind получава същия обект, който sync връща');
      const refreshesAfterFirst = data.state().refreshes;
      assert.equal(data.sync(), first, 'без чужда промяна връща СЪЩИЯ обект (без презареждане)');
      assert.equal(data.state().refreshes, refreshesAfterFirst, 'няма излишно презареждане');

      // Чужд запис: ревизията расте → следващият sync вижда новото, но обектът е СЪЩИЯТ.
      store.state.payload = { ...store.state.payload, portals: [...store.state.payload.portals, { id: 'p2', title: 'От друг процес' }] };
      store.state.revision += 1;
      const third = data.sync();
      assert.equal(third, first, 'обектът НЕ се подменя при чужд запис (иначе препратките умират)');
      assert.equal(third.portals.length, 2, 'вижда портала, записан от другия процес');
      assert.equal(data.state().refreshes, refreshesAfterFirst + 1, 'точно едно презареждане');
    }

    // ── 2. data()/keys(): достъп до ВСИЧКИ данни, не до отрязък ────────────────────
    {
      const store = fakeStore({ portals: [], directory: { contacts: [] }, cases: [], variables: [], taxonomy: { topics: [] }, settings: {} });
      const data = sharedData.create({ store });
      assert.deepEqual(data.keys(), ['cases', 'directory', 'portals', 'settings', 'taxonomy', 'variables'], 'keys връща всички слоеве подредени');
      const all = data.data();
      for (const key of data.keys()) assert.ok(Object.hasOwn(all, key), 'data() съдържа слоя ' + key);
      assert.equal(data.data(), all, 'data() връща същия жив обект');
    }

    // ── 3. transaction: живее върху живия обект и записва точно веднъж ────────────
    {
      const store = fakeStore({ portals: [{ id: 'p1', files: [] }] });
      const data = sharedData.create({ store, bind: () => { }, lockPath: lockPathIn(tmp) });
      const live = data.sync();
      const portal = live.portals[0];
      await data.transaction(() => { portal.files.push({ id: 'f1' }) });
      assert.equal(live.portals[0].files.length, 1, 'промяната е в СЪЩИЯ обект (препратката е валидна)');
      assert.equal(live.portals[0], portal, 'самият портал е същият обект');
      assert.equal(store.state.payload.portals[0].files.length, 1, 'и е записана на диска');
      assert.equal(store.state.saves, 1, 'точно един запис');
      assert.equal(data.state().revision, 1, 'слоят знае същата ревизия');
      assert.equal(fs.existsSync(lockPathIn(tmp)), false, 'ключалката е освободена след записа');
    }

    // ── 4. transaction: провал връща и паметта, и диска ──────────────────────────
    {
      const store = fakeStore({ portals: [{ id: 'p1', title: 'Оригинал' }] });
      const data = sharedData.create({ store, bind: () => { }, lockPath: lockPathIn(tmp) });
      const live = data.sync();
      await assert.rejects(
        data.transaction(() => {
          live.portals[0].title = 'Променено';
          throw Object.assign(new Error('Невалидна видимост'), { status: 400 });
        }),
        (e) => e.status === 400,
      );
      assert.equal(data.peek().portals[0].title, 'Оригинал', 'паметта е върната към състоянието отпреди операцията');
      assert.equal(store.state.payload.portals[0].title, 'Оригинал', 'на диска също няма промяна');
      assert.equal(store.state.saves, 0, 'нищо не е записано');
      assert.equal(fs.existsSync(lockPathIn(tmp)), false, 'ключалката е освободена и при провал');
    }

    // ── 5. Два слоя върху ЕДНА ключалка не пишат едновременно ────────────────────
    {
      const store = fakeStore({ entries: [] });
      const lockPath = lockPathIn(tmp);
      const a = sharedData.create({ store, bind: () => { }, lockPath, pollMs: 2 });
      const b = sharedData.create({ store, bind: () => { }, lockPath, pollMs: 2 });
      a.sync();
      b.sync();
      let inside = 0;
      let maxInside = 0;
      const job = (data, tag) =>
        data.transaction(async () => {
          inside++;
          maxInside = Math.max(maxInside, inside);
          await new Promise((resolve) => setTimeout(resolve, 5));
          data.peek().entries.push({ id: tag });
          inside--;
        });
      await Promise.all([job(a, 'a1'), job(b, 'b1'), job(a, 'a2'), job(b, 'b2')]);
      assert.equal(maxInside, 1, 'никога два записа не текат едновременно');
      const ids = store.state.payload.entries.map((e) => e.id).sort();
      assert.deepEqual(ids, ['a1', 'a2', 'b1', 'b2'], 'всичките четири записа са на диска');
      assert.equal(store.state.saves, 4, 'точно четири записа');
    }

    // ── 6. Изоставена ключалка (мъртъв pid) се поема, вместо да блокира ───────────
    {
      const store = fakeStore({ entries: [] });
      const lockPath = lockPathIn(tmp);
      fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, host: os.hostname(), at: new Date().toISOString() }));
      const data = sharedData.create({ store, bind: () => { }, lockPath, pollMs: 2, lockTimeoutMs: 2000 });
      data.sync();
      await data.transaction(() => { data.peek().entries.push({ id: 'след-срив' }) });
      assert.equal(store.state.payload.entries.length, 1, 'записът минава след изоставена ключалка');
      assert.equal(fs.existsSync(lockPath), false, 'ключалката е освободена');
    }

    // ── 7. Заета ключалка от ЖИВ процес: изчаква и после дава ясна грешка ────────
    {
      const store = fakeStore({ entries: [] });
      const lockPath = lockPathIn(tmp);
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString() }));
      const data = sharedData.create({ store, bind: () => { }, lockPath, pollMs: 2, lockTimeoutMs: 60 });
      data.sync();
      await assert.rejects(
        data.transaction(() => { data.peek().entries.push({ id: 'не-бива' }) }),
        (e) => e.code === 'STORE_LOCKED' && e.status === 503,
      );
      assert.equal(store.state.saves, 0, 'нищо не е записано, докато ключалката е чужда');
      assert.equal(data.state().lockTimeouts, 1, 'отчетен е един отказ по ключалка');
      fs.rmSync(lockPath, { force: true });
    }

    // ── 8. sync() в средата на транзакция НЕ подменя работния обект ──────────────
    {
      const store = fakeStore({ portals: [] });
      const data = sharedData.create({ store, bind: () => { }, lockPath: lockPathIn(tmp) });
      const live = data.sync();
      let insideSame = null;
      // Чужд запис „извън ключалката“: транзакцията трябва да откаже ясно (не да презапише),
      // а до момента на отказа sync() не бива да е подменил работния обект.
      await assert.rejects(
        data.transaction(() => {
          store.state.revision += 1;
          insideSame = data.sync() === live;
        }),
        (e) => e.code === 'STORE_CONFLICT',
      );
      assert.equal(insideSame, true, 'по време на транзакция sync връща работния обект');
      assert.equal(store.state.saves, 0, 'нищо не е записано при отказ');
    }

    // ── 9. Абонати: уведомяват се при чуждо презареждане и се отписват ──────────
    {
      const store = fakeStore({ portals: [] });
      const data = sharedData.create({ store });
      const seen = [];
      const off = data.onChange((payload, info) => seen.push({ count: payload.portals.length, reason: info.reason }));
      data.sync();
      assert.equal(seen.length, 1, 'първоначалното зареждане уведомява абоната веднъж');
      seen.length = 0;
      store.state.payload = { ...store.state.payload, portals: [{ id: 'нови' }] };
      store.state.revision += 1;
      data.sync();
      assert.equal(seen.length, 1, 'абонатът е уведомен точно веднъж за чуждата промяна');
      assert.equal(seen[0].reason, 'sync', 'причината е синхронизация');
      off();
      store.state.revision += 1;
      data.sync();
      assert.equal(seen.length, 1, 'след отписване не получава повече');
    }

    // ── 10. reconcile(): обновява съдържанието, но пази идентичността ───────────
    {
      const live = { portals: [{ id: 'a', title: 'старо', files: [] }, { id: 'b', title: 'b' }], settings: { x: 1, y: 2 } };
      const keepA = live.portals[0];
      const next = { portals: [{ id: 'a', title: 'ново', files: [{ id: 'f' }] }, { id: 'c', title: 'c' }], settings: { x: 9 } };
      sharedData.reconcile(live, next);
      assert.equal(live.portals[0], keepA, 'съществуващият портал е СЪЩИЯТ обект');
      assert.equal(live.portals[0].title, 'ново', 'но съдържанието е обновено');
      assert.deepEqual(live.portals.map((p) => p.id), ['a', 'c'], 'изчезналият е премахнат, новият е добавен');
      assert.deepEqual(live.settings, { x: 9 }, 'изчезналият ключ е премахнат');
    }

    console.log('PASS shared-data: sync чете само ревизията и не подменя обекта · data()/keys() дават ВСИЧКИ данни · транзакцията е под ключалка и работи върху живия обект · провал връща паметта и диска · ключалката е взаимно изключваща, поема се след срив и отказва с STORE_LOCKED');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
