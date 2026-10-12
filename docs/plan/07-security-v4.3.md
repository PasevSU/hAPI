# DOCFLOW Enterprise v4.3

## ЧАТ 03: Security Architecture – Zero Trust

**Версия:** 4.3
**Част:** 03 от 20
**Дата:** 2026-10-12
**Статус:** Strategic Design – за одобрение
**Класификация:** Internal – Confidential
**Зависимости:** v4.0 (Master), v4.1 (Domain), v4.2 (Multi-Tenancy)

---

## 0. Резюме на част 03

Сигурността не е функция. Тя е **фундаментално свойство** на всяка система. В enterprise контекст, сигурността определя дали платформата може да обслужва regulated industries (финанси, здравеопазване, публичен сектор) или не.

**Философия:** **Zero Trust** – "Never trust, always verify." Никаква мрежа не е trusted. Никакъв потребител не е trusted по подразбиране. Всяка заявка се верифицира.

**Обхват:**

- Zero Trust принципи и архитектура
- IAM – Identity & Access Management (RBAC + ABAC)
- Authentication (OIDC, SAML, MFA, WebAuthn, FIDO2)
- Authorization (policy engine, OPA/Rego)
- Cryptography (algorithms, key management, HSM, Vault)
- Secrets management
- Network security (mTLS, service mesh, segmentation)
- Data encryption (at rest, in transit, in use)
- Threat model (STRIDE) с митигации
- Security operations (SIEM, SOAR, SOC)
- Incident response
- Penetration testing
- Vulnerability management
- Compliance mapping (ISO 27001, SOC 2, GDPR, eIDAS)

---

## 1. Zero Trust Architecture

### 1.1 Принципи

| #    | Принцип                       | Какво означава                                                                   |
| ---- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| ZT-1 | **Never trust, always verify** | Всяка заявка се верифицира, независимо от произход |
| ZT-2 | **Assume breach**              | Проектирай с assumption, че attacker вече е вътре                      |
| ZT-3 | **Least privilege**            | Минимални права, Just-In-Time elevation                                         |
| ZT-4 | **Micro-segmentation**         | Мрежата е разделена на малки зони                                 |
| ZT-5 | **Verify explicitly**          | Identity, device, location, поведение                                                |
| ZT-6 | **Continuous validation**      | Не само при login, а при всяка операция                             |
| ZT-7 | **Encrypt everything**         | At rest, in transit, in use                                                                   |
| ZT-8 | **Audit everything**           | Всяко действие се записва                                               |

### 1.2 Zero Trust Reference Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    UNTRUSTED ZONE                            │
│  Internet │ Partners │ Mobile │ Remote Workers               │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                    EDGE / PERIMETER                          │
│  WAF │ DDoS Protection │ CDN │ TLS Termination               │
│  Rate Limiting │ Bot Detection │ Geo-blocking                │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                 IDENTITY PLANE                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │  AuthN     │  │   AuthZ    │  │   Policy   │             │
│  │ OIDC/SAML  │  │ RBAC+ABAC  │  │    OPA     │             │
│  │ MFA/WebAuthn│  │            │  │            │             │
│  └────────────┘  └────────────┘  └────────────┘             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │  Session   │  │    JWT     │  │  API Keys  │             │
│  │ Management │  │  Issuance  │  │ Management │             │
│  └────────────┘  └────────────┘  └────────────┘             │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                    CONTROL PLANE                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │   API      │  │  Service   │  │   mTLS     │             │
│  │  Gateway   │  │   Mesh     │  │   Certs    │             │
│  └────────────┘  └────────────┘  └────────────┘             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │  Secrets   │  │   KMS      │  │    HSM     │             │
│  │  (Vault)   │  │            │  │            │             │
│  └────────────┘  └────────────┘  └────────────┘             │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                   DATA PLANE (Segmented)                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │  Document  │  │  Identity  │  │Verification│             │
│  │  Services  │  │  Services  │  │  Services  │             │
│  └────────────┘  └────────────┘  └────────────┘             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │  Template  │  │   Audit    │  │  Workflow  │             │
│  │  Services  │  │  Services  │  │  Services  │             │
│  └────────────┘  └────────────┘  └────────────┘             │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                 OBSERVABILITY PLANE                          │
│  SIEM │ SOAR │ Metrics │ Logs │ Traces │ Audit               │
└──────────────────────────────────────────────────────────────┘
```

### 1.3 Trust Boundaries

| Boundary              | Trust Level | Controls                  |
| --------------------- | ----------- | ------------------------- |
| Internet → Edge      | Untrusted   | WAF, DDoS, TLS            |
| Edge → Identity      | Low         | Rate limit, bot detection |
| Identity → Control   | Medium      | mTLS, JWT validation      |
| Control → Data       | High        | mTLS, service mesh        |
| Data → Data          | High        | mTLS, RBAC                |
| Data → Observability | High        | mTLS, append-only         |

**Правило:** Всеки преход между зони изисква **explicit verification**.

---

## 2. Identity & Access Management (IAM)

### 2.1 IAM Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    IDENTITY PROVIDERS                        │
│  Local │ OIDC (Okta, Azure AD, Google) │ SAML (ADFS, Shibboleth)│
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                    IDENTITY BROKER                           │
│  - Federated authentication                                  │
│  - Identity mapping                                          │
│  - Attribute enrichment                                      │
│  - Session management                                        │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                    AUTHORIZATION ENGINE                      │
│  - RBAC (roles)                                              │
│  - ABAC (attributes)                                         │
│  - ReBAC (relationships)                                     │
│  - Policy evaluation (OPA)                                   │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                    ENFORCEMENT POINTS                        │
│  API Gateway │ Service Mesh │ Application │ Database (RLS)   │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Identity Types

| Тип                      | Описание                      | Authentication           |
| --------------------------- | ------------------------------------- | ------------------------ |
| **Human User**        | Служител, admin               | OIDC/SAML + MFA          |
| **Service Account**   | Вътрешна услуга         | mTLS + JWT               |
| **API Client**        | Партньор, integration         | API key + HMAC           |
| **Device**            | IoT, printer                          | Certificate              |
| **External Verifier** | Публичен потребител | Anonymous (rate-limited) |

### 2.3 User Model

```typescript
// domain/identity/aggregates/user.ts
export class User extends AggregateRoot<UserId> {
    private readonly id: UserId;
    private readonly tenantId: TenantId;
    private email: Email;
    private personId: PersonId | null;
    private roles: Set<Role>;
    private permissions: Set<Permission>;   // derived from roles + ABAC
    private attributes: UserAttributes;     // for ABAC
    private status: UserStatus;
    private mfaConfig: MfaConfig;
    private sessions: Session[];            // active sessions
    private readonly createdAt: Timestamp;
    private lastLoginAt: Timestamp | null;

    public hasRole(role: Role): boolean { return this.roles.has(role); }
    public hasPermission(perm: Permission): boolean {
        return this.permissions.has(perm);
    }

