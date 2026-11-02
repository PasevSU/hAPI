# Състояние на изданието — hAPI Enterprise 0.69.97

Версия: **0.69.97** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **323/323** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.97 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 524 файла · 87730 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 519 файла · 87140 реда · critical: 0 · high: 0 · medium: 0 · low: 195 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 27 RBAC способности, 43 опции, 323 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.97.tar.gz` | add-on архив (192 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.97.zip` | интеграция за HACS (24 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.97.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.97

- **Config flow-ът казваше „не се свързва“ за три различни неща.** Човек, който въведе адреса и
  получи „Add-on API-то не отговаря. Провери адреса и дали add-on-ът работи“, нямаше как да
  разбере дали проблемът е в мрежата, в токена или във версията. Сега статусът решава съобщението:
  **401** → грешен токен; **403** → въведен е ingress портът 8098 (само за Supervisor) и текстът
  дава верния адрес `http://hapi_enterprise:8099`; **404** → адресът отговаря, но не на админ
  API-то, което в практиката значи add-on **по-стар от 0.69.96** (публичният порт тогава отказва
  `/admin/api/*` дори с токен) — съобщението назовава версията; 5xx/таймаут остават
  „не се свързва“. `tests/ha-config-flow-errors.cjs` подава всеки статус през истинския Python
  модул и иска точния ключ, плюс че всеки ключ съществува в `strings.json` и двата превода —
  липсващ ключ иначе се показва като празно съобщение.
- Заготовките за Home Assistant вече покриват `ConfigFlow`/`OptionsFlow` и `selector`, за да може
  flow-ът да се изпълнява в тест, а не само да се компилира.

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
