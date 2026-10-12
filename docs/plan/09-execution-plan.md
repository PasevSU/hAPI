# DOCFLOW — План за изпълнение (Execution Plan)

> **Статус:** Работен план за последователно изпълнение на Фаза 1 → Фаза 2 → Фаза 3 от Master Plan v5.0.
> **Базов документ:** `08-master-plan-v5.0.md`. Този файл не променя архитектурата, а я разбива на конкретни, тествани стъпки.

---

## 0. Заключени решения (резолюция на §10 от Master Plan)

| # | Отворен въпрос (v5.0 §10) | Решение | Обосновка |
|---|---|---|---|
| 1 | `name_folder` или `id_gruppe` в ключа | **`id_gruppe`** (ADR-05) | Стабилен ID; преименуването на `name_folder` не разваля променливите |
| 2 | Порталите = групи+записи(3000) или отделно понятие | **Групи + записи с prefix 3000** | §6.1/§7; QR per-file идва във Фаза 3 |
| 3 | Приоритет | **Фаза 1 → 2 → 3 последователно** | Изрично искане на потребителя |

**Ключ на променлива (каноничен):**
```
{prefix}-{ID_db}-{id_gruppe}-{field}
  1000..5000   "1"     hex16     [a-z][a-z0-9_]*
```
- `ID_db` = instance ID (config.yaml `db_id`, default `"1"`) — за бъдеща multi-DB изолация.
- `id_gruppe` = 16-значен hex (стабилен, невидим).
- `name_folder` = mutable display label.
- `record_id` се пази като обратна връзка в `variables` (без парсване на ключа).

---

## Фаза 1 — Ядрото (в `hapi_enterprise`)

**Цел:** Registry + variable store + групи/профили/записи + orphan/асоцииране + migration bridge + йерархичен UI. Не чупи съществуващите тестове.

### 1.1 Registry (`registry.js` — нов)
- Профилни схеми 1000–5000, metadata-driven.
- Източник: нов `profiles:` блок в `config.yaml` + built-in defaults.
- API: `listProfiles()`, `getProfile(prefix)`, `fieldsFor(prefix)`, `validateField(prefix, field, value)`.
- Типове полета: `string, text, email, domain, phone, number, date, url, bool, list, encrypted`.
- `encrypted: true` → AES-256-GCM (Фаза 1: само маркер + съхранение на ciphertext, ключ = admin token).

### 1.2 Variable store (`variable-store.js` — нов) + SQLite таблици
- Нова таблица `variables(key TEXT PK, record_id, field, value_type, value_text, value_num, value_json, updated_at)`.
- Функции: `set(key,value)`, `get(key)`, `listForGroup(id_gruppe)`, `listForRecord(record_id)`, `remove(key)`.
- Индексирани полета (`indexed:true`) се дублират в колона `value_text` + `CREATE INDEX` (ADR-07).

### 1.3 Групи/профили/записи (SQLite + `core-service.js` — нов)
Нови таблици:
```sql
groups    (id_gruppe PK, name_folder, meta JSON, created_at)
profiles  (prefix PK, schema JSON, version)
records   (id PK, id_gruppe NULL, prefix, orphan INT, created_at)
links     (group_id, record_id)   -- orphan асоцииране/премахване
```
- `createGroup(name_folder)` → генерира `id_gruppe` + автогенерира записи за всички профили (ADR: всички профили споделят `id_gruppe`).
- `renameGroup`, `listGroups`, `getGroup`.
- `createRecord(prefix, fields, {orphan})`, `associate(recordId, groupId)`, `detach(recordId)`, `listOrphans()`.

### 1.4 API (версиониран, под `/admin/api/v2`)
- `GET/POST /admin/api/v2/groups`
- `GET/PATCH/DELETE /admin/api/v2/groups/:id`
- `GET/POST /admin/api/v2/records`, `POST /admin/api/v2/records/:id/associate`, `POST .../detach`
- `GET/PUT /admin/api/v2/variables` (по група/запис)
- `GET /admin/api/v2/profiles` (Registry дъмп)

### 1.5 Migration bridge (`migration-bridge.js` — нов)
- `POST /admin/api/v2/migrate` с `{dryRun}` → мапира:
  - `directory.contacts` → records (1000)
  - `directory.variables` → variable store
  - `portals` → groups + records (3000) + QR
  - `cabinet` → records (2000)
- Стъпки: backup → dry-run → real → verify → switch (всяка с rollback < 5 мин).

### 1.6 Admin UI (йерархия: Група → Профили → Полета)
- Нов таб „Групи/Профили“ — списък групи, влизане в група, профили като карти, полета като таблица.
- Адресира „оскъдното извеждане“ (acceptance §8.7).

### 1.7 Тестове (нови)
`tests/core-groups.cjs`, `tests/core-variables.cjs`, `tests/core-orphan.cjs`, `tests/core-profiles.cjs`, `tests/core-migration.cjs`.

**DoD:** acceptance критерии §8.1–8.7 от Master Plan минават зелено; съществуващите 56+ теста не се чупят.

---

## Фаза 2 — Гъвкавост (рефакторинг към v3.0)

### 2.1 DI контейнер (`container.js` — < 100 реда)
### 2.2 Event Bus (`event-bus.js` — in-process)
- Излъчва `group.created`, `record.associated`, `variable.updated`, etc.
### 2.3 Repository interface + SQLite имплементация (`repository.js`, `sqlite-repository.js`)
### 2.4 Плъгини: storage, renderer (PDF/OOXML), OCR
### 2.5 Версиониран API + legacy bridge (API v1 → deprecated, но работещ)

**DoD:** P1–P8 принципи покрити; всеки feature минава checklist §9.1.

---

## Фаза 3 — Полиране на документи/QR

### 3.1 QR per-file (не само per-portal) + legacy пренасочване
### 3.2 Верификация на hash-chain в UI
### 3.3 Подпис + timestamp (SHA-256), PKCS#7 по-късно

---

## Отложено (v6.0+)
Multi-tenancy реална, OIDC/MFA, HSM, service mesh, polyglot persistence — само ако продуктът напусне Home Assistant.

---

## Глобален DoD (от §9.1)
Всяка стъпка: config-изключваема, сменяема, с интерфейс, с event, с миграция+rollback, документирана в ADR, тествана изолирано.

**Край на Execution Plan.**
