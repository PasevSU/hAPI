# Промени в hAPI Enterprise

Тази версия: **0.69.50**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.50

Одит на всички издания: какво е имало и го няма, и какво е обещано и го няма.

- **Нов инструмент:** `node scripts/release-audit.cjs` сравнява ВСЕКИ таг (55 тага) с
  текущото дърво по файлове, функции по модул, секции в панела и опции на add-on-а и пише
  `reports/RELEASE-AUDIT.md`. Не е гейт — отчет за хора.
- **Резултат за историята:** файлове 142 → 149, функции 1430 → 1468, секции 17 (без
  промяна), опции 33 (без промяна) от v0.69.37 до сега. Няма тихо изчезнал файл или
  функция: 13-те „липсващи“ файла и 11-те функции имат документирани заместници
  (`portal_enterprise` → `hapi_enterprise`, `admin.js` → `ui/` в 0.69.8, `withSecretLock` →
  `secret-lock.js`, `merge/mergeLists/equal/giveUp` → `reconcile()`, `loginGate` → вход
  само през Supervisor/loopback, `visitor_trust_proxy` → конзолата + `TRUST_PROXY`).
- **Резултат за обещаното:** кодът сам обявява какво още не е направено — 6 експортни
  способности (`compression`, `split_archive`, `rate_limit`, `parallel_transfers`,
  `encrypt_package`, `resume_transfer`), 4 типа обекти в Report Studio (`logo`,
  `certificate`, `columns`, `dynamic`) и 5 документирани функции (FD-7 SMB, FD-8 USB,
  FD-9 Save Template, RS-06 veraPDF, W8/F9 Windows Edition).
- Проверките гледат КОД, не коментари и не етикети: „SMB / NAS“ е име на местоназначение,
  а „валидатор като veraPDF“ е описание на липсата — и двете не се броят за реализация.
