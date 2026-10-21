# archive/PLANS — карта на старите планове

> Тук **не се пазят копия**. Единственият източник е [`docs/plan/`](../../docs/plan/README.md).
> Този файл съществува само за да може стар път (`hapi_old/doku/plan/*`) да бъде проследен
> до текущия документ.

## Съответствие `hapi_old/doku/plan` → `docs/plan`

| Стар файл | Размер | Текущ документ | Решение |
| --- | --- | --- | --- |
| `plan001_чернова.txt` | 4.9 KB | [`00-core-requirement.txt`](../../docs/plan/00-core-requirement.txt) (оригиналното изискване) | `KEEP` |
| `plan001_v1.0.md` | 20 KB | [`01-specification-v1.0.md`](../../docs/plan/01-specification-v1.0.md) | `KEEP` |
| `v2.0.md` | 38 KB | [`02-docflow-v2.0.md`](../../docs/plan/02-docflow-v2.0.md) | `KEEP` |
| `v3.0.md` | 43 KB | [`03-architecture-v3.0.md`](../../docs/plan/03-architecture-v3.0.md) | `KEEP` |
| `v4.0.md` | 46 KB | [`04-enterprise-v4.0.md`](../../docs/plan/04-enterprise-v4.0.md) | `KEEP` (архитектурата е отхвърлена) |
| `v4.1.md` | 78 KB | [`05-domain-model-v4.1.md`](../../docs/plan/05-domain-model-v4.1.md) | `KEEP` |
| `v4.2.md` | 53 KB | [`06-multi-tenancy-v4.2.md`](../../docs/plan/06-multi-tenancy-v4.2.md) | `KEEP` |
| `v4.3.md` | 124 KB | [`07-security-v4.3.md`](../../docs/plan/07-security-v4.3.md) | `KEEP` |
| `v4.4.md` | **0 B** | — | `DROP` (празен) |

## Какво от тези планове влезе в проекта

Пълната трассируемост (идея → източник → решение → фаза) е в
[`docs/plan/15-unified-master-plan-v6.0.md`](../../docs/plan/15-unified-master-plan-v6.0.md) §9.
Кратко:

- **Приети:** metadata-driven Registry (v3.0), домейн модел като модули (v4.1),
  `tenant_id` като „architecture-ready“ (v4.2), scrypt/RBAC/шифроване (v4.3).
- **Отхвърлени:** `data JSONB`, polyglot persistence, microservices, Kafka/K8s/HSM като
  текуща архитектура (v4.0–v4.3).
- **Отложени:** реална multi-tenancy и пълен Zero Trust (v7+).

## Проверка

- [x] Всеки стар файл има ред в таблицата.
- [x] Нито един ред не сочи към липсващ документ в `docs/plan/`.
- [x] Няма копирани файлове в `archive/PLANS/` (без дублиране).
