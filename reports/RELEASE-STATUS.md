# Състояние на изданието — hAPI Enterprise 0.69.41

Версия: **0.69.41** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **211/211** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.41 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 345 файла · 57882 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 341 файла · 57518 реда · critical: 0 · high: 0 · medium: 0 · low: 151 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 24 RBAC способности, 33 опции, 211 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.41.tar.gz` | add-on архив (141 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.41.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.41

Панелът в Home Assistant вече се отваря — причината беше забрана за вграждане в iframe.

- **Дефект:** всички файлове на административния UI (`/ui/*`) се сервираха с
  `Content-Security-Policy: … frame-ancestors 'none'`. Панелът на add-on-а в Home Assistant
  е iframe, тоест браузърът отказваше да покаже документа и екранът оставаше напълно
  празен (сива страница с икона, без съобщение за грешка).
- **Поправка:** `frame-ancestors 'self'` — вграждане от същия origin е разрешено (ingress
  е на адреса на Home Assistant), чужд сайт остава отказан. Публичните страници
  (`/p/<id>`, `/secret/<id>`, порталът в интеграцията) остават с `'none'`.
- Договор: INV-C2 в `documentation/02_TO_BE_ARCHITECTURE/INTEGRATION_CONTRACTS.md`.
- Тест: `tests/blackbox-security.cjs` изисква `'self'` за UI-я и `'none'` за публичните
  страници — ако някой върне забраната, тестът пада.

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
