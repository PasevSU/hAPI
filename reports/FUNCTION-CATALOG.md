# Каталог на функциите и покритието им с тестове

> **Генериран документ.** Пише се от `node scripts/function-catalog.cjs`; не се редактира на ръка.
> „Покрита“ значи, че името на функцията се среща в тест — това е прокси, а не доказателство
> за поведение. Затова `tests/function-catalog.cjs` изисква всяка непокрита функция да е в
> изричен списък с причина и този списък може само да се свива.

| Показател | Стойност |
| --- | --- |
| Модули с изнесени символи | 50 |
| Изнасяни символи (функции + константи) | **401** |
| От тях функции | **358** |
| Покрити функции | **358** |
| Непокрити функции | **0** |

## hapi_enterprise/api-registry.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `ensure` | функция | да |
| `paths` | функция | да |
| `read` | функция | да |
| `remove` | функция | да |

## hapi_enterprise/config-profiles.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `get` | функция | да |
| `list` | функция | да |
| `remove` | функция | да |
| `save` | функция | да |

## hapi_enterprise/container.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `clear` | функция | да |
| `get` | функция | да |
| `has` | функция | да |
| `list` | функция | да |
| `register` | функция | да |
| `registerValue` | функция | да |

## hapi_enterprise/decision-sensors.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `evaluate` | функция | да |

## hapi_enterprise/directory.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `addContact` | функция | да |
| `addOrganization` | функция | да |
| `addRule` | функция | да |
| `addVariable` | функция | да |
| `ingest` | функция | да |
| `ORG_KINDS` | константа | **не** |
| `patchContact` | функция | да |
| `patchOrganization` | функция | да |
| `patchVariable` | функция | да |
| `removeContact` | функция | да |
| `removeOrganization` | функция | да |
| `removeRule` | функция | да |
| `removeVariable` | функция | да |
| `resolveConflict` | функция | да |
| `sanitizeAddresses` | функция | да |
| `sanitizeExtras` | функция | да |
| `state` | функция | да |
| `TYPES` | константа | да |

## hapi_enterprise/download-access.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `behaviour` | функция | да |
| `ok` | функция | да |

## hapi_enterprise/download-stream.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `acquire` | функция | да |
| `release` | функция | да |
| `stream` | функция | да |

## hapi_enterprise/error-log.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `append` | функция | да |
| `list` | функция | да |

## hapi_enterprise/event-bus.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `emit` | функция | да |
| `events` | функция | да |
| `listenerCount` | функция | да |
| `off` | функция | да |
| `on` | функция | да |
| `once` | функция | да |

## hapi_enterprise/event-stream.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `broadcast` | функция | да |
| `closeAll` | функция | да |
| `open` | функция | да |
| `stats` | функция | да |

## hapi_enterprise/export-manager.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `preflight` | функция | да |
| `resume` | функция | да |

## hapi_enterprise/export-rules.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `format` | функция | да |
| `packageId` | функция | да |

## hapi_enterprise/gateway-api.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `BUNDLED_DIR` | константа | **не** |
| `config` | функция | да |
| `CONFIG_DIR` | константа | да |
| `decideFile` | функция | да |
| `defaultSeedDir` | функция | да |
| `downloadUrlFor` | функция | да |
| `exportPreflight` | функция | да |
| `exportRulesPayload` | функция | да |
| `fileModeFor` | функция | да |
| `fileView` | функция | да |
| `overrideFor` | функция | да |
| `portalMode` | функция | да |
| `portalView` | функция | да |
| `readJson` | функция | да |
| `reload` | функция | да |
| `RULE_FILES` | константа | да |
| `ruleDirs` | функция | да |
| `seedRules` | функция | да |
| `setLogger` | функция | да |
| `status` | функция | да |
| `urlsFor` | функция | да |

## hapi_enterprise/generator.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `index` | функция | да |
| `list` | функция | да |
| `read` | функция | да |
| `remove` | функция | да |
| `save` | функция | да |
| `seed` | функция | да |

## hapi_enterprise/idempotency.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `handle` | функция | да |

## hapi_enterprise/instance-lock.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `acquire` | функция | да |
| `DEFAULT_STALE_MS` | константа | **не** |
| `FILE` | константа | да |
| `heartbeat` | функция | да |
| `heartbeatShared` | функция | да |
| `inspect` | функция | да |
| `joinShared` | функция | да |
| `leaveShared` | функция | да |
| `listShared` | функция | да |
| `lockPath` | функция | да |
| `PEERS_DIR` | константа | да |
| `peersDir` | функция | да |
| `pruneShared` | функция | да |
| `release` | функция | да |

