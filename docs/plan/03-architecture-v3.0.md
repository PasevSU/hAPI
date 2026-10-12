
# DOCFLOW v3.0 – Планов документ

## Гъвкава архитектура за дългосрочно развитие

**Версия:** 3.0
**Дата:** 2026-10-12
**Статус:** Draft за одобрение
**База:** DOCFLOW v2.0 + hapi_enterprise v0.49
**Философия:** *"Нищо не е фиксирано, освен принципите"*

---

## 0. Защо v3.0?

### 0.1 Проблемът с v1.0 и v2.0

И двете версии страдат от **един и същ фундаментален дефект**: фиксират конкретни решения твърде рано.

| Фиксирано в v1/v2                     | Защо е проблем                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| 5 системни профила (1000-5000)   | Какво ако утре трябва 6000?                                        |
| Фиксирани префикси             | Какво ако бизнесът поиска друг namespace?                  |
| Твърда схема на`records`         | Какво ако поле се появи/изчезне?                           |
| Монолитен`server.js`                 | Какво ако трябва отделен microservice?                          |
| Единна БД (SQLite)                      | Какво ако трябва PostgreSQL?                                           |
| Фиксирани политики за delete | Какво ако организацията има различни правила? |
| Смесени слоеве                     | Какво ако сменим UI framework?                                         |
| Твърд API contract                         | Какво ако клиент иска GraphQL?                                     |

**Резултатът:** Всяка промяна изисква рефакторинг. Скоростта на развитие пада експоненциално с всяка версия.

### 0.2 Философията на v3.0

> **Всичко, което може да се промени, трябва да е конфигурируемо.**
> **Всичко, което не може да се промени, трябва да е абстрахирано.**
> **Всичко останало трябва да е изолирано.**

Това означава:

1. **Никакви hard-coded стойности** – всичко през config/registry
2. **Никакви фиксирани схеми** – metadata-driven
3. **Никакви монолитни модули** – pluggable архитектура
4. **Никакви директни зависимости** – dependency injection
5. **Никакви breaking промени** – версиониране на всичко

---

## 1. Принципи на гъвкавост

### 1.1 Осем принципа

| #  | Принцип                          | Какво означава на практика                      |
| -- | --------------------------------------- | ---------------------------------------------------------------------- |
| P1 | **Configuration over Code**       | Всичко, което може да е config, е config            |
| P2 | **Convention over Configuration** | Разумни default-и, override при нужда                  |
| P3 | **Metadata over Schema**          | Полетата се дефинират в данни, не в код |
| P4 | **Composition over Inheritance**  | Малки модули, композирани, не йерархии |
| P5 | **Dependency Injection**          | Никакви`require('./db')` директно                     |
| P6 | **Version Everything**            | Схеми, API-та, шаблони, миграции                 |
| P7 | **Fail Gracefully**               | Липсващ модул не чупи системата             |
| P8 | **Document Decisions**            | ADR (Architecture Decision Records)                                    |

### 1.2 Anti-patterns, които избягваме

- ❌ Hard-coded префикси (1000, 2000...)
- ❌ Фиксирани SQL колони за бизнес полета
- ❌ `require()` на конкретни реализации
- ❌ `if (version === 'v2')` в код
- ❌ Една БД за всичко без абстракция
- ❌ UI, който знае за бизнес логика

---

## 2. Гъвкава архитектура – 6 слоя