    public grantRole(role: Role, by: UserId): void {
        if (this.roles.has(role)) return;
        this.roles.add(role);
        this.recomputePermissions();
        this.addDomainEvent(new UserRoleGranted(this.id, role, by));
    }

    public revokeRole(role: Role, by: UserId): void {
        if (!this.roles.has(role)) return;
        // Invariant: не може да остане без Admin
        if (role === Role.ADMIN && this.countAdminsInTenant() === 1) {
            throw new LastAdminError(this.id);
        }
        this.roles.delete(role);
        this.recomputePermissions();
        this.addDomainEvent(new UserRoleRevoked(this.id, role, by));
    }

    public enableMfa(config: MfaConfig, by: UserId): void {
        this.mfaConfig = config;
        this.addDomainEvent(new UserMfaEnabled(this.id, by));
    }

    public suspend(reason: string, by: UserId): void {
        this.status = UserStatus.SUSPENDED;
        this.invalidateAllSessions();
        this.addDomainEvent(new UserSuspended(this.id, reason, by));
    }
}
```

### 2.4 User Attributes (ABAC)

```typescript
export interface UserAttributes {
    department: string;
    clearanceLevel: ClearanceLevel;  // PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
    location: string;
    employmentType: 'employee' | 'contractor' | 'partner';
    costCenter: string;
    managerId: UserId | null;
}

export enum ClearanceLevel {
    PUBLIC = 0,
    INTERNAL = 1,
    CONFIDENTIAL = 2,
    RESTRICTED = 3
}
```

---

## 3. Authentication

### 3.1 Authentication Methods

| Method                   | Use Case           | Security  |
| ------------------------ | ------------------ | --------- |
| **Password + MFA** | Standard users     | High      |
| **WebAuthn/FIDO2** | High-security      | Very High |
| **OIDC**           | SSO integration    | High      |
| **SAML 2.0**       | Enterprise SSO     | High      |
| **API Key + HMAC** | Service-to-service | High      |
| **mTLS**           | Internal services  | Very High |
| **Certificate**    | Devices            | High      |
| **Magic Link**     | Low-friction       | Medium    |

### 3.2 Password Policy

```typescript
export class PasswordPolicy extends ValueObject<{
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireDigit: boolean;
    requireSpecial: boolean;
    maxAgeDays: number;
    preventReuse: number;
    lockoutAttempts: number;
    lockoutDurationMinutes: number;
}> {
    public static default(): PasswordPolicy {
        return new PasswordPolicy({
            minLength: 12,
            requireUppercase: true,
            requireLowercase: true,
            requireDigit: true,
            requireSpecial: true,
            maxAgeDays: 90,
            preventReuse: 5,
            lockoutAttempts: 5,
            lockoutDurationMinutes: 15
        });
    }

    public static strict(): PasswordPolicy {
        return new PasswordPolicy({
            minLength: 16,
            requireUppercase: true,
            requireLowercase: true,
            requireDigit: true,
            requireSpecial: true,
            maxAgeDays: 60,
            preventReuse: 12,
            lockoutAttempts: 3,
            lockoutDurationMinutes: 30
        });
    }

    public validate(password: string): ValidationResult { /* ... */ }
}
```

### 3.3 Password Hashing – Argon2id

```typescript
// infrastructure/crypto/password-hasher.ts
import { hash, verify, Algorithm } from '@node-rs/argon2';

export class PasswordHasher {
    private readonly options = {
        algorithm: Algorithm.Argon2id,
        memoryCost: 19456,       // 19 MB
        timeCost: 2,             // iterations
        parallelism: 1,
        outputLen: 32
    };

    public async hash(password: string): Promise<HashedPassword> {
        const hashValue = await hash(password, this.options);
        return HashedPassword.fromArgon2(hashValue);
    }

    public async verify(password: string, hashed: HashedPassword): Promise<boolean> {
        try {
            return await verify(hashed.value, password, this.options);
        } catch {
            return false;
        }
    }
}
```

**Защо Argon2id:**

- Winner на Password Hashing Competition (2015)
- Memory-hard (устойчив на GPU/ASIC)
- Поддържан от OWASP, NIST

### 3.4 MFA – Multi-Factor Authentication

```typescript
export interface MfaConfig {
    enabled: boolean;
    methods: MfaMethod[];
    primaryMethod: MfaMethod;
    backupCodes: BackupCode[];
    lastUsedAt: Timestamp | null;
}

export enum MfaMethod {
    TOTP = 'totp',           // Google Authenticator, Authy
    WEBAUTHN = 'webauthn',   // YubiKey, Touch ID
    SMS = 'sms',             // deprecated, last resort
    EMAIL = 'email',         // low security
    PUSH = 'push'            // Duo, Okta Verify
}
```

**MFA Policy per Tier:**

| Tier       | MFA Required           | Methods                      |
| ---------- | ---------------------- | ---------------------------- |
| Community  | Optional               | TOTP                         |
| Business   | Optional (recommended) | TOTP, WebAuthn               |
| Enterprise | Required               | TOTP, WebAuthn, Push         |
| Regulated  | Required + Hardware    | WebAuthn (hardware), PIV/CAC |

### 3.5 WebAuthn / FIDO2

```typescript
// infrastructure/auth/webauthn-service.ts
export class WebAuthnService {
    public async registerBegin(
        user: User,
        options: RegistrationOptions
    ): Promise<PublicKeyCredentialCreationOptions> {
        return {
            challenge: generateChallenge(),
            rp: {
                name: 'DOCFLOW Enterprise',
                id: this.config.rpId
            },
            user: {
                id: Buffer.from(user.id.value),
                name: user.email.value,
                displayName: user.displayName
            },
            pubKeyCredParams: [
                { type: 'public-key', alg: -7 },    // ES256
                { type: 'public-key', alg: -257 }   // RS256
            ],
            authenticatorSelection: {
                authenticatorAttachment: 'platform',  // or 'cross-platform'
                residentKey: 'preferred',
                userVerification: 'required'
            },
            timeout: 60000,
            attestation: 'direct'
        };
    }

    public async registerComplete(
        user: User,
        credential: RegistrationResponseJSON
    ): Promise<WebAuthnCredential> {
        const verification = await this.verifyRegistration(credential);
        if (!verification.verified) {
            throw new WebAuthnRegistrationFailedError();
        }
        return WebAuthnCredential.from(verification.registrationInfo);
    }
}
```

### 3.6 Session Management

```typescript
export class Session extends Entity<SessionId> {
    private readonly id: SessionId;
    private readonly userId: UserId;
    private readonly tenantId: TenantId;
    private readonly createdAt: Timestamp;
    private expiresAt: Timestamp;
    private lastActivityAt: Timestamp;
    private readonly device: DeviceInfo;
    private readonly ip: IpAddress;
    private status: SessionStatus;  // ACTIVE, EXPIRED, REVOKED

    public isActive(now: Timestamp): boolean {
        return this.status === SessionStatus.ACTIVE
            && this.expiresAt.isAfter(now);
    }

    public refresh(ttlMinutes: number): void {
        this.expiresAt = Timestamp.now().plusMinutes(ttlMinutes);
        this.lastActivityAt = Timestamp.now();
    }

