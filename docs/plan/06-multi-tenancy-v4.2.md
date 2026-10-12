
# DOCFLOW Enterprise v4.2

## ЧАТ 02: Multi-Tenancy Architecture

**Версия:** 4.2
**Част:** 02 от 20
**Дата:** 2026-10-12
**Статус:** Strategic Design – за одобрение
**Класификация:** Internal – Confidential
**Зависимости:** DOCFLOW Enterprise v4.0 (Master), v4.1 (Domain Model)

---

## 0. Резюме на част 02

Multi-tenancy е **фундаментално изискване** за enterprise платформа. Тя определя как **една инсталация** обслужва **много клиенти**, без компромис в:

- **Сигурност** – tenant A никога не вижда данни на tenant B
- **Производителност** – шумният съсед не засяга другите
- **Изолация** – провалът в един tenant не чупи другите
- **Compliance** – данните остават в правилната юрисдикция
- **Cost efficiency** – споделена инфраструктура, но изолирани ресурси

**Обхват:**

- Isolation models (shared → dedicated)
- Tenant lifecycle (onboarding → offboarding)
- Tenant context propagation
- Row-Level Security (RLS)
- Quotas & rate limiting
- Data residency
- Billing & metering
- Cross-tenant operations
- Migration между tiers
- Testing strategy

---

## 1. Tenant като First-Class Citizen

### 1.1 Дефиниция

**Tenant** = изолирана организация-клиент на платформата. Всеки tenant има:

- **Собствени данни** – изолирани от другите
- **Собствени потребители** – IAM в рамките на tenant
- **Собствена конфигурация** – settings, policies, branding
- **Собствени квоти** – storage, API calls, users
- **Собствен lifecycle** – trial, active, suspended, deleted

### 1.2 Tenant vs други концепции

| Концепция     | Дефиниция                                     | Пример            |
| ---------------------- | ------------------------------------------------------ | ----------------------- |
| **Tenant**       | Изолирана организация-клиент | "Acme Corp"             |
| **Organization** | Юридическо лице в Identity context      | "Acme Corp Ltd."        |
| **Group**        | Логическа папка в Document context      | "Договори 2026" |
| **User**         | Автентикиран субект                  | "ivan@acme.com"         |
| **Person**       | Физическо лице в Identity                | "Иван Петров" |

**Правило:** Един tenant може да съдържа много organizations, groups, users, persons. Но всички те са **изолирани** от други tenants.

### 1.3 Tenant Metadata

```typescript
// domain/tenant/aggregates/tenant.ts
export class Tenant extends AggregateRoot<TenantId> {
    private readonly id: TenantId;
    private name: TenantName;
    private slug: Slug;              // URL-safe, unique globally
    private tier: TenantTier;        // COMMUNITY | BUSINESS | ENTERPRISE
    private status: TenantStatus;    // TRIAL | ACTIVE | SUSPENDED | DELETED
    private config: TenantConfig;
    private quotas: TenantQuotas;
    private residency: DataResidency;
    private branding: TenantBranding;
    private readonly createdAt: Timestamp;
    private updatedAt: Timestamp;

    // Lifecycle
    public suspend(reason: SuspendReason, by: UserId): void { /* ... */ }
    public reactivate(by: UserId): void { /* ... */ }
    public upgradeTier(newTier: TenantTier, by: UserId): void { /* ... */ }
    public changeResidency(region: Region, by: UserId): void { /* ... */ }
}
```

---

## 2. Isolation Models

### 2.1 Спектър на изолация

```
◄─── По-малко изолация ──────────────── Повече изолация ───►

┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ Shared   │ Shared   │ Shared   │ Separate │ Separate │
│ DB       │ DB       │ DB       │ DB       │ Deploy   │
│ Shared   │ Separate │ Separate │ Separate │ Separate │
│ Schema   │ Schema   │ DB       │ Cluster  │ Region   │
└──────────┴──────────┴──────────┴──────────┴──────────┘
   SMB        Business   Business   Enterprise  Regulated
   Free       Standard   Premium    Platinum    Gov/Bank
```

### 2.2 Isolation Models – детайл

#### Model 1: Shared DB, Shared Schema

**Описание:** Всички tenants в една БД, едни таблици, `tenant_id` колона.

```sql
CREATE TABLE documents (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    ...
);
```

**Плюсове:**

- Най-нисък cost
- Най-лесно управление
- Ефективно използване на ресурси

**Минуси:**

- Най-ниска изолация (риск от leakage)
- "Noisy neighbor" проблеми
- Ограничения при compliance

**Кога:** Community tier, trial, SMB.

#### Model 2: Shared DB, Separate Schema

**Описание:** Една БД, отделна schema per tenant.

```sql
CREATE SCHEMA tenant_acme;
CREATE TABLE tenant_acme.documents (...);
```

**Плюсове:**

- По-добра изолация
- По-лесен backup per tenant
- По-добър compliance

**Минуси:**

- Schema proliferation (1000+ schemas)
- Сложно управление
- Migration per schema

**Кога:** Business tier.

#### Model 3: Shared DB, Separate Database

**Описание:** Един DB сървър, отделна database per tenant.

```sql
CREATE DATABASE tenant_acme;
CREATE DATABASE tenant_beta;
```

**Плюсове:**

- Силна изолация
- Independent backup/restore
- Independent scaling

**Минуси:**

- Connection overhead
- Management complexity
- Resource per DB

**Кога:** Business Premium, Enterprise.

#### Model 4: Separate Database Cluster

**Описание:** Отделен DB cluster per tenant (или per tenant group).

**Плюсове:**

- Пълна изолация
- Independent scaling
- Independent upgrades

**Минуси:**

- Висок cost
- Сложна автоматизация

**Кога:** Enterprise Platinum.

#### Model 5: Separate Deployment (Region)

**Описание:** Пълно отделно deployment, често в различна юрисдикция.