```
┌────────────────────────────────────────────────────────────────┐
│  L6: PRESENTATION (UI)                                         │
│  ├─ Admin UI, Public Portal, Verify, CLI, API Gateway          │
│  └─ Pluggable: React, HTMX, Vue – всеки клиент на същия API    │
├────────────────────────────────────────────────────────────────┤
│  L5: API GATEWAY                                               │
│  ├─ REST (default), GraphQL, WebSocket, gRPC                   │
│  └─ Versioned: /api/v1, /api/v2, ...                           │
├────────────────────────────────────────────────────────────────┤
│  L4: APPLICATION (Use Cases)                                   │
│  ├─ GroupUC, RecordUC, DocumentUC, VerifyUC, QrUC              │
│  └─ Pluggable: всеки UC е независим модул                      │
├────────────────────────────────────────────────────────────────┤
│  L3: DOMAIN (Business Logic)                                   │
│  ├─ Entities, Value Objects, Domain Events                     │
│  └─ Pure: без зависимост от DB, HTTP, UI                       │
├────────────────────────────────────────────────────────────────┤
│  L2: INFRASTRUCTURE (Adapters)                                 │
│  ├─ Repositories: SQLite, PostgreSQL, MongoDB                  │
│  ├─ Storage: Local, S3, WebDAV                                 │
│  ├─ Queue: In-memory, Redis, RabbitMQ                          │
│  └─ Pluggable: swap без промяна в L3/L4                        │
├────────────────────────────────────────────────────────────────┤
│  L1: CORE (Kernel)                                             │
│  ├─ DI Container, Event Bus, Config, Registry                  │
│  └─ Stable: промени само при нова major версия                 │
└────────────────────────────────────────────────────────────────┘
```

**Правило за зависимости:** Всеки слой зависи само от по-долния. L3 не знае за L2. L4 не знае за L6.

---

## 3. Ключови абстракции

### 3.1 Registry – вместо hard-coded профили

**Проблем в v2.0:**

```javascript
const SYSTEM_PROFILES = [
    {prefix: 1000, name: "Указател"},
    {prefix: 2000, name: "Картотека"},
    // ...
];
```

**Решение в v3.0:**

```javascript
// core/registry.js
class Registry {
    constructor() {
        this.profiles = new Map();      // prefix → ProfileDescriptor
        this.renderers = new Map();     // format → Renderer
        this.storages = new Map();      // name → Storage
        this.repositories = new Map();  // name → Repository
        this.validators = new Map();    // field → Validator
        this.hooks = new Map();         // event → [handlers]
    }

    registerProfile(descriptor) {
        this.profiles.set(descriptor.prefix, descriptor);
        this.emit('profile:registered', descriptor);
    }

    getProfile(prefix) {
        return this.profiles.get(prefix);
    }

    // Няма hard-coded списък – всичко идва от config/plugins
}

export const registry = new Registry();
```

**Конфигурация (profiles.yaml):**

```yaml
profiles:
  - prefix: 1000
    name: Указател
    namespace: directory
    schema: schemas/directory.yaml
    enabled: true
    plugins: [variables, audit, export]
  
  - prefix: 2000
    name: Картотека
    namespace: cabinet
    schema: schemas/cabinet.yaml
    enabled: true
  
  # Нов профил – просто добавяш запис
  - prefix: 6000
    name: Фактури
    namespace: invoices
    schema: schemas/invoices.yaml
    enabled: true
```

**Резултат:** Добавяне на нов профил = нов YAML запис. **Без промяна в код.**

### 3.2 Metadata-driven схеми

**Проблем в v2.0:**

```sql
CREATE TABLE records (
    name TEXT,
    adresse TEXT,
    ulica TEXT,
    -- ... фиксирани колони
);
```

**Решение в v3.0:**

```yaml
# schemas/directory.yaml
prefix: 1000
name: Указател
fields:
  - name: name
    type: string
    required: true
    label: "Име"
    searchable: true
  
  - name: email
    type: email
    required: false
    label: "Имейл"
    searchable: true
    validators: [email]
  
  - name: phone
    type: phone
    label: "Телефон"
    pattern: "^\\+?[0-9\\s-]+$"
  
  - name: custom_field_1
    type: string
    label: "Собствено поле"
    # добавено от потребител – без промяна в код
```

**Съхранение – EAV (Entity-Attribute-Value) или JSON:**

```sql
-- Вариант 1: EAV (гъвкаво, но бавно)
CREATE TABLE record_values (
    record_id TEXT,
    field_name TEXT,
    field_value TEXT
);

-- Вариант 2: JSON (бързо, SQLite/PostgreSQL поддържат)
CREATE TABLE records (
    id TEXT PRIMARY KEY,
    prefix INTEGER,
    id_gruppe TEXT,
    data JSON,         -- всички полета тук
    schema_version INTEGER,
    created_at TIMESTAMP
);

-- Вариант 3: Хибрид (препоръка)
CREATE TABLE records (
    id TEXT PRIMARY KEY,
    prefix INTEGER,
    id_gruppe TEXT,
    data JSON,              -- business полета
    indexed_fields JSON,    -- денормализирани за търсене
    schema_version INTEGER
);
```