    public revoke(reason: string): void {
        this.status = SessionStatus.REVOKED;
        this.addDomainEvent(new SessionRevoked(this.id, reason));
    }
}
```

**Session policy per tier:**

| Tier       | TTL     | Idle Timeout | Concurrent |
| ---------- | ------- | ------------ | ---------- |
| Community  | 30 days | 7 days       | 3          |
| Business   | 8 hours | 30 min       | 5          |
| Enterprise | 4 hours | 15 min       | 3          |
| Regulated  | 2 hours | 10 min       | 1          |

### 3.7 Token Management

```typescript
// Access token (short-lived)
interface AccessToken {
    sub: string;           // userId
    tid: string;           // tenantId
    roles: string[];
    permissions: string[];
    sessionId: string;
    iat: number;
    exp: number;           // 15 min
    jti: string;
    iss: string;
    aud: string;
    scope: string;
}

// Refresh token (long-lived, single use)
interface RefreshToken {
    sub: string;
    tid: string;
    sessionId: string;
    iat: number;
    exp: number;           // 30 days
    jti: string;
    family: string;        // rotation family
}
```

**Token Rotation:**

```
Login → access (15min) + refresh (30d, family=F1)
    ↓
Expiry → refresh(F1) → new access + new refresh(F1, rotated)
    ↓
Reuse detected → revoke entire family F1
```

---

## 4. Authorization

### 4.1 RBAC – Role-Based Access Control

**Roles:**

| Role                 | Scope    | Permissions                       |
| -------------------- | -------- | --------------------------------- |
| `SuperAdmin`       | Platform | Всичко, cross-tenant        |
| `TenantAdmin`      | Tenant   | Пълен достъп в tenant |
| `GroupManager`     | Group    | Управление на group   |
| `Editor`           | Group    | CRUD на документи      |
| `Viewer`           | Group    | Read-only                         |
| `Auditor`          | Tenant   | Read + audit access               |
| `APIClient`        | Tenant   | Programmatic                      |
| `ExternalVerifier` | Public   | Verify only                       |

```typescript
export enum Role {
    SUPER_ADMIN = 'super_admin',
    TENANT_ADMIN = 'tenant_admin',
    GROUP_MANAGER = 'group_manager',
    EDITOR = 'editor',
    VIEWER = 'viewer',
    AUDITOR = 'auditor',
    API_CLIENT = 'api_client',
    EXTERNAL_VERIFIER = 'external_verifier'
}

export enum Permission {
    // Document
    DOCUMENT_CREATE = 'document:create',
    DOCUMENT_READ = 'document:read',
    DOCUMENT_UPDATE = 'document:update',
    DOCUMENT_DELETE = 'document:delete',
    DOCUMENT_ARCHIVE = 'document:archive',
    DOCUMENT_LINK = 'document:link',

    // Template
    TEMPLATE_CREATE = 'template:create',
    TEMPLATE_READ = 'template:read',
    TEMPLATE_PUBLISH = 'template:publish',

    // Verification
    VERIFY_READ = 'verify:read',
    VERIFY_REVOKE = 'verify:revoke',

    // User
    USER_CREATE = 'user:create',
    USER_READ = 'user:read',
    USER_UPDATE = 'user:update',
    USER_DELETE = 'user:delete',

    // Tenant
    TENANT_CONFIG = 'tenant:config',
    TENANT_BILLING = 'tenant:billing',

    // Audit
    AUDIT_READ = 'audit:read',
    AUDIT_EXPORT = 'audit:export',

    // Admin
    ADMIN_ALL = '*'
}
```

**Role → Permission mapping:**

```typescript
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
    [Role.SUPER_ADMIN]: [Permission.ADMIN_ALL],
    [Role.TENANT_ADMIN]: [
        Permission.DOCUMENT_CREATE, Permission.DOCUMENT_READ,
        Permission.DOCUMENT_UPDATE, Permission.DOCUMENT_DELETE,
        Permission.DOCUMENT_ARCHIVE, Permission.DOCUMENT_LINK,
        Permission.TEMPLATE_CREATE, Permission.TEMPLATE_READ,
        Permission.TEMPLATE_PUBLISH,
        Permission.USER_CREATE, Permission.USER_READ,
        Permission.USER_UPDATE, Permission.USER_DELETE,
        Permission.TENANT_CONFIG, Permission.TENANT_BILLING,
        Permission.AUDIT_READ, Permission.AUDIT_EXPORT
    ],
    [Role.GROUP_MANAGER]: [
        Permission.DOCUMENT_CREATE, Permission.DOCUMENT_READ,
        Permission.DOCUMENT_UPDATE, Permission.DOCUMENT_ARCHIVE,
        Permission.DOCUMENT_LINK,
        Permission.TEMPLATE_READ,
        Permission.USER_READ
    ],
    [Role.EDITOR]: [
        Permission.DOCUMENT_CREATE, Permission.DOCUMENT_READ,
        Permission.DOCUMENT_UPDATE, Permission.DOCUMENT_LINK,
        Permission.TEMPLATE_READ
    ],
    [Role.VIEWER]: [
        Permission.DOCUMENT_READ,
        Permission.TEMPLATE_READ
    ],
    [Role.AUDITOR]: [
        Permission.DOCUMENT_READ,
        Permission.AUDIT_READ, Permission.AUDIT_EXPORT
    ],
    [Role.API_CLIENT]: [
        Permission.DOCUMENT_CREATE, Permission.DOCUMENT_READ,
        Permission.VERIFY_READ
    ],
    [Role.EXTERNAL_VERIFIER]: [
        Permission.VERIFY_READ
    ]
};
```

### 4.2 ABAC – Attribute-Based Access Control

**Защо ABAC?** RBAC не покрива всички случаи:

- "Editor може да edit само документи в своя department"
- "Auditor може да read само документи с classification ≤ CONFIDENTIAL"
- "Manager може да approve само до $10,000"

```typescript
export interface AccessRequest {
    subject: {
        userId: UserId;
        roles: Role[];
        attributes: UserAttributes;
    };
    resource: {
        type: string;
        id: string;
        tenantId: TenantId;
        ownerId?: UserId;
        attributes: ResourceAttributes;
    };
    action: Permission;
    environment: {
        time: Timestamp;
        ip: IpAddress;
        location: string;
        device: DeviceInfo;
    };
}
```

### 4.3 Policy Engine – OPA / Rego

```rego
# policies/document.rego
package docflow.document

import future.keywords.if
import future.keywords.in

default allow := false

# Rule 1: Tenant admin може всичко в tenant
allow if {
    "tenant_admin" in input.subject.roles
    input.subject.attributes.tenantId == input.resource.tenantId
}

# Rule 2: Editor може да edit само в своя group
allow if {
    "editor" in input.subject.roles
    input.action == "document:update"
    input.resource.tenantId == input.subject.attributes.tenantId
    input.resource.groupId == input.subject.attributes.groupId
}

