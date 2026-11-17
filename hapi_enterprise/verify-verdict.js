'use strict';
// ПРИСЪДАТА НА ЕДНА СВЕРКА НА ЦЯЛОСТТА — едно място, защото ключовете на обобщението се знаят
// от три страни: синхронният вход, фоновата задача и панелът.
//
// `verifyPortalFiles` брои по статус (`VERIFIED`, `MISMATCH`, `MISSING`, `INVALID_TYPE`, `ERROR`,
// `WRITABLE`), а не връща поле `failed`. Досега всяка страна смяташе провала сама и две от три
// го правеха грешно: панелът четеше `summary.mismatch` (малки букви) и показваше „разминават се 0“
// точно когато имаше подмяна, а фоновата задача смяташе `failed` от несъществуващо поле, тоест
// никога не влизаше в журнала на грешките. Затова:
//   • `MISMATCH`, `MISSING`, `INVALID_TYPE`, `ERROR` = провал (`ok: false`);
//   • `WRITABLE` е ПРЕДУПРЕЖДЕНИЕ за WORM (файлът е сменяем), не доказателство за подмяна —
//     влиза в `warnings`, но не прави сверката провалена.
const PROBLEM_KEYS = Object.freeze(['MISMATCH', 'MISSING', 'INVALID_TYPE', 'ERROR']);
const WARNING_KEYS = Object.freeze(['WRITABLE']);

function count(summary, keys) {
  return keys.reduce((n, key) => n + (Number(summary && summary[key]) || 0), 0);
}

/** Обобщение на сверка → `{ verified, failed, warnings, ok }`. Никога не хвърля. */
function verdict(summary) {
  const failed = count(summary, PROBLEM_KEYS);
  return {
    verified: Number(summary && summary.VERIFIED) || 0,
    failed,
    warnings: count(summary, WARNING_KEYS),
    ok: failed === 0,
  };
}

/** Кратък ред за човек: „проверени 3 · проблемни 1 · предупреждения 0“. */
function describe(summary) {
  const v = verdict(summary);
  return { ...v, text: `проверени ${v.verified} · проблемни ${v.failed} · предупреждения ${v.warnings}` };
}

module.exports = {
  verdict,
  describe,
  PROBLEM_KEYS,
  WARNING_KEYS,
};
