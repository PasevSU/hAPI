# Промени в hAPI Enterprise

Тази версия: **0.69.32**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.32

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
