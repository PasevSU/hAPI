
# DOCFLOW Enterprise v4.1

## ЧАТ 01: Domain Model – Bounded Contexts & Aggregates

**Версия:** 4.1
**Част:** 01 от 20
**Дата:** 2026-10-12
**Статус:** Strategic Design – за одобрение
**Класификация:** Internal – Confidential
**Зависимости:** DOCFLOW Enterprise v4.0 (Master Blueprint)

---

## 0. Резюме на част 01

Тази част дефинира **сърцето на платформата** – домейн модела. Тук не говорим за бази данни, API-та или UI. Говорим за **езика на бизнеса**, **границите на отговорност** и **правилата, които никога не се нарушават**.

Domain Model-ът е това, което остава **стабилно**, докато инфраструктурата, API-тата и UI-тата се менят. Ако домейнът е правилен, всичко останало е подменяемо. Ако домейнът е грешен, всяка промяна е скъпа.

**Обхват:**

- Strategic Design – bounded contexts, context map, ubiquitous language
- Tactical Design – aggregates, entities, value objects, domain events
- Domain Services vs Application Services
- Invariants & business rules
- Transaction boundaries
- Event catalog

---

## 1. Strategic Design

### 1.1 Ubiquitous Language – Глосар

**Правило:** Всеки термин има **точно едно значение** в рамките на своя bounded context. Ако две значения съществуват, те са в различни contexts.

| Термин              | Контекст | Дефиниция                                                                 | НЕ е                 |
| ------------------------- | ---------------- | ---------------------------------------------------------------------------------- | ----------------------- |
| **Tenant**          | Tenant           | Изолирана организация-клиент на платформата | ≠ Company, ≠ Customer |
| **Group**           | Document         | Логическа папка в рамките на tenant                        | ≠ Folder (filesystem)  |
| **Profile**         | Document         | Тип запис/документ в рамките на group                    | ≠ Schema, ≠ Template  |
| **Document**        | Document         | Агрегат от версии, метаданни и връзки               | ≠ File                 |
| **DocumentVersion** | Document         | Конкретна версия с immutable content                               | ≠ Revision (draft)     |
| **ContentHash**     | Document         | SHA-256 на съдържанието                                              | ≠ FileName             |
| **Record**          | Identity         | Данни за лице/организация                                    | ≠ Document             |
| **Person**          | Identity         | Физическо лице                                                        | ≠ User                 |
| **Organization**    | Identity         | Юридическо лице                                                      | ≠ Tenant               |
| **User**            | Identity         | Автентикиран субект                                              | ≠ Person               |
| **Employee**        | Identity         | Person, свързан с Organization                                             | ≠ User                 |
| **Template**        | Template         | Шаблон с променливи                                               | ≠ Document             |
| **Variable**        | Template         | Именувана стойност                                                | ≠ Field                |
| **RenderJob**       | Template         | Задача за генериране                                             | ≠ Document             |
| **Signature**       | Verification     | Криптографски подпис                                            | ≠ Visual stamp         |
| **QRToken**         | Verification     | Токен за верификация                                             | ≠ QR code (image)      |
| **Verification**    | Verification     | Проверка на автентичност                                     | ≠ Validation           |
| **AuditEntry**      | Audit            | Запис в одита                                                           | ≠ Log                  |
| **AuditChain**      | Audit            | Hash-верига от entries                                                     | ≠ Blockchain           |
| **Anchor**          | Audit            | Външно закотвен hash                                                 | ≠ Backup               |
| **Workflow**        | Workflow         | Процес с одобрения                                                 | ≠ Job                  |
| **Task**            | Workflow         | Единица работа                                                        | ≠ Todo                 |
| **Approval**        | Workflow         | Решение за одобрение                                             | ≠ Signature            |

### 1.2 Bounded Contexts – Общ преглед

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│   │   TENANT     │    │   IDENTITY   │    │   DOCUMENT   │     │
│   │   (Core)     │◄──►│  (Supporting)│◄──►│    (Core)    │     │
│   └──────────────┘    └──────────────┘    └──────┬───────┘     │
│                                                   │             │
│                                                   │             │
│   ┌──────────────┐    ┌──────────────┐    ┌──────▼───────┐     │
│   │   AUDIT      │◄──►│  TEMPLATE    │◄──►│ VERIFICATION │     │
│   │  (Generic)   │    │    (Core)    │    │    (Core)    │     │
│   └──────────────┘    └──────────────┘    └──────────────┘     │
│                                                                 │
│   ┌──────────────┐                                             │
│   │   WORKFLOW   │                                             │
│   │  (Supporting)│                                             │
│   └──────────────┘                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Core:       Document, Verification, Template
Supporting: Identity, Workflow
Generic:    Tenant, Audit
```

### 1.3 Context Classification

| Context                | Type       | Rationale                                 | Investment   |
| ---------------------- | ---------- | ----------------------------------------- | ------------ |
| **Document**     | Core       | Ключова диференциация | Висока |
| **Verification** | Core       | Уникална стойност         | Висока |
| **Template**     | Core       | Competitive advantage                     | Висока |
| **Identity**     | Supporting | Нужна, но не unique              | Средна |
| **Workflow**     | Supporting | Standard patterns                         | Средна |
| **Tenant**       | Generic    | Multi-tenancy standard                    | Ниска   |
| **Audit**        | Generic    | Compliance requirement                    | Ниска   |

**Правило:** Core contexts се разработват in-house. Generic contexts могат да се купят/вземат open-source.

### 1.4 Context Map – Relationship Patterns

```
┌─────────────────────────────────────────────────────────────────┐
│                      CONTEXT MAP                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Identity ──[ACL]──► Document                                  │
│      │                    │                                     │
│      │                    │                                     │
│      │                    ▼                                     │
│      │              Verification                                │
│      │                    ▲                                     │
│      │                    │                                     │
│      │              Template                                    │
│      │                    │                                     │
│      │                    │                                     │
│      ▼                    ▼                                     │
│   Tenant ◄──[PL]── Audit ◄──[PL]── Workflow                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

ACL = Anti-Corruption Layer
PL  = Published Language
SK  = Shared Kernel
CF  = Conformist
OHS = Open Host Service
```

#### Relationship Details

| From                     | To                 | Pattern                                                                                               | Rationale |
| ------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------- | --------- |
| Identity → Document     | ACL                | Identity има собствен модел на Person; Document не трябва да зависи |           |
| Document → Verification | ACL                | Verification не трябва да знае Document internals                                       |           |
| Template → Document     | ACL                | Template генерира, но не зависи от Document                                       |           |
| Tenant → всички   | Shared Kernel      | TenantId е shared value object                                                                       |           |
| Audit ← всички    | Published Language | Всички публикуват events, Audit ги консумира                               |           |
| Workflow → Document     | ACL                | Workflow не трябва да знае Document model                                               |           |

### 1.5 Shared Kernel – Value Objects

**Правило:** Само **immutable value objects** могат да бъдат в shared kernel. Никакви entities или aggregates.

```typescript
// shared-kernel/value-objects/
├── tenant-id.ts
├── user-id.ts
├── timestamp.ts
├── content-hash.ts
├── money.ts
├── email.ts
├── phone.ts
├── address.ts
└── id-generator.ts
```

**Обосновка:** Тези VO се използват от всички contexts и не носят бизнес логика, специфична за контекст.

---

## 2. Bounded Context: Document

### 2.1 Отговорност

Document context отговаря за:

- Жизнен цикъл на документ (create, version, link, archive)
- Метаданни и връзки
- Immutability на версии
- Content addressing (hash-based)
- Не отговаря за: генериране (Template), верификация (Verification), права (Identity)

### 2.2 Aggregate: Document

**Root:** `Document`

**Invariants:**

1. Document винаги принадлежи на точно един tenant
2. Document винаги има поне една версия (или е в DRAFT state)
3. Версиите са immutable след publish
4. Hash на всяка версия е уникален в рамките на document
5. Archived document не може да получи нова версия
6. Links са unidirectional (но могат да бъдат bidirectional по тип)
7. Maximum versions per document = 1000 (configurable)

**Lifecycle:**

```
DRAFT ──publish──► ACTIVE ──archive──► ARCHIVED ──purge──► PURGED
                       │
                       └──link──► (multiple links)