**Плюсове:**

- Data residency
- Regulatory compliance
- Пълна изолация

**Минуси:**

- Много висок cost
- Сложна координация

**Кога:** Regulated industries (banking, gov, healthcare).

### 2.3 Isolation Matrix

| Model                     | Cost    | Isolation | Compliance      | Scale  | Target           |
| ------------------------- | ------- | --------- | --------------- | ------ | ---------------- |
| Shared DB/Schema          | $       | Low       | GDPR (limited)  | High   | Community        |
| Shared DB/Separate Schema | $$      | Medium    | GDPR            | Medium | Business         |
| Shared DB/Separate DB     | $$$   | High      | GDPR, HIPAA     | Medium | Business Premium |
| Separate Cluster          | $$$$  | Very High | All             | Low    | Enterprise       |
| Separate Deployment       | $$$$$ | Maximum   | All + residency | Low    | Regulated        |

### 2.4 Hybrid Model – препоръка

**Стратегия:** **Shared DB/Schema by default + Separate DB on demand**

```typescript
// infrastructure/tenancy/isolation-resolver.ts
export class IsolationResolver {
    public resolve(tenant: Tenant): IsolationStrategy {
        switch (tenant.tier) {
            case TenantTier.COMMUNITY:
                return new SharedSchemaStrategy();
            case TenantTier.BUSINESS:
                return tenant.config.premiumIsolation
                    ? new SeparateSchemaStrategy()
                    : new SharedSchemaStrategy();
            case TenantTier.ENTERPRISE:
                return tenant.config.dedicatedDatabase
                    ? new SeparateDatabaseStrategy()
                    : new SeparateSchemaStrategy();
            case TenantTier.REGULATED:
                return new SeparateClusterStrategy();
        }
    }
}
```

**Правило:** Default = Shared Schema. Upgrade = seamless migration.

---

## 3. Tenant Context Propagation

### 3.1 Проблемът

Всяка заявка трябва да знае **кой tenant** я изпълнява. Без това:

- Данни могат да изтекат между tenants
- Квоти не могат да се прилагат
- Audit не може да се проследи

### 3.2 Решение: AsyncLocalStorage

```typescript
// infrastructure/tenancy/tenant-context.ts
import { AsyncLocalStorage } from 'async_hooks';

export interface TenantInfo {
    id: TenantId;
    slug: Slug;
    tier: TenantTier;
    status: TenantStatus;
    residency: DataResidency;
    quotas: TenantQuotas;
    config: TenantConfig;
}

export class TenantContext {
    private static readonly storage = new AsyncLocalStorage<TenantInfo>();

    public static run<T>(tenant: TenantInfo, fn: () => T): T {
        return this.storage.run(tenant, fn);
    }

    public static current(): TenantInfo {
        const tenant = this.storage.getStore();
        if (!tenant) {
            throw new MissingTenantContextError();
        }
        return tenant;
    }

    public static tryCurrent(): TenantInfo | null {
        return this.storage.getStore() ?? null;
    }

    public static require(): TenantInfo {
        return this.current();
    }
}
```

### 3.3 Middleware

```typescript
// infrastructure/http/middleware/tenant-middleware.ts
export function tenantMiddleware(
    tenantResolver: TenantResolver
): RequestHandler {
    return async (req, res, next) => {
        try {
            // 1. Resolve tenant from request
            const resolution = await tenantResolver.resolve(req);

            // 2. Load tenant info
            const tenant = await tenantService.load(resolution.tenantId);

            // 3. Validate tenant status
            if (tenant.status === TenantStatus.SUSPENDED) {
                return res.status(403).json({
                    error: 'TENANT_SUSPENDED',
                    message: 'Tenant is suspended'
                });
            }

            if (tenant.status === TenantStatus.DELETED) {
                return res.status(404).json({
                    error: 'TENANT_NOT_FOUND'
                });
            }

            // 4. Run in context
            TenantContext.run(tenant, () => next());
        } catch (error) {
            next(error);
        }
    };
}
```

### 3.4 Tenant Resolution Strategies

```typescript
// infrastructure/tenancy/tenant-resolver.ts
export class TenantResolver {
    public async resolve(req: Request): Promise<TenantResolution> {
        // Strategy 1: Subdomain
        const subdomain = this.extractSubdomain(req.hostname);
        if (subdomain) {
            return { tenantId: await this.lookupBySlug(subdomain) };
        }

        // Strategy 2: Header
        const header = req.headers['x-tenant-id'];
        if (header) {
            return { tenantId: TenantId.fromString(header as string) };
        }

        // Strategy 3: JWT claim
        const jwt = req.auth?.token;
        if (jwt?.tenantId) {
            return { tenantId: TenantId.fromString(jwt.tenantId) };
        }

        // Strategy 4: Path prefix (/api/v2/t/{slug}/...)
        const pathMatch = req.path.match(/^\/api\/v\d+\/t\/([^/]+)/);
        if (pathMatch) {
            return { tenantId: await this.lookupBySlug(pathMatch[1]) };
        }

        // Strategy 5: API key
        const apiKey = req.headers['x-api-key'];
        if (apiKey) {
            return { tenantId: await this.lookupByApiKey(apiKey as string) };
        }

        throw new TenantNotResolvedError();
    }
}
```

**Приоритет:** Subdomain > Path > Header > JWT > API key.

### 3.5 Propagation през слоевете

```
HTTP Request
    │
    ▼
[Middleware] TenantContext.run(tenant, ...)
    │
    ▼
[Application Service] TenantContext.current()
    │
    ▼
[Domain Service] TenantContext.current()
    │
    ▼
[Repository] TenantContext.current() → WHERE tenant_id = ?
    │
    ▼
[Database] RLS policy enforces
    │
    ▼
[Event Bus] TenantContext propagated in event metadata
    │
    ▼
[Async Job] TenantContext restored from event
```

