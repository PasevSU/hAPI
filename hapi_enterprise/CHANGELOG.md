# Промени в hAPI Enterprise

Тази версия: **0.69.194**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.194

- **Нова секция „Политики“ в панела — 18 настройки, които дотук се задаваха само с `PATCH`
  по API.** Измерено преди промяната: панелът пишеше настройки само по два пътя
  (`{sensors}` и `{limits:{publicBaseUrl}}`), а `limits.maxUploadMb`, `maxDownloadStreams`,
  `maxJobs`, `storageCheckMinutes`, `corsOrigin`, `requirePortalToken`, `storeRawIp`,
  `data.conflictPolicy`, `strictTaxonomy`, `defaultCategory`, `defaultGroup`, `maxTags`,
  `retention.enabled`, `fileDays`, `auditDays`, `fileAction`, `preview.enabled`, `thumbnails`
  се четат от кода (`runtime-config.effective()`, `directory.js`, `retention.js`, `preview`
  маршрутите) и нямаха поле в интерфейса — тоест функцията я има, но човекът не може да я
  настрои. Сега са в четири групи с ефективната стойност до всяко поле.
- **Поправен дефект в частичния запис на настройки (DEF-39).** `runtime.save()` сливаше само
  `sensors`; останалите вложени обекти се ЗАМЕНЯХА и валидаторът ги пълнеше от `DEFAULT`. Затова
  `PATCH {limits:{publicBaseUrl}}` — пътят, който секция „Основни“ ползва — изтриваше зададените
  `maxUploadMb`, `maxJobs` и `storageCheckIntervalMs`, а `PATCH {data:{maxTags}}` изтриваше
  политиката при конфликт. Сега шестте вложени обекта се сливат със записаното; изрично `null`
  пак изчиства поле.
- **Матрицата на съответствието вече не си противоречи.** Редове 8 (§1) и 13 (§7) стояха 🟡 с
  препратка към „§5, ред 1/4“, а §5 казва „Няма отворени редове“, а §5.1 изрежда
  `ARCHIVE_NOT_TAMPERED`, `HTML_IN_SANDBOX` и `FILE_CONTRACT_PAGE` като реализирани с тест.
  Затворени са с името на теста, който ги пази; регресионната база §6 е сверена с измереното
  (371 теста, 17 компонента в `routes/`).
- Проверява се от `tests/settings-policies.cjs` (валидация на четирите групи · 400 без промяна ·
  частичен запис не трие съседните полета през `save` и през HTTP · ефективните стойности ·
  `retention.preview` чете същата политика · оцеляване след рестарт) и от
  `tests/gui-sections.cjs` (сценарият „policies“ натиска бутона в живия DOM и проверява
  стойностите на сървъра). Без поправката пада B04 на `settings-policies`.
