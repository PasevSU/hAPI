# Промени в hAPI Enterprise

Тази версия: **0.69.33**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.33

Затваря се последният отворен слот от W7: отчетът вече може да излезе като **пакет с
доказателства**, а статусът му не се закръгля нагоре.

- **`POST /admin/api/v2/reports/package`** връща ZIP с `report.pdf`, `manifest.json`,
  `evidence.json`, наличните `tsa/start.tsr`, `tsa/stop.tsr`, `signature.p7s` и
  `SHA256SUMS.txt`. PDF-ът се рендира от същия манифест (детерминирано), или се подава готов
  с `pdfBase64`, ако вече е подписан.
- **Три статуса, без украса:** `READY` само при налични START и STOP токени (и подпис, ако е
  поискан); `INCOMPLETE` с изброени `missing`; `DRAFT` за чернова — тя не се подпечатва.
  При рендиране от сървъра водният знак е `DRAFT`/`INCOMPLETE`, когато пакетът не е `READY`.
- **Нов `hapi_enterprise/report-package.js`** (INV-E1…E5 в
  `documentation/04_FUNCTION_SPECIFICATIONS/REPORT_EVIDENCE_PACKAGE.md`); `SHA256SUMS.txt`
  покрива всеки файл в пакета, а `evidence.json` носи `manifestSha256` и `pdfSha256`.
- **Панелът** получи „Чернова (DRAFT)“, бутон „Пакет с доказателства“ и бадж със статуса;
  обяснението в панела вече не казва, че подписът и TSA са „RS-05“ — те са налични.
- **Поправен капан:** списъкът с липси пътуваше в HTTP заглавка като кирилица, което убива
  връзката (`ERR_INVALID_CHAR`). Сега `X-Evidence-Missing` е URL-кодиран, а пълният текст е в
  `evidence.json`; тестът проверява точно това.
- **Нов `tests/report-package.cjs`:** класификацията (включително „половин“ TSA и липсващ
  подпис), съдържанието на ZIP-а, верността на сумите, 401 без токен и статус в заглавка.
- `Dockerfile` копира `report-package.js`.