## hapi_enterprise/layout.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `entries` | функция | да |

## hapi_enterprise/load-control.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `effective` | функция | да |
| `heapRatio` | функция | да |

## hapi_enterprise/logger.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `at` | функция | да |

## hapi_enterprise/migration-bridge.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `analyze` | функция | да |
| `contacts` | функция | да |
| `migrate` | функция | да |

## hapi_enterprise/mirror-target.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `endpoint` | функция | да |
| `region` | функция | да |

## hapi_enterprise/observer.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `close` | функция | да |
| `download` | функция | да |
| `fileDelete` | функция | да |
| `fileUpload` | функция | да |
| `flush` | функция | да |
| `mirrorFailed` | функция | да |
| `normalizePath` | функция | да |
| `observe` | функция | да |
| `prometheus` | функция | да |
| `snapshot` | функция | да |
| `visit` | функция | да |

## hapi_enterprise/oidc.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `b64url` | функция | да |
| `CODE` | константа | да |
| `config` | функция | да |
| `cookie` | функция | да |
| `createDiscovery` | функция | да |
| `createFlows` | функция | да |
| `createJwks` | функция | да |
| `FLOW_TTL_MS` | константа | да |
| `groupsOf` | функция | да |
| `permitted` | функция | да |
| `roleFor` | функция | да |
| `sessionCookie` | функция | да |
| `sha256` | функция | да |
| `verifyIdToken` | функция | да |

## hapi_enterprise/package-crypto.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `decrypt` | функция | да |
| `describe` | функция | да |
| `encrypt` | функция | да |
| `generatePassword` | функция | да |
| `info` | функция | да |
| `isContainer` | функция | да |
| `MAGIC` | константа | да |
| `MAX_PASSWORD` | константа | **не** |
| `MIN_PASSWORD` | константа | **не** |

## hapi_enterprise/path-crypto.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `openPath` | функция | да |
| `pathField` | функция | да |
| `pathOf` | функция | да |
| `publicText` | функция | да |
| `reload` | функция | да |
| `requireEncryptionKey` | функция | да |
| `sealAll` | функция | да |
| `sealPath` | функция | да |
| `signDetached` | функция | да |
| `signing` | функция | да |
| `status` | функция | да |
| `unwrapSecret` | функция | да |
| `wrapSecret` | функция | да |

## hapi_enterprise/pdf-writer.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `glyph` | функция | да |

## hapi_enterprise/pgp-sign.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `artifact` | функция | да |
| `listFolder` | функция | да |
| `manifestFor` | функция | да |
| `resolveInput` | функция | да |
| `sign` | функция | да |

## hapi_enterprise/pgp-tools.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `canSign` | функция | да |
| `find` | функция | да |
| `keyId` | функция | да |
| `keys` | функция | да |
| `optionsKey` | функция | да |
| `publicKeyFor` | функция | да |
| `signer` | функция | да |
| `verify` | функция | да |
| `view` | функция | да |

## hapi_enterprise/pgp.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `AEAD_MODES` | константа | да |
| `ALGO` | константа | **не** |
| `armor` | функция | да |
| `bits` | функция | да |
| `crc24` | функция | да |
| `dearmor` | функция | да |
| `decryptMessage` | функция | да |
| `describe` | функция | да |
| `encryptToKey` | функция | да |
| `generate` | функция | да |
| `keys` | функция | да |
| `packet` | функция | да |
| `parseKeyBlock` | функция | да |
| `publicKeyOf` | функция | да |
| `readPackets` | функция | да |
| `rolesOfKeyFlags` | функция | да |
| `signDetached` | функция | да |
| `signingKey` | функция | да |
| `storageKeyOf` | функция | да |
| `verifyDetached` | функция | да |

## hapi_enterprise/plugins.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `all` | функция | да |
| `get` | функция | да |
| `has` | функция | да |
| `list` | функция | да |
| `register` | функция | да |

## hapi_enterprise/portal-integrity.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `intervalMs` | функция | да |
| `sha256` | функция | да |

