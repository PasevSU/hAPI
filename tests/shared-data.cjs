'use strict';
// ОРАКУЛ: слоят за споделени данни (hapi_enterprise/shared-data.js) — без сървър.
//
// Проверяваме точните обещания, а не „не гърми“:
//   • `sync()` чете САМО ревизията и презарежда само при чужда промяна;
//   • `data()`/`keys()` връщат ЦЕЛИЯ набор данни, не отрязък;
//   • `transaction` работи върху живия обект (препратките остават валидни), а при провал
//     връща състоянието назад — и в паметта, и на диска;
//   • при конфликт (друг процес е писал) намерението ни се СЛИВА с неговото, вместо да се
//     загуби; изчерпването на опитите е ясна грешка с код STORE_CONFLICT.
const assert = require('node:assert/strict');
const sharedData = require('../hapi_enterprise/shared-data');

// Малка „база“: пази JSON и ревизия, записва само ако ревизията е още същата.
function fakeStore(initial) {
  const state = { payload: structuredClone(initial), revision: 0, saves: 0, conflictOnce: false, alwaysConflict: false, beforeSave: null };
  return {
    state,
    snapshot() {
      return { payload: structuredClone(state.payload), revision: state.revision };
    },
    revision() {
      return state.revision;
    },
    save(payload, expectedRevision) {
      if (state.beforeSave) state.beforeSave(state);
      if (state.alwaysConflict || state.conflictOnce) {
        state.conflictOnce = false;
        // Другият процес е записал нещо между нашето четене и нашия запис.
        state.payload = { ...state.payload, theirs: { id: 't1', value: 'чуждо' } };
        state.revision += 1;
        throw Object.assign(new Error('конфликт'), { code: 'STORE_CONFLICT' });
      }
      if (expectedRevision !== state.revision) throw Object.assign(new Error('конфликт'), { code: 'STORE_CONFLICT' });
      state.payload = structuredClone(payload);
      state.revision += 1;
      state.saves += 1;
      return state.revision;
    },
  };
}

