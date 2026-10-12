# ADR — Архитектурни решения

Консолидирани записи на архитектурните решения (Master Plan v5.0, §9). Всеки ADR
прилага checklist-а за гъвкавост (§9.1) и е **Accepted** до ново решение, което го
замества (в такъв случай старият се маркира като *Superseded by ADR-NNN*).

| ADR     | Решение                                                |
| ------- | ------------------------------------------------------ |
| ADR-01  | Variable store с композитен ключ е ядрото (не JSONB)  |
| ADR-02  | Metadata-driven профилни схеми (Registry)             |
| ADR-03  | Монолит с модули + интерфейси (без microservices)      |
| ADR-04  | SQLite + Repository interface (смяна по-късно)         |
| ADR-05  | `id_gruppe` стабилен, `name_folder` mutable label      |
| ADR-06  | Orphan-first, асоцииране по-късно                      |
| ADR-07  | `indexed:true` полета се държат и релационно           |
| ADR-08  | Версиониране: schema/API/data/UI                       |
| ADR-09  | Multi-tenancy и Zero Trust — architecture-ready        |
| ADR-10  | Всеки feature минава checklist-а на гъвкавост (§2.4)   |
| ADR-11  | Решения за feature-ите от Фаза 4 (обработка + QR)      |

Шаблон за нови решения: [ADR-000-template.md](ADR-000-template.md).