**Резултат:** Ново поле = промяна в YAML + миграция на schema_version. **Без ALTER TABLE.**

### 3.3 Repository pattern – swap на БД

```javascript
// domain/repositories/record-repository.js (интерфейс)
export class RecordRepository {
    async findById(id) { throw new Error('Not implemented'); }
    async findByGroup(id_gruppe) { throw new Error('Not implemented'); }
    async save(record) { throw new Error('Not implemented'); }
    async delete(id) { throw new Error('Not implemented'); }
}

// infrastructure/sqlite/sqlite-record-repository.js
export class SqliteRecordRepository extends RecordRepository {
    async findById(id) { /* SQLite impl */ }
    // ...
}

// infrastructure/postgres/postgres-record-repository.js
export class PostgresRecordRepository extends RecordRepository {
    async findById(id) { /* PostgreSQL impl */ }
    // ...
}

// При стартиране – DI избира кой
container.bind('RecordRepository', config.db.type === 'postgres'
    ? PostgresRecordRepository
    : SqliteRecordRepository
);
```

**Резултат:** Смяна на БД = конфигурация. **Без промяна в бизнес логиката.**

### 3.4 Event Bus – разкачване на модули

```javascript
// core/event-bus.js
class EventBus {
    constructor() { this.handlers = new Map(); }
  
    on(event, handler) {
        if (!this.handlers.has(event)) this.handlers.set(event, []);
        this.handlers.get(event).push(handler);
    }
  
    async emit(event, payload) {
        const handlers = this.handlers.get(event) || [];
        await Promise.all(handlers.map(h => h(payload)));
    }
}

export const eventBus = new EventBus();
```

**Употреба:**

```javascript
// В record-service.js
await eventBus.emit('record.created', { record });

// В audit-plugin.js (независим модул)
eventBus.on('record.created', async ({record}) => {
    await audit.log('CREATE', record);
});

// В notify-plugin.js (друг независим модул)
eventBus.on('record.created', async ({record}) => {
    if (config.notify) await ha.notify(`Нов запис: ${record.id}`);
});

// В qr-plugin.js
eventBus.on('record.created', async ({record}) => {
    if (record.prefix === 2000) await qr.generate(record);
});
```

**Резултат:** Добавяне на функционалност = нов handler. **Без промяна в съществуващ код.**

### 3.5 Pluggable архитектура

```javascript
// core/plugin-loader.js
class PluginLoader {
    async load(pluginPath) {
        const plugin = await import(pluginPath);
        if (typeof plugin.register !== 'function') {
            throw new Error(`Plugin ${pluginPath} has no register()`);
        }
        await plugin.register({registry, eventBus, container});
    }
  
    async loadAll(dir) {
        const files = await fs.readdir(dir);
        for (const f of files) {
            try {
                await this.load(path.join(dir, f));
            } catch (e) {
                logger.warn(`Plugin ${f} failed: ${e.message}`);
                // Продължаваме – graceful degradation
            }
        }
    }
}
```

**Плагин пример:**

```javascript
// plugins/ocr-plugin.js
export async function register({registry, eventBus}) {
    registry.registerRenderer('ocr', new OcrRenderer());
  
    eventBus.on('file.uploaded', async ({file}) => {
        if (file.mimeType === 'application/pdf') {
            const text = await registry.getRenderer('ocr').extract(file);
            await registry.getRepository('FileRepository').updateText(file.id, text);
        }
    });
}
```

**Резултат:** Нова функционалност = нов файл. **Без промяна в ядрото.**

---

## 4. Гъвкавост по измерения

### 4.1 Данни

