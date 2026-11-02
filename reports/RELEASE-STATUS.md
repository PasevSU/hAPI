# Състояние на изданието — hAPI Enterprise 0.69.111

Версия: **0.69.111** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **331/331** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.111 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 533 файла · 89355 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 528 файла · 88765 реда · critical: 0 · high: 0 · medium: 0 · low: 197 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 27 RBAC способности, 43 опции, 331 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.111.tar.gz` | add-on архив (192 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.111.zip` | интеграция за HACS (24 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.111.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.111

- **Съвместимостта с Home Assistant вече се проверява локално, преди таг.** Дотук тези неща
  се хващаха само от hassfest/HACS в чужд CI — тоест след като изданието вече е излязло.
  Нов `tests/ha-support-matrix.cjs` свързва трите страни: какво кодът очаква от домакина, какво
  `config.yaml` декларира и каква минимална HA версия е обещана.
- Какво иска тестът: всеки mount, който кодът реално ползва (`share`, `media`,
  `homeassistant_config`, `app_config`, `ssl`), да е обявен в `map` — без `share:rw` например
  `/share` в контейнера е ефимерна папка, а не споделената, и папките на порталите „работят“
  върху чуждо място; портовете `8099`/`8088` да са в `ports`, в `ports_description` и в
  преводите bg+en; `ingress_port` и `watchdog` да сочат портовете, които кодът слуша (8098 и
  8099); `homeassistant_api: true`, защото `notify.js` вика Supervisor проксито; обявената
  минимална HA версия да не е под тази на използваните API-та (днес кодът иска 2024.4,
  обявеното е 2024.6); всяка `arch` да се билдва от базовия образ (`node:22.21.1-alpine3.23`).
- Списъкът с HA API-та е с минимална версия за всяко. Ново API без запис в него чупи теста —
  така минималната версия не може да изостане от кода.
- Проверено и обратно: премахването на `share:rw` от `map` чупи теста с името на липсващия
  mount. Записан е и в `RELEASE_CHECKLIST.md`.

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