```

```typescript
// domain/document/aggregates/document.ts
export class Document extends AggregateRoot<DocumentId> {
    // === Identity ===
    private readonly id: DocumentId;
    private readonly tenantId: TenantId;
    private readonly groupId: GroupId;
    private readonly profileId: ProfileId;

    // === State ===
    private status: DocumentStatus;
    private versions: DocumentVersion[];
    private currentVersionId: DocumentVersionId | null;
    private links: DocumentLink[];
    private metadata: DocumentMetadata;
    private tags: Set<Tag>;

    // === Audit ===
    private readonly createdBy: UserId;
    private readonly createdAt: Timestamp;
    private updatedBy: UserId;
    private updatedAt: Timestamp;

    // === Concurrency ===
    private version: number;  // optimistic locking

    // === Factory ===
    public static create(
        tenantId: TenantId,
        groupId: GroupId,
        profileId: ProfileId,
        createdBy: UserId
    ): Document {
        const doc = new Document({
            id: DocumentId.generate(),
            tenantId,
            groupId,
            profileId,
            status: DocumentStatus.DRAFT,
            versions: [],
            currentVersionId: null,
            links: [],
            metadata: DocumentMetadata.empty(),
            tags: new Set(),
            createdBy,
            createdAt: Timestamp.now(),
            updatedBy: createdBy,
            updatedAt: Timestamp.now(),
            version: 0
        });
        doc.addDomainEvent(new DocumentCreated(doc.id, tenantId, createdBy));
        return doc;
    }

    // === Behavior ===
    public addVersion(
        file: FileReference,
        hash: ContentHash,
        addedBy: UserId
    ): DocumentVersion {
        // Invariant: not archived
        if (this.status === DocumentStatus.ARCHIVED) {
            throw new DocumentArchivedError(this.id);
        }

        // Invariant: max versions
        if (this.versions.length >= MAX_VERSIONS) {
            throw new MaxVersionsExceededError(this.id, MAX_VERSIONS);
        }

        // Invariant: unique hash within document
        if (this.versions.some(v => v.contentHash.equals(hash))) {
            throw new DuplicateVersionError(this.id, hash);
        }

        const newVersion = DocumentVersion.create({
            documentId: this.id,
            versionNumber: this.versions.length + 1,
            file,
            contentHash: hash,
            createdBy: addedBy
        });

        this.versions.push(newVersion);
        this.currentVersionId = newVersion.id;
        this.status = DocumentStatus.ACTIVE;
        this.touch(addedBy);

        this.addDomainEvent(new DocumentVersionAdded(
            this.id, newVersion.id, this.tenantId, addedBy
        ));

        return newVersion;
    }

    public linkTo(
        targetId: DocumentId,
        type: LinkType,
        createdBy: UserId
    ): DocumentLink {
        if (targetId.equals(this.id)) {
            throw new SelfLinkError(this.id);
        }
        if (this.links.some(l => l.targetId.equals(targetId) && l.type === type)) {
            throw new DuplicateLinkError(this.id, targetId, type);
        }

        const link = DocumentLink.create({
            sourceId: this.id,
            targetId,
            type,
            createdBy
        });

        this.links.push(link);
        this.touch(createdBy);
        this.addDomainEvent(new DocumentLinked(this.id, targetId, type, createdBy));
        return link;
    }

    public unlink(targetId: DocumentId, type: LinkType, removedBy: UserId): void {
        const before = this.links.length;
        this.links = this.links.filter(
            l => !(l.targetId.equals(targetId) && l.type === type)
        );
        if (this.links.length === before) {
            throw new LinkNotFoundError(this.id, targetId, type);
        }
        this.touch(removedBy);
        this.addDomainEvent(new DocumentUnlinked(this.id, targetId, type, removedBy));
    }

    public archive(reason: ArchiveReason, archivedBy: UserId): void {
        if (this.status === DocumentStatus.ARCHIVED) return;
        if (this.status === DocumentStatus.PURGED) {
            throw new DocumentPurgedError(this.id);
        }
        this.status = DocumentStatus.ARCHIVED;
        this.touch(archivedBy);
        this.addDomainEvent(new DocumentArchived(this.id, reason, archivedBy));
    }

    public addTag(tag: Tag, addedBy: UserId): void {
        if (this.tags.has(tag)) return;
        this.tags.add(tag);
        this.touch(addedBy);
        this.addDomainEvent(new DocumentTagged(this.id, tag, addedBy));
    }

    public updateMetadata(metadata: DocumentMetadata, updatedBy: UserId): void {
        this.metadata = metadata;
        this.touch(updatedBy);
        this.addDomainEvent(new DocumentMetadataUpdated(this.id, updatedBy));
    }

    // === Private ===
    private touch(userId: UserId): void {
        this.updatedBy = userId;
        this.updatedAt = Timestamp.now();
        this.version++;
    }
}
```

### 2.3 Entity: DocumentVersion

```typescript
// domain/document/entities/document-version.ts
export class DocumentVersion extends Entity<DocumentVersionId> {
    private readonly id: DocumentVersionId;
    private readonly documentId: DocumentId;
    private readonly versionNumber: number;
    private readonly file: FileReference;
    private readonly contentHash: ContentHash;
    private readonly createdAt: Timestamp;
    private readonly createdBy: UserId;
    private signature: Signature | null;

    public static create(params: {
        documentId: DocumentId;
        versionNumber: number;
        file: FileReference;
        contentHash: ContentHash;
        createdBy: UserId;
    }): DocumentVersion {
        return new DocumentVersion({
            id: DocumentVersionId.generate(),
            ...params,
            createdAt: Timestamp.now(),
            signature: null
        });
    }

    public sign(signature: Signature): void {
        if (this.signature !== null) {
            throw new VersionAlreadySignedError(this.id);
        }
        this.signature = signature;
        // No domain event here – signature has its own events
    }

    // Immutable getters
    public getHash(): ContentHash { return this.contentHash; }
    public getFile(): FileReference { return this.file; }
    public isSigned(): boolean { return this.signature !== null; }
}
```

### 2.4 Entity: DocumentLink

```typescript
// domain/document/entities/document-link.ts
export class DocumentLink extends Entity<DocumentLinkId> {
    private readonly id: DocumentLinkId;
    private readonly sourceId: DocumentId;
    private readonly targetId: DocumentId;
    private readonly type: LinkType;
    private readonly createdAt: Timestamp;
    private readonly createdBy: UserId;
}

export enum LinkType {
    REFERENCES = 'references',      // Документ А цитира Б
    SUPERSEDES = 'supersedes',      // А замества Б
    AMENDS = 'amends',              // А изменя Б
    DERIVED_FROM = 'derived_from',  // А е производен от Б
    ATTACHES = 'attaches',          // А има прикачен Б
    RELATED = 'related'             // Обща връзка
}
```

### 2.5 Value Objects – Document Context

```typescript
// DocumentId
export class DocumentId extends ValueObject<{ value: string }> {
    static generate(): DocumentId {
        return new DocumentId({ value: ulid() });
    }
    static fromString(s: string): DocumentId {
        if (!ULID_PATTERN.test(s)) throw new InvalidDocumentIdError(s);
        return new DocumentId({ value: s });
    }
}

// DocumentMetadata (immutable)
export class DocumentMetadata extends ValueObject<{
    title: string;
    description: string;
    language: string;
    classification: Classification;
    retentionPolicy: RetentionPolicy;
    customFields: ReadonlyMap<string, string>;
}> {
    static empty(): DocumentMetadata { /* ... */ }
}

// FileReference
export class FileReference extends ValueObject<{
    storageKey: string;   // S3 key or local path
    mimeType: string;
    sizeBytes: number;
    originalName: string;
}> {
    static create(params): FileReference { /* validation */ }
    public isLarge(): boolean { return this.props.sizeBytes > 100_000_000; }
}