| Аспект             | v2.0 (фиксирано)       | v3.0 (гъвкаво)              |
| ------------------------ | ------------------------------- | ---------------------------------- |
| БД                     | SQLite                          | SQLite / PostgreSQL / MySQL        |
| Схема               | Твърда                    | Metadata-driven + JSON             |
| Полета             | Фиксирани колони | Дефинирани в YAML       |
| Профили           | Hard-coded 1000-5000            | Регистрирани в config |
| Версиониране | Няма                        | `schema_version` per запис  |
| Storage                  | Локален                  | Local / S3 / WebDAV                |

### 4.2 API

| Аспект             | v2.0             | v3.0                                   |
| ------------------------ | ---------------- | -------------------------------------- |
| Протокол         | REST             | REST / GraphQL / WebSocket             |
| Версиониране | `/api/`        | `/api/v1/`, `/api/v2/`             |
| Auth                     | Session          | Session / JWT / OAuth2 / API keys      |
| Rate limit               | Частичен | Pluggable limiter                      |
| Документация | Ръчна       | OpenAPI auto-generated                 |
| Format                   | JSON             | JSON / XML / CSV (content negotiation) |

### 4.3 UI

| Аспект         | v2.0               | v3.0                              |
| -------------------- | ------------------ | --------------------------------- |
| Framework            | Vanilla JS         | Pluggable (React/Vue/HTMX)        |
| Рендиране   | Server-side HTML   | SSR + CSR                         |
| Тема             | Твърда       | Token-based (design tokens)       |
| i18n                 | Смесен       | Пълна локализация |
| Accessibility        | Частична   | WCAG 2.1 AA                       |
| Компоненти | Монолитни | Composable                        |

### 4.4 Документи

| Аспект           | v2.0             | v3.0                              |
| ---------------------- | ---------------- | --------------------------------- |
| Renderers              | PDF, DOCX        | Pluggable (PDF/DOCX/XLSX/HTML/MD) |
| Шаблони         | Твърди     | Metadata + variables              |
| Signature              | SHA-256          | SHA-256 + PKCS#7 + timestamp      |
| OCR                    | Няма         | Pluggable (Tesseract/Cloud)       |
| QR                     | Per-portal       | Per-file + per-version            |
| Верификация | Заглушка | Multi-source (local + external)   |

### 4.5 Деплой

| Аспект | v2.0             | v3.0                           |
| ------------ | ---------------- | ------------------------------ |
| Пакет   | HA addon         | HA addon + Docker + Standalone |
| Config       | YAML             | YAML + ENV + DB                |
| Secrets      | Plaintext        | Vault / ENV / HA secrets       |
| Scaling      | Single instance  | Multi-instance ready           |
| Backup       | Частичен | Pluggable destinations         |

---

## 5. Версиониране – ключът към гъвкавостта

### 5.1 Четири нива на версиониране

```
V1: APPLICATION VERSION
    v3.0.0, v3.1.0, v4.0.0
    → Semantic versioning на целия продукт

V2: SCHEMA VERSION
    schema_version: 1, 2, 3...
    → Всяка промяна в metadata → нова версия
    → Миграциите са explicit

V3: API VERSION
    /api/v1/, /api/v2/
    → Breaking промени → нова версия
    → Старата остава жива N месеца

V4: DATA VERSION
    record.schema_version
    → Всеки запис знае с коя схема е създаден
    → Чете се с миграция on-the-fly
```

### 5.2 Миграционна стратегия

```javascript
// migrations/runner.js
class MigrationRunner {
    async run() {
        const current = await this.getCurrentVersion();
        const migrations = await this.loadMigrations();
      
        for (const m of migrations.filter(m => m.version > current)) {
            logger.info(`Applying migration ${m.version}: ${m.name}`);
            await this.applyWithBackup(m);
            await this.setVersion(m.version);
        }
    }
  
    async applyWithBackup(migration) {
        await backup.create();
        try {
            await migration.up(this.db);
        } catch (e) {
            await backup.restore();
            throw e;
        }
    }
  
    // Rollback
    async rollback(toVersion) {
        // ...
    }
}
```

**Правило:** Всяка миграция има `up()` и `down()`. Винаги можеш да се върнеш.

### 5.3 Backward compatibility