# Rule 3: Auditor може да read само до CONFIDENTIAL
allow if {
    "auditor" in input.subject.roles
    input.action == "document:read"
    clearance_gte(input.subject.attributes.clearanceLevel, input.resource.attributes.classification)
}

# Rule 4: Manager може да approve до $10K
allow if {
    "manager" in input.subject.roles
    input.action == "workflow:approve"
    input.resource.attributes.amount <= 10000
}

# Rule 5: Всички могат да read PUBLIC
allow if {
    input.action == "document:read"
    input.resource.attributes.classification == "public"
}

# Helper
clearance_gte(user_clearance, resource_classification) if {
    levels := {"public": 0, "internal": 1, "confidential": 2, "restricted": 3}
    levels[user_clearance] >= levels[resource_classification]
}
```

### 4.4 Policy Enforcement Points

```typescript
// infrastructure/authz/authorization-service.ts
export class AuthorizationService {
    constructor(
        private readonly opa: OpaClient,
        private readonly audit: AuditService
    ) {}

    public async authorize(request: AccessRequest): Promise<AuthorizationDecision> {
        // 1. Fast path: RBAC check
        const rbacResult = this.checkRbac(request);
        if (!rbacResult.allowed) {
            await this.audit.recordAuthorizationDenied(request, rbacResult.reason);
            return rbacResult;
        }

        // 2. ABAC check via OPA
        const opaResult = await this.opa.evaluate('docflow/allow', {
            input: request
        });

        const decision: AuthorizationDecision = {
            allowed: opaResult.result === true,
            reason: opaResult.result ? 'policy_allowed' : 'policy_denied',
            evaluatedPolicies: opaResult.metrics?.policies
        };

        // 3. Audit
        await this.audit.recordAuthorization(request, decision);

        return decision;
    }

    private checkRbac(request: AccessRequest): AuthorizationDecision {
        const permissions = request.subject.roles.flatMap(
            role => ROLE_PERMISSIONS[role] ?? []
        );
        if (permissions.includes(Permission.ADMIN_ALL)) {
            return { allowed: true, reason: 'super_admin' };
        }
        if (!permissions.includes(request.action)) {
            return { allowed: false, reason: 'rbac_denied' };
        }
        return { allowed: true, reason: 'rbac_allowed' };
    }
}
```

### 4.5 Enforcement Points

| Point                 | What it enforces                     |
| --------------------- | ------------------------------------ |
| **API Gateway** | AuthN, rate limit, tenant resolution |
| **Application** | RBAC + ABAC per operation            |
| **Domain**      | Invariants, business rules           |
| **Repository**  | Tenant filter                        |
| **Database**    | RLS                                  |
| **Storage**     | Signed URLs, per-object ACL          |

**Правило:** Defense-in-depth – всяко ниво проверява.

---

## 5. Cryptography

### 5.1 Algorithm Selection

| Use Case              | Algorithm              | Key Size | Notes               |
| --------------------- | ---------------------- | -------- | ------------------- |
| Password hashing      | Argon2id               | N/A      | Memory-hard         |
| Symmetric encryption  | AES-256-GCM            | 256      | AEAD                |
| Asymmetric encryption | RSA-4096 or ECIES      | 4096/256 | Hybrid              |
| Digital signature     | ECDSA P-384 or Ed25519 | 384/256  | FIPS 186-4          |
| Content hashing       | SHA-256 / SHA-3        | 256      | Collision-resistant |
| HMAC                  | HMAC-SHA256            | 256      | Authentication      |
| Key derivation        | HKDF-SHA256            | 256      | KDF                 |
| TLS                   | TLS 1.3                | N/A      | AEAD ciphers only   |
| JWT signing           | RS256 or ES256         | 2048/256 | Asymmetric          |
| Random                | CSPRNG                 | N/A      | crypto.randomBytes  |

### 5.2 Key Management

```
┌─────────────────────────────────────────────────────────────┐
│                    KEY HIERARCHY                            │
├─────────────────────────────────────────────────────────────┤
│  Root of Trust (HSM)                                        │
│  ├─ Master Key (KEK)                                        │
│  │   ├─ Data Encryption Keys (DEK) per tenant               │
│  │   │   ├─ Document content keys                           │
│  │   │   ├─ Database encryption keys                        │
│  │   │   └─ Backup encryption keys                          │
│  │   ├─ Signing Keys                                        │
│  │   │   ├─ Document signing (per tenant)                   │
│  │   │   ├─ JWT signing                                     │
│  │   │   └─ Audit anchoring                                 │
│  │   └─ Transport Keys                                      │
│  │       ├─ mTLS certificates                               │
│  │       └─ Session keys                                    │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 HSM Integration

```typescript
// infrastructure/crypto/hsm-client.ts
export interface HsmClient {
    generateKey(spec: KeySpec): Promise<KeyHandle>;
    sign(handle: KeyHandle, data: Buffer): Promise<Buffer>;
    verify(handle: KeyHandle, data: Buffer, signature: Buffer): Promise<boolean>;
    encrypt(handle: KeyHandle, plaintext: Buffer): Promise<Buffer>;
    decrypt(handle: KeyHandle, ciphertext: Buffer): Promise<Buffer>;
    delete(handle: KeyHandle): Promise<void>;
}

// PKCS#11 implementation
export class Pkcs11HsmClient implements HsmClient {
    constructor(private readonly session: Pkcs11Session) {}

    public async sign(handle: KeyHandle, data: Buffer): Promise<Buffer> {
        const mechanism = this.session.CKM_ECDSA;
        const digest = crypto.createHash('sha384').update(data).digest();
        return this.session.sign(handle.id, digest, mechanism);
    }
}
```

**HSM Options:**

- **Cloud:** AWS CloudHSM, Azure Dedicated HSM, Google Cloud HSM
- **On-prem:** Thales Luna, Utimaco, Entrust nShield
- **Software:** SoftHSM (dev only), HashiCorp Vault

### 5.4 Vault Integration

```typescript
// infrastructure/secrets/vault-client.ts
export class VaultClient {
    constructor(private readonly config: VaultConfig) {}

    public async getSecret(path: string): Promise<Secret> {
        const response = await fetch(`${this.config.url}/v1/${path}`, {
            headers: { 'X-Vault-Token': this.config.token }
        });
        return response.json();
    }

    public async transitEncrypt(
        keyName: string,
        plaintext: Buffer
    ): Promise<string> {
        const response = await fetch(
            `${this.config.url}/v1/transit/encrypt/${keyName}`,
            {
                method: 'POST',
                headers: { 'X-Vault-Token': this.config.token },
                body: JSON.stringify({
                    plaintext: plaintext.toString('base64')
                })
            }
        );
        const data = await response.json();
        return data.data.ciphertext;  // vault:v1:...
    }

    public async transitDecrypt(
        keyName: string,
        ciphertext: string
    ): Promise<Buffer> {
        const response = await fetch(
            `${this.config.url}/v1/transit/decrypt/${keyName}`,
            {
                method: 'POST',
                headers: { 'X-Vault-Token': this.config.token },
                body: JSON.stringify({ ciphertext })
            }
        );
        const data = await response.json();
        return Buffer.from(data.data.plaintext, 'base64');
    }
}
```

