# Състояние на изданието — hAPI Enterprise 0.69.148

Версия: **0.69.148** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **351/351** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.148 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 558 файла · 95713 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 553 файла · 94775 реда · critical: 0 · high: 0 · medium: 0 · low: 200 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 27 RBAC способности, 43 опции, 351 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.148.tar.gz` | add-on архив (193 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.148.zip` | интеграция за HACS (25 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.148.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.148

- **Поправено: панелът не можеше да отвори портала пред домейн (CSP `connect-src 'self'`).**
  В конзолата на Home Assistant се виждаше `Connecting to 'https://pasev.asuscomm.com/api/v1/p/<slug>'
  violates the following Content-Security-Policy directive: "connect-src 'self'"` и „Отвори“ /
  „Изтегли“ в менюто на API-то не правеха нищо. Причината: `api.json` съдържа ПУБЛИЧНИЯ адрес
  (той е верен — него получателят копира и сканира), а панелът се отваря на произхода на Home
  Assistant (или на add-on-а). Заявка към другия произход се блокира от политиката на браузъра.
  Сега панелът обръща препратката на **относителен път** (`/api/v1/p/<slug>`) — същият път и
  същият сървър, но произходът е този на документа, тоест заявката остава в `connect-src 'self'`.
  Показваният и копираният адрес не се променя: той си остава публичният.
- **Произходът идва само от `api-base.js`.** Помощникът `sameOrigin()` не чете `location`
  (това е договорът на файла — вж. `files-manager.js`): Ingress префиксът
  (`/api/hassio_ingress/<токен>`) се взима от `window.hapiIngressPrefix()`, а базовият адрес —
  от `window.hapiApiBase()`. Така поправката важи и за add-on-а директно, и зад Ingress.
- **Живата проверка на папката печата какво има на диска.** `tests/qr-leads-to-folder.cjs`
  създава истински файлове в папката на портала и отпечатва пътя, размера и SHA-256 на всеки,
  адреса, който носи QR кодът, и какво показва страницата — за да се види резултатът, а не да
  се вярва на описание.
- **Тест.** Нов `tests/gui-csp-same-origin.cjs`: менюто показва публичния адрес
  (`https://pasev.asuscomm.com/...`), а заявката, която панелът прави при натискане, е
  относителна и отива на същия път на произхода на панела; прозорецът показва `api.json`,
  а не съобщение за грешка.

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
