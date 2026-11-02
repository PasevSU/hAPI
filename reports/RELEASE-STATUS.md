# Състояние на изданието — hAPI Enterprise 0.69.98

Версия: **0.69.98** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **324/324** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.98 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 526 файла · 87876 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 521 файла · 87286 реда · critical: 0 · high: 0 · medium: 0 · low: 195 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 27 RBAC способности, 43 опции, 324 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.98.tar.gz` | add-on архив (192 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.98.zip` | интеграция за HACS (24 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.98.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.98

- **Изданието се раждаше с ПРАЗНИ бележки.** Тагването създаваше release с тяло с дължина 0, а
  текстът се слагаше после на ръка (`gh release edit --notes-file`) — едно забравено копиране и
  изданието не казва нищо за съдържанието си. Точно това стана с **0.69.95** и **0.69.96**: и двете
  бяха публикувани с празно описание. Сега `scripts/release-notes.cjs` извлича секцията за
  ТОЧНО тази версия от `CHANGELOG.md` (до следващия `## `, без да го гълта), а `release.yml` я
  подава като `body_path`. Липсваща или празна секция е **грешка на скрипта**, а не празен release.
  Скриптът се ползва и локално: `node scripts/release-notes.cjs --version X --out notes.md`.
- `tests/release-notes.cjs` проверява извличането (вкл. че следващата секция не влиза), че
  липсваща/празна секция дава грешка, че `CHANGELOG.md` има секция за текущата версия, и че
  `release.yml` наистина пуска скрипта и подава `body_path` — при махнат `body_path` тестът пада с
  „release.yml подава бележките като тяло“, тоест поправката не може да изчезне тихо.

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
