# Състояние на изданието — hAPI Enterprise 0.69.99

Версия: **0.69.99** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **325/325** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.99 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 527 файла · 87952 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 522 файла · 87362 реда · critical: 0 · high: 0 · medium: 0 · low: 195 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 27 RBAC способности, 43 опции, 325 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.99.tar.gz` | add-on архив (192 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.99.zip` | интеграция за HACS (24 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.99.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.99

- **Липсващ превод в Home Assistant се вижда като ПРАЗНО място, без никаква грешка.** Текстовете се
  взимат по ключ (`config.error.<key>`, `entity.sensor.<key>.name`), тоест забравен ключ в
  `translations/en.json` или `bg.json` не чупи нищо видимо — просто съобщението изчезва. Точно така
  се появи и празен текст при грешка в config flow-а, преди да има тест за това.
  `tests/ha-translations.cjs` сравнява ПЪЛНИТЕ пътища на ключовете в трите файла **в двете посоки**
  (липсващ превод и мъртъв превод), иска непразни текстове за заглавия/имена/грешки, и проверява
  че всеки ключ, който `config_flow.py` връща, съществува в преводите. При премахнат
  `cannot_connect` от `bg.json` тестът пада с „translations/bg.json: липсват ключове:
  config.error.cannot_connect“.
- **Изданието се казваше „v0.69.99“.** Заглавието се слагаше на ръка след всяко тагване; сега
  `release.yml` го извежда от версията (`hAPI Enterprise <версия>`) и го подава към release-а, както
  и бележките. Тестът иска `id: release_name` и подаването му, за да не изчезне тихо при следващо
  редактиране на workflow-а.

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
