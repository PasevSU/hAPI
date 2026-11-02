# Състояние на изданието — hAPI Enterprise 0.69.93

Версия: **0.69.93** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **317/317** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.93 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 515 файла · 86706 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 510 файла · 86116 реда · critical: 0 · high: 0 · medium: 0 · low: 195 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 27 RBAC способности, 43 опции, 317 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.93.tar.gz` | add-on архив (191 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.93.zip` | интеграция за HACS (23 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.93.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.93

- **Мостът на интеграцията никога не беше ИЗВИКВАН в тест.** `ha-integration-import` го зареждаше
  и регистрираше изгледите, но нито един тест не викаше `view.get(...)` — тоест `_forward`,
  копирането на заглавки и стриймването не бяха проверени нито веднъж, а това е кодът, който
  реално върти заявките в Home Assistant. `tests/ha-integration-proxy.cjs` пуска ИСТИНСКИЯ
  сървър на add-on-а, създава публичен портал и изпълнява Python изгледа на интеграцията срещу
  него (сесията в заготовките е истински HTTP клиент): очаква се 200, тялото да е JSON-ът на
  портала, `Content-Type` да е запазен, а второ извикване за `/files` да дава същото като правия
  път. **Проверено обратно:** мостът, насочен към несъществуващ път → тестът пада; загубен
  `Content-Type` → „Content-Type се запазва: application/octet-stream“.

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
