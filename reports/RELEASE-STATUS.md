# Състояние на изданието — hAPI Enterprise 0.69.32

Версия: **0.69.32** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **208/208** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.32 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 337 файла · 56581 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 333 файла · 56217 реда · critical: 0 · high: 0 · medium: 0 · low: 151 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 24 RBAC способности, 33 опции, 208 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.32.tar.gz` | add-on архив (133 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.32.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.32

PasevSU Document Generator е интегриран като самостоятелно приложение в hAPI — без ръчната
стъпка, която го правеше крехък.

- **Жив индекс вместо `temp/index.json`.** Досега списъкът се строеше с
  `tools/build-index.mjs` и се записваше във файл; след добавяне или изтриване на шаблон
  индексът лъжеше, докато някой не пусне скрипта. Сега `hapi_enterprise/generator.js` строи
  индекса от папката при **всяка** заявка — нов `*.html` се вижда веднага, без рестарт.
- **Модулът живее на `/generator/`** (`index.html`, `app.js`, `style.css`) на
  административния listener. Шаблоните са файлове в `<storage>/generator/temp`, тоест в
  папката на add-on-а и в `/config` бекъпа. Пакетът не съдържа нито един вграден шаблон.
- **API:** `GET/POST /admin/api/generator/templates` и `GET/DELETE …/templates/<file>` —
  качване, замяна само с изричен `overwrite` и изтриване от самия интерфейс. Одитът пази
  `generator.template.save` / `.delete` (файл, байтове, брой — без съдържание). Нова
  capability `generator`: четене за всяка роля, запис за `admin`/`operator`.
- **Шаблонът не се изпълнява на сървъра:** сервира се като `text/plain` с `nosniff`, а
  редакторът го почиства в браузъра (скриптове, рамки, форми, стилове, `on*`, опасни адреси).
- **Печат:** ново действие „Нова страница“ (`page-break-before`), защото досега раздел не
  можеше да започне на нов лист.
- Имената са ограничени до `[A-Za-z0-9_.-]{1,80}.html`, таван 512 KiB, атомарен запис без
  частично прочетен файл.
- `Dockerfile` копира `generator.js` и `generator/`; договорът е в
  `documentation/04_FUNCTION_SPECIFICATIONS/DOCUMENT_GENERATOR.md` (INV-G1…G5), тестът —
  `tests/generator-app.cjs`.

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