### 3.6 Async Jobs

```typescript
// infrastructure/jobs/tenant-aware-job.ts
export abstract class TenantAwareJob<T> {
    public async execute(payload: T): Promise<void> {
        const tenantId = this.extractTenantId(payload);
        const tenant = await tenantService.load(tenantId);
      
        await TenantContext.run(tenant, async () => {
            await this.run(payload);
        });
    }

    protected abstract extractTenantId(payload: T): TenantId;
    protected abstract run(payload: T): Promise<void>;
}
```

### 3.7 Events – Tenant Propagation

```typescript
// integration event
{
    "id": "01H...",
    "type": "document.created",
    "version": "1.0",
    "tenantId": "tenant-uuid",  // ← ЗАДЪЛЖИТЕЛНО
    "occurredAt": "2026-10-12T14:30:00Z",
    "data": { ... }
}
```

**Правило:** Всеки integration event **трябва** да съдържа `tenantId`. Без него → reject.

---

## 4. Row-Level Security (PostgreSQL)

### 4.1 Защо RLS?

Дори с application-level filtering, **човешка грешка** може да доведе до изтичане. RLS добавя **втора линия на защита** на ниво БД.

### 4.2 RLS Setup

```sql
-- 1. Enable RLS на всички tenant-scoped таблици
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_entries ENABLE ROW LEVEL SECURITY;
-- ... всички

-- 2. Създай policy за всеки
CREATE POLICY tenant_isolation ON documents
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- 3. Force RLS за table owner (по подразбиране owner заобикаля)
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
```

### 4.3 Setting Tenant Context

```typescript
// infrastructure/db/tenant-aware-connection.ts
export class TenantAwareConnection {
    public async withTenant<T>(
        tenantId: TenantId,
        fn: (conn: Connection) => Promise<T>
    ): Promise<T> {
        const conn = await this.pool.acquire();
        try {
            // Set session variable
            await conn.query(
                `SET LOCAL app.tenant_id = $1`,
                [tenantId.toString()]
            );
            return await fn(conn);
        } finally {
            // Reset
            await conn.query(`RESET app.tenant_id`);
            this.pool.release(conn);
        }
    }
}
```

### 4.4 Bypass за Admin

```sql
-- Super admin може да чете всичко
CREATE POLICY super_admin_all ON documents
    FOR ALL
    TO super_admin_role
    USING (true);
```

**Правило:** Bypass само за specific role, никога за application.

### 4.5 Testing RLS

```typescript
describe('RLS', () => {
    it('tenant A cannot see tenant B data', async () => {
        const tenantA = await createTenant('A');
        const tenantB = await createTenant('B');

        await TenantContext.run(tenantA, async () => {
            const docs = await documentRepo.findAll();
            expect(docs.every(d => d.tenantId.equals(tenantA.id))).toBe(true);
        });

        // Direct SQL bypass attempt
        await TenantContext.run(tenantA, async () => {
            const result = await conn.query(
                `SELECT * FROM documents WHERE tenant_id = $1`,
                [tenantB.id.toString()]
            );
            expect(result.rows).toHaveLength(0);
        });
    });
});
```

### 4.6 Performance Considerations

| Issue               | Mitigation                       |
| ------------------- | -------------------------------- |
| RLS adds overhead   | Index on`tenant_id`            |
| Prepared statements | Use`SET LOCAL` per transaction |
| Connection pooling  | Reset on release                 |
| Complex policies    | Keep simple, test                |

---

## 5. Quotas & Rate Limiting

### 5.1 Quota Types

| Resource                     | Unit   | Default per Tier         |
| ---------------------------- | ------ | ------------------------ |
| **Storage**            | bytes  | 10 GB / 1 TB / Unlimited |
| **Documents**          | count  | 10K / 1M / Unlimited     |
| **API calls**          | /day   | 10K / 1M / Unlimited     |
| **Users**              | count  | 10 / 100 / Unlimited     |
| **Groups**             | count  | 5 / 100 / Unlimited      |
| **Concurrent renders** | count  | 1 / 10 / 50              |
| **OCR pages**          | /month | 100 / 10K / 100K         |
| **Webhooks**           | count  | 0 / 10 / 100             |

### 5.2 Quota Model

```typescript
// domain/tenant/value-objects/tenant-quotas.ts
export class TenantQuotas extends ValueObject<{
    storageBytes: number;
    documents: number;
    apiCallsPerDay: number;
    users: number;
    groups: number;
    concurrentRenders: number;
    ocrPagesPerMonth: number;
    webhooks: number;
}> {
    public static forTier(tier: TenantTier): TenantQuotas {
        const presets = {
            [TenantTier.COMMUNITY]: {
                storageBytes: 10 * GB,
                documents: 10_000,
                apiCallsPerDay: 10_000,
                users: 10,
                groups: 5,
                concurrentRenders: 1,
                ocrPagesPerMonth: 100,
                webhooks: 0
            },
            [TenantTier.BUSINESS]: {
                storageBytes: 1 * TB,
                documents: 1_000_000,
                apiCallsPerDay: 1_000_000,
                users: 100,
                groups: 100,
                concurrentRenders: 10,
                ocrPagesPerMonth: 10_000,
                webhooks: 10
            },
            [TenantTier.ENTERPRISE]: {
                storageBytes: Number.MAX_SAFE_INTEGER,
                documents: Number.MAX_SAFE_INTEGER,
                apiCallsPerDay: Number.MAX_SAFE_INTEGER,
                users: Number.MAX_SAFE_INTEGER,
                groups: Number.MAX_SAFE_INTEGER,
                concurrentRenders: 50,
                ocrPagesPerMonth: 100_000,
                webhooks: 100
            }
        };
        return new TenantQuotas(presets[tier]);
    }
}
```

### 5.3 Quota Enforcement

