# Състояние на изданието — hAPI Enterprise 0.69.96

Версия: **0.69.96** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **322/322** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.96 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 523 файла · 87553 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 518 файла · 86963 реда · critical: 0 · high: 0 · medium: 0 · low: 195 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 27 RBAC способности, 43 опции, 322 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.96.tar.gz` | add-on архив (192 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.96.zip` | интеграция за HACS (24 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.96.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.96

- **Интеграцията на Home Assistant нямаше как да работи: админ API-то беше недостъпно за нея.**
  Сензорите ѝ се хранят от `/admin/api/sensors`, а в add-on режим админ пътищата се сервират само
  на ingress listener-а (8098), който приема единствено Supervisor и loopback. Home Assistant не е
  нито едно от двете: на 8098 получаваше **403**, а на публичния порт — **404**. Тоест „инсталира
  се и не работи“, което е точно определението за несъвместимост. Сега програмен клиент с **Bearer
  токен** минава и на публичния порт: токенът е самоличността, а RBAC го проверява на всеки
  маршрут. Без токен админ пътищата остават 404, тоест браузърната повърхност не се отваря.
  `tests/ha-admin-api-port.cjs` иска 404 без токен, 200 с валиден (whoami и sensors), 401/403 с
  грешен, непроменен ingress listener — и че документацията сочи порт, който наистина работи.
- **Документацията сочеше `http://hapi_enterprise:8098`** — порт, който отказва на Home Assistant.
  `strings.json`, `translations/en.json` и `translations/bg.json` вече сочат **8099**, а съобщението
  при 404 в координатора обяснява кой порт да се провери, вместо да праща човека на грешен.
- **Диагностика по стандарта на Home Assistant: `diagnostics.py`.** „Download diagnostics“ вече
  дава отчета, който човек слага в issue: адрес на API-то, интервал, състояние на координатора и
  телеметрията — но **никога токена**. Замазването е рекурсивно (`token`, `password`, `secret`,
  `api_key`, `authorization`), а за „има ли токен“ се връща факт (`token_configured`), не стойност.
  `tests/ha-diag-redaction.cjs` пуска истинския Python модул върху entry с токен и иска стойността
  да не се среща никъде в JSON-а, вкл. когато е вложена дълбоко; при премахнато замазване тестът
  пада с „токенът НЕ бива да излиза в диагностиката“.

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
