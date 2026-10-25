# hAPI Enterprise — Documentation

Enterprise governance and methodology layer. Complements the implementation-level
`docs/` tree (plan + ADR).

| Folder                        | Purpose                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00_GOVERNANCE/`              | Charter, master plan, roadmap, milestones, WBS, traceability, risk/dependency registers, change control, definition of done; **[`PLAN_STATUS.md`](00_GOVERNANCE/PLAN_STATUS.md)** — къде сме спрямо плана (и кои планови документи са исторически) |
| `01_AS_IS_ARCHITECTURE/`      | Current source inventory (**generated** from the tree by `scripts/source-inventory.cjs`), module catalog, call/dependency graphs, crypto matrix, GUI inventory, known defects                                                                                                                                                                                               |
| `02_TO_BE_ARCHITECTURE/`      | Целева архитектура — започни от **[индекса](02_TO_BE_ARCHITECTURE/README.md)**: **[`API_ARCHITECTURE_SPEC.md`](02_TO_BE_ARCHITECTURE/API_ARCHITECTURE_SPEC.md)** (нормативен), **[`API_ENDPOINT_REFERENCE.md`](02_TO_BE_ARCHITECTURE/API_ENDPOINT_REFERENCE.md)** (генериран от кода), **[`RUNTIME_EXECUTION_FLOWS.md`](02_TO_BE_ARCHITECTURE/RUNTIME_EXECUTION_FLOWS.md)**, **[`ARCHITECTURE_COMPLIANCE_MATRIX.md`](02_TO_BE_ARCHITECTURE/ARCHITECTURE_COMPLIANCE_MATRIX.md)**, **[`OIDC_LOGIN.md`](02_TO_BE_ARCHITECTURE/OIDC_LOGIN.md)**, **[`PGP_KEYRING_AND_WORK_FOLDER.md`](02_TO_BE_ARCHITECTURE/PGP_KEYRING_AND_WORK_FOLDER.md)**, **[`READY_MADE_COMPONENTS.md`](02_TO_BE_ARCHITECTURE/READY_MADE_COMPONENTS.md)** (готови компоненти вместо собствен код) и **[`DEPLOYMENT_MODEL.md`](02_TO_BE_ARCHITECTURE/DEPLOYMENT_MODEL.md)** (add-on · Compose · SaaS — решението и защо) |
| `03_ADR/`                     | Architecture Decision Records — single registry (ADR-0001 … ADR-0023)                                                                                                                                                                                                                                       |
| `04_FUNCTION_SPECIFICATIONS/` | Master function inventory + specification template; **[`PORTAL_PAGE_CONTRACT.md`](04_FUNCTION_SPECIFICATIONS/PORTAL_PAGE_CONTRACT.md)** — binding contract for `/p/<id>`; **[`EVIDENCE_VIEW_PORTAL.md`](04_FUNCTION_SPECIFICATIONS/EVIDENCE_VIEW_PORTAL.md)** — порталът, който показва файловете и данните; **[`AUDIT_EVENTS.md`](04_FUNCTION_SPECIFICATIONS/AUDIT_EVENTS.md)** — каталог на одитните събития (генериран от кода) |
| `05_MIGRATION/`               | Zero-damage migration plan and supporting registers                                                                                                                                                                                                                                                         |
| `06_TESTING/`                 | Master test plan, catalog, crypto vectors, interoperability, GUI E2E, security tests                                                                                                                                                                                                                        |
| `07_RELEASE/`                 | Qualification, criteria, checklist, decision; **[`RELEASE_0.69.87.md`](07_RELEASE/RELEASE_0.69.87.md)** — какво влезе в изданието и с какво е доказано; **[`AUDIT_0.69.87.md`](07_RELEASE/AUDIT_0.69.87.md)** — пълният одит: произход → код → тест → документ → комит, измерени гейтове и какво НЕ е доказано |
| `08_USER_GUIDES/`             | User guides (BG / DE / EN) — incl. [`portals-contacts-cases.md`](08_USER_GUIDES/portals-contacts-cases.md), [`install-hacs.md`](08_USER_GUIDES/install-hacs.md), **[`pgp-keys-setup.md`](08_USER_GUIDES/pgp-keys-setup.md)** и **[`oidc-login.md`](08_USER_GUIDES/oidc-login.md)** (вход през Pocket ID/Keycloak), **[`admin-token.md`](08_USER_GUIDES/admin-token.md)** (защо admin токенът не е HA LLAT)  |

## Relationship to `docs/`

- `docs/plan/` — working design & planning history (v1.0 → Phase 7).
- `documentation/03_ADR/` — the single ADR registry (enterprise + implementation).
- This `documentation/` tree — official governance, architecture, migration, testing,
  release, and user guides.

## Пълно съдържание

Таблицата по-горе е **подбрани акценти**. Пълният списък е долу — всеки документ в дървото,
с заглавието от самия файл. Той се генерира от диска, за да няма документ без входяща
препратка (документ, който не се намира, е също толкова проблемен, колкото липсващ).

<!-- doc-index:begin -->
_Генериран списък: **112** документа. Пише се от `node scripts/docs-index.cjs`,
проверява се от `tests/docs-index.cjs`. Ръчна редакция се губи при следващото генериране._

| Документ | Заглавие (първи ред от самия файл) |
| -------- | --------------------------------- |
| `00_GOVERNANCE/CHANGE_CONTROL.md` | Change Control — hAPI Enterprise |
| `00_GOVERNANCE/DEFINITION_OF_DONE.md` | Definition of Done — hAPI Enterprise |
| `00_GOVERNANCE/DEPENDENCY_REGISTER.md` | Dependency Register — hAPI Enterprise |
| `00_GOVERNANCE/MASTER_PROJECT_PLAN.md` | Master Project Plan — hAPI Enterprise |
| `00_GOVERNANCE/MILESTONES.md` | Milestones — hAPI Enterprise |
| `00_GOVERNANCE/PLAN_STATUS.md` | Къде сме спрямо плана — проверка |
| `00_GOVERNANCE/PROJECT_CHARTER.md` | Project Charter — hAPI Enterprise |
| `00_GOVERNANCE/REQUIREMENTS_TRACEABILITY.md` | Requirements Traceability Matrix — hAPI Enterprise |
| `00_GOVERNANCE/RISK_REGISTER.md` | Risk Register — hAPI Enterprise |
| `00_GOVERNANCE/ROADMAP.md` | Roadmap — hAPI Enterprise |
| `00_GOVERNANCE/WORK_BREAKDOWN_STRUCTURE.md` | Work Breakdown Structure — hAPI Enterprise |
| `01_AS_IS_ARCHITECTURE/CRYPTO_PROVIDER_MATRIX.md` | Crypto Provider Matrix — hAPI Enterprise |
| `01_AS_IS_ARCHITECTURE/DEPENDENCY_GRAPH.md` | Dependency Graph — hAPI Enterprise (As-Is) |
| `01_AS_IS_ARCHITECTURE/FUNCTION_CALL_GRAPH.md` | Function Call Graph — hAPI Enterprise (As-Is) |
| `01_AS_IS_ARCHITECTURE/GUI_INVENTORY.md` | GUI Inventory — hAPI Enterprise (As-Is) |
| `01_AS_IS_ARCHITECTURE/KNOWN_DEFECTS.md` | Known Defects — hAPI Enterprise |
| `01_AS_IS_ARCHITECTURE/MODULE_CATALOG.md` | Module Catalog — hAPI Enterprise (As-Is) |
| `01_AS_IS_ARCHITECTURE/SOURCE_INVENTORY.md` | Source Inventory — hAPI Enterprise (As-Is) |
| `01_AS_IS_ARCHITECTURE/STORAGE_LAYOUT.md` | Къде какво стои — структура на файловете |
| `02_TO_BE_ARCHITECTURE/API_ARCHITECTURE_SPEC.md` | hAPI ENTERPRISE — API Architecture & Runtime Logic Specification |
| `02_TO_BE_ARCHITECTURE/API_ENDPOINT_REFERENCE.md` | API Endpoint Reference |
| `02_TO_BE_ARCHITECTURE/ARCHITECTURE_COMPLIANCE_MATRIX.md` | Architecture Compliance Matrix |
| `02_TO_BE_ARCHITECTURE/CRYPTO_ENGINE.md` | Crypto Engine — hAPI Enterprise (To-Be) |
| `02_TO_BE_ARCHITECTURE/DATA_MODEL.md` | Data Model — hAPI Enterprise (To-Be) |
| `02_TO_BE_ARCHITECTURE/DEPLOYMENT_MODEL.md` | Модел на внедряване — add-on или Docker Compose |
| `02_TO_BE_ARCHITECTURE/EVIDENCE_PORTAL_V1.2_REVIEW.md` | Преглед: `hapi-evidence-portal v1.2` (външен пакет) → какво от него вече е в hAPI |
| `02_TO_BE_ARCHITECTURE/GUI_ARCHITECTURE.md` | GUI Architecture — hAPI Enterprise (To-Be) |
| `02_TO_BE_ARCHITECTURE/INTEGRATION_CONTRACTS.md` | Integration Contracts — hAPI Enterprise (To-Be) |
| `02_TO_BE_ARCHITECTURE/KEY_MANAGEMENT.md` | Key Management — hAPI Enterprise (To-Be) |
| `02_TO_BE_ARCHITECTURE/LINK_AND_STORAGE_CONTRACT.md` | Договор за адресите и за директорията (LINK & STORAGE CONTRACT) |
| `02_TO_BE_ARCHITECTURE/OIDC_LOGIN.md` | OIDC вход (Pocket ID, Keycloak, Authentik…) — как се включва |
| `02_TO_BE_ARCHITECTURE/PGP_KEYRING_AND_WORK_FOLDER.md` | PGP ключове и криптиране на работната папка |
| `02_TO_BE_ARCHITECTURE/README.md` | 02 · Архитектура „как трябва да бъде“ — индекс |
| `02_TO_BE_ARCHITECTURE/READY_MADE_COMPONENTS.md` | Готови решения — оценка и място в архитектурата |
| `02_TO_BE_ARCHITECTURE/RUNTIME_EXECUTION_FLOWS.md` | Runtime Execution Flows |
| `02_TO_BE_ARCHITECTURE/SECURITY_MODEL.md` | Security Model — hAPI Enterprise (To-Be) |
| `02_TO_BE_ARCHITECTURE/SHARED_DATA.md` | Споделени данни между процеси — hAPI Enterprise |
| `02_TO_BE_ARCHITECTURE/STORAGE_ARCHITECTURE.md` | Storage Architecture — hAPI Enterprise (To-Be) |
| `02_TO_BE_ARCHITECTURE/SYSTEM_ARCHITECTURE.md` | System Architecture — hAPI Enterprise (To-Be) |
| `03_ADR/ADR_INDEX.md` | ADR Index |
| `03_ADR/ADR_TEMPLATE.md` | ADR Template |
| `03_ADR/ADR-0001-architecture.md` | ADR-0001: architecture |
| `03_ADR/ADR-0002-crypto-provider.md` | ADR-0002: crypto-provider |
| `03_ADR/ADR-0003-openpgp-v6.md` | ADR-0003: openpgp-v6 |
| `03_ADR/ADR-0004-key-lifecycle.md` | ADR-0004: key-lifecycle |
| `03_ADR/ADR-0005-secure-storage.md` | ADR-0005: secure-storage |
| `03_ADR/ADR-0006-fortress.md` | ADR-0006: fortress |
| `03_ADR/ADR-0007-identity-metadata.md` | ADR-0007: identity-metadata |
| `03_ADR/ADR-0008-gui-runtime.md` | ADR-0008: gui-runtime |
| `03_ADR/ADR-0009-evidence-reports.md` | ADR-0009: evidence-reports |
| `03_ADR/ADR-0010-migration-policy.md` | ADR-0010: migration-policy |
| `03_ADR/ADR-0011-compatibility.md` | ADR-0011: compatibility |
| `03_ADR/ADR-0012-release-gate.md` | ADR-0012: release-gate |
| `03_ADR/ADR-0013-variable-store-composite-key.md` | ADR-0013: Variable store с композитен ключ е ядрото (не JSONB) |
| `03_ADR/ADR-0014-metadata-driven-registry.md` | ADR-0014: Metadata-driven профилни схеми (Registry) |
| `03_ADR/ADR-0015-monolith-modules-interfaces.md` | ADR-0015: Монолит с модули + интерфейси (без microservices) |
| `03_ADR/ADR-0016-sqlite-repository-interface.md` | ADR-0016: SQLite + Repository interface (смяна по-късно) |
| `03_ADR/ADR-0017-stable-id-mutable-label.md` | ADR-0017: `id_gruppe` стабилен, `name_folder` mutable label |
| `03_ADR/ADR-0018-orphan-first.md` | ADR-0018: Orphan-first, асоцииране по-късно |
| `03_ADR/ADR-0019-indexed-fields-relational.md` | ADR-0019: `indexed:true` полета се държат и релационно |
| `03_ADR/ADR-0020-versioning.md` | ADR-0020: Версиониране: schema/API/data/UI |
| `03_ADR/ADR-0021-multi-tenancy-zero-trust.md` | ADR-0021: Multi-tenancy и Zero Trust — architecture-ready |
| `03_ADR/ADR-0022-flexibility-checklist.md` | ADR-0022: Всеки feature минава checklist-а на гъвкавост (§2.4/§9.1) |
| `03_ADR/ADR-0023-phase-4-features.md` | ADR-0023: Решения за feature-ите от Фаза 4 (обработка на документи + QR/споделяне) |
| `03_ADR/ADR-0024-unified-project-v6.md` | ADR-0024: Обединяване на всички идеи в един проект (v6.0) |
| `03_ADR/ADR-0025-report-studio.md` | ADR-0025: Report Studio — manifest-driven отчети с RFC 3161 обхват |
| `03_ADR/ADR-0026-public-gateway-and-digital-delivery.md` | ADR-0026 — Public API Gateway, файлово предоставяне и контрол на достъпа |
| `03_ADR/README.md` | ADR — Architecture Decision Records |
| `04_FUNCTION_SPECIFICATIONS/AUDIT_EVENTS.md` | Одитни събития — каталог |
| `04_FUNCTION_SPECIFICATIONS/DOCUMENT_GENERATOR.md` | Document Generator — договор |
| `04_FUNCTION_SPECIFICATIONS/EVIDENCE_VIEW_PORTAL.md` | Порталът, който показва файловете и данните (Evidence View) |
| `04_FUNCTION_SPECIFICATIONS/FUNCTION_SPECIFICATION_TEMPLATE.md` | Function Specification Template |
| `04_FUNCTION_SPECIFICATIONS/MASTER_FUNCTION_INVENTORY.md` | Master Function Inventory — hAPI Enterprise |
| `04_FUNCTION_SPECIFICATIONS/MODULE_SPECIFICATIONS/README.md` | Module Specifications |
| `04_FUNCTION_SPECIFICATIONS/PORTAL_PAGE_CONTRACT.md` | Договор за изпълнение: публична страница на портала (`/p/<id>`) |
| `04_FUNCTION_SPECIFICATIONS/REPORT_EVIDENCE_PACKAGE.md` | Пакет с доказателства от отчет — договор |
| `04_FUNCTION_SPECIFICATIONS/REPORT_OBJECTS.md` | Report Studio — обектна библиотека (договор) |
| `04_FUNCTION_SPECIFICATIONS/REPORT_SCOPES.md` | Договор за отчетите: обхвати и къде живеят (Фаза 11 / Report Studio) |
| `04_FUNCTION_SPECIFICATIONS/VISITOR_SENSORS.md` | Сензори за комуникацията (Visitor Sensors) |
| `05_MIGRATION/BACKLOG-AFTER-0.69.67.md` | Backlog след 0.69.67 — какво остана ⏳ (предложение, НЕ е одобрено) |
| `05_MIGRATION/CONFLICT_RESOLUTION.md` | Conflict Resolution — hAPI Enterprise |
| `05_MIGRATION/DONOR_COMPARISON.md` | Donor Comparison — hAPI Enterprise |
| `05_MIGRATION/MASTER_MIGRATION_PLAN.md` | Master Migration Plan — hAPI Enterprise |
| `05_MIGRATION/MIGRATION_LOG.md` | Migration Log — hAPI Enterprise |
| `05_MIGRATION/MIGRATION_MATRIX.md` | Migration Matrix — hAPI Enterprise |
| `05_MIGRATION/PLAN-0.69.67-LINKS-AND-FILES.md` | План: премахване на грешната логика и изграждане на договорената (0.69.67) |
| `05_MIGRATION/ROLLBACK_PLAN.md` | Rollback Plan — hAPI Enterprise Migration |
| `06_TESTING/CRYPTO_TEST_VECTORS.md` | Crypto Test Vectors — hAPI Enterprise |
| `06_TESTING/GUI_E2E.md` | GUI E2E — hAPI Enterprise |
| `06_TESTING/INTEROPERABILITY.md` | Interoperability — hAPI Enterprise |
| `06_TESTING/MASTER_TEST_PLAN.md` | Master Test Plan — hAPI Enterprise |
| `06_TESTING/SECURITY_TESTS.md` | Security Tests — hAPI Enterprise |
| `06_TESTING/TEST_CASE_CATALOG.md` | Test Case Catalog — hAPI Enterprise |
| `07_RELEASE/AUDIT_0.69.87.md` | Одит на постигнатото — 0.69.87 |
| `07_RELEASE/AUDIT-PROTOCOL.md` | Протокол от одита и изданието |
| `07_RELEASE/FEATURE_PARITY.md` | Паритет на функциите: `PasevSU/hAPI` ↔ това хранилище |
| `07_RELEASE/QUALIFICATION_PLAN.md` | Qualification Plan — hAPI Enterprise |
| `07_RELEASE/RELEASE_0.69.87.md` | Издание 0.69.87 — какво влезе, защо и как е проверено |
| `07_RELEASE/RELEASE_BUILD.md` | Изграждане и проверка на издание (Home Assistant) |
| `07_RELEASE/RELEASE_CHECKLIST.md` | Release Checklist — hAPI Enterprise |
| `07_RELEASE/RELEASE_CRITERIA.md` | Release Criteria — hAPI Enterprise |
| `07_RELEASE/RELEASE_DECISION.md` | Release Decision — hAPI Enterprise |
| `08_USER_GUIDES/admin-token.md` | Администраторски токен — какъв да бъде и защо |
| `08_USER_GUIDES/install-hacs.md` | Инсталиране през HACS |
| `08_USER_GUIDES/installation-layout.md` | Инсталация: коя папка къде отива |
| `08_USER_GUIDES/oidc-login.md` | Вход през външен доставчик (Pocket ID / Keycloak) — ръководство |
| `08_USER_GUIDES/pgp-keys-setup.md` | PGP ключове и криптирана работна папка — как се настройва |
| `08_USER_GUIDES/portals-contacts-cases.md` | Портали & файлове — контакт, дело, папка и полета по избор |
| `08_USER_GUIDES/public-gateway-setup.md` | Public API Gateway — свързване на собствен домейн към работещ Home Assistant |
| `08_USER_GUIDES/USER_GUIDE_BG.md` | hAPI Enterprise — Ръководство за потребителя |
| `08_USER_GUIDES/USER_GUIDE_DE.md` | hAPI Enterprise — Benutzerhandbuch |
| `08_USER_GUIDES/USER_GUIDE_EN.md` | hAPI Enterprise — User Guide |
<!-- doc-index:end -->