### 5.5 Envelope Encryption

```
┌──────────────────────────────────────────────────────────────┐
│  Envelope Encryption Flow                                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Generate DEK (Data Encryption Key)                       │
│     DEK = random(256 bits)                                   │
│                                                              │
│  2. Encrypt data with DEK                                    │
│     ciphertext = AES-256-GCM(data, DEK)                      │
│                                                              │
│  3. Encrypt DEK with KEK (Key Encryption Key)                │
│     encryptedDEK = HSM.encrypt(DEK, KEK)                     │
│                                                              │
│  4. Store:                                                   │
│     { ciphertext, encryptedDEK, iv, tag, kekId }             │
│                                                              │
│  5. Decrypt:                                                 │
│     DEK = HSM.decrypt(encryptedDEK, KEK)                     │
│     data = AES-256-GCM.decrypt(ciphertext, DEK)              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 5.6 Key Rotation

```typescript
export class KeyRotationService {
    /**
     * Rotate key without downtime.
     * 1. Generate new key (version N+1)
     * 2. New encryptions use N+1
     * 3. Old data still decryptable with N
     * 4. Background re-encryption
     * 5. Retire N when all data re-encrypted
     */
    public async rotate(keyId: KeyId): Promise<RotationResult> {
        const current = await this.keyStore.get(keyId);
        const newKey = await this.hsm.generateKey(current.spec);

        await this.keyStore.addVersion(keyId, newKey);

        // Schedule background re-encryption
        await this.scheduleReEncryption(keyId, current.version, newKey.version);

        return { oldVersion: current.version, newVersion: newKey.version };
    }
}
```

**Rotation policy:**

- DEK: every 90 days or 1M operations
- KEK: every 365 days
- Signing keys: every 730 days
- TLS certs: every 90 days (Let's Encrypt) or 365 (enterprise)

---

## 6. Secrets Management

### 6.1 Secrets Classification

| Type                          | Examples               | Storage       |
| ----------------------------- | ---------------------- | ------------- |
| **Application secrets** | DB passwords, API keys | Vault         |
| **User credentials**    | Passwords (hashed)     | DB (Argon2id) |
| **Tokens**              | JWT signing keys       | HSM           |
| **Certificates**        | TLS, mTLS              | Vault PKI     |
| **Encryption keys**     | DEK, KEK               | HSM           |
| **External secrets**    | HA token, S3 keys      | Vault         |

### 6.2 Secrets Lifecycle

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ Generate │──►│  Store   │──►│  Access  │──►│  Rotate  │
│          │   │          │   │          │   │          │
│ CSPRNG   │   │  Vault   │   │  Runtime │   │  90d     │
│ or HSM   │   │  or HSM  │   │  (temp)  │   │          │
└──────────┘   └──────────┘   └──────────┘   └──────────┘
                                                    │
                                                    ▼
                                              ┌──────────┐
                                              │  Revoke  │
                                              └──────────┘
```

### 6.3 Access Patterns

```typescript
// ❌ NEVER: hard-coded
const dbPassword = 'super-secret-password';

// ❌ NEVER: in environment variables (visible in /proc)
process.env.DB_PASSWORD;

// ✅ OK: from Vault at startup
const dbPassword = await vault.getSecret('database/creds/app');

// ✅ BEST: dynamic credentials (Vault DB secrets engine)
const dbCreds = await vault.getDynamicDbCreds('database/creds/app');
// { username, password, lease_id, lease_duration }
```

### 6.4 Kubernetes Secrets

```yaml
# External Secrets Operator
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: docflow-secrets
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: SecretStore
  target:
    name: docflow-secrets
  data:
    - secretKey: db-password
      remoteRef:
        key: database/creds/docflow
        property: password
    - secretKey: jwt-signing-key
      remoteRef:
        key: transit/keys/jwt-signing
```

### 6.5 Audit of Secret Access

```typescript
// Every secret access is logged
{
    "timestamp": "2026-10-12T14:30:00Z",
    "actor": "service:document-service",
    "action": "secret.read",
    "secret": "database/creds/app",
    "ip": "10.0.1.42",
    "result": "success",
    "lease_id": "database/creds/app/abc123"
}
```

---

## 7. Network Security

### 7.1 Network Segmentation

```
┌──────────────────────────────────────────────────────────────┐
│                    DMZ (Internet-facing)                     │
│  Load Balancer │ WAF │ CDN │ DDoS Protection                 │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                    APPLICATION TIER                          │
│  API Gateway │ Public Portal │ Verify Service                │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                    SERVICE TIER (mTLS)                       │
│  Document │ Identity │ Verification │ Template │ Workflow    │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                    DATA TIER                                 │
│  PostgreSQL │ Redis │ S3 │ Kafka │ Elasticsearch             │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                    MANAGEMENT TIER                           │
│  Vault │ HSM │ Monitoring │ Backup │ Bastion                 │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 mTLS (Mutual TLS)

```typescript
// infrastructure/network/mtls-config.ts
export const mtlsConfig = {
    // Server
    server: {
        cert: loadCert('/certs/server.crt'),
        key: loadKey('/certs/server.key'),
        ca: loadCert('/certs/ca.crt'),
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.3'
    },
    // Client
    client: {
        cert: loadCert('/certs/client.crt'),
        key: loadKey('/certs/client.key'),
        ca: loadCert('/certs/ca.crt'),
        checkServerIdentity: (host, cert) => {
            // Verify SPIFFE ID
            return verifySpiffeId(cert, host);
        }
    }
};
```

### 7.3 Service Mesh – Istio

```yaml
# PeerAuthentication: enforce mTLS
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: docflow
spec:
  mtls:
    mode: STRICT
---
# AuthorizationPolicy: least privilege
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: document-service
  namespace: docflow
spec:
  selector:
    matchLabels:
      app: document-service
  rules:
    - from:
        - source:
            principals: ["cluster.local/ns/docflow/sa/api-gateway"]
      to:
        - operation:
            methods: ["GET", "POST", "PUT", "DELETE"]
            paths: ["/api/v1/documents/*"]
    - from:
        - source:
            principals: ["cluster.local/ns/docflow/sa/audit-service"]
      to:
        - operation:
            methods: ["GET"]
            paths: ["/internal/audit/*"]
```

### 7.4 Network Policies

```yaml
# Kubernetes NetworkPolicy
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: document-service
spec:
  podSelector:
    matchLabels:
      app: document-service
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: api-gateway
      ports:
        - port: 8080
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - port: 5432
    - to:
        - podSelector:
            matchLabels:
              app: vault
      ports:
        - port: 8200
    - to:
        - namespaceSelector:
            matchLabels:
              name: kube-system
      ports:
        - port: 53
          protocol: UDP
```

### 7.5 WAF Rules

```yaml
waf:
  rules:
    - id: SQL_INJECTION
      action: block
      severity: critical
    - id: XSS
      action: block
      severity: high
    - id: PATH_TRAVERSAL
      action: block
      severity: high
    - id: RATE_LIMIT
      action: challenge
      threshold: 1000/min
    - id: GEO_BLOCK
      action: block
      countries: [KP, IR, SY]
    - id: BOT_DETECTION
      action: challenge
      sensitivity: medium
