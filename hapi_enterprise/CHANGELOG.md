# Промени в hAPI Enterprise

Тази версия: **0.69.79**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.79

Целостта на архивите: подмяна на доказателство се вижда без човешка сверка.

- **Нов модул `portal-integrity.js`** (правило `ARCHIVE_NOT_TAMPERED`). Проверява по ред и
  връща ТОЧЕН код за всяка повреда, вместо едно общо „счупено“: `file_missing`,
  `archive_hash_mismatch` (с `expected` и `actual`), `archive_unreadable`, `manifest_missing`,
  `manifest_invalid`, `manifest_hash_mismatch`, `file_missing_in_archive`,
  `file_hash_mismatch` / `file_size_mismatch` (с името на файла).
- **`POST /admin/api/portals/<id>/qr/verify`** — проверка по заявка. Резултатът се записва в
  метаданните (`db.portalIntegrity[portalId]`: `checkedAt`, `ok`, `archives`, `verified`,
  `failed[]`) и `GET …/qr` го показва като `integrity` (преди първата проверка — `null`,
  а не „здраво“).
- **Фонова проверка** през 6 часа (`HAPI_INTEGRITY_INTERVAL_MS`, `0` я изключва), с `unref`
  таймер — не държи процеса жив и не блокира старта. При провал вдига `integrity.failed` в
  одитната верига с `reasons` и `archiveIds`, за да остане следа извън екрана.
- **Сензори:** `qr.integrity` в `/admin/api/sensors` (`failures`, `portalsFailed`, `checked`,
  `lastCheckedAt`, `intervalMs`, `code`) → пети QR сензор `integrity_failed` в Home Assistant
  (**29 общо**), на три езика.
- **Панел:** бутон „Провери целостта на архивите“ показва проверени/общо и при провал —
  кой архив и с каква причина (`#pf-qr-verify`, `/qr/verify`).
- **Гейт:** `tests/portal-integrity.cjs` — всеки код на повреда поотделно (модул), запис и
  одит (сървър), `integrity.failed` в сензорите и в одитната верига. Документацията е
  обновена: нова точка 7а в `RUNTIME_EXECUTION_FLOWS.md`, а `ARCHITECTURE_COMPLIANCE_MATRIX.md`
  вече не брои целостта към липсите (§5.1).