// Classification
export enum Classification {
    PUBLIC = 'public',
    INTERNAL = 'internal',
    CONFIDENTIAL = 'confidential',
    RESTRICTED = 'restricted'
}

// ArchiveReason
export enum ArchiveReason {
    SUPERSEDED = 'superseded',
    EXPIRED = 'expired',
    USER_REQUEST = 'user_request',
    POLICY = 'policy',
    LEGAL_HOLD = 'legal_hold'
}
```

### 2.6 Domain Events – Document

```typescript
// domain/document/events/
DocumentCreated          { documentId, tenantId, createdBy }
DocumentVersionAdded     { documentId, versionId, tenantId, addedBy }
DocumentLinked           { documentId, targetId, type, linkedBy }
DocumentUnlinked         { documentId, targetId, type, unlinkedBy }
DocumentArchived         { documentId, reason, archivedBy }
DocumentPurged           { documentId, purgedBy, purgedAt }
DocumentTagged           { documentId, tag, taggedBy }
DocumentMetadataUpdated  { documentId, updatedBy }
DocumentMovedToGroup     { documentId, fromGroupId, toGroupId, movedBy }
```

### 2.7 Domain Services – Document

**Кога domain service?** Когато логиката включва **повече от един aggregate**.

```typescript
// domain/document/services/document-merge-service.ts
export class DocumentMergeService {
    constructor(
        private readonly documentRepo: DocumentRepository,
        private readonly fileStorage: FileStorage
    ) {}

    /**
     * Обединява два документа в нов.
     * Invariant: и двата трябва да са в същия tenant и group.
     */
    public async merge(
        sourceId: DocumentId,
        targetId: DocumentId,
        mergedBy: UserId,
        options: MergeOptions
    ): Promise<Document> {
        const source = await this.documentRepo.findById(sourceId);
        const target = await this.documentRepo.findById(targetId);

        if (!source || !target) throw new DocumentNotFoundError();
        if (!source.sameTenant(target)) throw new CrossTenantMergeError();
        if (!source.sameGroup(target)) throw new CrossGroupMergeError();

        // Създаваме нов документ с версии от двата
        const merged = Document.create(
            source.tenantId, source.groupId, source.profileId, mergedBy
        );

        for (const version of [...source.getVersions(), ...target.getVersions()]) {
            merged.addVersion(version.getFile(), version.getHash(), mergedBy);
        }

        // Запазваме links
        for (const link of [...source.getLinks(), ...target.getLinks()]) {
            merged.linkTo(link.targetId, link.type, mergedBy);
        }

        // Архивираме източниците
        source.archive(ArchiveReason.SUPERSEDED, mergedBy);
        target.archive(ArchiveReason.SUPERSEDED, mergedBy);

        return merged;
    }
}
```

### 2.8 Repository Interface – Document

```typescript
// domain/document/repositories/document-repository.ts
export interface DocumentRepository {
    findById(id: DocumentId): Promise<Document | null>;
    findByTenantAndGroup(tenantId: TenantId, groupId: GroupId): Promise<Document[]>;
    findByHash(tenantId: TenantId, hash: ContentHash): Promise<Document | null>;
    findByTag(tenantId: TenantId, tag: Tag): Promise<Document[]>;
    search(criteria: DocumentSearchCriteria): Promise<PagedResult<Document>>;
    save(document: Document): Promise<void>;
    delete(id: DocumentId): Promise<void>;
    nextIdentity(): DocumentId;
}

export interface DocumentSearchCriteria {
    tenantId: TenantId;
    groupIds?: GroupId[];
    profileIds?: ProfileId[];
    statuses?: DocumentStatus[];
    tags?: Tag[];
    createdAfter?: Timestamp;
    createdBefore?: Timestamp;
    query?: string;
    page: number;
    size: number;
}
```

### 2.9 Transaction Boundaries

| Операция | Transaction Boundary                                         |
| ---------------- | ------------------------------------------------------------ |
| Create document  | Aggregate: Document                                          |
| Add version      | Aggregate: Document                                          |
| Link             | Aggregate: Document (both sides via domain service)          |
| Merge            | Domain Service (multiple aggregates) – eventual consistency |
| Archive          | Aggregate: Document                                          |

**Правило:** Една транзакция = един aggregate. За multi-aggregate → saga/process manager.

---

## 3. Bounded Context: Identity

### 3.1 Отговорност

Identity context отговаря за:

- Хора (Person) и организации (Organization)
- Потребители (User) и роли
- Служители (Employee) – връзка Person ↔ Organization
- Профили (Record) – гъвкави данни по схема
- Не отговаря за: автентикация (infra), авторизация (policy)

### 3.2 Aggregates

#### 3.2.1 Aggregate: Person

```typescript
// domain/identity/aggregates/person.ts
export class Person extends AggregateRoot<PersonId> {
    private readonly id: PersonId;
    private readonly tenantId: TenantId;
    private names: PersonNames;
    private contacts: ContactInfo[];
    private addresses: Address[];
    private identifiers: ExternalIdentifier[];  // EGN, passport, tax ID
    private readonly createdAt: Timestamp;
    private updatedAt: Timestamp;

    public static create(tenantId: TenantId, names: PersonNames): Person { /* ... */ }

    public updateNames(names: PersonNames, by: UserId): void { /* ... */ }
    public addContact(contact: ContactInfo, by: UserId): void { /* ... */ }
    public removeContact(contactId: ContactId, by: UserId): void { /* ... */ }
    public addAddress(address: Address, by: UserId): void { /* ... */ }
    public addIdentifier(id: ExternalIdentifier, by: UserId): void { /* ... */ }
    public mergeWith(other: Person, by: UserId): Person { /* ... */ }
}
```

**Invariants:**

1. Person винаги има поне едно име
2. External identifiers са уникални в tenant (напр. само един EGN)
3. Contacts са валидни (email, phone)
4. Merge е необратим

#### 3.2.2 Aggregate: Organization

```typescript
export class Organization extends AggregateRoot<OrganizationId> {
    private readonly id: OrganizationId;
    private readonly tenantId: TenantId;
    private legalName: LegalName;
    private registrationNumber: RegistrationNumber;
    private taxId: TaxId | null;
    private contacts: ContactInfo[];
    private address: Address;
    private readonly createdAt: Timestamp;
    private updatedAt: Timestamp;
}
```

**Invariants:**

1. RegistrationNumber е уникален в tenant
2. LegalName не може да е празно
3. Address е задължителен

#### 3.2.3 Aggregate: User

```typescript
export class User extends AggregateRoot<UserId> {
    private readonly id: UserId;
    private readonly tenantId: TenantId;
    private email: Email;
    private personId: PersonId | null;  // link to Person
    private roles: Set<Role>;
    private status: UserStatus;  // ACTIVE, SUSPENDED, DELETED
    private mfaEnabled: boolean;
    private readonly createdAt: Timestamp;
    private lastLoginAt: Timestamp | null;
}
```

**Invariants:**

1. Email е уникален в tenant
2. Поне една роля
3. Не може да се изтрие последният Admin
4. Suspended user не може да се автентикира

#### 3.2.4 Aggregate: Employee

```typescript
export class Employee extends AggregateRoot<EmployeeId> {
    private readonly id: EmployeeId;
    private readonly tenantId: TenantId;
    private personId: PersonId;
    private organizationId: OrganizationId;
    private position: Position;
    private department: Department | null;
    private validFrom: Timestamp;
    private validTo: Timestamp | null;  // null = current
}
```

**Invariants:**

1. validFrom < validTo (ако validTo е зададено)
2. Само един active Employee за (Person, Organization) в даден момент
3. Position не може да е празно

#### 3.2.5 Aggregate: Record

```typescript
export class Record extends AggregateRoot<RecordId> {
    private readonly id: RecordId;
    private readonly tenantId: TenantId;
    private readonly profileId: ProfileId;
    private readonly groupId: GroupId;
    private data: RecordData;  // JSON-based, schema-driven
    private readonly createdAt: Timestamp;
    private updatedAt: Timestamp;
    private version: number;
}
```

**Invariants:**

1. Data отговаря на Profile schema
2. Profile определя полетата
3. Orphan records позволяват groupId = null

### 3.3 Domain Events – Identity

```typescript
PersonCreated           { personId, tenantId, createdBy }
PersonMerged            { sourceId, targetId, mergedBy }
OrganizationCreated     { organizationId, tenantId, createdBy }
UserCreated             { userId, tenantId, email }
UserRoleGranted         { userId, role, grantedBy }
UserRoleRevoked         { userId, role, revokedBy }
UserSuspended           { userId, reason, suspendedBy }
EmployeeHired           { employeeId, personId, organizationId }
EmployeeTerminated      { employeeId, terminatedAt }
RecordCreated           { recordId, tenantId, profileId }
RecordLinkedToGroup     { recordId, groupId, linkedBy }
```

---

## 4. Bounded Context: Verification

### 4.1 Отговорност

Verification context отговаря за:

- Криптографски подписи (signatures)
- QR токени (immutable, revocable)
- Проверки (verifications) – read model
- Timestamps (RFC 3161)
- Не отговаря за: документи (Document), права (Identity)

### 4.2 Aggregates

#### 4.2.1 Aggregate: Signature

```typescript
export class Signature extends AggregateRoot<SignatureId> {
    private readonly id: SignatureId;
    private readonly tenantId: TenantId;
    private readonly documentVersionId: DocumentVersionId;
    private readonly algorithm: SignatureAlgorithm;  // SHA256, SHA512, ECDSA_P384, PKCS7
    private readonly value: SignatureValue;
    private readonly signedBy: SignerIdentity;
    private readonly signedAt: Timestamp;
    private readonly timestampToken: TimestampToken | null;
    private readonly certificate: Certificate | null;

