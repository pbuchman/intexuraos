# Domain Colocation Refactoring — Dependency Inventory

> **STATUS: COMPLETED**  
> This document is historical. The refactoring described here has been completed.  
> Domain and infra code is now colocated in apps (`apps/*/src/domain/` and `apps/*/src/infra/`).  
> See [package-contracts.md](./package-contracts.md) for current architecture.

**Created:** 2024-12-23  
**Completed:** 2024-12-23  
**Branch:** `refactor/colocate-domain`

---

## Domain Package Inventory (HISTORICAL)

### `@intexuraos/domain-identity`

**Location:** `packages/domain/identity/`

**Exports:**

- Models: `AuthTokens`, `AuthTokensPublic`, `RefreshResult`, `AuthError`, `AuthErrorCode`
- Ports: `AuthTokenRepository`, `Auth0Client`

**Importers (apps):**
| App | Import | File |
|-----|--------|------|
| auth-service | `type { AuthTokens }` | `v1/routes/deviceRoutes.ts` |
| auth-service | `type { AuthTokens }` | `v1/routes/tokenRoutes.ts` |

**Proposed Owner:** `auth-service`

**Status:** Single-service usage. Direct colocate candidate.

---

### `@intexuraos/domain-inbox`

**Location:** `packages/domain/inbox/`

**Exports:**

- Models: `InboxNote`, `InboxAction`, `InboxNoteSource`, `InboxMessageType`, `InboxContentType`, `InboxNoteStatus`, `InboxProcessor`, `InboxTopic`, `InboxActionStatus`, `InboxActionType`, `InboxActionAgent`, `InboxActionPriority`, `InboxErrorCode`, `InboxError`, `InboxResult`
- Ports: `InboxNotesRepository`, `InboxActionsRepository`, `WhatsAppUserMapping`, `WhatsAppUserMappingPublic`, `WhatsAppUserMappingRepository`, `WebhookProcessingStatus`, `IgnoredReason`, `WhatsAppWebhookEvent`, `WhatsAppWebhookEventRepository`
- Use cases: `ProcessWhatsAppWebhookUseCase`, `WhatsAppWebhookPayload`, `WebhookProcessingConfig`, `WebhookProcessingResult`

**Importers (apps):**
| App | Import | File |
|-----|--------|------|
| whatsapp-service | Types: `WhatsAppWebhookEventRepository`, `WhatsAppUserMappingRepository`, `InboxNotesRepository` | `services.ts` |
| whatsapp-service | `ProcessWhatsAppWebhookUseCase` | `v1/routes/webhookRoutes.ts` |

**Proposed Owner:** `whatsapp-service`

**Status:** Single-service usage. Direct colocate candidate.

---

### `@intexuraos/domain-promptvault`

**Location:** `packages/domain/promptvault/`

**Exports:**

- Models: `Prompt`, `PromptId`, `CreatePromptInput`, `UpdatePromptInput`, `PromptVaultError`, `PromptVaultErrorCode`, `createPromptVaultError`
- Ports: `PromptRepository`, `NotionConnectionConfig`, `NotionConnectionPublic`, `NotionPage`, `NotionBlock`, `CreatedNote`, `NotionErrorCode`, `NotionError`, `NotionConnectionRepository`, `NotionApiPort`, `IdempotencyLedger`, `CreatePromptVaultNoteParams`
- Use cases: `createPrompt`, `listPrompts`, `getPrompt`, `updatePrompt`, `createCreatePromptUseCase`, `createListPromptsUseCase`, `createGetPromptUseCase`, `createUpdatePromptUseCase`
- Error utilities: `NOTION_ERROR_CODES`, `isNotionErrorCode`, `NotionErrorCodeRuntime`

**Importers (apps):**
| App | Import | File |
|-----|--------|------|
| promptvault-service | Types: `NotionConnectionRepository`, `NotionApiPort`, `PromptRepository` | `services.ts` |
| promptvault-service | Use cases: `createPrompt`, `listPrompts`, `getPrompt`, `updatePrompt` | `v1/routes/promptRoutes.ts` |
| promptvault-service | Type: `PromptVaultErrorCode` | `v1/routes/shared.ts` |
| notion-service | Types: `NotionConnectionRepository`, `NotionApiPort` | `services.ts` |

**Multi-service:** YES (promptvault-service + notion-service)

**Analysis:** Both services share Notion connection types. Two migration strategies:

1. **PREFERRED:** Move to `promptvault-service` and have `notion-service` depend on it (services coupling)
2. **ALTERNATIVE:** Extract shared Notion types to a thin `@intexuraos/common-notion` types package

**Proposed Owner:** `promptvault-service` (primary), with `notion-service` importing from it OR shared types extracted.

---

## Infra Package Inventory

### `@intexuraos/infra-auth0`

**Location:** `packages/infra/auth0/`

**Exports:** `Auth0ClientImpl`, `loadAuth0Config`

**Importers (apps):**
| App | Import | File |
|-----|--------|------|
| auth-service | `Auth0ClientImpl`, `loadAuth0Config` | `v1/routes/tokenRoutes.ts` |

**Dependencies:** `@intexuraos/common`, `@intexuraos/domain-identity`

**Multi-service:** NO (auth-service only)