## hapi_enterprise/portal-policy.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `clearCookie` | функция | да |
| `decide` | функция | да |
| `digest` | функция | да |
| `isSecureRequest` | функция | да |
| `readSessionToken` | функция | да |
| `sessionCookie` | функция | да |
| `snapshot` | функция | да |
| `userMayPortal` | функция | да |

## hapi_enterprise/portal-qr.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `activeRevision` | функция | да |
| `buildArchive` | функция | да |
| `DEPTH_CODE` | константа | **не** |
| `depthOf` | функция | да |
| `ensureFirst` | функция | да |
| `files` | функция | да |
| `manifestFor` | функция | да |
| `MAX_DEPTH` | константа | да |
| `policy` | функция | да |
| `qrIdOf` | функция | да |
| `registry` | функция | да |
| `sha256` | функция | да |
| `stats` | функция | да |
| `tooDeep` | функция | да |
| `unpack` | функция | да |
| `walk` | функция | да |

## hapi_enterprise/portal-skin.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `skin` | функция | да |
| `SKINS` | константа | **не** |
| `stylesheet` | функция | да |
| `warnEncryptionWithoutKey` | функция | да |

## hapi_enterprise/public-gateway.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `visibility` | функция | да |

## hapi_enterprise/public-package.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `issue` | функция | да |
| `prune` | функция | да |
| `redeem` | функция | да |

## hapi_enterprise/rbac.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `allowed` | функция | да |
| `capabilitiesOf` | функция | да |
| `resolve` | функция | да |

## hapi_enterprise/registry.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `fieldsFor` | функция | да |
| `getProfile` | функция | да |
| `label` | функция | да |
| `listProfiles` | функция | да |
| `validateField` | функция | да |
| `validateRecord` | функция | да |

## hapi_enterprise/report-stamp.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `BINDING` | константа | да |
| `closingDigest` | функция | да |
| `NOT_REQUESTED` | константа | да |
| `stampReport` | функция | да |
| `startFields` | функция | да |
| `stopFields` | функция | да |
| `TOKEN_FORMAT` | константа | **не** |

## hapi_enterprise/retention.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `apply` | функция | да |
| `evidenceIndex` | функция | да |
| `preview` | функция | да |

## hapi_enterprise/secret-links.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `adminView` | функция | да |
| `ALPHABET` | константа | **не** |
| `createRecord` | функция | да |
| `DEFAULT_TTL_SECONDS` | константа | **не** |
| `DEFAULT_VIEWS` | константа | **не** |
| `FRAGMENT_LENGTH` | константа | да |
| `HASH_LENGTH` | константа | **не** |
| `ID_LENGTH` | константа | да |
| `idHashOf` | функция | да |
| `inspectRecord` | функция | да |
| `isValidHash` | функция | да |
| `isValidId` | функция | да |
| `isValidIv` | функция | да |
| `isValidKey` | функция | да |
| `IV_BYTES` | константа | **не** |
| `KEY_BYTES` | константа | **не** |
| `KEY_LENGTH` | константа | да |
| `list` | функция | да |
| `MAX_CIPHERTEXT_BYTES` | константа | да |
| `MAX_HINT_LENGTH` | константа | **не** |
| `MAX_PBKDF2_ITERATIONS` | константа | **не** |
| `MAX_TTL_SECONDS` | константа | да |
| `MAX_VIEWS` | константа | да |
| `MIN_PBKDF2_ITERATIONS` | константа | **не** |
| `newFragment` | функция | да |
| `newId` | функция | да |
| `newReceipt` | функция | да |
| `normalizeEnvelope` | функция | да |
| `normalizeHint` | функция | да |
| `parseFragment` | функция | да |
| `read` | функция | да |
| `readRecord` | функция | да |
| `RECEIPT_LENGTH` | константа | да |
| `recordPath` | функция | да |
| `remove` | функция | да |
| `SALT_BYTES` | константа | **не** |
| `save` | функция | да |
| `secretsDir` | функция | да |
| `sweep` | функция | да |

## hapi_enterprise/send.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `adminView` | функция | да |
| `ALPHABET` | константа | **не** |
| `canAccess` | функция | да |
| `createRecord` | функция | да |
| `hashPassphrase` | функция | да |
| `ID_LENGTH` | константа | да |
| `isExhausted` | функция | да |
| `isExpired` | функция | да |
| `isProtected` | функция | да |
| `mintTicket` | функция | да |
| `newId` | функция | да |
| `TICKET_TTL_MS` | константа | **не** |
| `verifyPassphrase` | функция | да |
| `verifyTicket` | функция | да |

