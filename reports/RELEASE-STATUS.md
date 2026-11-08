# Състояние на изданието — hAPI Enterprise 0.69.199

Версия: **0.69.199** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **381/381** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.199 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 609 файла · 108236 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 604 файла · 107312 реда · critical: 0 · high: 0 · medium: 0 · low: 201 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 381 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.199.tar.gz` | add-on архив (201 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.199.zip` | интеграция за HACS (26 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.199.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.199

- **Поправен дефект DEF-42: сензорът за версията не се създаваше в Home Assistant 2026.11.**
  Открит при проверката след обновяването на живата инстанция: в лога на HA стои
  `ERROR … Error adding entity sensor.hapi_enterprise_add_on_version … ValueError: … suggesting
  precision '0' … non-numeric value: '0.69.198'`. Причината е в
  `custom_components/hapi_enterprise/sensor.py`: `PortalSensorEntityDescription` имаше
  `suggested_display_precision: int = 0` като подразбиране, тоест **всеки** сензор получаваше
  прецизия — включително текстовият „версия“ и enum-ът „синхрон“, които HA отказва. Така в
  панела липсваше точно това, което трябва да показва коя версия работи и дали съвпада с
  интеграцията. **Поправка**: подразбирането е `None`, а числовите сензори, на които им трябва
  закръгляне, задават прецизия изрично (5 сензора).
- `tests/ha-version-sensor.cjs` пази поправката: текстовият сензор и enum-ът не носят прецизия,
  числовите я задават изрично — тестът би паднал при връщане на подразбирането 0.

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