```

---

## 8. Data Security

### 8.1 Encryption at Rest

| Data       | Encryption           | Key            |
| ---------- | -------------------- | -------------- |
| PostgreSQL | AES-256 (TDE)        | KMS            |
| S3 objects | AES-256-GCM          | Per-object DEK |
| Redis      | AES-256              | KMS            |
| Backups    | AES-256-GCM          | Separate key   |
| Logs       | AES-256              | KMS            |
| Audit      | AES-256 + hash chain | HSM            |

### 8.2 Encryption in Transit

| Channel            | Protocol | Cipher      |
| ------------------ | -------- | ----------- |
| Client → API      | TLS 1.3  | AES-256-GCM |
| Service → Service | mTLS 1.3 | AES-256-GCM |
| Service → DB      | TLS 1.3  | AES-256-GCM |
| Service → S3      | TLS 1.3  | AES-256-GCM |
| Service → HSM     | PKCS#11  | N/A         |

**Правило:** TLS 1.2 е минимум, 1.3 се предпочита. TLS 1.0/1.1 са забранени.

### 8.3 Encryption in Use

- **Confidential Computing** (Intel SGX, AMD SEV) – за най-чувствителни workloads
- **Homomorphic encryption** – изследователски
- **Secure enclaves** – HSM, TPM

### 8.4 Data Classification

```typescript
export enum DataClassification {
    PUBLIC = 'public',           // Marketing, docs
    INTERNAL = 'internal',       // Employee info
    CONFIDENTIAL = 'confidential', // Customer data
    RESTRICTED = 'restricted',   // Secrets, PII
    REGULATED = 'regulated'      // PCI, PHI, GDPR-sensitive
}
```

**Controls per classification:**

| Classification | Encryption                   | Access       | Retention      | Audit         |
| -------------- | ---------------------------- | ------------ | -------------- | ------------- |
| PUBLIC         | TLS                          | Anyone       | Indefinite     | Basic         |
| INTERNAL       | TLS + at rest                | Employees    | 7 years        | Standard      |
| CONFIDENTIAL   | TLS + at rest + field        | Need-to-know | 5 years        | Enhanced      |
| RESTRICTED     | TLS + at rest + field + HSM  | Named        | 3 years        | Full          |
| REGULATED      | All + confidential computing | Named + MFA  | Per regulation | Full + anchor |

### 8.5 PII Handling

```typescript
export class PiiMasker {
    /**
     * Mask PII in logs, errors, audit.
     */
    public mask(value: string, type: PiiType): string {
        switch (type) {
            case PiiType.EMAIL:
                return this.maskEmail(value);
            case PiiType.PHONE:
                return this.maskPhone(value);
            case PiiType.IBAN:
                return this.maskIban(value);
            case PiiType.EGN:
                return this.maskEgn(value);
            case PiiType.CREDIT_CARD:
                return this.maskCard(value);
            default:
                return '***';
        }
    }

    private maskEmail(email: string): string {
        const [local, domain] = email.split('@');
        const maskedLocal = local[0] + '***' + local[local.length - 1];
        return `${maskedLocal}@${domain}`;
    }

    private maskCard(card: string): string {
        return '**** **** **** ' + card.slice(-4);
    }
}
```

### 8.6 Data Loss Prevention (DLP)

```typescript
export class DlpScanner {
    private readonly patterns = {
        iban: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
        egn: /\b\d{10}\b/g,
        creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
        passport: /\b[A-Z]{2}\d{7}\b/g,
        phone: /\b\+?\d{10,15}\b/g
    };

    public scan(content: string): DlpFinding[] {
        const findings: DlpFinding[] = [];
        for (const [type, pattern] of Object.entries(this.patterns)) {
            const matches = content.matchAll(pattern);
            for (const match of matches) {
                findings.push({
                    type,
                    value: match[0],
                    position: match.index
                });
            }
        }
        return findings;
    }
}
```

---

## 9. Threat Model (STRIDE)

### 9.1 STRIDE Analysis

| Threat                           | Description          | Mitigation              |
| -------------------------------- | -------------------- | ----------------------- |
| **S**poofing               | Impersonation        | MFA, mTLS, OIDC         |
| **T**ampering              | Data modification    | Hash chains, signatures |
| **R**epudiation            | Deny action          | Audit log, signatures   |
| **I**nformation disclosure | Data leak            | Encryption, RBAC, RLS   |
| **D**enial of service      | Unavailability       | Rate limit, WAF, CDN    |
| **E**levation of privilege | Privilege escalation | Least privilege, ABAC   |

### 9.2 Threat Scenarios

#### T-01: Cross-tenant data access

**Attack:** Attacker manipulates tenant_id в заявка.
**Impact:** Data breach.
**Mitigation:**

- TenantContext from JWT only
- RLS at DB level
- Repository-level tenant filter
- Audit anomaly detection

#### T-02: QR forgery

**Attack:** Attacker creates fake QR token.
**Impact:** Fraud, reputation.
**Mitigation:**

- Signed tokens (HMAC)
- Token entropy ≥ 128 bits
- Revocation list
- Hash verification на файл

#### T-03: Document tampering

**Attack:** Attacker modifies PDF след publish.
**Impact:** Legal, compliance.
**Mitigation:**

- SHA-256 hash of content
- Digital signature (PKCS#7)
- Audit chain
- External anchor

#### T-04: Credential stuffing

**Attack:** Bot uses leaked credentials.
**Impact:** Account takeover.
**Mitigation:**

- Rate limiting
- MFA required
- Breach password check
- Anomaly detection (geo, device, time)

#### T-05: API abuse

**Attack:** Bot floods API.
**Impact:** DoS, cost.
**Mitigation:**

- Rate limiting (token bucket)
- WAF
- Bot detection
- CAPTCHA on abuse

#### T-06: Insider threat

**Attack:** Malicious insider.
**Impact:** Data exfiltration.
**Mitigation:**

- Least privilege
- Separation of duties
- Audit + anomaly detection
- DLP
- Session recording (privileged)

#### T-07: Supply chain attack

**Attack:** Compromised dependency.
**Impact:** Backdoor.
**Mitigation:**

- SBOM
- Dependency scanning (Snyk, Dependabot)
- Signed commits
- Pinned versions
- Private registry

#### T-08: Man-in-the-middle

**Attack:** Intercept traffic.
**Impact:** Credential theft.
**Mitigation:**

- TLS 1.3
- HSTS
- Certificate pinning
- mTLS internal

### 9.3 Attack Trees

```
Goal: Access tenant A data
├─ Steal credentials
│   ├─ Phishing → MFA blocks
│   ├─ Credential stuffing → Rate limit + MFA
│   └─ Insider → Audit + DLP
├─ Exploit application
│   ├─ SQL injection → WAF + prepared statements
│   ├─ XSS → CSP + sanitization
│   └─ IDOR → RLS + RBAC + ABAC
├─ Exploit infrastructure
│   ├─ Container escape → Isolation + seccomp
│   ├─ DB access → Network policy + mTLS
│   └─ Key theft → HSM + audit
└─ Bypass authorization
    ├─ Tenant ID manipulation → Context from JWT
    ├─ Role escalation → Invariants + audit
    └─ Policy bypass → Defense-in-depth