    public static create(params: {
        documentVersionId: DocumentVersionId;
        algorithm: SignatureAlgorithm;
        value: SignatureValue;
        signedBy: SignerIdentity;
        certificate?: Certificate;
    }): Signature { /* ... */ }

    public verify(content: ContentHash): boolean {
        return this.algorithm.verify(content, this.value);
    }
}
```

**Invariants:**

1. Algorithm е разрешен (configurable)
2. Value е валиден за algorithm
3. Certificate е валиден (ако е приложимо)
4. Immutable след create

#### 4.2.2 Aggregate: QRToken

```typescript
export class QRToken extends AggregateRoot<QRTokenId> {
    private readonly id: QRTokenId;
    private readonly tenantId: TenantId;
    private readonly documentId: DocumentId;
    private readonly documentVersionId: DocumentVersionId;
    private readonly token: OpaqueToken;  // не предвидим
    private readonly expiresAt: Timestamp | null;
    private revokedAt: Timestamp | null;
    private readonly createdAt: Timestamp;
    private readonly createdBy: UserId;

    public static generate(params: {
        documentId: DocumentId;
        documentVersionId: DocumentVersionId;
        expiresAt?: Timestamp;
        createdBy: UserId;
    }): QRToken { /* ... */ }

    public revoke(reason: RevocationReason, by: UserId): void {
        if (this.revokedAt !== null) return;
        this.revokedAt = Timestamp.now();
        this.addDomainEvent(new QRTokenRevoked(this.id, reason, by));
    }

    public isValid(now: Timestamp): boolean {
        if (this.revokedAt !== null) return false;
        if (this.expiresAt !== null && this.expiresAt.isBefore(now)) return false;
        return true;
    }
}
```

**Invariants:**

1. Token е криптографски random (>= 128 bits)
2. Token е уникален глобално
3. Expired/revoked → невалиден
4. Immutable освен revoke

#### 4.2.3 Aggregate: VerificationRecord (read model)

```typescript
export class VerificationRecord extends Entity<VerificationId> {
    private readonly id: VerificationId;
    private readonly qrTokenId: QRTokenId;
    private readonly verifiedAt: Timestamp;
    private readonly verifierIp: IpAddress;
    private readonly verifierAgent: UserAgent | null;
    private readonly result: VerificationResult;
    private readonly details: VerificationDetails;
}

export enum VerificationResult {
    VALID = 'valid',
    INVALID = 'invalid',
    EXPIRED = 'expired',
    REVOKED = 'revoked',
    TAMPERED = 'tampered',
    NOT_FOUND = 'not_found'
}
```

### 4.3 Domain Services – Verification

```typescript
export class VerificationService {
    /**
     * Верифицира QR token и връща резултат.
     * Side effect: записва VerificationRecord.
     */
    public async verify(
        token: OpaqueToken,
        context: VerificationContext
    ): Promise<VerificationOutcome> {
        // 1. Намери token
        const qrToken = await this.qrTokenRepo.findByToken(token);
        if (!qrToken) return this.record(NOT_FOUND, context);

        // 2. Провери валидност
        if (qrToken.isRevoked()) return this.record(REVOKED, context);
        if (qrToken.isExpired()) return this.record(EXPIRED, context);

        // 3. Зареди документ
        const doc = await this.documentRepo.findById(qrToken.documentId);
        const version = doc.getVersion(qrToken.documentVersionId);

        // 4. Провери hash на реалния файл
        const actualHash = await this.fileStorage.hash(version.getFile());
        if (!actualHash.equals(version.getHash())) {
            return this.record(TAMPERED, context, {
                expected: version.getHash().toString(),
                actual: actualHash.toString()
            });
        }

        // 5. Провери signature (ако има)
        if (version.isSigned()) {
            if (!version.getSignature().verify(actualHash)) {
                return this.record(INVALID, context, { reason: 'signature_mismatch' });
            }
        }

        // 6. Успешна верификация
        return this.record(VALID, context, {
            documentId: doc.id.toString(),
            versionId: version.id.toString(),
            hash: actualHash.toString()
        });
    }
}
```

### 4.4 Domain Events – Verification

```typescript
SignatureCreated         { signatureId, documentVersionId, algorithm }
SignatureVerified        { signatureId, result }
QRTokenGenerated         { qrTokenId, documentId, expiresAt }
QRTokenRevoked           { qrTokenId, reason, revokedBy }
DocumentVerified         { documentId, result, verificationId }
VerificationFailed       { documentId, reason, verificationId }
```

---

## 5. Bounded Context: Template

### 5.1 Отговорност

Template context отговаря за:

- Шаблони (templates) с променливи
- Схеми на променливите (variable schemas)
- Генериране на документи (render jobs)
- Версиониране на шаблони
- Не отговаря за: съхранение на документи (Document)

### 5.2 Aggregates

#### 5.2.1 Aggregate: Template

```typescript
export class Template extends AggregateRoot<TemplateId> {
    private readonly id: TemplateId;
    private readonly tenantId: TenantId;
    private name: TemplateName;
    private description: string;
    private format: TemplateFormat;  // PDF, DOCX, XLSX, HTML, MD
    private content: TemplateContent;
    private variableSchema: VariableSchema;
    private status: TemplateStatus;  // DRAFT, PUBLISHED, DEPRECATED
    private versions: TemplateVersion[];
    private currentVersionId: TemplateVersionId;
    private readonly createdAt: Timestamp;
    private updatedAt: Timestamp;
}
```

**Invariants:**

1. Content съдържа само декларирани variables
2. VariableSchema е валидна
3. Published template е immutable (нова версия за промени)
4. Format е поддържан

#### 5.2.2 Aggregate: RenderJob

```typescript
export class RenderJob extends AggregateRoot<RenderJobId> {
    private readonly id: RenderJobId;
    private readonly tenantId: TenantId;
    private readonly templateId: TemplateId;
    private readonly templateVersionId: TemplateVersionId;
    private readonly variables: VariableValues;
    private status: RenderJobStatus;  // PENDING, RUNNING, COMPLETED, FAILED
    private result: RenderResult | null;
    private error: RenderError | null;
    private attempts: number;
    private readonly createdAt: Timestamp;
    private startedAt: Timestamp | null;
    private completedAt: Timestamp | null;
}
```

**Invariants:**

1. Variables отговарят на schema
2. Max attempts = 3
3. Failed job не може да стане COMPLETED без retry

### 5.3 Value Objects – Template

```typescript
// VariableSchema
export class VariableSchema extends ValueObject<{
    variables: ReadonlyArray<VariableDefinition>;
}> {
    public validate(values: VariableValues): ValidationResult { /* ... */ }
    public getRequired(): VariableDefinition[] { /* ... */ }
}

