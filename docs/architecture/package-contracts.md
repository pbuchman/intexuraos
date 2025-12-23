# Package Contracts

This document defines the architectural contracts for PraxOS.
These rules are enforced by ESLint boundaries, CI scripts, and code review.

## Architecture Overview

PraxOS uses **app-first colocation**: each app owns its domain logic and infrastructure adapters.

```
apps/
  <app>/
    src/
      domain/       # Business logic, models, usecases
      infra/        # Adapters (Firestore, Notion, Auth0)
      v1/routes/    # HTTP transport layer
      services.ts   # Service container / DI
packages/
  common/           # Only shared utilities
```

## Layer Definitions

### packages/common

**Purpose:** Cross-cutting technical utilities only.

**Allowed contents:**

- Result/Either types
- Error base classes
- HTTP response helpers
- Redaction utilities
- JWT/auth utilities
- Firestore/Notion client wrappers (shared initialization only)

**Forbidden contents:**

- Domain models (User, Action, Prompt, etc.)
- Business logic
- App-specific code

**Dependencies:** None (leaf package).

**Verification:** `npm run verify:common`

### apps/\*/src/domain/

**Purpose:** App-specific business logic, domain models, use cases.

**Structure:**

```
domain/
  <context>/
    models/      # Domain types (optional)
    ports/       # Interfaces for infra (optional)
    usecases/    # Business logic
```

**Allowed contents:**

- Domain models and types
- Use cases / application services
- Domain validation and policies
- Port interfaces for infrastructure

**Forbidden contents:**

- Direct external service calls
- Infrastructure implementation details
- HTTP/transport layer concerns
- Imports from other apps

**Dependencies:**

- `@praxos/common` ✓
- Same-app `src/infra/` via ports only ✗ (domain should not import infra directly)

### apps/\*/src/infra/

**Purpose:** App-specific adapters for external services.

**Structure:**

```
infra/
  firestore/
    *Repository.ts    # Firestore implementations
  notion/
    *Api.ts          # Notion API adapters
  auth0/
    client.ts        # Auth0 client (auth-service only)
```

**Allowed contents:**

- Adapter implementations
- External SDK usage
- Mapping logic (external → domain types)
- Client configuration

**Forbidden contents:**

- Business logic (belongs in domain)
- HTTP handlers (belongs in v1/routes)
- Imports from other apps

**Dependencies:**

- `@praxos/common` ✓
- Same-app `src/domain/` ✓

### apps/\*/src/v1/routes/

**Purpose:** HTTP transport layer.

**Allowed contents:**

- Route handlers
- Request/response schemas
- Input validation
- Error mapping to HTTP codes

**Dependencies:**

- Same-app `src/domain/` ✓
- Same-app `src/infra/` ✓ (via services.ts)
- `@praxos/common` ✓

## Import Rules

| From                    | Can Import                        |
| ----------------------- | --------------------------------- |
| `packages/common`       | nothing                           |
| `apps/<app>/src/domain` | `@praxos/common`                  |
| `apps/<app>/src/infra`  | `@praxos/common`, same-app domain |
| `apps/<app>/src/v1`     | `@praxos/common`, same-app all    |

**Forbidden:**

- ❌ Any app importing from another app
- ❌ `packages/common` importing from apps
- ❌ Deep imports into package internals

## Naming Conventions

| Type           | Pattern                  | Example                  |
| -------------- | ------------------------ | ------------------------ |
| Shared package | `@praxos/common`         | `@praxos/common`         |
| App            | `@praxos/<name>-service` | `@praxos/auth-service`   |
| Repository     | `*Repository.ts`         | `authTokenRepository.ts` |
| Use case       | `*UseCase.ts`            | `createPromptUseCase.ts` |
| API adapter    | `*Api.ts`                | `promptApi.ts`           |

## Verification

```bash
npm run verify:boundaries  # ESLint boundaries check
npm run verify:common      # Common package purity check
npm run lint               # Full ESLint including boundaries
npm run ci                 # All checks
```
