# ADR-0025: Миграционен конвейер за документи с нулева загуба (Фаза 6)

- **Status:** Accepted
- **Дата:** 2026-10-12

## Контекст
Фаза 6 изисква безопасно мигриране на папка с документи и указатели („източник“) в
управлявано хранилище („цел“), с гаранция за 0% щети по файловете. Обхватът е зададен
в `docs/plan/13-phase-6-migration-architecture.md`. Изискването е миграцията да е
fail-closed, верифицируема (SHA-256), възобновяема и обратима.

## Решение
Въведен е модул **`migration-pipeline.js`** — оркестратор, реализиращ осемте етапа
`PRECHECK → SNAPSHOT → PLAN → STAGE → VERIFY → SWITCH → RECONCILE → REPORT`:

- **PRECHECK (`preflight`)** — fail-closed проверка: източникът съществува, не е symlink,
  е четим; източник/цел не са вложени един в друг; родителят на целта е реален и има
  достатъчно място. Връща `{ok, blockers[]}` без странични ефекти.
- **SNAPSHOT/PLAN (`plan`)** — инвентаризира източника (имена + размери, сортирани),
  открива конфликтите спрямо съществуваща цел и връща dry-run отчет
  (`totalFiles/totalBytes/conflicts/neededBytes/sufficient`).
- **STAGE** — копира файловете в отделна директория `<цел>.migrate-staging`, а не директно
  в целта. Всеки файл се верифицира чрез SHA-256 на източника спрямо копието. Използва
  `copy` (по подразбиране), `hardlink` (с EXDEV fallback към copy) или `reference`
  (без трансфер — само инвентар за сверяване).
- **VERIFY** — сверява съдържанието на staging-то с планирания набор файлове (имена + размери).
- **SWITCH** — атомарен `rename` на staging-то към целта. Ако целта вече съществува, тя се
  мести в `<цел>.bak.<timestamp>` преди това — така старата цел остава за rollback.
- **RECONCILE/REPORT** — връща `{sourcePreserved, files, copied, skipped, backup, destination}`.
- **Конфликти** — `data.conflictPolicy`: `queue` (преименува новия файл `name (2).ext`),
  `first` (пази съществуващия), `skip` (пропуска новия). Никога не презаписва съществуващ файл.
- **Resume** — `run` е идемпотентен: файлове, вече поставени в staging с валиден hash, се
  пропускат. Прекъснато изпълнение се възобновява чрез повторно извикване на `run`.

Инвариантът за нулева загуба се гарантира от: (1) източникът никога не се записва; (2) всяко
копие се верифицира преди commit; (3) commit е `rename`; (4) старата цел се запазва като backup
и `rollback()` я възстановява, като мигрираното съдържание също се запазва като
`<цел>.pre-rollback.<ts>`.

## API
`POST /admin/api/migrate/preflight|plan|run`, `GET /admin/api/migrate/:planId`,
`POST /admin/api/migrate/:planId/cancel|rollback` — достъп през `adminGate('migrate')`
(admin-only). `run` подава работа в `job-manager` (`type:'migration'`); прогресът и
резултатът се четат от `GET /admin/api/migrate/:planId`, а `job.*` събитията се показват
в Notification Center от Фаза 5.

## Последици
- Плюс: проверяем и възобновяем конвейер; източникът остава непокътнат; обратимост чрез backup.
- Минус: първоначалният инвентар на големи дървета хешира по време на копиране (не в `plan`),
  затова `plan` е бърз (само имена + размери), а `run` хешира по време на STAGE.

## Checklist за гъвкавост (§9.1)
- [x] Изключва се през config? — да, `method:'reference'` пропуска трансфера; миграцията е опционална.
- [x] Заменя се с алтернатива? — `create()` връща `{preflight,plan,run,rollback,scan}`; методите са сменяеми.
- [x] Има интерфейс, не конкретна имплементация? — да (`CONFLICT_POLICIES`, `METHODS` са декларирани множества).
- [x] Излъчва събитие? — `migrate.preflight/plan/run/completed/rollback` + `job.*`.
- [x] Има миграция с rollback? — да, `rollback({destination})` възстановява `.bak.<ts>`.
- [x] Документиран е в ADR? — да (настоящият ADR).
- [x] Тестван изолирано? — `migrate-preflight.cjs`, `migrate-copy-verify.cjs`, `migrate-conflict.cjs`, `migrate-rollback.cjs`, `migrate-resume.cjs`.
