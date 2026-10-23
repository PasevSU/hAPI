# Промени в hAPI Enterprise

Тази версия: **0.69.39**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.39

`server.js` спира да бъде монолит: HTTP слоят се разделя на компоненти.

- Отчетите и генераторът вече са отделни файлове: `hapi_enterprise/routes/reports.js`
  (`/admin/api/v2/reports/{render,package,sign}`, `rfc3161` + `verify`) и
  `hapi_enterprise/routes/generator.js` (`/admin/api/generator/templates`). Кодът е
  преместен 1:1 — нито един маршрут не е променен.
- Един договор за всички: `create(deps)` → `handle({ req, res, url, parts, method })`,
  който връща `true` (заявката е негова и е приключена) или `false` (следващият я поема).
  Зависимостите се подават изрично — компонентът не пипа база, портали или файлове,
  ако не са му дадени.
- `server.js` падна от 2971 на 2727 реда; таванът се пази от `tests/server-structure.cjs`
  и **само се намалява** — нов маршрут отива в компонент.
- Тестът хваща и втората класическа грешка при изнасяне: `require('./…')` от `routes/`
  гледа в `routes/`, а не в `hapi_enterprise/` (точно това даде 500 при отчетите,
  докато не се поправи на `../`).
- `Dockerfile` копира `routes/`; `hapi_enterprise/routes/README.md` описва договора и
  следващите кандидати (sensors, core, ui-assets, portals, settings).
