# Състояние на изданието — hAPI Enterprise 0.69.160

Версия: **0.69.160** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **357/357** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.160 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 573 файла · 98214 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 568 файла · 97276 реда · critical: 0 · high: 0 · medium: 0 · low: 200 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 357 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 43 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.160.tar.gz` | add-on архив (194 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.160.zip` | интеграция за HACS (25 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.160.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.160

- **Изданието се доставя с ТОЧНО тези настройки, с които е изпитано.** Defaults в
  `config.yaml` бяха сверени с работещата инсталация (`scripts/compare-live-options.cjs`):
  **42 от 43 опции съвпадат**, а единствената разлика е `token` — тайна, която по правило
  остава празна и се задава от човека. Променени defaults: `memory_limit_mb` 0→**1024**,
  `min_free_mb` 100→**1000**, `public_gateway` false→**true**, `public_same_origin`
  false→**true**, `storage_location` share→**addon_config**, `storage_subdirectory`
  hapi/data→**hapi_enterprise**, `tsa_enabled` false→**true**, `user_roles` ""→**{"pasev-admin":"admin"}**.
  Всяка от тях е с коментар в `config.yaml` защо е такава и какво следва от нея.
- **Видими в конфигурацията, не само в кода.** Описанията в `translations/en.yaml` и
  `translations/bg.yaml` вече казват стойността по подразбиране за всяка от тези опции, че
  публичният порт 8088 НЕ е публикуван (достъп само през reverse proxy), че TSA без интернет
  се проваля затворено и не блокира старта, и че 1024 MB може да се смъкне до 256-384 на малка
  машина. Поправен е и **дублиран `description`** при `storage_subdirectory` в двата превода —
  YAML пазеше само втория ред и дългото обяснение се губеше.
- **Таблиците с подразбирания в README-тата се преизграждат** (`scripts/settings-defaults.cjs`),
  иначе `settings-defaults` пада — това е гейтът, който хвана разминаването веднага.
- **Нов тест `tests/addon-defaults-startup.cjs` — „стартира безаварийно“ като проверка.**
  Чете опциите НАПРАВО от `config.yaml` и: (1) иска очакваните стойности, (2) иска всички
  тайни да са празни, (3) стартира entrypoint-а със самите defaults и проверява, че `/health`
  отговаря, че хранилището е създадено на `addon_config/hapi_enterprise`, че портът на
  публичния шлюз НАИСТИНА слуша и че SIGTERM води до чист изход, (4) проверява обратното —
  без `token` стартът се отказва с `ADMIN_TOKEN_REQUIRED`, вместо да тръгне с празен админ.
- `tests/raspberrypi-compat.cjs` вече не иска `memory_limit_mb: 0`, а разумен диапазон
  (0 или 256..2048) и изрично изисква препоръката 256-384 да е в преводите — така Pi-защитата
  остава, без да блокира сверените с разпределението defaults.

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
