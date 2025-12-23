# Domain Colocation — Ownership Map

> **STATUS: COMPLETED**  
> This document is historical. The refactoring described here has been completed.  
> Domain and infra code is now colocated in apps (`apps/*/src/domain/` and `apps/*/src/infra/`).  
> See [package-contracts.md](./package-contracts.md) for current architecture.

**Created:** 2024-12-23  
**Completed:** 2024-12-23  
**Branch:** `refactor/colocate-domain`

---

## Target Architecture (COMPLETED)

After migration, each app owns its domain logic in `src/domain/` and app-specific infra in `src/infra/`.

```
apps/
├── auth-service/
│   └── src/
│       ├── domain/
│       │   └── identity/        ← from @praxos/domain-identity
│       │       ├── models/
│       │       │   ├── AuthToken.ts
│       │       │   └── AuthError.ts
│       │       └── ports/
│       │           ├── AuthTokenRepository.ts
│       │           └── Auth0Client.ts
│       └── infra/
│           ├── auth0/           ← from @praxos/infra-auth0
│           │   ├── client.ts
│           │   └── config.ts
│           └── firestore/
│               └── authTokenRepository.ts  ← from @praxos/infra-firestore
│
├── promptvault-service/
│   └── src/
│       ├── domain/
│       │   └── promptvault/     ← from @praxos/domain-promptvault
│       │       ├── models/
│       │       │   ├── Prompt.ts
│       │       │   └── PromptVaultError.ts
│       │       ├── ports/
│       │       │   └── PromptRepository.ts
│       │       └── usecases/
│       │           ├── CreatePromptUseCase.ts
│       │           ├── ListPromptsUseCase.ts
│       │           ├── GetPromptUseCase.ts
│       │           └── UpdatePromptUseCase.ts
│       └── infra/
│           ├── notion/
│           │   └── promptRepository.ts  ← from @praxos/infra-notion
│           └── firestore/
│               └── notionConnectionRepository.ts  ← from @praxos/infra-firestore
│
├── whatsapp-service/
│   └── src/
│       ├── domain/
│       │   └── inbox/           ← from @praxos/domain-inbox
│       │       ├── models/
│       │       │   └── InboxNote.ts
│       │       ├── ports/
│       │       │   └── repositories.ts
│       │       └── usecases/
│       │           └── processWhatsAppWebhook.ts
│       └── infra/
│           ├── notion/
│           │   └── inboxNotesRepository.ts  ← from @praxos/infra-notion
│           └── firestore/
│               ├── whatsappWebhookEventRepository.ts
│               └── whatsappUserMappingRepository.ts
│
├── notion-service/
│   └── src/
│       └── infra/
│           └── firestore/
│               └── notionConnectionRepository.ts  ← SHARED with promptvault
│
└── web/                         ← Frontend (no domain logic)

packages/
├── common/                      ← KEEP: Cross-cutting utilities
│   └── src/
│       ├── result.ts
│       ├── auth.ts
│       └── ...
│
└── infra/
    ├── firestore/               ← KEEP (minimal): Firestore client only
    │   └── src/
    │       └── client.ts        ← getFirestore()
    │
    └── notion/                  ← KEEP (minimal): NotionApiAdapter only
        └── src/
            └── adapter.ts       ← NotionApiAdapter (shared by 2+ apps)
```

---

## Ownership Matrix

### Domain Logic Ownership

| Domain                  | Owner App           | Current Package              | Target Location                                    |
| ----------------------- | ------------------- | ---------------------------- | -------------------------------------------------- |
| Identity (auth, tokens) | auth-service        | `@praxos/domain-identity`    | `apps/auth-service/src/domain/identity/`           |
| Inbox (WhatsApp, notes) | whatsapp-service    | `@praxos/domain-inbox`       | `apps/whatsapp-service/src/domain/inbox/`          |
| PromptVault (prompts)   | promptvault-service | `@praxos/domain-promptvault` | `apps/promptvault-service/src/domain/promptvault/` |

### Infra Adapter Ownership

| Adapter                        | Owner               | Current Package           | Target Location                                 |
| ------------------------------ | ------------------- | ------------------------- | ----------------------------------------------- |
| Auth0Client                    | auth-service        | `@praxos/infra-auth0`     | `apps/auth-service/src/infra/auth0/`            |
| FirestoreAuthTokenRepository   | auth-service        | `@praxos/infra-firestore` | `apps/auth-service/src/infra/firestore/`        |
| NotionPromptRepository         | promptvault-service | `@praxos/infra-notion`    | `apps/promptvault-service/src/infra/notion/`    |
| NotionConnectionRepository     | promptvault-service | `@praxos/infra-firestore` | `apps/promptvault-service/src/infra/firestore/` |
| NotionInboxNotesRepository     | whatsapp-service    | `@praxos/infra-notion`    | `apps/whatsapp-service/src/infra/notion/`       |
| WhatsAppWebhookEventRepository | whatsapp-service    | `@praxos/infra-firestore` | `apps/whatsapp-service/src/infra/firestore/`    |
| WhatsAppUserMappingRepository  | whatsapp-service    | `@praxos/infra-firestore` | `apps/whatsapp-service/src/infra/firestore/`    |

### Shared Infra (Stays in packages/)

| Adapter            | Location                    | Reason                     |
| ------------------ | --------------------------- | -------------------------- |
| `getFirestore()`   | `packages/infra/firestore/` | Used by 4 apps, stable API |
| `NotionApiAdapter` | `packages/infra/notion/`    | Used by 2 apps, stable API |

---

## Cross-Service Dependencies

### After Migration

| Service             | Depends On                                                                             |
| ------------------- | -------------------------------------------------------------------------------------- |
| auth-service        | `@praxos/common`, `@praxos/infra-firestore` (client only)                              |
| promptvault-service | `@praxos/common`, `@praxos/infra-firestore` (client), `@praxos/infra-notion` (adapter) |
| notion-service      | `@praxos/common`, `@praxos/infra-firestore` (client), `@praxos/infra-notion` (adapter) |
| whatsapp-service    | `@praxos/common`, `@praxos/infra-firestore` (client)                                   |
| api-docs-hub        | `@praxos/common`                                                                       |
| web                 | (frontend, no backend packages)                                                        |

---

## Special Cases

### NotionConnectionRepository Sharing

`notion-service` and `promptvault-service` both use `FirestoreNotionConnectionRepository`.

**Resolution:**

- Primary: Move to `promptvault-service` (more use cases)
- `notion-service` duplicates implementation (same Firestore collection, copy is acceptable)
- Alternative: Keep in shared `@praxos/infra-firestore` but ONLY NotionConnectionRepository

### Shared Types Between Services

Types used across services (after domain migration):

- `NotionConnectionConfig`, `NotionConnectionPublic` — used by promptvault + notion
- `NotionApiPort` — interface for NotionApiAdapter

**Resolution:**

- Keep port interfaces in shared `@praxos/infra-notion`
- Domain models stay with owning app
