# ADR-0024: Център за уведомления и настройки с прогрес (Фаза 5)

- **Status:** Accepted
- **Дата:** 2026-10-12

## Контекст
Фаза 5 изисква (1) пълноценен екран за настройки в административния панел с групиране
по 7 секции, инлайн валидация, индикация „изисква рестарт“ и сравнение при прилагане на
профил, и (2) изкачащ блок (drawer), който показва прогреса на процесите, техния успех
или провал. Досега настройките бяха минимални (само съхранение + лимити), а изходът на
информация — оскъден. Обхватът е зададен в `docs/plan/12-phase-5-settings-and-progress.md`.

## Решение
Въведен е устойчив, ограничен кръгов буфер за уведомления и събитиен транспорт:

- **`notification-center.js`** — персистентен ring buffer (по подразбиране 200 записа),
  съхраняван в `notifications.json`. Поддържа `record()`, `upsert()` (job се движи
  `running -> succeeded/failed/cancelled` на място, без спам), `list()` (newest-first,
  филтри `since/limit/level/kind/status`), `stats()`, `clear({finishedOnly})`.
  Записът е синхронен (`writeFileSync` + `renameSync`) — елиминира състезанието между
  последователни create → reload, наблюдавано при асинхронното fire-and-forget персистиране.
- **Event Bus** — `job-manager` излъчва `job.running/succeeded/failed/cancelled/interrupted`;
  `server.js` излъчва `settings_changed`, `backup.created`, `config.profile.saved/applied`,
  `integrity.verified`, `storage.warning`. `notificationCenter.subscribe(bus)` ги проектира
  в уведомления.
- **API** — `GET /admin/api/events` (с филтри) и `POST /admin/api/events/clear`
  (`?all=true` изчиства всичко, иначе само завършените). Достъп през `adminGate('settings')`.
- **UI** — групиран екран за настройки (Бранд, Съхранение, Лимити и достъп,
  Данни и таксономия, Съхранение на документи, Преглед + read-only Add-on опции) и
  глобален бутон с badge (активни + неуспешни), drawer с активни/история, филтър
  „само неуспешни“ и „Изчисти“. Badge се опреснява чрез лек 5-секунден poll.

## Последици
- Плюс: единен източник на истина за операционни събития; прогрес на място; определена
  персистентност; минимални HTTP разходи (ring buffer ≤ 200, `since`/филтри).
- Минус: синхронният запис е приемлив само заради малкия размер на буфера; при голям
  обем трябва да се премине към batch/dirty-write.

## Checklist за гъвкавост (§9.1)
- [x] Изключва се през config? — буферът е ограничен (`max`), drawer е опционален в UI.
- [x] Заменя се с алтернатива? — Event Bus е заменяем източник; `subscribe` е точков интерфейс.
- [x] Има интерфейс, не конкретна имплементация? — `create({dir,max})` връща `record/upsert/list/stats/clear/subscribe`.
- [x] Излъчва събитие? — да (map от домейн събития + `notifications.clear` audit).
- [x] Има миграция с rollback? — `clear` (finished-only vs all) обръща състоянието без загуба на данни.
- [x] Документиран е в ADR? — да (настоящият ADR).
- [x] Тестван изолирано? — `notification-center.cjs`, `settings-validation.cjs`.
