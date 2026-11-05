# Състояние на изданието — hAPI Enterprise 0.69.153

Версия: **0.69.153** · клон `main`

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
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.153 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 568 файла · 97155 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 563 файла · 96217 реда · critical: 0 · high: 0 · medium: 0 · low: 200 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 27 RBAC способности, 43 опции, 356 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.153.tar.gz` | add-on архив (194 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.153.zip` | интеграция за HACS (25 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.153.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.153

- **Картата в store-а вече има линк „Документация“.** В `config.yaml` липсваше ключът
  `documentation:` — `url:` сочи add-on-а в хранилището, не упътването, затова Supervisor
  показваше `documentation: false`. Добавен е и се пази от ново правило **HA-M13** в
  `ha-compatibility.cjs`.
- **Интеграцията пази състоянието си в `entry.runtime_data`, не в `hass.data[DOMAIN]`.**
  Дотук координаторът се слагаше в речник, индексиран по `entry_id`: работи, но при
  презареждане ключът оставаше, ако някой забрави да го изчисти, а платформите трябваше да
  знаят как е устроен речникът. `ConfigEntry.runtime_data` (HA ≥ 2024.6, колкото е и
  минимумът ни) прави същото, но животът на данните следва живота на вписването. Миграцията
  е в `__init__.py`, `sensor.py`, `binary_sensor.py`, `diagnostics.py`; пази се от нов
  `tests/integration-runtime-data.cjs`, който пада и ако някой върне `hass.data`, и ако
  минимумът на HA падне под 2024.6.
- **Готов образ на add-on-а (GHCR).** Нов workflow `.github/workflows/addon-image.yml`
  строи `ghcr.io/<owner>/{arch}-addon-hapi_enterprise` за `amd64`, `aarch64` и `armv7` при
  всеки таг и го публикува с тагове `<версия>` и `latest`. Причината: без `image:` store-ът
  строи образа на машината — измерено **127 s** на Raspberry Pi 4 за всяко обновяване.
  `image:` в `config.yaml` още НЕ е включен: първо образът трябва да е публикуван и **public**
  в GHCR, иначе Supervisor не може да го изтегли анонимно. Проверката е
  `scripts/check-addon-image.ps1 -Version 0.69.153`.
- **Обновяване на интеграцията с една команда.** `scripts/update-integration.ps1` сваля
  публикуваното издание и слага `custom_components/hapi_enterprise` на място (локално или на
  Home Assistant през SSH), без да пипа `configuration.yaml` и без да рестартира HA — рестартът
  остава решение на човека. Досега това се правеше на ръка, затова интеграцията на диска
  изоставаше от add-on-а.

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
