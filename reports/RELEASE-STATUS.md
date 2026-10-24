# Състояние на изданието — hAPI Enterprise 0.69.73

Версия: **0.69.73** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **242/242** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.73 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 405 файла · 69350 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 401 файла · 68986 реда · critical: 0 · high: 0 · medium: 3 · low: 171 — **има необяснени** |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 24 RBAC способности, 40 опции, 242 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.73.tar.gz` | add-on архив (164 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.73.zip` | интеграция за HACS (23 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.73

Оперативна интелигентност: сензорите вече казват **какво да се направи**, а не само колко е
било. Числото не е решение — затова праговете, прозорецът и препоръката се смятат на едно
място (`hapi_enterprise/decision-sensors.js`) и се виждат еднакво в API-то, в панела и в
Home Assistant.

- **`/admin/api/sensors` връща `guidance`** — статус (`ok`/`warning`/`critical`/`unknown`),
  списък сигнали и **една препоръчана проверка**. Прагове: 5xx над 1 % / 5 %, p95 над
  2000 / 5000 ms, откази при изтегляне над 20 %, база над 1 GiB, телеметрия над 256 MiB,
  неуспешен запис в огледалото. Всяко „лошо“ число носи компонент, измерена стойност, праг
  и конкретно действие — не само че „има проблем“.
- **Текущо срещу историческо.** Щом има предишно измерване, процентите се смятат от
  РАЗЛИКАТА (прозорец), не от натрупаните от старта броячи: стара грешка не е нов инцидент,
  а поправеният проблем не „виси“ вечно. Първото измерване го казва честно (`basis:
  cumulative`).
- **Праг И продължителност.** Предупреждението става активно след `sustainMs` (60 s), за да
  не плаши един бавен отговор; критичното (огледало, 5xx над 5 %) не чака. Под 30 заявки
  няма заключение — статусът е `unknown`, а не „здраво“.
- **Таблото показва решението:** карта „Състояние“ с причината и препоръчаната проверка.
  Праговете НЕ се дублират в интерфейса — панелът и HA четат един и същ отговор.
- **Home Assistant entities (без нов polling):** `sensor.hapi_health`,
  `sensor.hapi_http_error_rate`, `sensor.hapi_latency_p95`,
  `sensor.hapi_download_denial_rate`, `sensor.hapi_recommended_action` (с атрибути
  компонент/причина/база/прозорец) и `binary_sensor.hapi_mirror_problem`,
  `binary_sensor.hapi_api_available`. Всички ползват общата снимка на координатора (едно
  обновяване на интервала), а липсващото измерване остава `unknown`, не нула.
- **Сензори за сигурността от Stage D:** `active_portal_sessions`,
  `token_validation_failures`, `revoked_token_attempts`, `cross_portal_denials` и
  `binary_sensor.public_gateway_security_alert`. Тревогата гледа **прозорец от 5 минути**
  (крос-портални опити и опит с отнет токен), а не натрупания брояч — иначе би светела
  вечно след първия отказ. Общо 24 сензора и 3 binary сензора.
- **`portal-policy.js` пази времето на отказа** (само вид и час, без токен, бисквитка и IP),
  за да може `security.window` да отговори на „има ли отказ СЕГА“.
- **Гейт:** `tests/decision-sensors.cjs` (прагове, продължителност, прозорец, живият
  endpoint); `tests/portal-tokens.cjs` проверява и прозореца на отказите;
  `tests/ha-integration-flow.cjs` пази 24 сензора и 3 binary сензора с преводи на BG/EN.

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