export interface VariableDefinition {
    name: string;
    type: VariableType;  // STRING, NUMBER, DATE, BOOLEAN, EMAIL, PHONE, ADDRESS, TABLE
    required: boolean;
    defaultValue?: unknown;
    validation?: ValidationRule[];
    displayName: string;
    description?: string;
}

// TemplateContent – с {{variable}} placeholders
export class TemplateContent extends ValueObject<{ raw: string }> {
    public extractVariables(): string[] {
        const regex = /\{\{([^}]+)\}\}/g;
        const matches = [...this.props.raw.matchAll(regex)];
        return matches.map(m => m[1].trim());
    }
}
```

### 5.4 Domain Services – Template

```typescript
export class RenderingService {
    /**
     * Генерира документ от шаблон + променливи.
     * Създава RenderJob, изпълнява, връща резултат.
     */
    public async render(
        templateId: TemplateId,
        variables: VariableValues,
        context: RenderContext
    ): Promise<RenderResult> {
        // 1. Зареди template
        const template = await this.templateRepo.findById(templateId);
        if (!template.isPublished()) {
            throw new TemplateNotPublishedError(templateId);
        }

        // 2. Валидирай variables спрямо schema
        const validation = template.variableSchema.validate(variables);
        if (!validation.isValid()) {
            throw new InvalidVariablesError(validation.errors);
        }

        // 3. Създай RenderJob
        const job = RenderJob.create({
            templateId,
            templateVersionId: template.currentVersionId,
            variables,
            createdBy: context.userId
        });
        await this.renderJobRepo.save(job);

        // 4. Изпълни (async или sync според конфигурация)
        try {
            job.start();
            const renderer = this.rendererRegistry.get(template.format);
            const buffer = await renderer.render(template.content, variables);
            const hash = ContentHash.sha256(buffer);
            const file = await this.fileStorage.save(buffer, {
                mimeType: template.format.mimeType(),
                name: `${template.name}-${ulid()}.${template.format.extension()}`
            });

            job.complete({ file, hash });
            await this.renderJobRepo.save(job);

            // Публикувай event – Document context ще създаде Document
            this.eventBus.publish(new DocumentRendered(
                job.id, templateId, file, hash, context
            ));

            return { job, file, hash };
        } catch (error) {
            job.fail(error);
            await this.renderJobRepo.save(job);
            throw error;
        }
    }
}
```

### 5.5 Domain Events – Template

```typescript
TemplateCreated          { templateId, tenantId, format }
TemplatePublished        { templateId, versionId, publishedBy }
TemplateDeprecated       { templateId, reason }
TemplateVersionCreated   { templateId, versionId, createdBy }
RenderJobCreated         { jobId, templateId, tenantId }
RenderJobStarted         { jobId }
RenderJobCompleted       { jobId, file, hash }
RenderJobFailed          { jobId, error, attempts }
DocumentRendered         { jobId, templateId, file, hash }  // Integration event
```

---

## 6. Bounded Context: Audit

### 6.1 Отговорност

Audit context отговаря за:

- Запис на всички значими събития (append-only)
- Hash-верига (tamper-evident)
- Външно закотвяне (anchoring)
- Lineage (provenance)
- Не отговаря за: бизнес логика (наблюдава я)

### 6.2 Aggregates

#### 6.2.1 Aggregate: AuditChain

```typescript
export class AuditChain extends AggregateRoot<AuditChainId> {
    private readonly id: AuditChainId;
    private readonly tenantId: TenantId;
    private lastEntryId: AuditEntryId | null;
    private lastHash: ChainHash;
    private entryCount: number;
    private lastAnchoredAt: Timestamp | null;
    private lastAnchorRef: AnchorReference | null;
}
```

**Invariants:**

1. Append-only
2. Всяка entry съдържа hash на предходната
3. Anchor е immutable
4. Не може да се изтрие entry

#### 6.2.2 Entity: AuditEntry

```typescript
export class AuditEntry extends Entity<AuditEntryId> {
    private readonly id: AuditEntryId;
    private readonly chainId: AuditChainId;
    private readonly sequenceNumber: number;
    private readonly eventType: string;
    private readonly aggregateType: string;
    private readonly aggregateId: string;
    private readonly actor: Actor;
    private readonly tenantId: TenantId;
    private readonly payload: JsonValue;  // sanitized
    private readonly metadata: AuditMetadata;
    private readonly occurredAt: Timestamp;
    private readonly previousHash: ChainHash;
    private readonly hash: ChainHash;  // = sha256(previousHash + canonical(this))

    public static create(prev: AuditEntry | null, event: DomainEvent): AuditEntry {
        const previousHash = prev?.hash ?? ChainHash.GENESIS;
        const entry = new AuditEntry({
            id: AuditEntryId.generate(),
            // ...
            previousHash
        });
        entry.hash = ChainHash.compute(previousHash, entry);
        return entry;
    }

    public verify(prev: AuditEntry): boolean {
        if (!this.previousHash.equals(prev.hash)) return false;
        const expected = ChainHash.compute(prev.hash, this);
        return this.hash.equals(expected);
    }
}
```

### 6.3 Domain Services – Audit

```typescript
export class AuditService {
    /**
     * Записва domain event в audit chain.
     * Гарантира: append-only, hash-chain, tenant isolation.
     */
    public async record(event: DomainEvent): Promise<AuditEntry> {
        const chain = await this.chainRepo.findByTenant(event.tenantId);
        const lastEntry = chain.lastEntryId
            ? await this.entryRepo.findById(chain.lastEntryId)
            : null;

        const entry = AuditEntry.create(lastEntry, event);

        // Transaction: entry + chain update
        await this.unitOfWork.execute(async () => {
            await this.entryRepo.append(entry);
            chain.advance(entry);
            await this.chainRepo.save(chain);
        });

        return entry;
    }

    /**
     * Верифицира целия chain.
     */
    public async verifyChain(tenantId: TenantId): Promise<ChainVerificationResult> {
        const entries = await this.entryRepo.findAllByTenant(tenantId);
        let prev: AuditEntry | null = null;
        for (const entry of entries) {
            if (prev && !entry.verify(prev)) {
                return { valid: false, brokenAt: entry.id };
            }
            prev = entry;
        }
        return { valid: true, entries: entries.length };
    }

