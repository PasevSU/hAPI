# Промени в hAPI Enterprise

Тази версия: **0.69.213**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.213

- **Архивът на изданието съдържа само това, което е в хранилището.** `build-release.cjs`
  събира файловете от файловата система, затова всеки локален, **игнориран** файл в
  `hapi_enterprise/` влизаше в `dist/`. Измерено при 0.69.212: локалният
  `hapi_enterprise/generator.7z` даде **212** файла в `dist/RELEASE.json`, а CI (където файла
  го няма) — **211**. `reports/RELEASE-STATUS.md` цитира точно тази бройка, тоест отчетът
  съдържаше машинно-зависимо число: CI го обяви за остарял (`reports/RELEASE-STATUS.md е
  остарял`) и `Release` падна, без нито един ред код да е сгрешен. Сега `release-lib.cjs` има
  `ignoredPaths()` (чете `git ls-files --others --ignored --exclude-standard`) и
  `archiveEntries()`, което ползват add-on архивът, интеграцията и GUI пакетът. Без git
  поведението е старото. Пази го `tests/release-archive-ignored.cjs` (собствено git хранилище
  в `%TEMP%` + проверка, че в това хранилище нито един запис на изданието не е игнориран).
- **Затваря DEF-58** (архивът зависи от локални файлове) — с котва в
  `tests/regression-guards.cjs`.