```javascript
// API versioning
app.use('/api/v1', require('./api/v1'));
app.use('/api/v2', require('./api/v2'));

// Deprecation
app.use('/api/v1', (req, res, next) => {
    res.set('X-API-Deprecated', 'true');
    res.set('X-API-Sunset', '2027-01-01');
    next();
});
```

---

## 6. Configuration – всичко е config

### 6.1 Йерархия на конфигурацията

```
1. Defaults (в код)
   ↓ override
2. Config file (config.yaml)
   ↓ override
3. Environment variables
   ↓ override
4. Database settings
   ↓ override
5. Runtime overrides (admin UI)
```

### 6.2 Пълен config.yaml (гъвкав)

```yaml
# ═══════════════════════════════════════════════════════════
# CORE
# ═══════════════════════════════════════════════════════════
app:
  name: "DOCFLOW"
  version: "3.0.0"
  instance_id: ""  # auto-generated
  environment: "production"  # development | staging | production

# ═══════════════════════════════════════════════════════════
# DATABASE (pluggable)
# ═══════════════════════════════════════════════════════════
database:
  driver: "sqlite"  # sqlite | postgres | mysql
  sqlite:
    path: "/data/db.sqlite"
  postgres:
    host: ""
    port: 5432
    database: ""
    user: ""
    password: ""
  pool:
    min: 2
    max: 10

# ═══════════════════════════════════════════════════════════
# STORAGE (pluggable)
# ═══════════════════════════════════════════════════════════
storage:
  driver: "local"  # local | s3 | webdav
  local:
    path: "/data/files"
  s3:
    endpoint: ""
    bucket: ""
    access_key: ""
    secret_key: ""
  webdav:
    url: ""
    user: ""
    password: ""

# ═══════════════════════════════════════════════════════════
# PROFILES (metadata-driven – не hard-coded!)
# ═══════════════════════════════════════════════════════════
profiles:
  source: "file"  # file | database | plugin
  file: "config/profiles.yaml"
  # Може да се добавят профили динамично
  allow_runtime_registration: true

# ═══════════════════════════════════════════════════════════
# MODULES (pluggable)
# ═══════════════════════════════════════════════════════════
modules:
  enabled:
    - directory
    - cabinet
    - portals
    - snippets
    - templates
    - ocr
    - qr
    - verify
    - audit
    - backup
  disabled: []
  auto_discover: true
  directory: "modules/"

# ═══════════════════════════════════════════════════════════
# API (versioned)
# ═══════════════════════════════════════════════════════════
api:
  default_version: "v2"
  enabled_versions: ["v1", "v2"]
  formats: ["json", "xml", "csv"]
  rate_limit:
    public: 60/min
    verify: 30/min
    authenticated: 600/min
  cors:
    enabled: true
    origins: ["*"]

# ═══════════════════════════════════════════════════════════
# DOCUMENTS
# ═══════════════════════════════════════════════════════════
documents:
  renderers:
    pdf:
      driver: "pdf-lib"
      options:
        compress: true
    docx:
      driver: "ooxml"
    xlsx:
      driver: "ooxml"
  signature:
    enabled: true
    algorithm: "sha256"  # sha256 | sha512 | pkcs7
  ocr:
    enabled: false
    driver: "tesseract"  # tesseract | cloud
    languages: ["bul", "deu", "eng"]
  qr:
    enabled: true
    per_file: true
    branding:
      logo: "/data/logo.png"
      error_correction: "H"
      size: 256
    expiry:
      default_days: 0  # 0 = без expiry

# ═══════════════════════════════════════════════════════════
# INTEGRATIONS
# ═══════════════════════════════════════════════════════════
integrations:
  homeassistant:
    enabled: true
    url: "http://supervisor/core"
    token: ""
    sensors: true
    notifications: true
  webhook:
    enabled: false
    endpoints: []

# ═══════════════════════════════════════════════════════════
# FEATURES (feature flags)
# ═══════════════════════════════════════════════════════════
features:
  multi_tenant: false
  graphql_api: false
  websocket: false
  blockchain_anchor: false
  advanced_analytics: false
  # Включваш/изключваш без промяна в код

# ═══════════════════════════════════════════════════════════
# POLICIES (per-tenant configurable)
# ═══════════════════════════════════════════════════════════
policies:
  delete:
    default: "orphan"  # orphan | cascade | block
    require_confirmation: true
  orphan:
    cleanup_after_days: 0  # 0 = никога
    notify_admin: true
  retention:
    audit_log_days: 365
    backup_count: 10
    trash_days: 30
  qr:
    revoke_on_file_update: true
    require_signature: true

# ═══════════════════════════════════════════════════════════
# SECURITY
# ═══════════════════════════════════════════════════════════
security:
  auth:
    session_ttl: 86400
    jwt_enabled: false
    oauth2_enabled: false
  passwords:
    algorithm: "scrypt"
    min_length: 12
  secrets:
    source: "env"  # env | vault | file
    vault_url: ""

# ═══════════════════════════════════════════════════════════
# OBSERVABILITY
# ═══════════════════════════════════════════════════════════
observability:
  logging:
    level: "info"
    format: "json"  # text | json
    destination: "stdout"  # stdout | file | syslog
  metrics:
    enabled: true
    driver: "prometheus"  # prometheus | statsd | none
    port: 9090
  tracing:
    enabled: false
    driver: "jaeger"
```