```typescript
// infrastructure/quotas/quota-enforcer.ts
export class QuotaEnforcer {
    constructor(
        private readonly redis: RedisClient,
        private readonly metrics: MetricsClient
    ) {}

    public async check(
        tenantId: TenantId,
        resource: QuotaResource,
        amount: number
    ): Promise<QuotaCheckResult> {
        const tenant = await tenantService.load(tenantId);
        const limit = tenant.quotas.get(resource);
        const used = await this.getUsage(tenantId, resource);

        if (used + amount > limit) {
            this.metrics.increment('quota.exceeded', { tenant: tenantId, resource });
            return {
                allowed: false,
                limit,
                used,
                requested: amount,
                resetAt: this.getResetTime(resource)
            };
        }

        return { allowed: true, limit, used, requested: amount };
    }

    public async consume(
        tenantId: TenantId,
        resource: QuotaResource,
        amount: number
    ): Promise<void> {
        const key = this.buildKey(tenantId, resource);
        const ttl = this.getTtl(resource);
        await this.redis.incrby(key, amount);
        if (ttl > 0) await this.redis.expire(key, ttl);
    }

    private getResetTime(resource: QuotaResource): Date | null {
        switch (resource) {
            case QuotaResource.API_CALLS_PER_DAY:
                return endOfDay();
            case QuotaResource.OCR_PAGES_PER_MONTH:
                return endOfMonth();
            default:
                return null;
        }
    }
}
```

### 5.4 Rate Limiting – Token Bucket

```typescript
// infrastructure/rate-limit/token-bucket.ts
export class TokenBucket {
    constructor(
        private readonly redis: RedisClient,
        private readonly capacity: number,
        private readonly refillRate: number  // tokens per second
    ) {}

    public async consume(key: string, tokens: number = 1): Promise<boolean> {
        const now = Date.now();
        const script = `
            local key = KEYS[1]
            local capacity = tonumber(ARGV[1])
            local refill_rate = tonumber(ARGV[2])
            local now = tonumber(ARGV[3])
            local requested = tonumber(ARGV[4])

            local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
            local tokens = tonumber(bucket[1]) or capacity
            local last_refill = tonumber(bucket[2]) or now

            local elapsed = (now - last_refill) / 1000
            local refilled = math.min(capacity, tokens + elapsed * refill_rate)

            if refilled >= requested then
                redis.call('HMSET', key, 'tokens', refilled - requested, 'last_refill', now)
                redis.call('EXPIRE', key, 3600)
                return 1
            else
                redis.call('HMSET', key, 'tokens', refilled, 'last_refill', now)
                redis.call('EXPIRE', key, 3600)
                return 0
            end
        `;
        const result = await this.redis.eval(
            script,
            [key],
            [this.capacity, this.refillRate, now, tokens]
        );
        return result === 1;
    }
}
```

### 5.5 Rate Limit Tiers

| Tier       | Public API | Verify   | Authenticated |
| ---------- | ---------- | -------- | ------------- |
| Community  | 60/min     | 30/min   | 600/min       |
| Business   | 600/min    | 300/min  | 6000/min      |
| Enterprise | 6000/min   | 3000/min | 60000/min     |

### 5.6 Response Headers

```http
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 599
X-RateLimit-Reset: 1697126400
Retry-After: 60
```

### 5.7 Graceful Degradation

```
100% quota ──► soft warning (90%)
         ──► throttling (95%)
         ──► hard block (100%)
         ──► auto-upgrade offer (110% for 24h)
```

---

## 6. Data Residency

### 6.1 Региони

```typescript
export enum Region {
    EU_WEST = 'eu-west-1',      // Ирландия
    EU_CENTRAL = 'eu-central-1', // Франкфурт
    US_EAST = 'us-east-1',      // Вирджиния
    US_WEST = 'us-west-2',      // Орегон
    AP_SOUTHEAST = 'ap-southeast-1', // Сингапур
    AP_NORTHEAST = 'ap-northeast-1'  // Токио
}
```

### 6.2 Residency Rules

```typescript
export class DataResidency extends ValueObject<{
    primary: Region;
    backup: Region | null;
    allowedProcessingRegions: Region[];
    allowCrossBorderTransfer: boolean;
}> {
    public static eu(): DataResidency {
        return new DataResidency({
            primary: Region.EU_CENTRAL,
            backup: Region.EU_WEST,
            allowedProcessingRegions: [Region.EU_CENTRAL, Region.EU_WEST],
            allowCrossBorderTransfer: false
        });
    }

    public static gdpr(): DataResidency { return this.eu(); }
    public static us(): DataResidency { /* ... */ }
    public static global(): DataResidency { /* ... */ }
}
```

### 6.3 Routing

```typescript
// infrastructure/tenancy/residency-router.ts
export class ResidencyRouter {
    public async route(tenantId: TenantId): Promise<Region> {
        const tenant = await tenantService.load(tenantId);
        return tenant.residency.primary;
    }

    public async getStorageEndpoint(
        tenantId: TenantId
    ): Promise<StorageEndpoint> {
        const region = await this.route(tenantId);
        return this.endpoints.get(region);
    }

    public async getDatabasePool(
        tenantId: TenantId
    ): Promise<DatabasePool> {
        const region = await this.route(tenantId);
        return this.pools.get(region);
    }
}
```

### 6.4 Cross-Region Replication

```
┌──────────────┐         ┌──────────────┐
│ EU Central   │────────►│ EU West      │
│ (Primary)    │  async  │ (Backup)     │
└──────────────┘         └──────────────┘
       │
       │ (no cross-border for regulated tenants)
       ▼
┌──────────────┐
│ EU Only      │
└──────────────┘
```

**Правило:** За regulated tenants – никакво cross-border. Само intra-region replication.

### 6.5 Compliance Enforcement

