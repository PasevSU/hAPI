# Състояние на изданието — hAPI Enterprise 0.69.150

Версия: **0.69.150** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **353/353** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.150 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 561 файла · 96004 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 556 файла · 95066 реда · critical: 0 · high: 0 · medium: 0 · low: 200 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 27 RBAC способности, 43 опции, 353 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.150.tar.gz` | add-on архив (193 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.150.zip` | интеграция за HACS (25 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.150.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.150

- **Поправено (висока тежест): на реалната инсталация ВСЕКИ адрес на портал отваряше 404 —
  включително публичен и адресът, който носи QR кодът.** `start.js` налагаше
  `REQUIRE_PORTAL_TOKEN='true'`; при този флаг `portal-policy.js` прескача правилото „публичен
  портал без идентичност“, а `adminPortal` връща празен `accessQuery` — тоест нито един адрес
  не можеше да се отвори. Одитът на add-on-а го е записал: `portal.access.denied · reason:
  no-identity` и секунда след него `link.check · host: pasev.asuscomm.com · status: 404`.
- **Режимът „искай токен за всеки портал“ вече е по избор**, не закован:
  `REQUIRE_PORTAL_TOKEN=true` в средата го включва, по подразбиране е изключен. Така публичният
  портал се отваря на голия си адрес, а частният — с подписан достъп, който панелът и QR кодът
  носят (важи 1 час).
- **Причината да не се хване досега:** всички тестове пускат `server.js` директно, а add-on-ът
  върви през `start.js`, който сменя средата. Нов `tests/start-portal-open.cjs` пуска
  **истинския entrypoint** и проверява резултата: публичен → 200 със страницата на портала,
  частен → 404, а с `REQUIRE_PORTAL_TOKEN=true` → 404 и за публичен. На стария код тестът пада
  с `404 !== 200` — точно това виждаше човекът в браузъра.

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
