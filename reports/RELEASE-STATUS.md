# Състояние на изданието — hAPI Enterprise 0.69.92

Версия: **0.69.92** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **316/316** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.92 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 514 файла · 86397 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 509 файла · 85807 реда · critical: 0 · high: 0 · medium: 0 · low: 193 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 27 RBAC способности, 43 опции, 316 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.92.tar.gz` | add-on архив (191 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.92.zip` | интеграция за HACS (23 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.92.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.92

- **Интеграцията никога не беше ЗАРЕЖДАНА от нито един тест.** `ha-integration-python` я
  компилираше, но компилацията не хваща нито `ImportError` от сгрешено име, нито `NameError` в
  тялото, нито изглед, който изобщо не се регистрира — тоест интеграцията можеше да не се вдигне
  в истински Home Assistant, а всички проверки да са зелени. `tests/ha-integration-import.cjs`
  внася модула срещу минимални заготовки на `homeassistant`/`aiohttp`/`voluptuous` (истинските
  пакети не са зависимост на репото) и вика `async_setup` с фалшив `hass`, който записва
  регистрираните изгледи: без `backend_url` — само 2 статични изгледа (fail-closed), с
  `backend_url` — 19, включително `/hapi/{tail:.*}`, `/api/v1/p/{tail:.*}`, `/p/…`, `/s/…`,
  `/qr/…`, `/site/…`, `/t/…`, `/secret`, `/portal.js` и публичния gateway; всички без HA сесия и
  без дубликати. **Проверено обратно:** счупен `import` → „интеграцията се зарежда“ (с
  `ImportError`); махнат `register_view(HapiPrefix())` → „регистриран е изглед /hapi/{tail:.*}“.

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
