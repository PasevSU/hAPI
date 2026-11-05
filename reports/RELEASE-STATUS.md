# Състояние на изданието — hAPI Enterprise 0.69.157

Версия: **0.69.157** · клон `main`

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
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.157 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 569 файла · 97319 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 564 файла · 96381 реда · critical: 0 · high: 0 · medium: 0 · low: 200 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 27 RBAC способности, 43 опции, 356 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.157.tar.gz` | add-on архив (194 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.157.zip` | интеграция за HACS (25 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.157.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.157

- **`update-integration.ps1` вече разменя интеграцията атомарно.** Дотук редът беше
  `rm -rf …/hapi_enterprise` **преди** `scp`: при скъсана връзка (или грешен път) интеграцията
  на HA оставаше изтрита и следващият рестарт на Home Assistant я нямаше. Сега архивът се качва
  първо, новото се разархивира в `/tmp`, старият вариант се мести на `hapi_enterprise.bak`,
  новият заема мястото му и едва тогава `.bak` се трие; при провал старият се връща на място.
  Локалният режим работи по същия принцип (`hapi_enterprise.new` → размяна).
  Проверено на живата инсталация: 0.69.156 → 0.69.156 с атомарна размяна.
- **Ново ръководство `documentation/08_USER_GUIDES/operations.md`** — трите неща след всяко
  издание с точните команди и с измерените числа: store-ът тегли готов образ (129 s build →
  14 s pull), интеграцията се обновява с една команда, `secrets.yaml` се одитира без да се
  показват стойности; плюс стъпките за смяна на администраторския токен (в UI, защото CLI `ha`
  няма команда за опции).

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