**Резултат:** Всичко се променя през config. **Без промяна в код.**

---

## 7. Пътна карта – гъвкаво развитие

### 7.1 Фази

```
ФАЗА 0: FOUNDATION (2 седмици)
  ├─ Core kernel (DI, EventBus, Registry)
  ├─ Configuration loader (йерархия)
  ├─ Migration runner
  └─ Plugin loader

ФАЗА 1: DOMAIN (2 седмици)
  ├─ Entities (Group, Profile, Record)
  ├─ Repository interfaces
  ├─ Use cases (Create, Link, Unlink, Rename)
  └─ Domain events

ФАЗА 2: INFRASTRUCTURE (2 седмици)
  ├─ SQLite repository impl
  ├─ Local storage impl
  ├─ Backup service
  └─ Audit service

ФАЗА 3: API (2 седмици)
  ├─ REST v1 (backward compatible)
  ├─ REST v2 (new features)
  ├─ Content negotiation
  └─ OpenAPI spec

ФАЗА 4: UI (3 седмици)
  ├─ Admin: Обзор, Групи, Записи, Шаблони
  ├─ Public: Portal, Verify
  ├─ Design tokens + dark mode
  └─ i18n

ФАЗА 5: DOCUMENTS (3 седмици)
  ├─ Template engine
  ├─ Renderers (PDF, DOCX, XLSX)
  ├─ QR per-file + embedding
  ├─ Signature (SHA-256 → PKCS#7)
  └─ Verify page

ФАЗА 6: MODULES (3 седмици)
  ├─ OCR plugin
  ├─ Full-text search
  ├─ PDF tools
  ├─ HA sensors + notifications
  └─ Webhook plugin

ФАЗА 7: HARDENING (2 седмици)
  ├─ Tests (unit + integration + e2e)
  ├─ CI/CD
  ├─ Documentation
  └─ Security audit
```

### 7.2 Какво може да се промени по всяко време

| Компонент | Може да се промени | Не може (без major версия) |
| ------------------ | --------------------------------- | ----------------------------------------- |
| Профили     | Да – config                    | –                                        |
| Полета       | Да – YAML                      | –                                        |
| БД               | Да – config                    | –                                        |
| Storage            | Да – config                    | –                                        |
| Renderers          | Да – plugin                    | –                                        |
| API                | Да – versioned                 | –                                        |
| UI                 | Да – pluggable                 | –                                        |
| Policies           | Да – config                    | –                                        |
| Modules            | Да – enable/disable            | –                                        |
| Core kernel        | –                                | Само при v4.0                      |

---

## 8. ADR – Architecture Decision Records

Всяко решение се документира:

```markdown
# ADR-001: Избор на SQLite като default БД

## Status
Accepted

## Context
Трябва БД, която работи в HA addon без външни зависимости.

## Decision
SQLite като default, но с абстракция (Repository pattern), 
която позволява смяна на PostgreSQL.

## Consequences
+ Нула конфигурация
+ Работи offline
- Ограничена конкурентност
- Не скалира хоризонтално

## Mitigation
Repository pattern + config за смяна.
```