```typescript
export class ResidencyEnforcer {
    public async enforce(tenantId: TenantId, operation: Operation): Promise<void> {
        const tenant = await tenantService.load(tenantId);
        const residency = tenant.residency;

        if (!residency.allowedProcessingRegions.includes(operation.region)) {
            throw new ResidencyViolationError(
                tenantId,
                operation.region,
                residency.allowedProcessingRegions
            );
        }

        if (operation.crossBorder && !residency.allowCrossBorderTransfer) {
            throw new CrossBorderTransferDeniedError(tenantId, operation);
        }
    }
}
```

---

## 7. Billing & Metering

### 7.1 Metering Model

Всяка консумация се записва като **usage event**:

```typescript
export interface UsageEvent {
    id: string;
    tenantId: TenantId;
    resource: UsageResource;
    quantity: number;
    unit: string;
    occurredAt: Timestamp;
    metadata: {
        userId?: string;
        apiKeyId?: string;
        operation: string;
    };
}

export enum UsageResource {
    API_CALL = 'api_call',
    STORAGE_BYTES = 'storage_bytes',
    DOCUMENT_CREATED = 'document_created',
    DOCUMENT_RENDERED = 'document_rendered',
    OCR_PAGE = 'ocr_page',
    VERIFICATION = 'verification',
    USER_SEAT = 'user_seat',
    WEBHOOK_DELIVERY = 'webhook_delivery'
}
```

### 7.2 Metering Pipeline

```
Application → UsageEvent → Kafka → Metering Service → TimescaleDB
                                              │
                                              ▼
                                       Aggregation (hourly/daily/monthly)
                                              │
                                              ▼
                                       Billing Service → Invoice
```

### 7.3 Billing Model

| Model                  | Описание                |
| ---------------------- | ------------------------------- |
| **Subscription** | Fixed monthly fee per tier      |
| **Usage-based**  | Pay per API call, storage, etc. |
| **Hybrid**       | Base subscription + overage     |
| **Seat-based**   | Per user                        |
| **Enterprise**   | Custom contract                 |

### 7.4 Pricing Example

```yaml
tiers:
  community:
    price: 0
    included:
      storage: 10GB
      documents: 10000
      api_calls: 10000/day
    overage: not_allowed

  business:
    price: 499 EUR/month
    included:
      storage: 1TB
      documents: 1000000
      api_calls: 1000000/day
    overage:
      storage: 0.10 EUR/GB/month
      api_calls: 0.001 EUR/call

  enterprise:
    price: custom
    included: unlimited
    overage: negotiated
```

### 7.5 Invoice Generation

```typescript
export class InvoiceService {
    public async generateMonthlyInvoice(
        tenantId: TenantId,
        period: BillingPeriod
    ): Promise<Invoice> {
        const tenant = await tenantService.load(tenantId);
        const subscription = await this.subscriptionRepo.findActive(tenantId);
        const usage = await this.usageRepo.aggregate(tenantId, period);

        const lineItems: LineItem[] = [
            {
                description: `${subscription.plan.name} subscription`,
                quantity: 1,
                unitPrice: subscription.plan.monthlyPrice,
                total: subscription.plan.monthlyPrice
            }
        ];

        // Overage
        for (const resource of Object.keys(usage)) {
            const included = subscription.plan.included[resource];
            const consumed = usage[resource];
            const overage = Math.max(0, consumed - included);
            if (overage > 0) {
                lineItems.push({
                    description: `${resource} overage`,
                    quantity: overage,
                    unitPrice: subscription.plan.overage[resource],
                    total: overage * subscription.plan.overage[resource]
                });
            }
        }

        return Invoice.create({
            tenantId,
            period,
            lineItems,
            total: lineItems.reduce((s, i) => s + i.total, 0),
            currency: 'EUR',
            dueAt: period.end.plusDays(30)
        });
    }
}
```

---

## 8. Tenant Lifecycle

### 8.1 States

```
     ┌──────────┐
     │  DRAFT   │  ← създаден, но не активиран
     └────┬─────┘
          │ activate
          ▼
     ┌──────────┐
     │  TRIAL   │  ← 14/30 дни trial
     └────┬─────┘
          │ convert
          ▼
     ┌──────────┐
     │  ACTIVE  │◄────┐
     └────┬─────┘     │ reactivate
          │           │
          │ suspend   │
          ▼           │
     ┌──────────┐     │
     │SUSPENDED │─────┘
     └────┬─────┘
          │ delete
          ▼
     ┌──────────┐
     │ DELETED  │  ← soft delete, 30 дни retention
     └────┬─────┘
          │ purge
          ▼
     ┌──────────┐
     │  PURGED  │  ← всичко изтрито
     └──────────┘
```

### 8.2 Onboarding

```typescript
export class TenantOnboardingService {
    public async onboard(cmd: OnboardTenantCommand): Promise<Tenant> {
        return this.uow.execute(async () => {
            // 1. Validate
            await this.validateSlugUnique(cmd.slug);
            await this.validateEmailDomain(cmd.email);

            // 2. Create tenant
            const tenant = Tenant.create({
                name: cmd.name,
                slug: cmd.slug,
                tier: cmd.tier,
                residency: cmd.residency,
                status: TenantStatus.TRIAL
            });
            await this.tenantRepo.save(tenant);

            // 3. Provision infrastructure
            await this.provisioner.provision(tenant);

            // 4. Create initial admin user
            const admin = await this.userService.createAdmin({
                tenantId: tenant.id,
                email: cmd.email,
                name: cmd.adminName
            });

            // 5. Send welcome email
            await this.notificationService.sendWelcome(admin);

            // 6. Create default groups/profiles
            await this.createDefaults(tenant);

            // 7. Record audit
            await this.auditService.record(new TenantCreated(tenant.id, tenant.tier, admin.id));

            return tenant;
        });
    }

    private async provisioner(tenant: Tenant): Promise<void> {
        switch (tenant.tier) {
            case TenantTier.COMMUNITY:
                await this.provisionSharedSchema(tenant);
                break;
            case TenantTier.BUSINESS:
                await this.provisionSeparateSchema(tenant);
                break;
            case TenantTier.ENTERPRISE:
                await this.provisionSeparateDatabase(tenant);
                break;
        }
    }
}
```