    /**
     * Закотвя последния hash на chain във външна система.
     */
    public async anchor(tenantId: TenantId): Promise<AnchorReference> {
        const chain = await this.chainRepo.findByTenant(tenantId);
        const anchor = await this.anchorProvider.publish({
            chainId: chain.id,
            hash: chain.lastHash,
            timestamp: Timestamp.now()
        });
        chain.recordAnchor(anchor);
        await this.chainRepo.save(chain);
        return anchor;
    }
}
```

### 6.4 Domain Events – Audit

```typescript
AuditEntryAppended       { entryId, chainId, eventType }
AuditChainVerified       { chainId, valid, entries }
AuditChainAnchored       { chainId, anchorRef }
AuditIntegrityBroken     { chainId, brokenAt }  // CRITICAL
```

---

## 7. Bounded Context: Tenant

### 7.1 Отговорност

Tenant context отговаря за:

- Жизнен цикъл на tenant
- Конфигурация per tenant
- Квоти и лимити
- Billing/metering
- Не отговаря за: бизнес данни (в други contexts)

### 7.2 Aggregates

#### 7.2.1 Aggregate: Tenant

```typescript
export class Tenant extends AggregateRoot<TenantId> {
    private readonly id: TenantId;
    private name: TenantName;
    private slug: Slug;  // unique, URL-safe
    private tier: TenantTier;  // COMMUNITY, BUSINESS, ENTERPRISE
    private status: TenantStatus;  // ACTIVE, SUSPENDED, DELETED
    private config: TenantConfig;
    private quotas: TenantQuotas;
    private readonly createdAt: Timestamp;
    private updatedAt: Timestamp;
}
```

**Invariants:**

1. Slug е уникален глобално
2. Tier определя max quotas
3. Suspended tenant не може да създава нови ресурси
4. Deleted tenant е soft (data remains for retention period)

#### 7.2.2 Aggregate: Subscription

```typescript
export class Subscription extends AggregateRoot<SubscriptionId> {
    private readonly id: SubscriptionId;
    private readonly tenantId: TenantId;
    private plan: Plan;
    private status: SubscriptionStatus;  // TRIAL, ACTIVE, PAST_DUE, CANCELLED
    private currentPeriodStart: Timestamp;
    private currentPeriodEnd: Timestamp;
    private readonly createdAt: Timestamp;
}
```

### 7.3 Value Objects – Tenant

```typescript
export enum TenantTier {
    COMMUNITY = 'community',
    BUSINESS = 'business',
    ENTERPRISE = 'enterprise'
}

export class TenantQuotas extends ValueObject<{
    storageBytes: number;
    documents: number;
    apiCallsPerDay: number;
    concurrentRenders: number;
    users: number;
    groups: number;
}> {
    public static forTier(tier: TenantTier): TenantQuotas { /* ... */ }
    public canConsume(resource: QuotaResource, amount: number): boolean { /* ... */ }
}
```

### 7.4 Domain Events – Tenant

```typescript
TenantCreated            { tenantId, tier, createdBy }
TenantSuspended          { tenantId, reason }
TenantReactivated        { tenantId }
TenantTierChanged        { tenantId, fromTier, toTier }
QuotaExceeded            { tenantId, resource, limit, attempted }
SubscriptionActivated    { subscriptionId, tenantId, plan }
SubscriptionCancelled    { subscriptionId, reason }
```

---

## 8. Bounded Context: Workflow

### 8.1 Отговорност

Workflow context отговаря за:

- Дефиниции на процеси (workflow definitions)
- Изпълнение (instances)
- Задачи (tasks) и одобрения (approvals)
- Notifications и escalations
- SLA tracking
- Не отговаря за: documents (Document), users (Identity)

### 8.2 Aggregates

#### 8.2.1 Aggregate: WorkflowDefinition

```typescript
export class WorkflowDefinition extends AggregateRoot<WorkflowDefinitionId> {
    private readonly id: WorkflowDefinitionId;
    private readonly tenantId: TenantId;
    private name: string;
    private version: number;
    private steps: WorkflowStep[];
    private status: DefinitionStatus;  // DRAFT, ACTIVE, ARCHIVED
}
```

#### 8.2.2 Aggregate: WorkflowInstance

```typescript
export class WorkflowInstance extends AggregateRoot<WorkflowInstanceId> {
    private readonly id: WorkflowInstanceId;
    private readonly tenantId: TenantId;
    private readonly definitionId: WorkflowDefinitionId;
    private readonly subjectType: string;  // e.g., 'Document'
    private readonly subjectId: string;
    private status: InstanceStatus;  // RUNNING, COMPLETED, FAILED, CANCELLED
    private currentStepIndex: number;
    private steps: StepExecution[];
    private readonly startedAt: Timestamp;
    private completedAt: Timestamp | null;
}
```

#### 8.2.3 Aggregate: Task

```typescript
export class Task extends AggregateRoot<TaskId> {
    private readonly id: TaskId;
    private readonly instanceId: WorkflowInstanceId;
    private readonly assignee: Assignee;  // UserId or Role
    private status: TaskStatus;  // PENDING, IN_PROGRESS, COMPLETED, CANCELLED
    private decision: Decision | null;
    private dueAt: Timestamp | null;
    private escalatedAt: Timestamp | null;
    private readonly createdAt: Timestamp;
    private completedAt: Timestamp | null;
}
```

### 8.3 Domain Events – Workflow

```typescript
WorkflowStarted          { instanceId, definitionId, subjectType, subjectId }
WorkflowCompleted        { instanceId }
WorkflowFailed           { instanceId, error }
TaskCreated              { taskId, instanceId, assignee, dueAt }
TaskAssigned             { taskId, assignee }
TaskCompleted            { taskId, decision, completedBy }
TaskEscalated            { taskId, escalatedTo, reason }
ApprovalGranted          { taskId, approvedBy }
ApprovalRejected         { taskId, rejectedBy, reason }
```

---

## 9. Domain Services vs Application Services

### 9.1 Разграничение

| Aspect                     | Domain Service                   | Application Service      |
| -------------------------- | -------------------------------- | ------------------------ |
| **Located in**       | Domain layer                     | Application layer        |
| **Depends on**       | Domain only                      | Domain + Infrastructure  |
| **Contains**         | Business rules across aggregates | Orchestration            |
| **Transaction**      | Never opens                      | Opens (Unit of Work)     |
| **Publishes events** | Yes (domain events)              | Yes (integration events) |
| **Tests**            | Pure unit                        | Integration              |
| **Example**          | `DocumentMergeService`         | `DocumentAppService`   |

### 9.2 Application Service Example

```typescript
// application/document/document-app-service.ts
export class DocumentAppService {
    constructor(
        private readonly documentRepo: DocumentRepository,
        private readonly documentMergeService: DocumentMergeService,
        private readonly uow: UnitOfWork,
        private readonly eventBus: EventBus
    ) {}

    public async createDocument(cmd: CreateDocumentCommand): Promise<DocumentDto> {
        return this.uow.execute(async () => {
            const doc = Document.create(
                cmd.tenantId, cmd.groupId, cmd.profileId, cmd.userId
            );
            await this.documentRepo.save(doc);
            await this.eventBus.publishAll(doc.pullEvents());
            return DocumentMapper.toDto(doc);
        });
    }

    public async mergeDocuments(cmd: MergeDocumentsCommand): Promise<DocumentDto> {
        return this.uow.execute(async () => {
            const merged = await this.documentMergeService.merge(
                cmd.sourceId, cmd.targetId, cmd.userId, cmd.options
            );
            await this.documentRepo.save(merged);
            // events from merge service are published by uow
            return DocumentMapper.toDto(merged);
        });
    }
}
```

---

## 10. Aggregate Design Principles

### 10.1 Правила за агрегати

1. **Един aggregate = една транзакция.** Никога не модифицирай два агрегата в една транзакция.
2. **Referencing by ID.** Агрегатът реферира друг агрегат само по ID, не по object reference.
3. **Small aggregates.** По-малки = по-добра конкурентност.
4. **Eventual consistency между агрегати.** Чрез domain events + eventual consistency.
5. **Invariants вътре в агрегата.** Всичко, което трябва да е атомарно, е в един агрегат.
6. **Root е единственият вход.** Външният свят не достъпва entities директно.
7. **Value objects са immutable.**
8. **Domain events се публикуват след успешна транзакция.**

### 10.2 Размер на агрегатите

| Aggregate        | Размер                 | Обосновка                                 |
| ---------------- | ---------------------------- | -------------------------------------------------- |
| Document         | Голям (versions, links) | Нужна атомарност при add version |
| Person           | Среден                 | Contacts/addresses са част от identity     |
| Organization     | Среден                 | Similar to Person                                  |
| User             | Малък                   | Independent lifecycle                              |
| Employee         | Малък                   | Independent lifecycle                              |
| Record           | Малък                   | Schema-driven data                                 |
| Signature        | Малък                   | Immutable                                          |
| QRToken          | Малък                   | Simple lifecycle                                   |
| Template         | Среден                 | Versioning                                         |
| RenderJob        | Малък                   | Independent                                        |
| AuditChain       | Голям (append-only)     | Append atomic                                      |
| Tenant           | Малък                   | Config only                                        |
| WorkflowInstance | Среден                 | Steps atomic                                       |
| Task             | Малък                   | Independent                                        |

### 10.3 Reference by ID – пример

```typescript
// ❌ ГРЕШНО: директна референция
class Document {
    private group: Group;  // object reference
}