**Правило:** Всяко важно решение → ADR в `docs/adr/`.

---

## 9. Тестова стратегия за гъвкавост

### 9.1 Contract tests

```javascript
// tests/contracts/repository.contract.js
export function testRepositoryContract(createRepo) {
    describe('Repository contract', () => {
        it('findById returns null for missing', async () => {
            const repo = createRepo();
            expect(await repo.findById('missing')).toBeNull();
        });
        // ... тестове, които всяка имплементация трябва да мине
    });
}

// tests/sqlite/repository.test.js
testRepositoryContract(() => new SqliteRecordRepository(db));

// tests/postgres/repository.test.js
testRepositoryContract(() => new PostgresRecordRepository(pool));
```

### 9.2 Plugin isolation tests

```javascript
it('system works without OCR plugin', async () => {
    const app = await createApp({modules: {ocr: false}});
    const res = await app.inject({method: 'GET', url: '/api/v2/records'});
    expect(res.statusCode).toBe(200);
});
```

### 9.3 Migration tests

```javascript
it('migration 002 → 003 → 002 is reversible', async () => {
    await migrate.to(2);
    await migrate.to(3);
    await migrate.to(2);
    // Проверка на данни
});
```

---

## 10. Документация

### 10.1 Структура

```
docs/
├── README.md
├── ARCHITECTURE.md
├── adr/
│   ├── 001-sqlite-default.md
│   ├── 002-repository-pattern.md
│   └── ...
├── api/
│   ├── openapi-v1.yaml
│   └── openapi-v2.yaml
├── guides/
│   ├── getting-started.md
│   ├── adding-profile.md
│   ├── writing-plugin.md
│   └── migrating-db.md
├── reference/
│   ├── config.md
│   ├── profiles.md
│   └── events.md
└── changelog.md
```

### 10.2 Генериране

- OpenAPI → от код (auto)
- Config reference → от JSON Schema
- ADR → ръчно
- Changelog → от commits (Conventional Commits)

---

## 11. Миграция от hapi_enterprise v0.49

### 11.1 Стратегия

```
hapi_enterprise v0.49 (работещ)
    │
    │ 1. Backup (db + files)
    │ 2. Install DOCFLOW v3.0 в паралелна папка
    │ 3. Migration script (dry-run)
    │ 4. Migration script (real)
    │ 5. Verify integrity
    │ 6. Switch (DNS / HA config)
    │ 7. Monitor
    │
    ▼
DOCFLOW v3.0 (нов)
```

### 11.2 Mapping

| hapi_enterprise       | DOCFLOW v3.0                        |
| ----------------------- | ----------------------------------- |
| `portals`             | `groups` + `records` (3000)     |
| `files`               | `records` (2000) + storage        |
| `directory`           | `records` (1000)                  |
| `directory_variables` | `variable_values`                 |
| `audit_log`           | `audit_log` (запазва се) |
| `settings.json`       | `config.yaml`                     |
| QR (per-portal)         | QR (per-file) + legacy mapping      |

### 11.3 Backward compatibility

- API v1 → запазва се, deprecated
- Стари URL-и → redirect
- Стари QR → пренасочване към нов verify

---

## 12. Критерии за гъвкавост

### 12.1 Checklist – всеки нов feature

- [ ] Може ли да се изключи през config?
- [ ] Може ли да се замени с друг?
- [ ] Има ли интерфейс (не конкретна имплементация)?
- [ ] Има ли event, който да уведоми?
- [ ] Има ли миграция с rollback?
- [ ] Документиран ли е в ADR?
- [ ] Тестван ли е изолирано?

**Ако не → не е готов.**

### 12.2 Метрики

| Метрика                                            | Цел                     |
| --------------------------------------------------------- | -------------------------- |
| Време за добавяне на нов профил | < 1 час (config only)   |
| Време за смяна на БД                      | < 1 ден (config + test) |
| Време за добавяне на plugin              | < 2 часа               |
| Време за breaking change в API                    | 0 (нова версия)  |
| Време за rollback на миграция            | < 5 мин                 |
| Coverage на contract tests                              | 100%                       |

