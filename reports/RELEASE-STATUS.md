# Състояние на изданието — hAPI Enterprise 0.69.155

Версия: **0.69.155** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **356/356** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.155 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 568 файла · 97200 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 563 файла · 96262 реда · critical: 0 · high: 0 · medium: 0 · low: 200 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 27 RBAC способности, 43 опции, 356 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.155.tar.gz` | add-on архив (194 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.155.zip` | интеграция за HACS (25 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.155.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.155

- **`update-integration.ps1` никога не е работил — поправен, след като беше пуснат наистина.**
  Три отделни дефекта, всеки от които стигаше, за да падне обновяването:
  1. `-Version latest` (по подразбиране!) подаваше буквално `latest` на `gh release download`,
     а това е търсене на таг с такова име → `release not found`. Сега името се разрешава до
     истинския таг с `gh release view --json tagName --jq .tagName`.
  2. `gh release view` НЕ приема краткия `-q` (той е на `gh api`) — с него скриптът падаше и
     след поправка 1.
  3. Отдалеченото разархивиране подаваше `grep -m1 '\"version\"'` във `ssh`; PowerShell не
     разбира `\"` (екранирането е с обратен апостроф), затова до shell-а стигаше счупен израз и
     `grep` падаше с `bad regex`. Сега командата не съдържа кавички.
  Освен това в режим `-HaHost` версията „на място“ се пита НА самия HA — дотук локалният
  `Test-Path /config/...` гледаше диска на Windows и винаги казваше „няма“.
  Проверено на живата инсталация: интеграцията мина от 0.69.147 на 0.69.154 с една команда.

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
