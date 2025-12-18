# Package Contracts

This document defines the architectural contracts for all packages in PraxOS.
These rules are enforced by ESLint, CI scripts, and code review.

## Layer Definitions

### common

**Purpose:** Cross-cutting technical utilities only.

**Allowed contents:**

- Result/Either types
- Error base classes
- Crypto primitives
- Logging types and interfaces
- Generic type utilities
- Configuration loaders (non-domain-specific)

**Forbidden contents:**

- Domain models (User, Action, Prompt, etc.)
- Business logic
- External service references (Auth0, Notion, Firestore)
- Anything that implies a specific bounded context

**Dependencies:** None (leaf package).

### domain

**Purpose:** Business logic, domain models, use cases, and policies.

Each domain package represents a bounded context:

- `identity` - User identity, authentication state, access control models
- `promptvault` - Prompt templates, versioning, metadata
- `actions` - Executable actions, scheduling, execution state

**Allowed contents:**

- Domain models (`src/models/`)
- Ports/interfaces for external dependencies (`src/ports/`)
- Use cases / application services (`src/usecases/`)
- Domain policies and validation (`src/policies/`)

**Forbidden contents:**

- Direct external service calls
- Infrastructure implementation details
- HTTP/transport layer concerns

**Dependencies:**

- `common` ✓
- Other `domain` packages ✓ (with care)
- `infra` ✗
- `apps` ✗

### infra

**Purpose:** Adapters that implement domain ports using external services.

Each infra package wraps a specific external dependency:

- `auth0` - Auth0 client wrapper
- `notion` - Notion API client wrapper
- `firestore` - Firestore client wrapper

**Allowed contents:**

- Adapter implementations (`src/adapters/`)
- Client configuration
- External SDK wrappers
- Mapping logic (external → domain types)

**Forbidden contents:**

- Business logic
- Domain models (import from domain instead)
- Direct HTTP handlers

**Dependencies:**

- `common` ✓
- `domain` ✓
- Other `infra` packages ✓ (with care)
- `apps` ✗

### apps

**Purpose:** Deployable services that compose domain and infra.

**Allowed contents:**

- HTTP handlers / routes
- Service configuration
- Dependency injection / wiring
- Health checks, metrics endpoints

**Dependencies:**

- `common` ✓
- `domain` ✓
- `infra` ✓

## Dependency Graph

```
┌─────────┐
│  apps   │
└────┬────┘
     │ imports
     ▼
┌─────────┐     ┌─────────┐
│  infra  │────▶│ domain  │
└────┬────┘     └────┬────┘
     │               │
     └───────┬───────┘
             ▼
       ┌─────────┐
       │ common  │
       └─────────┘
```

## Public API Rules

### Index Exports Only

Every package exposes its public API through `src/index.ts`.

```typescript
// ✓ Correct: import from package entrypoint
import { ok, err } from '@praxos/common';

// ✗ Forbidden: deep import into package internals
import { ok } from '@praxos/common/src/result';
```

### No Deep Imports Across Packages

ESLint enforces that cross-package imports must use the public entrypoint.

Importing from another package's `/src/` path is forbidden:

```typescript
// ✗ Forbidden
import { X } from '@praxos/domain-identity/src/models/user';

// ✓ Correct
import { X } from '@praxos/domain-identity';
```

Within the same package, relative imports are allowed:

```typescript
// ✓ Allowed (same package)
import { Result } from './result';
import { BaseError } from '../errors/base';
```

## Testing Requirements

### common

- Unit tests for all utilities
- No mocking required (pure functions)
- 100% coverage target

### domain

- Unit tests for models and policies
- Use case tests with port mocks
- No external dependencies in tests
- Contract tests for ports (optional, for documentation)

### infra

- Adapter tests with mocked external clients
- Contract tests verifying adapter implements port correctly
- Integration tests (optional, run separately)

### apps

- Route handler tests with mocked domain/infra
- Integration tests (separate CI job)

## Naming Conventions

### Package Names

- `@praxos/common` - shared utilities
- `@praxos/domain-{context}` - domain packages (e.g., `@praxos/domain-identity`)
- `@praxos/infra-{service}` - infra packages (e.g., `@praxos/infra-auth0`)
- `@praxos/{service}-service` - apps (e.g., `@praxos/auth-service`)

### Directory Structure

```
packages/{layer}/{name}/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts          # Public exports only
    ├── models/           # (domain only) Domain entities
    ├── ports/            # (domain only) Interfaces for external deps
    ├── usecases/         # (domain only) Application services
    ├── policies/         # (domain only) Validation, business rules
    ├── adapters/         # (infra only) Port implementations
    └── __tests__/        # Co-located tests
```

### File Naming

- Models: `{entity}.ts` (e.g., `user.ts`, `action.ts`)
- Ports: `{service}.port.ts` (e.g., `auth.port.ts`)
- Adapters: `{service}.adapter.ts` (e.g., `auth0.adapter.ts`)
- Use cases: `{action}.usecase.ts` (e.g., `create-user.usecase.ts`)
- Tests: `{file}.test.ts`

## Anti-Patterns

### Common Dumping

**Definition:** Placing domain-specific code in `common` to avoid proper dependency management.

**Symptoms:**

- Domain model names in common (User, Action, Prompt)
- Service-specific types in common (NotionPage, Auth0Token)
- Business logic in common
- common growing faster than other packages

**Prevention:**

- CI script scans common for forbidden keywords
- Code review checklist
- Regular architecture review

**Example violation:**

```typescript
// packages/common/src/user.ts
// ✗ FORBIDDEN: User is a domain concept
export interface User {
  id: string;
  email: string;
}
```

**Correct approach:**

```typescript
// packages/domain/identity/src/models/user.ts
// ✓ Domain model in domain package
export interface User {
  id: string;
  email: string;
}
```

### Domain Depending on Infra

**Definition:** Domain package importing from infra package.

**Why forbidden:** Domain must remain pure and testable without external dependencies.

**Example violation:**

```typescript
// packages/domain/identity/src/usecases/login.ts
// ✗ FORBIDDEN: domain importing infra
import { Auth0Client } from '@praxos/infra-auth0';
```

**Correct approach:**

```typescript
// packages/domain/identity/src/ports/auth.port.ts
export interface AuthPort {
  validateToken(token: string): Promise<Result<TokenPayload, AuthError>>;
}

// packages/domain/identity/src/usecases/login.ts
// ✓ Domain uses port interface
import type { AuthPort } from '../ports/auth.port';
```

### Bypassing Public API

**Definition:** Importing internal modules directly instead of through index.ts.

**Why forbidden:** Breaks encapsulation, creates fragile dependencies.

**Prevention:** ESLint rule blocks `/src/` in cross-package imports.

## Enforcement

| Rule              | Mechanism                      |
| ----------------- | ------------------------------ |
| Dependency graph  | eslint-plugin-boundaries       |
| No deep imports   | ESLint no-restricted-imports   |
| No common dumping | scripts/verify-common.mjs + CI |
| Public API only   | ESLint + code review           |
| Test coverage     | Vitest coverage thresholds     |

## Exceptions

Exceptions require:

1. Documented justification in code comment
2. Approval in code review
3. Tracked issue for remediation

No permanent exceptions. All exceptions are tech debt.