## hapi_enterprise/server.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `id` | функция | да |
| `revisions` | функция | да |

## hapi_enterprise/shared-data.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `acquire` | функция | да |
| `clone` | функция | да |
| `data` | функция | да |
| `keys` | функция | да |
| `onChange` | функция | да |
| `peek` | функция | да |
| `reconcile` | функция | да |
| `refresh` | функция | да |
| `release` | функция | да |
| `state` | функция | да |
| `sync` | функция | да |
| `transaction` | функция | да |

## hapi_enterprise/sqlite-store.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `backup` | функция | да |
| `completeIdempotency` | функция | да |
| `completeWebhookDelivery` | функция | да |
| `countPendingWebhookDeliveries` | функция | да |
| `createPortalSession` | функция | да |
| `createPortalToken` | функция | да |
| `createSession` | функция | да |
| `createUser` | функция | да |
| `createWebhook` | функция | да |
| `deletePortalSession` | функция | да |
| `deleteSession` | функция | да |
| `deleteUser` | функция | да |
| `deleteUserSessions` | функция | да |
| `deleteWebhook` | функция | да |
| `dueWebhookDeliveries` | функция | да |
| `enqueueWebhookDelivery` | функция | да |
| `failWebhookDelivery` | функция | да |
| `forgetIdempotency` | функция | да |
| `getIdempotency` | функция | да |
| `getPortalSession` | функция | да |
| `getPortalTokenByHash` | функция | да |
| `getPortalUsers` | функция | да |
| `getSession` | функция | да |
| `getUser` | функция | да |
| `getUserCases` | функция | да |
| `getUserPortals` | функция | да |
| `getWebhook` | функция | да |
| `listPortalTokens` | функция | да |
| `listUsers` | функция | да |
| `listWebhooks` | функция | да |
| `load` | функция | да |
| `purgeExpiredPortalAccess` | функция | да |
| `purgeExpiredSessions` | функция | да |
| `purgeIdempotency` | функция | да |
| `purgeWebhookDeliveries` | функция | да |
| `quickCheck` | функция | да |
| `reserveIdempotency` | функция | да |
| `restoreFrom` | функция | да |
| `revision` | функция | да |
| `revokePortalToken` | функция | да |
| `save` | функция | да |
| `setPortalUsers` | функция | да |
| `setUserCases` | функция | да |
| `setUserPortals` | функция | да |
| `setWebhookDisabled` | функция | да |
| `snapshot` | функция | да |
| `stats` | функция | да |
| `touchWebhook` | функция | да |
| `updateUser` | функция | да |
| `usePortalToken` | функция | да |

## hapi_enterprise/tsa-client.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `ALGORITHMS` | константа | да |
| `breakerSnapshot` | функция | да |
| `buildRequest` | функция | да |
| `normalizeAlgorithm` | функция | да |
| `normalizeDigest` | функция | да |
| `normalizeUrl` | функция | да |
| `parseResponse` | функция | да |
| `parseTstInfo` | функция | да |
| `resetBreaker` | функция | да |
| `stamp` | функция | да |
| `stampOne` | функция | да |
| `STATUS_TEXT` | константа | **не** |

## hapi_enterprise/webhooks.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `drain` | функция | да |
| `enabled` | функция | да |
| `forget` | функция | да |
| `publish` | функция | да |
| `remember` | функция | да |
| `remove` | функция | да |
| `setDisabled` | функция | да |
| `sign` | функция | да |
| `start` | функция | да |
| `status` | функция | да |
| `stop` | функция | да |
| `subscribe` | функция | да |
| `test` | функция | да |

## hapi_enterprise/workdir-io.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `on` | функция | да |
| `pack` | функция | да |
| `read` | функция | да |
| `size` | функция | да |

## hapi_enterprise/workdir-migrate.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `sealPortals` | функция | да |

## hapi_enterprise/worm.js

| Символ | Вид | Тест |
| --- | --- | --- |
| `isSealed` | функция | да |
| `seal` | функция | да |
| `sealManifest` | функция | да |
| `unseal` | функция | да |
| `vaultCheck` | функция | да |
| `vaultPut` | функция | да |
| `vaultRestore` | функция | да |
| `vaultStats` | функция | да |
| `verify` | функция | да |

