# Логически одит — отчет

Генериран: 2026-10-22T09:56:06.921Z

- сканирани: **289 файла · 50206 реда**
- находки: **7** (отворени 0, приети с обосновка 7)
- по тежест: critical 0 · high 0 · medium 0

## Отворени находки

_Няма отворени находки._

## Приети с обосновка

| файл:ред | правило | код | обосновка |
|---|---|---|---|
| `hapi_enterprise/download-access.js:71` | ternary-bool | `verify_on_serve: src.verify_on_serve === false ? false : true,` | Нормализация на политика: по подразбиране true, освен при изрично false. `src.x === false ? false : true` е точно това правило (undefined -> true), затова не се заменя с !src.x. |
| `hapi_enterprise/download-access.js:72` | ternary-bool | `audit: src.audit === false ? false : true,` | Нормализация на политика: по подразбиране true, освен при изрично false. `src.x === false ? false : true` е точно това правило (undefined -> true), затова не се заменя с !src.x. |
| `hapi_enterprise/download-access.js:81` | ternary-bool | `inherits: src.inherits === false ? false : true,` | Нормализация на политика: по подразбиране true, освен при изрично false. `src.x === false ? false : true` е точно това правило (undefined -> true), затова не се заменя с !src.x. |
| `hapi_enterprise/public-gateway.js:118` | ternary-bool | `api: src.api === false ? false : true,` | Същата нормализация на публичен портал: липсващо поле значи включено, изрично false значи изключено. Инверсията е умишлена. |
| `hapi_enterprise/public-gateway.js:119` | ternary-bool | `qr: src.qr === false ? false : true,` | Същата нормализация на публичен портал: липсващо поле значи включено, изрично false значи изключено. Инверсията е умишлена. |
| `hapi_enterprise/public-gateway.js:121` | ternary-bool | `inherit: src.inherit === false ? false : true,` | Същата нормализация на публичен портал: липсващо поле значи включено, изрично false значи изключено. Инверсията е умишлена. |
| `hapi_enterprise/server.js:1479` | off-by-one-loop | `for (let i = 0; i <= parts.length; i++) {` | lockedAncestor проверява ВСИЧКИ родителски префикси, включително пълния път; i === parts.length дава parts.slice(0, n) — точно последният родител, който трябва да се провери. Това е нарочна инклузивна итерация, не off-by-one. |

## Правила

| правило | тежест | какво хваща |
|---|---|---|
| off-by-one-loop | critical | цикъл с `<=` върху `.length` минава един елемент отвъд масива (undefined) |
| sort-boolean | critical | компаратор, който връща `true`/`false`, не сортира правилно — редът е произволен |
| parseint-radix | high | `parseInt` без основа гадае: низ с водеща 0 може да се чете като осмично, а „08“ — като 0 |
| assign-in-condition | critical | единично `=` в условие присвоява вместо да сравнява — условието е почти винаги истина |
| ternary-bool | medium | `cond ? true : false` е самият `cond`; `cond ? false : true` е отрицание — чете се трудно и крие инверсия |
| catch-returns-truthy | high | `catch`, който връща `true`/обект, превръща провала в успех — точно това е тихият пропуск |
| ms-seconds-mix | critical | `Date.now()` е в милисекунди; делене на 1000 на същия ред е класическият 1000× бъг |
| duplicate-condition | medium | едно и също сравнение повторено в `||`/`&&` — второто е мъртво, вероятно е сбъркан операнд |
| impossible-range | critical | долна граница, по-голяма от горната — условието никога не е истина |
| unreachable-code | high | код след `return`/`throw` в същия блок никога не се изпълнява — обикновено е забравена логика |
| async-in-sync-iteration | high | `forEach`/`map` с `async` не изчаква нищо — грешките се гулят и редът не е гарантиран |
| success-status-on-failure | critical | `fail()` с код 2xx връща „успех“ при грешка; клиентът не разбира, че е отказано |
| divide-by-literally-zero | critical | делене на литерал 0 дава `Infinity`/`NaN` и се разпространява тихо |
| reversed-slice | high | `slice(a, b)` с `a > b` връща празен масив — логиката отпада без грешка |
| boolean-as-string | high | сравнение с `"true"`/`"false"` върху булево поле винаги е неистина (или обратното) |
| mutate-while-iterating | high | промяна на масива, по който се итерира, пропуска или повтаря елементи |