### 8.3 Suspension

```typescript
export class TenantSuspensionService {
    public async suspend(
        tenantId: TenantId,
        reason: SuspendReason,
        by: UserId
    ): Promise<void> {
        return this.uow.execute(async () => {
            const tenant = await this.tenantRepo.findById(tenantId);
            if (!tenant) throw new TenantNotFoundError(tenantId);

            tenant.suspend(reason, by);
            await this.tenantRepo.save(tenant);

            // Effects:
            // - API returns 403 for tenant
            // - Users cannot login
            // - Jobs pause
            // - Storage remains (no data loss)

            await this.jobScheduler.pauseAll(tenantId);
            await this.cacheInvalidator.invalidateTenant(tenantId);
            await this.notificationService.sendSuspensionNotice(tenant, reason);
        });
    }
}
```

### 8.4 Deletion (soft + hard)

```typescript
export class TenantDeletionService {
    /**
     * Soft delete: tenant marked as DELETED, data remains for 30 days.
     */
    public async softDelete(tenantId: TenantId, by: UserId): Promise<void> {
        const tenant = await this.tenantRepo.findById(tenantId);
        tenant.markDeleted(by);
        await this.tenantRepo.save(tenant);

        await this.scheduleHardDelete(tenantId, 30);
    }

    /**
     * Hard delete: all data purged.
     */
    public async hardDelete(tenantId: TenantId): Promise<void> {
        return this.uow.execute(async () => {
            // 1. Verify retention period passed
            const tenant = await this.tenantRepo.findById(tenantId);
            if (!tenant.canBePurged()) {
                throw new RetentionPeriodNotPassedError(tenantId);
            }

            // 2. Delete from all contexts
            await this.documentRepo.deleteAllByTenant(tenantId);
            await this.identityRepo.deleteAllByTenant(tenantId);
            await this.verificationRepo.deleteAllByTenant(tenantId);
            await this.templateRepo.deleteAllByTenant(tenantId);
            await this.auditRepo.archiveAndDelete(tenantId);  // audit archive
            await this.workflowRepo.deleteAllByTenant(tenantId);

            // 3. Delete storage
            await this.storage.deleteAllByTenant(tenantId);

            // 4. Delete infrastructure
            await this.provisioner.deprovision(tenant);

            // 5. Delete tenant record
            await this.tenantRepo.delete(tenantId);

            // 6. Record in global audit (not tenant-scoped)
            await this.globalAudit.record(new TenantPurged(tenantId));
        });
    }
}
```

### 8.5 Offboarding Checklist

```
□ Notify tenant (30 days before)
□ Export data (GDPR right to portability)
□ Revoke all API keys
□ Terminate subscriptions
□ Backup (for legal retention)
□ Soft delete
□ Wait 30 days
□ Hard delete
□ Confirm deletion
```

---

## 9. Cross-Tenant Operations

### 9.1 Кога се налагат?

- **Super Admin** – platform support
- **Analytics** – aggregate reports
- **Compliance** – regulatory audits
- **Billing** – cross-tenant invoices
- **Migration** – tenant tier upgrade

### 9.2 Security Model

```typescript
export class CrossTenantAccess {
    public static async withSuperAdmin<T>(
        operatorId: UserId,
        reason: string,
        fn: () => Promise<T>
    ): Promise<T> {
        // 1. Verify operator is super admin
        const operator = await userService.load(operatorId);
        if (!operator.isSuperAdmin()) {
            throw new InsufficientPrivilegesError(operatorId);
        }

        // 2. Require MFA
        if (!operator.hasRecentMFA(15 * MINUTES)) {
            throw new MFARequiredError();
        }

        // 3. Record intent
        const auditEntry = await auditService.recordIntent({
            operatorId,
            reason,
            action: 'cross_tenant_access',
            timestamp: Timestamp.now()
        });

        // 4. Run with bypass (elevated privileges)
        return TenantContext.run({
            id: TenantId.SYSTEM,
            tier: TenantTier.SYSTEM,
            // ...
        }, async () => {
            try {
                const result = await fn();
                await auditService.recordCompletion(auditEntry.id, 'success');
                return result;
            } catch (error) {
                await auditService.recordCompletion(auditEntry.id, 'failure', error);
                throw error;
            }
        });
    }
}
```

### 9.3 Правила

| Правило            | Описание                                               |
| ------------------------- | -------------------------------------------------------------- |
| **Explicit intent** | Всяка cross-tenant операция изисква reason |
| **MFA required**    | Super admin трябва да има recent MFA                |
| **Audit always**    | Всяка операция се записва                |
| **Time-bounded**    | Access изтича след N минути                    |
| **Least privilege** | Само specific operations                                   |
| **No data export**  | Освен с explicit approval                                |
| **Notification**    | Tenant admin се уведомява                           |

### 9.4 Analytics (Aggregate)

```typescript
export class AnalyticsService {
    /**
     * Aggregated analytics – не разкрива individual tenant data.
     */
    public async getPlatformMetrics(): Promise<PlatformMetrics> {
        // Runs with special role that has aggregate-only access
        return this.db.query(`
            SELECT
                COUNT(DISTINCT tenant_id) as total_tenants,
                SUM(document_count) as total_documents,
                SUM(storage_bytes) as total_storage,
                AVG(api_calls_per_day) as avg_api_calls
            FROM tenant_metrics_view
            WHERE anonymized = true
        `);
    }
}
```

---

## 10. Migration между Tiers

### 10.1 Upgrade Scenarios

