# Промени в hAPI Enterprise

Тази версия: **0.69.241**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.241

- **Линтът вече не „минава“ заради потискания (DEF-66).** `npx eslint .` даваше 0, но това беше
  0 **след** `eslint-suppressions.json`: **216** находки в **135** файла чакаха в базата (9 правила),
  а никой не виждаше отчета. Днес **всички са поправени**, не преместени — базата е `{}`
  (0 файла, 0 записа).
- **По правила, не на парче.** `no-unused-vars` 38 (мъртви параметри и променливи — махани, не
  потискани), `no-useless-assignment` 52 (първото присвояване преди `return`/презапис — премахнато),
  `no-control-regex` 16 (контролните символи са НАРОЧНИ в санитизацията, затова получават
  `eslint-disable-next-line` с обосновка на точния ред), `no-useless-escape` 12 (в `runtime-config.js`
  character class-ът беше сбъркан — `\[`/`\]` са излишни, `\-` е нужен), `no-empty` 93, плюс
  `no-redeclare` (`app.js`), `no-unsafe-finally` ×2 в `instance-lock.js` (хвърлянето във `finally`
  поглъщаше изключението от `try` — сега се събира и хвърля след блока), `preserve-caught-error`
  в `storage-preflight.js` (`{ cause: e }`) и `no-regex-spaces` ×2.
- **Празният `catch` е решение, не мълчание.** 93-те места получиха отговор: трите в
  `scripts/dev-dashboard.cjs` носят обосновка в коментар, а в тестовете (изчакване на `/health`,
  почистване във `finally`) `no-empty` е с `allowEmptyCatch: true` **само за `tests/**/*.cjs`** —
  изключението е тясно и е записано в `eslint.config.mjs` с причина.
- **Ратчетът само пада.** Нов `tests/eslint-ratchet.cjs` пази тавана: иска базата да е празна, с
  `eslint --print-config` доказва, че продуктът остава под пълното правило (`allowEmptyCatch: false`
  за `server.js`, `ui/files-manager.js`, `scripts/test-matrix.cjs`), че изключението е scoped само
  до тестовете и че базата е валиден JSON. Мутационно проверен — добавен запис в базата го събаря.
  Защитата е вписана в `tests/regression-guards.cjs` (котва: „базата не бива да съдържа потискания“).