```

---

## 10. Security Operations

### 10.1 SIEM – Security Information & Event Management

**Log sources:**

- API Gateway (requests)
- Application (business events)
- Database (queries, RLS violations)
- OS (syslog, auth)
- Network (firewall, IDS)
- Cloud (audit logs)

**Correlation rules:**

```yaml
rules:
  - name: Brute force
    condition: failed_logins > 10 in 5min from same IP
    action: block_ip + alert
  
  - name: Impossible travel
    condition: |
      login_success.geo != previous_login.geo
      AND time_diff < 1h
    action: revoke_session + alert
  
  - name: Cross-tenant access
    condition: super_admin_access without approved_reason
    action: block + alert_immediately
  
  - name: Mass data export
    condition: export_size > 1GB in 1h
    action: throttle + notify_admin
```

### 10.2 SOAR – Security Orchestration, Automation, Response

**Playbooks:**

```yaml
playbook: compromised_account
triggers:
  - credential_stuffing_detected
steps:
  - action: revoke_all_sessions
  - action: force_password_reset
  - action: enable_mfa
  - action: notify_user
  - action: notify_security_team
  - action: create_incident_ticket
  - action: preserve_forensic_data
```

### 10.3 Security Metrics

| Metric                          | Target   |
| ------------------------------- | -------- |
| MTTD (Mean Time to Detect)      | < 5 min  |
| MTTR (Mean Time to Respond)     | < 30 min |
| False positive rate             | < 5%     |
| Critical vulnerabilities open   | 0        |
| High vulnerabilities open > 30d | 0        |
| Patch compliance                | > 95%    |
| MFA adoption                    | > 95%    |
| Audit coverage                  | 100%     |

### 10.4 Security Dashboards

```
┌─────────────────────────────────────────────┐
│  SECURITY POSTURE                           │
├─────────────────────────────────────────────┤
│  Threat level: LOW                          │
│  Active incidents: 0                        │
│  Failed logins (24h): 1,234                 │
│  Blocked IPs: 45                            │
│  Vulnerabilities: 0 critical, 3 high        │
│  Patch compliance: 97%                      │
│  MFA adoption: 96%                          │
│  Audit integrity: VALID                     │
└─────────────────────────────────────────────┘
```

---

## 11. Incident Response

### 11.1 IR Phases (NIST)

```
1. Preparation
   ├─ IR plan
   ├─ Roles & responsibilities
   ├─ Tools & access
   └─ Training & drills

2. Detection & Analysis
   ├─ Monitoring
   ├─ Alerting
   ├─ Triage
   └─ Classification

3. Containment
   ├─ Short-term (isolate)
   ├─ Long-term (patch)
   └─ Evidence preservation

4. Eradication
   ├─ Remove threat
   ├─ Patch vulnerabilities
   └─ Verify

5. Recovery
   ├─ Restore services
   ├─ Monitor
   └─ Validate

6. Post-Incident
   ├─ Lessons learned
   ├─ Update procedures
   └─ Report
```

### 11.2 Severity Levels

| Severity        | Definition            | Response Time | Escalation        |
| --------------- | --------------------- | ------------- | ----------------- |
| **SEV-1** | Critical, data breach | 15 min        | CEO, Legal, Board |
| **SEV-2** | High, service down    | 30 min        | CTO, CISO         |
| **SEV-3** | Medium, degraded      | 2 hours       | Security team     |
| **SEV-4** | Low, minor            | 1 day         | On-call           |

### 11.3 Communication Plan

| Audience   | When                | Channel             |
| ---------- | ------------------- | ------------------- |
| IR team    | Immediately         | Slack/PagerDuty     |
| Executives | SEV-1/2             | Phone + email       |
| Customers  | SEV-1 (if impacted) | Email + status page |
| Regulators | GDPR 72h            | Official channels   |
| Public     | SEV-1               | Press release       |

### 11.4 Post-Mortem Template

```markdown
# Incident Post-Mortem: INC-2026-042

## Summary
Brief description of what happened.

## Timeline
- 14:30 UTC: Detection
- 14:35 UTC: Acknowledged
- 14:45 UTC: Contained
- 15:30 UTC: Resolved

## Impact
- Duration: 60 minutes
- Users affected: 1,234
- Data affected: None

## Root Cause
Detailed technical analysis.

## What Went Well
- Fast detection
- Clear communication

## What Went Wrong
- Delayed escalation
- Missing runbook

## Action Items
- [ ] Update runbook (Owner: X, Due: Y)
- [ ] Add monitoring (Owner: Z, Due: W)
```

---

## 12. Penetration Testing & Vulnerability Management

### 12.1 Testing Cadence

| Type                        | Frequency    | Scope         |
| --------------------------- | ------------ | ------------- |
| **SAST**              | Every commit | Source code   |
| **DAST**              | Weekly       | Running app   |
| **SCA**               | Daily        | Dependencies  |
| **Container scan**    | Every build  | Images        |
| **IaC scan**          | Every commit | Terraform/K8s |
| **Internal pen test** | Quarterly    | Full stack    |
| **External pen test** | Annually     | Full stack    |
| **Red team**          | Annually     | Adversarial   |
| **Bug bounty**        | Continuous   | Public        |

### 12.2 Vulnerability Management

```typescript
export class VulnerabilityService {
    public async assess(vuln: Vulnerability): Promise<RiskAssessment> {
        const cvss = vuln.cvss;
        const exploitability = await this.checkExploitability(vuln);
        const exposure = await this.checkExposure(vuln);
      
        const risk = this.computeRisk(cvss, exploitability, exposure);
      
        return {
            risk,
            priority: this.prioritize(risk),
            sla: this.computeSla(risk),
            mitigation: await this.findMitigation(vuln)
        };
    }

    private computeSla(risk: Risk): Duration {
        switch (risk) {
            case Risk.CRITICAL: return Duration.days(1);
            case Risk.HIGH: return Duration.days(7);
            case Risk.MEDIUM: return Duration.days(30);
            case Risk.LOW: return Duration.days(90);
        }
    }
}
```

### 12.3 Bug Bounty Program

```yaml
program:
  name: DOCFLOW Bug Bounty
  platform: HackerOne
  scope:
    - "*.docflow.example.com"
    - "api.docflow.example.com"
  rewards:
    critical: $10,000
    high: $5,000
    medium: $1,000
    low: $250
  rules:
    - No social engineering
    - No physical attacks
    - No DoS
    - Responsible disclosure (90 days)
