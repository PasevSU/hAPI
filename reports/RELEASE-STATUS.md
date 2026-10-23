# Състояние на изданието — hAPI Enterprise 0.69.37

Версия: **0.69.37** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **210/210** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.37 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 341 файла · 57625 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 337 файла · 57261 реда · critical: 0 · high: 0 · medium: 0 · low: 151 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 24 RBAC способности, 33 опции, 210 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.37.tar.gz` | add-on архив (138 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.37.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.37

Обновяването вече се вижда и в Home Assistant, а не само в GitHub.

- **Нов сензор „Версия на add-on-а“** (`sensor.…_version`): показва версията, която add-on-ът
  **реално** работи. Тя идва от самия add-on (`/admin/api/sensors` → `version`), а не от
  инсталирания някога файл.
- **Нов сензор „Съвпадение на add-on и интеграция“** (`…_sync`, enum): `ok` / `mismatch` /
  `unknown`. При `mismatch` атрибутите `addon_version` и `integration_version` показват кое е
  старо — тоест дали да се обнови add-on-ът от Add-on Store или интеграцията през HACS.
  Преди това едната половина можеше да е обновена, а другата не, без това да се вижда.
- **Поправена грешна версия:** телеметрията връщаше `v2` (`apiVersion.VERSION.CURRENT` —
  версията на API-то) вместо продуктовата. Сега `server.js` чете `config.yaml` — единственият
  източник на истина, който вече се копира в образа (`COPY config.yaml`) — и същата стойност
  ползват и сензорите, и блокът „Системни данни“ в отчета.
- Устройството в HA носи `sw_version` на интеграцията (преди беше празно).
- Преводи на EN/BG за новите сензори и състоянията им; договорът се пази от
  `tests/ha-integration-flow.cjs` (15 сензора) и `tests/ui-version.cjs`.

## 4. Как се проверява наново

```
node scripts/test-matrix.cjs          # пълният набор, от начало, до 5 опита
node scripts/build-release.cjs        # dist/
node scripts/verify-release.cjs       # S01–S21 върху готовия архив
npm run audit:gui                     # GUI + съвместимост + изданието
node scripts/release-status.cjs       # този отчет
```

## 5. Извън локалните гейтове

CI, CodeQL, Release workflow и HACS проверките се виждат с `gh run list` — те не се
записват тук, за да не се представя чужд резултат за свой.
