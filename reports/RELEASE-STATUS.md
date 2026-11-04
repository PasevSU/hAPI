# Състояние на изданието — hAPI Enterprise 0.69.149

Версия: **0.69.149** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **352/352** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.149 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 560 файла · 95888 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 555 файла · 94950 реда · critical: 0 · high: 0 · medium: 0 · low: 200 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 27 RBAC способности, 43 опции, 352 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.149.tar.gz` | add-on архив (193 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.149.zip` | интеграция за HACS (25 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.149.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.149

- **Тестер, който налага Content-Security-Policy в тестовете.** Досега GUI тестовете вървяха
  в DOM без браузър — тоест без политика — и заявка към чужд произход минаваше зелено, а се
  блокираше едва при човека (`Connecting to 'https://pasev.asuscomm.com/api/v1/p/newportal2c'
  violates "connect-src 'self'"`). Сега `tests/lib/csp.cjs` обвива `fetch` в харнеса и
  **отказва** всяка заявка извън произхода на документа, точно както прави браузърът; всички
  GUI тестове минават под тази политика.
- **Политиката не се измисля.** `tests/gui-csp-guard.cjs` взима `connect-src` от ИСТИНСКАТА
  заглавка, която add-on-ът изпраща за `/ui/index.html`, и пада, ако тестерът налага друго.
- **Тестерът е проверен, че хваща.** Отделен контрол: нарочна заявка към чужд произход се
  отказва с грешка от типа, който страницата вижда, и се записва; плюс проверка на самия код —
  при временно върнато старо поведение (`fetch(url)` вместо `fetch(sameOrigin(url))`) тестът
  пада с точно съобщението от конзолата на човека, а с поправката минава.
- **`ui.cspViolations()`** е достъпно на всеки тест: списък на нарушенията, които панелът е
  направил. Празен списък значи „под политиката няма скрити заявки навън“.

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