// ✅ ПРАВИЛНО: reference by ID
class Document {
    private groupId: GroupId;  // value object with ID
}
```

---

## 11. Event Catalog

### 11.1 Domain Events (вътрешни, in-process)

| Event                | Context      | Payload                    |
| -------------------- | ------------ | -------------------------- |
| DocumentCreated      | Document     | documentId, tenantId       |
| DocumentVersionAdded | Document     | documentId, versionId      |
| DocumentLinked       | Document     | documentId, targetId, type |
| DocumentArchived     | Document     | documentId, reason         |
| PersonCreated        | Identity     | personId, tenantId         |
| PersonMerged         | Identity     | sourceId, targetId         |
| UserRoleGranted      | Identity     | userId, role               |
| SignatureCreated     | Verification | signatureId, versionId     |
| QRTokenGenerated     | Verification | qrTokenId, documentId      |
| DocumentVerified     | Verification | documentId, result         |
| TemplatePublished    | Template     | templateId, versionId      |
| RenderJobCompleted   | Template     | jobId, file, hash          |
| AuditEntryAppended   | Audit        | entryId, eventType         |
| AuditIntegrityBroken | Audit        | chainId                    |
| TenantSuspended      | Tenant       | tenantId, reason           |
| WorkflowStarted      | Workflow     | instanceId, subjectId      |

### 11.2 Integration Events (външни, cross-context)

| Event                  | Published by | Consumed by           |
| ---------------------- | ------------ | --------------------- |
| document.created       | Document     | Audit, Workflow       |
| document.version.added | Document     | Verification, Audit   |
| document.verified      | Verification | Audit, Workflow       |
| document.rendered      | Template     | Document, Audit       |
| user.created           | Identity     | Audit                 |
| tenant.suspended       | Tenant       | Всички contexts |
| audit.integrity.broken | Audit        | Alerting, Operations  |

### 11.3 Event Schema (canonical)

```typescript
export interface IntegrationEvent {
    id: string;                    // ULID
    type: string;                  // e.g., 'document.created'
    version: string;               // '1.0'
    source: string;                // 'document-service'
    tenantId: string;
    occurredAt: string;            // ISO 8601
    correlationId: string;
    causationId: string | null;
    data: Record<string, unknown>;
    metadata: {
        userId?: string;
        ipAddress?: string;
        userAgent?: string;
    };
}
```

---

## 12. Invariants – Master List

### 12.1 Document Context

- INV-D-01: Document принадлежи на точно един tenant
- INV-D-02: Document има поне една версия или е DRAFT
- INV-D-03: Версиите са immutable след publish
- INV-D-04: Hash на версия е уникален в document
- INV-D-05: Archived document не може да получи нова версия
- INV-D-06: Max 1000 версии per document
- INV-D-07: Self-link е забранен
- INV-D-08: Duplicate link е забранен

### 12.2 Identity Context

- INV-I-01: Person има поне едно име
- INV-I-02: External identifier е уникален в tenant
- INV-I-03: Registration number е уникален в tenant
- INV-I-04: Email е уникален в tenant
- INV-I-05: User има поне една роля
- INV-I-06: Последният Admin не може да се изтрие
- INV-I-07: Само един active Employee за (Person, Organization)
- INV-I-08: validFrom < validTo

### 12.3 Verification Context

- INV-V-01: Algorithm е разрешен
- INV-V-02: Signature value е валиден
- INV-V-03: QR token е >= 128 bits random
- INV-V-04: QR token е уникален
- INV-V-05: Expired/revoked token е невалиден
- INV-V-06: Signature е immutable

### 12.4 Template Context

- INV-T-01: Content съдържа само декларирани variables
- INV-T-02: VariableSchema е валидна
- INV-T-03: Published template е immutable
- INV-T-04: Variables отговарят на schema
- INV-T-05: Max 3 attempts на RenderJob

### 12.5 Audit Context

- INV-A-01: Append-only
- INV-A-02: Всяка entry съдържа hash на предходната
- INV-A-03: Anchor е immutable
- INV-A-04: Entry не може да се изтрие

### 12.6 Tenant Context

- INV-TN-01: Slug е уникален глобално
- INV-TN-02: Tier определя max quotas
- INV-TN-03: Suspended tenant не може да създава ресурси
- INV-TN-04: Deleted tenant е soft

### 12.7 Workflow Context

- INV-W-01: Instance има валиден definition
- INV-W-02: Task има assignee
- INV-W-03: Completed task не може да се променя
- INV-W-04: Steps се изпълняват последователно

---

## 13. Domain Model – Code Structure

```
src/
├── domain/
│   ├── document/
│   │   ├── aggregates/
│   │   │   └── document.ts
│   │   ├── entities/
│   │   │   ├── document-version.ts
│   │   │   └── document-link.ts
│   │   ├── value-objects/
│   │   │   ├── document-id.ts
│   │   │   ├── document-metadata.ts
│   │   │   ├── file-reference.ts
│   │   │   ├── classification.ts
│   │   │   └── archive-reason.ts
│   │   ├── events/
│   │   │   ├── document-created.ts
│   │   │   ├── document-version-added.ts
│   │   │   └── ...
│   │   ├── services/
│   │   │   └── document-merge-service.ts
│   │   ├── repositories/
│   │   │   └── document-repository.ts
│   │   └── errors/
│   │       ├── document-archived-error.ts
│   │       └── ...
│   ├── identity/
│   │   ├── aggregates/
│   │   │   ├── person.ts
│   │   │   ├── organization.ts
│   │   │   ├── user.ts
│   │   │   ├── employee.ts
│   │   │   └── record.ts
│   │   ├── entities/
│   │   ├── value-objects/
│   │   ├── events/
│   │   ├── services/
│   │   ├── repositories/
│   │   └── errors/
│   ├── verification/
│   │   ├── aggregates/
│   │   │   ├── signature.ts
│   │   │   └── qr-token.ts
│   │   ├── entities/
│   │   │   └── verification-record.ts
│   │   ├── value-objects/
│   │   ├── events/
│   │   ├── services/
│   │   │   └── verification-service.ts
│   │   ├── repositories/
│   │   └── errors/
│   ├── template/
│   │   ├── aggregates/
│   │   │   ├── template.ts
│   │   │   └── render-job.ts
│   │   ├── value-objects/
│   │   ├── events/
│   │   ├── services/
│   │   │   └── rendering-service.ts
│   │   ├── repositories/
│   │   └── errors/
│   ├── audit/
│   │   ├── aggregates/
│   │   │   └── audit-chain.ts
│   │   ├── entities/
│   │   │   └── audit-entry.ts
│   │   ├── value-objects/
│   │   ├── events/
│   │   ├── services/
│   │   │   └── audit-service.ts
│   │   ├── repositories/
│   │   └── errors/
│   ├── tenant/
│   │   ├── aggregates/
│   │   │   ├── tenant.ts
│   │   │   └── subscription.ts
│   │   ├── value-objects/
│   │   ├── events/
│   │   ├── repositories/
│   │   └── errors/
│   ├── workflow/
│   │   ├── aggregates/
│   │   │   ├── workflow-definition.ts
│   │   │   ├── workflow-instance.ts
│   │   │   └── task.ts
│   │   ├── value-objects/
│   │   ├── events/
│   │   ├── services/
│   │   ├── repositories/
│   │   └── errors/
│   └── shared/
│       ├── base/
│       │   ├── aggregate-root.ts
│       │   ├── entity.ts
│       │   ├── value-object.ts
│       │   ├── domain-event.ts
│       │   └── domain-error.ts
│       └── value-objects/
│           ├── tenant-id.ts
│           ├── user-id.ts
│           ├── timestamp.ts
│           ├── content-hash.ts
│           ├── email.ts
│           └── ...
```

---

## 14. ADR – Architecture Decision Records (част 01)

### ADR-001: Domain-Driven Design като основен подход

**Status:** Accepted
**Context:** Трябва подход за modeling на сложна бизнес логика.
**Decision:** DDD с bounded contexts, aggregates, domain events.
**Consequences:**

- + Ясни граници, тестваемост, независимо развитие
- − По-голям upfront investment
- − Изисква опит в екипа

### ADR-002: Event-Driven Architecture

**Status:** Accepted
**Context:** Трябва loose coupling между contexts.
**Decision:** Domain events in-process + integration events cross-service.
**Consequences:**

- + Loose coupling, extensibility
- − Eventual consistency
- − Debugging complexity

### ADR-003: ULID за ID генерация

**Status:** Accepted
**Context:** Трябва ID-та, които са sortable, unique, URL-safe.
**Decision:** ULID (Universally Unique Lexicographically Sortable Identifier).
**Consequences:**

- + Sortable, no coordination
- + URL-safe
- − 26 chars vs UUID 36

### ADR-004: Reference by ID между агрегати

**Status:** Accepted
**Decision:** Агрегатите реферират други агрегати само по ID.
**Consequences:**

- + Small aggregates, по-добра конкурентност
- − Изисква explicit loading
- − Eventual consistency

### ADR-005: Audit като отделен context

**Status:** Accepted
**Context:** Audit трябва да е immutable и tamper-evident.
**Decision:** Отделен bounded context, append-only, hash-chain.
**Consequences:**

- + Compliance ready
- + Tamper-evident
- − Storage growth
- − Complex queries

### ADR-006: Shared Kernel само за Value Objects

**Status:** Accepted
**Decision:** Само immutable VOs в shared kernel.
**Consequences:**

- + Няма coupling през entities
- − Дублиране на някои helpers

### ADR-007: Verification като отделен context

**Status:** Accepted
**Context:** Verification има собствена логика (crypto, tokens).
**Decision:** Отделен bounded context.
**Consequences:**

- + Независимо развитие
- + Може да се изнесе като услуга
- − Допълнителна сложност

---

## 15. Testing Strategy – Domain Layer

### 15.1 Unit Tests

**Правило:** Всеки aggregate, entity, value object, domain service има unit tests.

**Пример – Document aggregate:**

```typescript
describe('Document', () => {
    describe('addVersion', () => {
        it('adds version and increments count', () => { /* ... */ });
        it('throws when archived', () => { /* ... */ });
        it('throws on duplicate hash', () => { /* ... */ });
        it('throws when max versions exceeded', () => { /* ... */ });
        it('emits DocumentVersionAdded event', () => { /* ... */ });
        it('sets status to ACTIVE', () => { /* ... */ });
    });

    describe('linkTo', () => {
        it('creates link', () => { /* ... */ });
        it('throws on self-link', () => { /* ... */ });
        it('throws on duplicate', () => { /* ... */ });
    });
});
```

### 15.2 Property-Based Tests

```typescript
// fast-check
fc.assert(
    fc.property(fc.array(versionArb), (versions) => {
        const doc = Document.create(...);
        versions.forEach(v => doc.addVersion(v.file, v.hash, v.user));
        expect(doc.getVersions()).toHaveLength(versions.length);
        expect(doc.getVersions()).toEqual([...doc.getVersions()].sort(byVersion));
    })
);
```

### 15.3 Coverage Targets

| Layer           | Coverage |
| --------------- | -------- |
| Aggregates      | 95%      |
| Entities        | 90%      |
| Value Objects   | 100%     |
| Domain Services | 90%      |
| Domain Events   | 100%     |

### 15.4 Test Data Builders

```typescript
class DocumentBuilder {
    private tenantId = TenantId.generate();
    private groupId = GroupId.generate();
    private profileId = ProfileId.generate();
    private versions: DocumentVersion[] = [];

