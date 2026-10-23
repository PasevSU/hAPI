'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Сериализация на достъпа до една тайна по id: два едновременни прегледа не бива да
// минат и двата покрай лимита за прегледи. Add-on-ът е един процес, значи това стига.
//
// Защо е отделен модул: предишната версия пазеше в Map `previous.then(() => current)`,
// а изчистваше записа само ако `get(id) === current` — тоест НИКОГА. Всеки преглед на
// тайна оставяше запис завинаги (бавeн теч на памет) и условието беше мъртъв код.
// Сега се помни точно опашката, която е сложена в Map, и тя се маха в `finally`.
//
//   const withSecretLock = require('./secret-lock').create();
//   await withSecretLock(id, async () => { ... });
//   withSecretLock.size()   // колко заключвания се пазят в момента (за тест)
// ─────────────────────────────────────────────────────────────────────────────

function create() {
  const locks = new Map();

  const run = async (id, fn) => {
    const previous = locks.get(id) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve });
    // Опашката се помни ТОЧНО такава, каквато влиза в Map — иначе изчистването по-долу
    // сравнява различни обекти и не изтрива нищо.
    const tail = previous.then(() => current);
    locks.set(id, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(id) === tail) locks.delete(id);
    }
  };

  run.size = () => locks.size;
  run.has = (id) => locks.has(id);
  return run;
}

module.exports = { create };
