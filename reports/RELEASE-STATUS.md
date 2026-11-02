# Състояние на изданието — hAPI Enterprise 0.69.107

Версия: **0.69.107** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **330/330** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.107 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 532 файла · 89049 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 527 файла · 88459 реда · critical: 0 · high: 0 · medium: 0 · low: 197 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 27 RBAC способности, 43 опции, 330 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.107.tar.gz` | add-on архив (192 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.107.zip` | интеграция за HACS (24 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.107.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.107

- **Инструментът за празни `catch`-ове падаше.** `scripts/document-empty-catches.cjs` е
  еднократен инструмент от времето, когато панелът беше `hapi_enterprise/admin.js`; файлът
  отдавна не съществува (панелът е в `ui/`), а скриптът падаше с `ENOENT` при първото си
  извикване. Сега прескача файл, който го няма, и казва кой е — вместо да гърми.
- **И не пише без разрешение.** Номерата на редовете в плана му са исторически; ако файлът
  съществува, но редовете са се разместили, скриптът можеше да сложи обяснение на ЧУЖД
  празен `catch`. Сега без `--apply` само отчита (`празни catch-ове за поправяне: N`), а
  `--apply` записва. Нищо в издавания код не се променя — това е инструмент за разработка.
- Отчетено от `scripts/release-status.cjs --check`, който хвана разликата веднага след
  промяната — затова и излиза ново издание, а не "довършване" на предишното.

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
