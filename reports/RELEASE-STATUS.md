# Състояние на изданието — hAPI Enterprise 0.69.194

Версия: **0.69.194** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **371/371** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.194 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 597 файла · 106647 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 592 файла · 105723 реда · critical: 0 · high: 0 · medium: 0 · low: 201 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 371 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.194.tar.gz` | add-on архив (201 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.194.zip` | интеграция за HACS (26 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.194.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.194

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

## 4. Как се проверява наново

```
node scripts/test-matrix.cjs          # пълният набор, от начало, до 5 опита
node scripts/build-release.cjs        # dist/
node scripts/verify-release.cjs       # S01–S23 върху готовия архив
npm run audit:gui                     # GUI + съвместимост + изданието
node scripts/release-status.cjs       # този отчет
```

## 5. Извън локалните гейтове

CI, CodeQL, Release workflow и HACS проверките се виждат с `gh run list` — те не се
записват тук, за да не се представя чужд резултат за свой.
