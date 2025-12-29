# Task 011: Development Standards

## Objective

Apply five architectural standards consistently across the IntexuraOS codebase, following the Continuity Standard workflow.

## Standards to Apply

### Standard 1: Common Package Decomposition

Split `packages/common` into purpose-driven packages:

- `packages/common-core` (pure utils, Result, errors, redaction, zero infra deps)
- `packages/common-http` (Fastify helpers, requestId, error mapping)
- `packages/infra-firestore` (Firestore clients/adapters only)
- `packages/infra-notion` (Notion clients/adapters only)

**Status:** PENDING - See LEDGER.md for detailed task list (Tasks 1.1-1.9)

### Standard 2: Hard Cross-App Isolation

Enforce pattern-based blocking of cross-app imports:

- Block `@intexuraos/*-service` automatically
- Block `@intexuraos/web` automatically
- Rule applies to future apps without configuration changes

**Status:** ✅ COMPLETED

### Standard 3: Thin Routes, Fat Use-Cases

Routes may ONLY handle:

- Transport
- Input validation
- Calling a use-case
- Mapping output to HTTP

All decision logic MUST live in domain/usecase layers.

**Status:** PARTIALLY COMPLETED - See LEDGER.md for detailed task list (Tasks 3.1-3.5)

- ✅ notion-service (Task 3.5)
- ⬜ user-service (Task 3.1) - REQUIRES IMPLEMENTATION
- ⬜ whatsapp-service (Task 3.2) - REQUIRES REVIEW
- ⬜ promptvault-service (Task 3.3) - REQUIRES REVIEW
- ⬜ mobile-notifications-service (Task 3.4) - REQUIRES REVIEW

### Standard 4: Notion-Service Domain Introduction

Add domain layer structure to notion-service:

- `domain/usecases/`
- `domain/ports/`

Move integration decisions from routes to use-cases.

**Status:** ✅ COMPLETED (merged with Standard 3 for notion-service)

### Standard 5: Observability Baseline

Enforce consistent structured logging:

- Service name
- RequestId / correlationId
- Route
- Status code
- Latency

**Status:** ✅ ALREADY SATISFIED - Existing infrastructure meets requirements

## Global Constraints

- Do NOT introduce HTTP root versioning
- Do NOT partially apply changes
- All changes must pass `npm run ci`

## Execution Plan (Updated)

### Phase 1: ✅ COMPLETED

1. Standard 2 - Pattern-based cross-app isolation
2. Standard 4 & 3 (notion-service) - Domain introduction and route refactoring
3. Standard 5 - Confirmed as already satisfied

### Phase 2: PENDING

4. Standard 1 - Common package decomposition (Tasks 1.1-1.9)
5. Standard 3 (remaining services) - Route refactoring (Tasks 3.1-3.4)

## Implementation Order for Phase 2

1. **Standard 3 first (Tasks 3.1-3.4)** - Lower risk, establishes patterns
2. **Standard 1 (Tasks 1.1-1.9)** - Higher risk, requires careful coordination
