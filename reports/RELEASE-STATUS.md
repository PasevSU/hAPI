# Състояние на изданието — hAPI Enterprise 0.69.94

Версия: **0.69.94** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **318/318** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.94 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 516 файла · 86797 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 511 файла · 86207 реда · critical: 0 · high: 0 · medium: 0 · low: 195 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 27 RBAC способности, 43 опции, 318 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.94.tar.gz` | add-on архив (191 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.94.zip` | интеграция за HACS (23 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.94.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.94

- **`links/check` казваше „страницата не съществува“, когато всъщност отговаря Home Assistant.**
  Проверката на публичен адрес връщаше само `404` и общата причина, а най-честият случай е
  точно този: на адреса отговаря самият HA (неговият API изглед връща `404: Not Found`), тоест
  пътят не е проксиран към add-on-а. Сега при грешка се прочита малко от тялото (до 64 байта) и
  ако то е точно `404: Not Found`, резултатът носи причината „на този адрес отговаря Home
  Assistant, не hAPI — пътят не е проксиран към add-on-а“ и подсказка какво да се направи
  (инсталирай интеграцията или насочи reverse proxy-то към add-on-а). При обикновен 404
  подсказката липсва — съобщението не бива да лъже. Освен това проверката приема и адреса от
  `PUBLIC_BASE_URL` в средата, не само от настройките: точно него човек иска да провери.
  `tests/link-check-home-assistant.cjs` вдига истински сървър, който отговаря като aiohttp на HA,
  и иска точната причина и подсказка, а за обикновен 404 — нито едно от двете.

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
