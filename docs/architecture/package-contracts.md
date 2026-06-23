# Package Contracts

This document defines the architectural contracts for IntexuraOS.
These rules are enforced by ESLint boundaries, CI scripts, and code review.

## Architecture Overview

IntexuraOS uses **app-first colocation**: each app owns its domain logic and infrastructure adapters.

```
apps/
  <app>/
    src/
      domain/       # Business logic, models, usecases
      infra/        # Adapters (Firestore, Notion, Auth0)
      routes/    # HTTP transport layer
      services.ts   # Service container / DI
packages/
  common-core/      # Result/Either types, error base classes (leaf package)
  common-http/      # HTTP response helpers, redaction utilities (leaf package)
  common-metrics/   # Cloud Monitoring metric writer helpers
  common-worker/    # Shared worker bootstrap utilities
  http-contracts/   # Shared HTTP type definitions
  http-server/      # Fastify server factory and plugins
  infra-*/          # External service wrappers (Claude, Firestore, Gemini, etc.)
  *-domain/         # Shared domain contracts
  *-pubsub-client/  # Typed Pub/Sub message clients
  internal-clients/ # Typed HTTP clients for service-to-service communication
  llm-*/            # LLM utilities: contract, factory, pricing, prompts, utils
  service-catalog/  # Service registry metadata
```

## Package Catalog

The monorepo contains 29 packages:

### Common Packages

| Package                       | Purpose                                                |
| ----------------------------- | ------------------------------------------------------ |
| `@intexuraos/common-core`     | Result/Either types, error base classes                |
| `@intexuraos/common-http`     | HTTP response helpers, redaction utilities             |
| `@intexuraos/common-metrics`  | Cloud Monitoring metric writer helpers                 |
| `@intexuraos/common-worker`   | Shared worker bootstrap utilities                      |
| `@intexuraos/http-contracts`  | Shared HTTP type definitions (request/response shapes) |

### Server & Transport

| Package                   | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| `@intexuraos/http-server` | Fastify server factory, auth plugin, request logging |

### Infrastructure Wrappers (`infra-*`)

| Package                        | Purpose                                                |
| ------------------------------ | ------------------------------------------------------ |
| `@intexuraos/infra-claude`     | Anthropic Claude API client                            |
| `@intexuraos/infra-firestore`  | Firestore client initialization                        |
| `@intexuraos/infra-gemini`     | Google Gemini API client                               |
| `@intexuraos/infra-gpt`        | OpenAI GPT API client                                  |
| `@intexuraos/infra-notion`     | Notion API client wrapper                              |
| `@intexuraos/infra-openrouter` | OpenAI-compatible client for the OpenRouter aggregator |
| `@intexuraos/infra-perplexity` | Perplexity AI API client                               |
| `@intexuraos/infra-pubsub`     | Google Cloud Pub/Sub client and publisher              |
| `@intexuraos/infra-sentry`     | Sentry error tracking and `createAppLogger()`          |
| `@intexuraos/infra-whatsapp`   | WhatsApp Business API client                           |

### Service Communication And Domain Contracts

| Package                                   | Purpose                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `@intexuraos/calendar-pubsub-client`      | Typed Pub/Sub client for calendar messages                                  |
| `@intexuraos/code-task-domain`            | Shared code task domain contracts                                           |
| `@intexuraos/internal-clients`            | Typed clients for service-to-service HTTP calls (e.g., user-service client) |
| `@intexuraos/linear-domain`               | Shared Linear domain contracts                                              |
| `@intexuraos/pr-triage-pubsub-client`     | Typed Pub/Sub client for PR triage messages                                 |
| `@intexuraos/service-catalog`             | Service registry metadata                                                   |
| `@intexuraos/retired-checklist-pubsub-client`         | Typed Pub/Sub client for todos messages                                     |
| `@intexuraos/whatsapp-pubsub-client`      | Typed Pub/Sub client for WhatsApp messages                                  |

### LLM Utilities (`llm-*`)

| Package                    | Purpose                                             |
| -------------------------- | --------------------------------------------------- |
| `@intexuraos/llm-contract` | Shared LLM type contracts (models, messages)        |
| `@intexuraos/llm-factory`  | LLM client factory (selects provider by model ID)   |
| `@intexuraos/llm-pricing`  | LLM token pricing lookup and cost calculation       |
| `@intexuraos/llm-prompts`  | Shared `PromptBuilder` and versioned prompt helpers |
| `@intexuraos/llm-utils`    | Shared LLM utility functions                        |

## Layer Definitions

### packages/common-core and packages/common-http

**Purpose:** Cross-cutting technical utilities only.

**Allowed contents:**

- Result/Either types (`common-core`)
- Error base classes (`common-core`)
- HTTP response helpers (`common-http`)
- Redaction utilities (`common-http`)

**Forbidden contents:**

- Domain models (User, Action, Prompt, etc.)
- Business logic
- App-specific code

**Dependencies:** None (leaf packages).

**Verification:** `pnpm run verify:common`

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

- `@intexuraos/common-core` ✓
- `@intexuraos/common-http` ✓
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
    client.ts        # Auth0 client (user-service only)
```

**Allowed contents:**

- Adapter implementations
- External SDK usage
- Mapping logic (external → domain types)
- Client configuration

**Forbidden contents:**

- Business logic (belongs in domain)
- HTTP handlers (belongs in routes)
- Imports from other apps

**Dependencies:**

- `@intexuraos/common-core` ✓
- `@intexuraos/common-http` ✓
- Same-app `src/domain/` ✓

### apps/\*/src/routes/

**Purpose:** HTTP transport layer.

**Allowed contents:**

- Route handlers
- Request/response schemas
- Input validation
- Error mapping to HTTP codes

**Dependencies:**

- Same-app `src/domain/` ✓
- Same-app `src/infra/` ✓ (via services.ts)
- `@intexuraos/common-core` ✓
- `@intexuraos/common-http` ✓

## Import Rules

| From                    | Can Import                                           |
| ----------------------- | ---------------------------------------------------- |
| `packages/common-core`  | nothing                                              |
| `packages/common-http`  | `@intexuraos/common-core`                            |
| `apps/<app>/src/domain` | `@intexuraos/common-core`, `@intexuraos/common-http` |
| `apps/<app>/src/infra`  | `@intexuraos/common-*`, same-app domain              |
| `apps/<app>/src/routes` | `@intexuraos/common-*`, same-app all                 |

**Forbidden:**

- ❌ Any app importing from another app
- ❌ `packages/common-*` importing from apps
- ❌ Deep imports into package internals

## Naming Conventions

| Type           | Pattern                      | Example                    |
| -------------- | ---------------------------- | -------------------------- |
| Core utilities | `@intexuraos/common-core`    | `@intexuraos/common-core`  |
| HTTP utilities | `@intexuraos/common-http`    | `@intexuraos/common-http`  |
| App            | `@intexuraos/<name>-service` | `@intexuraos/user-service` |
| Repository     | `*Repository.ts`             | `authTokenRepository.ts`   |
| Use case       | `*UseCase.ts`                | `createPromptUseCase.ts`   |
| API adapter    | `*Api.ts`                    | `promptApi.ts`             |

## Verification

```bash
pnpm run verify:boundaries  # ESLint boundaries check
pnpm run verify:common      # Common package purity check
pnpm run lint               # Full ESLint including boundaries
pnpm run ci                 # All checks
```