```

---

## 13. Compliance Mapping

### 13.1 ISO 27001 Controls

| Control                  | Implementation              |
| ------------------------ | --------------------------- |
| A.5 Information policies | Security policy, ADRs       |
| A.6 Organization         | Roles, responsibilities     |
| A.7 HR security          | Background checks, training |
| A.8 Asset management     | Inventory, classification   |
| A.9 Access control       | RBAC + ABAC, MFA            |
| A.10 Cryptography        | HSM, TLS 1.3, AES-256       |
| A.11 Physical            | Cloud provider              |
| A.12 Operations          | Monitoring, backup, IR      |
| A.13 Communications      | Network segmentation, mTLS  |
| A.14 Development         | SDLC, code review, SAST     |
| A.15 Supplier            | Vendor assessment           |
| A.16 Incident            | IR plan, post-mortem        |
| A.17 Continuity          | DR plan, RTO/RPO            |
| A.18 Compliance          | Audit, GDPR, SOC 2          |

### 13.2 SOC 2 Trust Services Criteria

| Criteria                  | Implementation        |
| ------------------------- | --------------------- |
| CC6.1 Logical access      | IAM, MFA, RBAC        |
| CC6.2 Access removal      | Deprovisioning        |
| CC6.3 Least privilege     | ABAC, JIT             |
| CC6.6 Boundary protection | WAF, network policies |
| CC6.7 Transmission        | TLS 1.3, mTLS         |
| CC6.8 Malicious software  | Container scan, EDR   |
| CC7.1 Detection           | SIEM, monitoring      |
| CC7.2 Monitoring          | Metrics, alerts       |
| CC7.3 Evaluation          | Incident review       |
| CC7.4 Response            | IR plan               |
| CC8.1 Change management   | GitOps, CI/CD         |

### 13.3 GDPR Compliance

| Article                     | Implementation             |
| --------------------------- | -------------------------- |
| Art. 5 Principles           | Data minimization, purpose |
| Art. 6 Lawfulness           | Consent, contract          |
| Art. 7 Consent              | Consent management         |
| Art. 15 Access              | Data export API            |
| Art. 16 Rectification       | Update API                 |
| Art. 17 Erasure             | Soft delete + purge        |
| Art. 18 Restriction         | Processing flags           |
| Art. 20 Portability         | Export (JSON/CSV)          |
| Art. 25 Privacy by design   | Defaults, minimization     |
| Art. 30 Records             | Processing register        |
| Art. 32 Security            | Encryption, access control |
| Art. 33 Breach notification | 72h process                |

### 13.4 eIDAS Compliance

| Requirement          | Implementation        |
| -------------------- | --------------------- |
| Advanced signature   | PKCS#7 + certificate  |
| Qualified signature  | QSCD + qualified cert |
| Qualified timestamp  | RFC 3161 TSA          |
| Long-term validation | LTV, PAdES-LTV        |
| Signature validation | OCSP, CRL             |

### 13.5 HIPAA (if applicable)

| Requirement           | Implementation         |
| --------------------- | ---------------------- |
| Access control        | RBAC, unique IDs       |
| Audit controls        | Immutable audit log    |
| Integrity             | Hash chain, signatures |
| Transmission security | TLS 1.3                |
| Encryption            | AES-256                |
| BAA                   | Signed with customers  |

---

## 14. ADR – Architecture Decision Records (част 03)

### ADR-017: Zero Trust като security model

**Status:** Accepted
**Context:** Perimeter security не е достатъчна.
**Decision:** Zero Trust – verify every request, least privilege, assume breach.
**Consequences:**

- + Stronger security posture
- + Compliance ready
- − Complexity
- − Performance overhead

### ADR-018: Argon2id за password hashing

**Status:** Accepted
**Context:** Нужен е memory-hard algorithm.
**Decision:** Argon2id (OWASP recommended).
**Consequences:**

- + GPU/ASIC resistant
- + Winner of PHC
- − More memory per hash

### ADR-019: OPA за authorization policies

**Status:** Accepted
**Context:** RBAC не е достатъчно.
**Decision:** OPA + Rego за ABAC policies.
**Consequences:**

- + Declarative policies
- + Testable
- + External decision
- − Additional service

### ADR-020: HSM за signing keys

**Status:** Accepted
**Context:** Signing keys трябва да са защитени.
**Decision:** HSM (cloud or on-prem) за всички signing keys.
**Consequences:**

- + Highest security
- + Compliance (FIPS 140-2)
- − Cost
- − Complexity

### ADR-021: Vault за secrets management

**Status:** Accepted
**Context:** Secrets не трябва да са в code/env.
**Decision:** HashiCorp Vault + dynamic credentials.
**Consequences:**

- + Centralized
- + Auditable
- + Dynamic
- − Additional infrastructure

### ADR-022: mTLS за service-to-service

**Status:** Accepted
**Context:** Internal traffic трябва да е authenticated.
**Decision:** mTLS STRICT + SPIFFE IDs.
**Consequences:**

- + Mutual authentication
- + Zero trust
- − Certificate management

### ADR-023: Hash chain + external anchor за audit

**Status:** Accepted
**Context:** Audit трябва да е tamper-evident.
**Decision:** Hash chain + periodic external anchor.
**Consequences:**

- + Tamper-evident
- + Compliance
- − Storage growth

### ADR-024: Bug bounty program

**Status:** Accepted
**Context:** Външна валидация на сигурността.
**Decision:** Public bug bounty (HackerOne).
**Consequences:**

- + Continuous testing
- + Community
- − Cost
- − Disclosure management

---

## 15. Заключение на част 03

Security архитектурата дефинира **как платформата защитава данни, потребители и операции**.

**Ключови решения:**

1. Zero Trust model с 8 принципа
2. IAM с RBAC + ABAC + OPA
3. Authentication: OIDC, SAML, MFA, WebAuthn
4. Authorization: policy engine, defense-in-depth
5. Cryptography: Argon2id, AES-256-GCM, ECDSA, HSM
6. Secrets: Vault + dynamic credentials
7. Network: segmentation + mTLS + service mesh
8. Data: encryption at rest/transit/use + classification
9. Threat model: STRIDE + attack trees
10. SecOps: SIEM + SOAR + IR
11. Pen testing + bug bounty
12. Compliance: ISO 27001, SOC 2, GDPR, eIDAS
13. 8 ADR-та

**Какво следва:**

- Част 04: Data Architecture – Polyglot Persistence
- Част 05: API Strategy
- ...

---

## 16. Приложения

- **A.** Zero Trust reference architecture
- **B.** IAM model
- **C.** Cryptography matrix
- **D.** STRIDE threat model
- **E.** IR playbooks
- **F.** Compliance matrix
- **G.** ADR-017 до ADR-024

---

**Край на DOCFLOW Enterprise v4.3 – Част 03: Security Architecture – Zero Trust.**

---

## Следваща стъпка

**Кажи ми:**

1. **Одобряваш ли Security архитектурата?**
2. **Кой аспект искаш да задълбоча?** (IAM, AuthN, AuthZ, Crypto, Network, Threats, IR, Compliance)
3. **Или преминаваме към Част 04: Data Architecture – Polyglot Persistence?**

**Когато си готов, стартираме Част 04**


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