| From                    | To                               | Migration |
| ----------------------- | -------------------------------- | --------- |
| Community → Business   | Shared Schema → Separate Schema |           |
| Business → Enterprise  | Separate Schema → Separate DB   |           |
| Enterprise → Regulated | Separate DB → Separate Cluster  |           |

### 10.2 Zero-Downtime Migration

```
Phase 1: PREPARE
  ├─ Create target infrastructure
  ├─ Setup replication (source → target)
  └─ Verify replication lag < 1s

Phase 2: SYNC
  ├─ Wait for lag = 0
  ├─ Enable dual-write (source + target)
  └─ Verify consistency

Phase 3: SWITCH
  ├─ Set read-only on source
  ├─ Final sync
  ├─ Update routing (target = primary)
  └─ Disable dual-write

Phase 4: CLEANUP
  ├─ Monitor target for 24h
  ├─ Archive source
  └─ Delete source after 30 days
```

### 10.3 Migration Service

```typescript
export class TenantMigrationService {
    public async migrateToTier(
        tenantId: TenantId,
        targetTier: TenantTier
    ): Promise<MigrationResult> {
        const tenant = await this.tenantRepo.findById(tenantId);
        const source = await this.isolationResolver.resolve(tenant);
        const target = await this.isolationResolver.resolveForTier(targetTier);

        // 1. Create target
        await target.provision(tenant);

        // 2. Replicate data
        const replicator = new TenantReplicator(source, target);
        await replicator.startReplication(tenantId);

        // 3. Wait for sync
        await replicator.waitForSync(tenantId, { maxLag: 1000 });

        // 4. Switch
        await this.router.switchTenant(tenantId, target);
        await replicator.stopReplication(tenantId);

        // 5. Update tenant tier
        tenant.upgradeTier(targetTier, UserId.SYSTEM);
        await this.tenantRepo.save(tenant);

        // 6. Cleanup source (async, after 30 days)
        await this.scheduleCleanup(source, tenantId, 30);

        return { success: true, source, target };
    }
}
```

### 10.4 Rollback Plan

- **Before switch:** просто изтрий target
- **After switch (0-24h):** switch back + replay
- **After 24h:** complex – restore from backup

---

## 11. Tenant Configuration

### 11.1 Configuration Hierarchy

```
1. Platform defaults (in code)
   ↓ override
2. Tier defaults (per tier)
   ↓ override
3. Tenant config (in DB)
   ↓ override
4. Runtime overrides (admin UI)
```

### 11.2 TenantConfig

```typescript
export interface TenantConfig {
    branding: TenantBranding;
    features: TenantFeatures;
    policies: TenantPolicies;
    integrations: TenantIntegrations;
    security: TenantSecurity;
}

export interface TenantBranding {
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    faviconUrl: string | null;
    customDomain: string | null;
}

export interface TenantFeatures {
    ocr: boolean;
    advancedSearch: boolean;
    workflow: boolean;
    webhooks: boolean;
    sso: boolean;
    apiAccess: boolean;
    auditExport: boolean;
    customTemplates: boolean;
}

export interface TenantPolicies {
    passwordPolicy: PasswordPolicy;
    sessionPolicy: SessionPolicy;
    dataRetention: DataRetentionPolicy;
    deletePolicy: DeletePolicy;  // orphan | cascade | block
    qrExpiry: QrExpiryPolicy;
}

export interface TenantSecurity {
    mfaRequired: boolean;
    ipWhitelist: string[] | null;
    allowedDomains: string[] | null;
    sessionTimeoutMinutes: number;
}
```

### 11.3 Configuration API

```typescript
// GET /api/v2/tenant/config
// PATCH /api/v2/tenant/config
export class TenantConfigService {
    public async get(tenantId: TenantId): Promise<TenantConfig> {
        const tenant = await this.tenantRepo.findById(tenantId);
        return tenant.config;
    }

    public async update(
        tenantId: TenantId,
        patch: Partial<TenantConfig>,
        by: UserId
    ): Promise<TenantConfig> {
        const tenant = await this.tenantRepo.findById(tenantId);

        // Validate per tier
        await this.validateForTier(tenant.tier, patch);

        const updated = { ...tenant.config, ...patch };
        tenant.updateConfig(updated, by);
        await this.tenantRepo.save(tenant);

        // Invalidate cache
        await this.cache.invalidate(`tenant:${tenantId}:config`);

        return updated;
    }
}
```

---

## 12. Testing Strategy

### 12.1 Unit Tests

```typescript
describe('TenantQuotas', () => {
    it('community tier has correct limits', () => {
        const q = TenantQuotas.forTier(TenantTier.COMMUNITY);
        expect(q.storageBytes).toBe(10 * GB);
    });

    it('enterprise tier has unlimited storage', () => {
        const q = TenantQuotas.forTier(TenantTier.ENTERPRISE);
        expect(q.storageBytes).toBe(Number.MAX_SAFE_INTEGER);
    });
});
```

### 12.2 Integration Tests

```typescript
describe('Tenant isolation', () => {
    it('tenant A cannot access tenant B documents', async () => {
        const a = await fixtures.createTenant('A');
        const b = await fixtures.createTenant('B');

        await TenantContext.run(a, async () => {
            const docA = await documentService.create({ ... });
            const docB = await documentService.findById(docA.id);  // should not exist in B
        });

        await TenantContext.run(b, async () => {
            // Should not see docA
            const docs = await documentService.findAll();
            expect(docs).toHaveLength(0);
        });
    });

    it('RLS enforces even with raw SQL', async () => {
        // ...
    });
});
```

### 12.3 Contract Tests

```typescript
describe('TenantRepository contract', () => {
    testRepositoryContract('sqlite', () => new SqliteTenantRepository());
    testRepositoryContract('postgres', () => new PostgresTenantRepository());
});
```

### 12.4 Performance Tests