**Classification:** **COLOCATE** to `apps/auth-service/src/infra/auth0/`

---

### `@intexuraos/infra-firestore`

**Location:** `packages/infra/firestore/`

**Exports:**

- `getFirestore` (client)
- `FirestoreNotionConnectionRepository`
- `FirestoreAuthTokenRepository`
- `FirestoreWhatsAppWebhookEventRepository`
- `FirestoreWhatsAppUserMappingRepository`
- `FakeNotionConnectionRepository` (testing)
- `encryption` utilities

**Importers (apps):**
| App | Import | File |
|-----|--------|------|
| auth-service | `getFirestore` | `server.ts` |
| auth-service | `FirestoreAuthTokenRepository` | `v1/routes/deviceRoutes.ts`, `frontendRoutes.ts`, `tokenRoutes.ts` |
| promptvault-service | `getFirestore` | `server.ts` |
| promptvault-service | `FirestoreNotionConnectionRepository` | `services.ts` |
| promptvault-service | `FakeNotionConnectionRepository` | `__tests__/testUtils.ts` |
| whatsapp-service | `getFirestore` | `server.ts` |
| whatsapp-service | `FirestoreWhatsAppWebhookEventRepository`, `FirestoreWhatsAppUserMappingRepository`, `FirestoreNotionConnectionRepository` | `services.ts` |
| whatsapp-service | Fakes | `__tests__/testUtils.ts` |
| notion-service | `FirestoreNotionConnectionRepository` | `services.ts` |

**Dependencies:** `@intexuraos/common`, `@intexuraos/domain-identity`, `@intexuraos/domain-promptvault`, `@intexuraos/domain-inbox`

**Multi-service:** YES (4 services)

**Analysis:**

- Core `getFirestore` client is shared
- Repository implementations are app-specific:
  - `FirestoreAuthTokenRepository` → auth-service only
  - `FirestoreNotionConnectionRepository` → promptvault + notion + whatsapp
  - `FirestoreWhatsAppWebhookEventRepository` → whatsapp-service only
  - `FirestoreWhatsAppUserMappingRepository` → whatsapp-service only

**Classification:** **SPLIT**

- Keep `getFirestore` client in shared infra (stable, multi-service)
- Colocate repositories to their owning apps

---

### `@intexuraos/infra-notion`

**Location:** `packages/infra/notion/`

**Exports:**

- `NotionApiAdapter`
- `createNotionPromptRepository`
- `NotionInboxNotesRepository`
- `MockNotionApiAdapter` (testing)
- `NotionLogger` type

**Importers (apps):**
| App | Import | File |
|-----|--------|------|
| promptvault-service | `NotionApiAdapter`, `createNotionPromptRepository`, `NotionLogger` | `services.ts`, `server.ts` |
| promptvault-service | `MockNotionApiAdapter`, `createNotionPromptRepository` | `__tests__/testUtils.ts` |
| notion-service | `NotionApiAdapter`, `NotionLogger` | `services.ts`, `server.ts` |
| notion-service | `MockNotionApiAdapter` | `__tests__/testUtils.ts` |
| whatsapp-service | `NotionInboxNotesRepository` | `v1/routes/webhookRoutes.ts` |

**Dependencies:** `@intexuraos/common`, `@intexuraos/domain-promptvault`, `@intexuraos/domain-inbox`, `@notionhq/client`

**Multi-service:** YES (3 services)

**Analysis:**

- `NotionApiAdapter` shared by promptvault + notion services
- `NotionInboxNotesRepository` used only by whatsapp-service
- `createNotionPromptRepository` used only by promptvault-service

**Classification:** **SPLIT**

- Keep `NotionApiAdapter` in shared infra (used by 2 services, stable API)
- Colocate `NotionInboxNotesRepository` to whatsapp-service
- Colocate `createNotionPromptRepository` to promptvault-service

---

## Summary

### Domain Packages — All Colocate

| Package                      | Owner App           | Multi-service?                  | Action                          |
| ---------------------------- | ------------------- | ------------------------------- | ------------------------------- |
| `@intexuraos/domain-identity`    | auth-service        | No                              | Colocate                        |
| `@intexuraos/domain-inbox`       | whatsapp-service    | No                              | Colocate                        |
| `@intexuraos/domain-promptvault` | promptvault-service | Yes (notion-service uses types) | Colocate + extract shared types |

### Infra Packages — Mixed

| Package                   | Shared Part           | Colocate Part              |
| ------------------------- | --------------------- | -------------------------- |
| `@intexuraos/infra-auth0`     | None                  | All → auth-service         |
| `@intexuraos/infra-firestore` | `getFirestore` client | Repositories → owning apps |
| `@intexuraos/infra-notion`    | `NotionApiAdapter`    | Repositories → owning apps |

---

## Migration Order (Recommended)

1. **domain-identity** → auth-service (simplest, no cross-deps)
2. **domain-inbox** → whatsapp-service (single user)
3. **infra-auth0** → auth-service (single user)
4. **domain-promptvault** → promptvault-service (extract shared Notion types first)
5. **infra-firestore** repositories → split to owning apps
6. **infra-notion** repositories → split to owning apps
7. Delete obsolete packages
8. Update build configs