---

## 13. Рискове и смекчаване

| Риск                                     | Вероятност | Влияние | Смекчаване                          |
| -------------------------------------------- | -------------------- | -------------- | --------------------------------------------- |
| Over-engineering                             | Висока         | Високо   | YAGNI – само каквото трябва |
| Твърде много абстракции | Средна         | Средно   | Concrete default, abstract при нужда  |
| Performance загуби от JSON           | Средна         | Средно   | Indexed fields + cache                        |
| Сложност на DI                     | Средна         | Средно   | Опростен container (< 100 реда)   |
| Migration failures                           | Средна         | Високо   | Backup + dry-run + rollback                   |
| Plugin conflicts                             | Ниска           | Средно   | Isolation + contract tests                    |
| Documentation drift                          | Висока         | Средно   | Auto-generation + CI checks                   |

---

## 14. Какво НЕ правим в v3.0

За да остане реалистично:

- ❌ Microservices (остава монолит с модули)
- ❌ Multi-tenant (само architecture-ready)
- ❌ GraphQL (само REST)
- ❌ Blockchain anchor (само HA entity)
- ❌ Full PKCS#7 (само SHA-256 + timestamp)
- ❌ Kubernetes (само Docker + HA addon)
- ❌ AI/ML (само OCR)

**Тези са v4.0+.** Сега строим основата, която ги позволява.

---

## 15. Следващи стъпки

### 15.1 Решения за вземане

1. **Приемаш ли философията на v3.0?** (гъвкавост > фиксираност)
2. **Приемаш ли 8-те принципа?** (P1-P8)
3. **Приемаш ли 6-те слоя?** (L1-L6)
4. **Приемаш ли pluggable архитектурата?**
5. **Приемаш ли metadata-driven схеми?**
6. **Приемаш ли версионирането на 4 нива?**
7. **Приемаш ли ADR практиката?**

### 15.2 Ако ДА – започваме с:

**Стъпка 1:** ADR-001 (философия на v3.0)
**Стъпка 2:** Core kernel (DI, EventBus, Registry) – скелет
**Стъпка 3:** Config loader + schema
**Стъпка 4:** Repository interface + SQLite impl
**Стъпка 5:** Domain entities + use cases
**Стъпка 6:** API v2 skeleton
**Стъпка 7:** Миграционен скрипт от v0.49
**Стъпка 8:** Тестове + CI

### 15.3 Ако НЕ – какво липсва?

Кажи ми кое не е наред:

- Твърде абстрактно?
- Твърде много работа?
- Липсва конкретика?
- Друго?

---

## 16. Заключение

**v3.0 не е просто нова версия. Това е нова основа.**

Разликата:

| v1/v2                             | v3.0                         |
| --------------------------------- | ---------------------------- |
| Фиксирани решения | Конфигурируеми |
| Монолит                    | Pluggable модули       |
| Твърди схеми           | Metadata-driven              |
| Една БД                     | Pluggable storage            |
| Един API                      | Versioned API                |
| Един UI                       | Pluggable UI                 |
| Без ADR                        | ADR за всичко        |
| Без versioning                 | 4 нива versioning        |

**Резултат:** Следващата промяна ще е конфигурация, не рефакторинг.

---

## Приложения

- **A.** ADR template
- **B.** Plugin template
- **C.** Repository interface template
- **D.** Profile schema template
- **E.** Migration template

---

**Край на DOCFLOW v3.0.**

---

## Въпрос към теб

Този документ е **философският манифест** на проекта. Той не казва "какво да правим", а "как да мислим".

**Кажи ми:**

1. **Приемаш ли философията?** (гъвкавост > фиксираност)
2. **Кое от 8-те принципа е най-важен за теб?**
3. **Кое от 6-те слоя искаш да задълбоча първо?**
4. **Искаш ли конкретен пример** (напр. "как се добавя нов профил стъпка по стъпка")?
5. **Или искаш да преминем директно към:**
   - **A)** ADR-001 (философия)
   - **B)** Core kernel (код)
   - **C)** Config schema (YAML)
   - **D)** Migration plan (от v0.49)

Кой път избираш?
