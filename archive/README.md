# Archive — политика

Тази папка пази **историята на идеите** на проекта в текстов вид, така че нищо да не се
губи, когато стари папки бъдат изтрити или преместени.

## Правила

1. **Само за четене.** Код тук не се поддържа и не се билдва.
2. **Само текст.** Бинарни архиви (`.zip`, `.7z`, `.exe`, `node.exe`) не влизат в git —
   описват се в [`RELEASES.md`](RELEASES.md) с размер и SHA-256.
3. **Всеки артефакт има ред** в [`MANIFEST.md`](MANIFEST.md) с решение
   `KEEP` / `MERGE` / `DROP` / `DEFER` и фаза от
   [`docs/plan/15-unified-master-plan-v6.0.md`](../docs/plan/15-unified-master-plan-v6.0.md).
4. **Активният код живее само в** `hapi_enterprise/`, `custom_components/`, `api/`,
   `sdk/`, `tests/`, `scripts/` — никога тук.

## Съдържание

| Път | Какво | Произход |
| --- | --- | --- |
| `MANIFEST.md` | Инвентар на всички стари артефакти + решение | `hapi_old/`, worktrees |
| `RELEASES.md` | Списък на старите release пакети (без бинарите) | `hapi_old/HAPI.SU/release/`, `hapi_old/*/release/` |
| `ANALYSIS-v0.49.1.md` | Критичен анализ v0.24 → v0.49.1 (13 находки, 7 препоръки) | `hapi_old/HAPI.SU/ANALYSIS.md` |
| `PLANS/README.md` | Карта `hapi_old/doku/plan/*` → `docs/plan/*` (без копия) | `hapi_old/doku/plan/` |
| `SDK/client.mjs` | Първият публичен API клиент (`PortalClient`) | `hapi_old/**/sdk/client.mjs` |
