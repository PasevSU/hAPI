# ADR-009: Multi-tenancy и Zero Trust — architecture-ready

- **Status:** Accepted
- **Дата:** 2026-10-12

## Контекст
Портали/групи/записи са отделни наематели (tenants) в една инсталация. Достъпът не
може да се доверява на мрежовата позиция.

## Решение
Архитектурата е multi-tenant-ready: `ID_db`/групата изолират scope, RBAC ограничава
роли (admin/operator/viewer), порталните токени/ключове изискват explicit access,
а Zero Trust се прилага чрез подписвани URL-и и липса на доверие по default.

## Последици
- Плюс: изолация и одит по tenant; готовност за enterprise.
- Минус: повече проверки при достъп (компенсира се с кеширани RBAC роли).

## Checklist за гъвкавост (§9.1)
- [x] Изключва се през config? — `requirePortalToken`, RBAC токени.
- [x] Заменя се с алтернатива? — да, RBAC/Session са зад интерфейси.
- [x] Има интерфейс? — да (`rbac`, `sqlite-store` sessions).
- [x] Излъчва събитие? — да, audit при auth/access.
- [x] Миграция с rollback? — ролите са данни, версионируеми.
- [x] Документиран в ADR? — да.
- [x] Тестван изолирано? — да (`rbac.cjs`, `rbac-sso.cjs`, `auth.cjs`).