(async () => {
  // ── 1. sync(): една ревизионна заявка, без излишно презареждане ───────────────
  {
    const store = fakeStore({ portals: [{ id: 'p1', title: 'Първи' }], variables: [] });
    let bound = null;
    const data = sharedData.create({ store, bind: (payload) => { bound = payload } });
    const first = data.sync();
    assert.equal(first.portals[0].title, 'Първи', 'sync връща данните');
    assert.equal(bound, first, 'bind получава същия обект, който sync връща');
    const refreshesAfterFirst = data.state().refreshes;
    const second = data.sync();
    assert.equal(second, first, 'без чужда промяна връща СЪЩИЯ обект (без презареждане)');
    assert.equal(data.state().refreshes, refreshesAfterFirst, 'няма излишно презареждане');

    // Чужд запис: ревизията расте → следващият sync вижда новото.
    store.state.payload = { ...store.state.payload, portals: [...store.state.payload.portals, { id: 'p2', title: 'От друг процес' }] };
    store.state.revision += 1;
    const third = data.sync();
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
    const data = sharedData.create({ store, bind: () => { } });
    const live = data.sync();
    const portal = live.portals[0];
    await data.transaction(() => { portal.files.push({ id: 'f1' }) });
    assert.equal(live.portals[0].files.length, 1, 'промяната е в СЪЩИЯ обект (препратката е валидна)');
    assert.equal(store.state.payload.portals[0].files.length, 1, 'и е записана на диска');
    assert.equal(store.state.saves, 1, 'точно един запис');
    assert.equal(store.state.revision, 1, 'ревизията е напред с едно');
    assert.equal(data.state().revision, 1, 'слоят знае същата ревизия');
  }

  // ── 4. transaction: провал връща и паметта, и диска ──────────────────────────
  {
    const store = fakeStore({ portals: [{ id: 'p1', title: 'Оригинал' }] });
    const data = sharedData.create({ store, bind: () => { } });
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
  }

  // ── 5. Конфликт: нашето и чуждото оцеляват и двете (тристранно сливане) ───────
  {
    const store = fakeStore({ portals: [{ id: 'p1', files: [] }] });
    const data = sharedData.create({ store, bind: () => { }, baseDelayMs: 0 });
    const live = data.sync();
    store.state.conflictOnce = true; // първият запис се сблъсква с чужд
    await data.transaction(() => { live.portals[0].files.push({ id: 'мое' }) });
    const saved = store.state.payload;
    assert.equal(saved.portals[0].files.length, 1, 'нашият файл е записан');
    assert.equal(saved.portals[0].files[0].id, 'мое', 'точно нашият файл');
    assert.ok(saved.theirs, 'чуждото също е запазено (не е презаписано)');
    assert.equal(data.state().conflicts, 1, 'отчетен е един конфликт');
    assert.equal(data.state().merges, 1, 'направено е едно сливане');
    assert.equal(store.state.saves, 1, 'успешният запис е точно един');
  }

  // ── 6. Конфликт по идентификатор: двамата добавят различен портал ────────────
  {
    const store = fakeStore({ portals: [{ id: 'base', files: [] }] });
    const data = sharedData.create({ store, bind: () => { }, baseDelayMs: 0 });
    const live = data.sync();
    store.state.conflictOnce = true;
    await data.transaction(() => { live.portals.push({ id: 'мое', files: [] }) });
    const ids = store.state.payload.portals.map((p) => p.id);
    assert.equal(ids.includes('мое'), true, 'нашият портал е записан');
    assert.equal(ids.includes('base'), true, 'старият портал е на място');
    assert.equal(new Set(ids).size, ids.length, 'няма дубликати');
  }

  // ── 7. sync() в средата на транзакция НЕ подменя работния обект ──────────────
  {
    const store = fakeStore({ portals: [] });
    const data = sharedData.create({ store, bind: () => { } });
    const live = data.sync();
    let insideSame = null;
    await data.transaction(() => {
      store.state.revision += 1; // чужд запис по средата
      insideSame = data.sync() === live;
    });
    assert.equal(insideSame, true, 'по време на транзакция sync връща работния обект');
  }

  // ── 8. Изчерпване на опитите: ясна грешка, без безкраен цикъл ────────────────
  {
    const store = fakeStore({ portals: [] });
    store.state.alwaysConflict = true;
    const data = sharedData.create({ store, bind: () => { }, baseDelayMs: 0, retry: 3 });
    await assert.rejects(
      data.transaction(() => { data.peek().portals.push({ id: 'x' }) }),
      (e) => e.code === 'STORE_CONFLICT' && e.status === 503 && e.attempts === 3,
    );
    assert.equal(data.state().conflicts, 3, 'точно три сблъсъка преди отказ');
    assert.equal(store.state.saves, 0, 'нищо не е записано');
  }

  // ── 9. Абонати: уведомяват се при чуждо презареждане и се отписват ──────────
  {
    const store = fakeStore({ portals: [] });
    const data = sharedData.create({ store });
    const seen = [];
    const off = data.onChange((payload, info) => seen.push({ count: payload.portals.length, reason: info.reason }));
    data.sync();
    // Първоначалното зареждане също е презареждане — броим само след него.
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

  // ── 10. merge(): чиста функция с предвидими правила ─────────────────────────
  {
    const base = { a: 1, list: [{ id: 'x', v: 1 }] };
    assert.deepEqual(sharedData.merge(base, base, { a: 2, list: [{ id: 'x', v: 1 }] }), { a: 2, list: [{ id: 'x', v: 1 }] }, 'ние не пипаме → тяхното');
    assert.deepEqual(sharedData.merge(base, { a: 3, list: [{ id: 'x', v: 1 }] }, base), { a: 3, list: [{ id: 'x', v: 1 }] }, 'те не пипат → нашето');
    const both = sharedData.merge(base, { a: 3, list: [{ id: 'x', v: 2 }] }, { a: 2, list: [{ id: 'x', v: 1 }, { id: 'y', v: 9 }] });
    assert.equal(both.a, 3, 'при разлика в едно и също поле печели нашето намерение');
    assert.deepEqual(both.list.map((i) => i.id), ['x', 'y'], 'списъкът пази и двете страни');
    assert.equal(both.list.find((i) => i.id === 'x').v, 2, 'нашето поле в общия елемент печели');
    const deleted = sharedData.merge({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 5 });
    assert.deepEqual(deleted, { a: 1 }, 'изтрито от нас остава изтрито');
    assert.equal(sharedData.equal({ a: 1, b: 2 }, { b: 2, a: 1 }), true, 'равенството не зависи от реда на ключовете');
    assert.equal(sharedData.equal({ a: 1 }, { a: 2 }), false, 'различните стойности не са равни');
  }

  console.log('PASS shared-data: sync чете само ревизията · data()/keys() дават ВСИЧКИ данни · транзакцията работи върху живия обект · провал връща паметта и диска · конфликт се слива (нашето + чуждото) · отказ след точния брой опити');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
