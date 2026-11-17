# Състояние на изданието — hAPI Enterprise 0.69.232

Версия: **0.69.232** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **452/452** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.232 — отпечатъците се сверяват от `verify-release.cjs` |
| Линт | `npx eslint . --max-warnings=0` | `npx eslint . --max-warnings=0` → 0 · потиснати **217** находки в 135 файла (най-много `no-empty` 93) |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 718 файла · 128991 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 711 файла · 126889 реда · critical: 0 · high: 0 · medium: 1 · low: 216 — **има необяснени** · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 452 правила (= тестови файлове), 45 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.232.tar.gz` | add-on архив (232 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.232.zip` | интеграция за HACS (27 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.232.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.232

- **Грешка в ГУИ тест вече НЕ убива процеса.** `assert.equal(app.$(…), null)` при провал караше
  Node да строи diff от инспекцията на ЦЕЛИЯ DOM възел — измерено **144 s** и
  `Array buffer allocation failed` вместо съобщение. Сценарият J53 „падаше“ като таймаут и никой
  не разбираше какво е сгрешено. Сега всяко твърдение получава СТОЙНОСТ (`assert.ok(!възел)`,
  `assert.ok(възел === друг)`), тестовият DOM има `isConnected` и КРАТКА инспекция на възел
  (един ред `<div.fm-file> · 300 деца`). J53 минава за **367 ms** вместо 144 s, а `gui-journeys`
  целият — за **17 s** (преди: 180 s таймаут). Пази го `dom-harness.cjs` (§6 и §7).
- **„QR за тази папка“ показва ПРАВИЛНОТО ниво.** Без `isConnected` тестовият DOM караше
  `ensureModal()` да строи ВТОРИ прозорец при всяко отваряне, а тестът четеше стария — тоест
  проверката виждаше адреса на портала и не хващаше нищо. J53 вече проверява от край до край:
  папката има свой вход към QR студиото и картата носи адреса ѝ (`.qs-card[data-url]` с `folder=`).
- **Каталогът на грешките описва и новите кодове.** `hash` и `http` хвърляха `EALGO`/`EOPTION`/
  `ETIMEDOUT` без обяснение, защото код под 6 знака не стига до описанието. Кодовете са
  описателни (`HASH_UNKNOWN_ALGO`, `HASH_BAD_CHUNK`, `HASH_BAD_ENTRY(S)`, `HASH_BAD_EXPECTED`,
  `HTTP_BAD_OPTION`, `HTTP_NO_FETCH`), съобщението е цяло изречение, а динамичните части са полета
  на грешката (`algo`, `allowed`, `chunk`, `option`). `tests/core-hash.cjs` пази съобщението и
  списъка с позволени алгоритми да не се разминат.
- **Регистърът:** 92 реда, **85 затворени**, **6 отворени** (DEF-01 приет; DEF-06, DEF-49,
  DEF-66, DEF-67, DEF-69) — всеки с причина.

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