```typescript
describe('Multi-tenant performance', () => {
    it('10K tenants × 1K docs = fast queries', async () => {
        // Seed
        await seed(10_000, 1000);
        // Measure
        const start = Date.now();
        await TenantContext.run(tenant, () => documentService.findAll({ limit: 100 }));
        expect(Date.now() - start).toBeLessThan(200);
    });
});
```

### 12.5 Chaos Tests

```typescript
describe('Tenant failure isolation', () => {
    it('one tenant cannot DoS others', async () => {
        // Tenant A: 10K RPS
        // Tenant B: normal load
        // Expect: B unaffected
    });
});
```

---

## 13. Monitoring & Observability

### 13.1 Tenant-Aware Metrics

```typescript
// All metrics labeled with tenant_id (hashed for cardinality)
metrics.increment('documents.created', { tenant: hash(tenantId) });
metrics.histogram('api.latency', latency, { tenant: hash(tenantId) });
```

### 13.2 Tenant Dashboard

```
┌─────────────────────────────────────────────┐
│  TENANT: Acme Corp                          │
├─────────────────────────────────────────────┤
│  Status: ACTIVE       Tier: BUSINESS        │
│  Residency: EU_CENTRAL                       │
├─────────────────────────────────────────────┤
│  Storage: 456 GB / 1 TB (45%)               │
│  Documents: 234K / 1M (23%)                 │
│  API calls today: 456K / 1M (45%)           │
│  Users: 67 / 100 (67%)                      │
├─────────────────────────────────────────────┤
│  Latency p95: 120ms                          │
│  Error rate: 0.02%                           │
│  Last backup: 2h ago                         │
│  Audit chain: VALID                          │
└─────────────────────────────────────────────┘
```

### 13.3 Alerts

| Alert               | Threshold | Action                |
| ------------------- | --------- | --------------------- |
| Quota > 80%         | Warn      | Email tenant admin    |
| Quota > 95%         | Critical  | Throttle + notify     |
| Quota > 100%        | Block     | Hard block + escalate |
| Error rate > 1%     | Warn      | Investigate           |
| Latency p95 > 500ms | Warn      | Investigate           |
| Audit broken        | Critical  | Immediate             |
| Backup failed       | Critical  | Immediate             |

### 13.4 Tenant Health Score

```typescript
export class TenantHealthScore {
    public compute(tenant: Tenant): number {
        let score = 100;
        score -= this.quotaPenalty(tenant);      // 0-30
        score -= this.errorPenalty(tenant);      // 0-20
        score -= this.usagePenalty(tenant);      // 0-30
        score -= this.paymentPenalty(tenant);    // 0-20
        return Math.max(0, score);
    }
}
```

---

## 14. ADR – Architecture Decision Records (част 02)

### ADR-009: Hybrid isolation model

**Status:** Accepted
**Decision:** Shared Schema by default + upgrade path to dedicated.
**Consequences:**

- + Cost efficient за SMB
- + Seamless upgrade за enterprise
- − Migration complexity

### ADR-010: AsyncLocalStorage за tenant context

**Status:** Accepted
**Decision:** AsyncLocalStorage като primary mechanism.
**Consequences:**

- + Automatic propagation
- + No manual threading
- − Node.js-specific

### ADR-011: RLS като defense-in-depth

**Status:** Accepted
**Decision:** PostgreSQL RLS + application-level filtering.
**Consequences:**

- + Double protection
- − Performance overhead
- − Complexity

### ADR-012: ULID за TenantId

**Status:** Accepted
**Rationale:** Sortable, URL-safe, no coordination.
**Consequences:**

- + Distributed generation
- + Time-sortable
- − 26 chars

### ADR-013: Token bucket за rate limiting

**Status:** Accepted
**Decision:** Redis-based token bucket.
**Consequences:**

- + Distributed
- + Smooth
- − Redis dependency

### ADR-014: Data residency per tenant

**Status:** Accepted
**Decision:** Residency configurable per tenant, EU default.
**Consequences:**

- + GDPR compliance
- + Regulatory ready
- − Multi-region infrastructure

### ADR-015: Usage-based billing

**Status:** Accepted
**Decision:** Metered usage + subscription hybrid.
**Consequences:**

- + Fair pricing
- + Scalable
- − Complexity

### ADR-016: Cross-tenant access изисква MFA + audit

**Status:** Accepted
**Decision:** Super admin access изисква MFA + reason + audit.
**Consequences:**

- + Strong security
- + Compliance ready
- − Friction за support

---

## 15. Заключение на част 02

Multi-tenancy е **критичната основа** за enterprise платформа. Тази част дефинира:

**Ключови решения:**

1. 5 isolation models с hybrid approach
2. AsyncLocalStorage за context propagation
3. RLS като defense-in-depth
4. Token bucket rate limiting
5. Data residency per tenant
6. Hybrid billing (subscription + usage)
7. Soft delete + 30-day retention
8. Cross-tenant access с MFA + audit
9. Zero-downtime tier migration
10. 8 ADR-та

**Какво следва:**

- Част 03: Security Architecture – Zero Trust
- Част 04: Data Architecture
- ...

---

## 16. Приложения

- **A.** Isolation model decision tree
- **B.** Tenant lifecycle state machine
- **C.** RLS policies (SQL)
- **D.** Quota enforcement algorithm
- **E.** Migration playbook
- **F.** Cross-tenant access policy
- **G.** ADR-009 до ADR-016

---

**Край на DOCFLOW Enterprise v4.2 – Част 02: Multi-Tenancy Architecture.**

---

## Следваща стъпка

**Кажи ми:**

1. **Одобряваш ли Multi-Tenancy архитектурата?**
2. **Кой аспект искаш да задълбоча?** (isolation, RLS, quotas, residency, billing, lifecycle, migration)
3. **Или преминаваме към Част 03: Security Architecture – Zero Trust?**

**Когато си готов, стартираме Част 03 в нов чат.**