    withTenant(id: TenantId): this { this.tenantId = id; return this; }
    withVersions(v: DocumentVersion[]): this { this.versions = v; return this; }

    build(): Document {
        const doc = Document.create(this.tenantId, this.groupId, this.profileId, UserId.generate());
        this.versions.forEach(v => doc.addVersion(v.file, v.hash, v.createdBy));
        doc.pullEvents();  // clear
        return doc;
    }
}
```

---

## 16. Anti-Corruption Layers

### 16.1 Identity → Document ACL

```typescript
// application/document/acl/identity-acl.ts
export class IdentityAcl {
    constructor(private readonly identityClient: IdentityClient) {}

    /**
     * Document context не знае за Person/Organization.
     * Знае само за "RecordReference".
     */
    public async toRecordReference(
        recordId: RecordId,
        tenantId: TenantId
    ): Promise<RecordReference> {
        const record = await this.identityClient.getRecord(recordId, tenantId);
        if (!record) throw new RecordNotFoundError(recordId);
        return RecordReference.from({
            id: record.id,
            type: record.type,
            displayName: record.displayName
        });
    }
}
```

### 16.2 Document → Verification ACL

```typescript
// application/verification/acl/document-acl.ts
export class DocumentAcl {
    public async getVersionForVerification(
        documentId: DocumentId,
        versionId: DocumentVersionId
    ): Promise<VerificationTarget> {
        const doc = await this.documentClient.get(documentId);
        const version = doc.versions.find(v => v.id === versionId);
        return {
            documentId: doc.id,
            versionId: version.id,
            contentHash: version.hash,
            fileReference: version.file,
            signature: version.signature
        };
    }
}
```

---

## 17. Integration Patterns между Contexts

### 17.1 Synchronous (Query)

```
Document Context  ──query──►  Identity Context
                  ◄──result──
```

**Използва се за:** Read operations, справки.

### 17.2 Asynchronous (Event)

```
Document Context  ──event──►  [Event Bus]  ──event──►  Audit Context
                                          ──event──►  Workflow Context
                                          ──event──►  Notification Context
```

**Използва се за:** Side effects, reactions, choreography.

### 17.3 Saga (Process Manager)

```
DocumentMergeSaga:
  1. Archive source ──► Document Context
  2. Archive target ──► Document Context
  3. Create merged ──► Document Context
  4. On failure ──► Compensate (restore source/target)
```

**Използва се за:** Multi-aggregate transactions.

---

## 18. Заключение на част 01

Domain Model-ът дефинира **езика и границите** на платформата. Той е:

- **Стабилен** – промени само при промяна в бизнеса
- **Независим** – не знае за БД, API, UI
- **Тестваем** – pure functions, in-memory tests
- **Разширяем** – нов context = нов модул

**Ключови решения в тази част:**

1. 7 bounded contexts с ясни граници
2. Core: Document, Verification, Template
3. Shared Kernel само за VO
4. ACL между contexts
5. Aggregates с малки граници
6. Reference by ID
7. Domain Events + Integration Events
8. Append-only Audit Chain
9. 8 ADR-та
10. Testing strategy с coverage targets

**Какво следва:**

- Част 02: Multi-Tenancy Architecture
- Част 03: Security Architecture
- ...

---

## 19. Приложения

- **A.** Пълен глосар (Ubiquitous Language)
- **B.** Context Map (детайлен)
- **C.** Aggregate diagrams (всички)
- **D.** Event catalog (пълен)
- **E.** Invariants master list
- **F.** ADR-001 до ADR-008
- **G.** Code structure template

---

**Край на DOCFLOW Enterprise v4.1 – Част 01: Domain Model.**

---

## Следваща стъпка

Тази част е **основата**. Всичко останало (API, DB, UI) ще следва този модел.

**Кажи ми:**

1. **Одобряваш ли Domain Model-а?**
2. **Кой context искаш да задълбоча допълнително?** (Document, Identity, Verification, Template, Audit, Tenant, Workflow)
3. **Или преминаваме към Част 02: Multi-Tenancy Architecture?**

**Когато си готов, стартираме Част 02 в нов чат.**
