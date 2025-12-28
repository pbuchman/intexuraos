# Task 011: Development Standards

## Objective

Apply five architectural standards consistently across the IntexuraOS codebase, following the Continuity Standard workflow.

## Standards to Apply

### Standard 1: Common Package Decomposition

Split `packages/common` into purpose-driven packages:

- `common-core` (pure utils, Result, errors, redaction, zero infra deps)
- `common-http` (Fastify helpers, requestId, error mapping)
- `infra-firestore` (Firestore clients/adapters only)
- `infra-notion` (Notion clients/adapters only)

### Standard 2: Hard Cross-App Isolation

Enforce pattern-based blocking of cross-app imports:

- Block `@intexuraos/*-service` automatically
- Block `@intexuraos/web` automatically
- Rule applies to future apps without configuration changes

### Standard 3: Thin Routes, Fat Use-Cases

Routes may ONLY handle:

- Transport
- Input validation
- Calling a use-case
- Mapping output to HTTP

All decision logic MUST live in domain/usecase layers.

### Standard 4: Notion-Service Domain Introduction

Add domain layer structure to notion-service:

- `domain/usecases/`
- `domain/ports/`

Move integration decisions from routes to use-cases.

### Standard 5: Observability Baseline

Enforce consistent structured logging:

- Service name
- RequestId / correlationId
- Route
- Status code
- Latency

## Global Constraints

- Do NOT introduce HTTP root versioning
- Do NOT partially apply changes
- All changes must pass `npm run ci`

## Current State Analysis

### Standard 1 Assessment

`packages/common` currently contains:

- Result types and utilities
- HTTP utilities (errors, responses, requestId, fastifyPlugin, logger, validation)
- Auth utilities (JWT, fastifyAuthPlugin)
- Security utilities (redaction)
- Firestore client
- Notion client and connection utilities
- Testing utilities

**Decision Required:** The decomposition would require massive refactoring across all apps.

### Standard 2 Assessment

ESLint config already has cross-app import restrictions, but uses a hardcoded list:

- `@intexuraos/auth-service`
- `@intexuraos/promptvault-service`
- `@intexuraos/notion-service`
- `@intexuraos/whatsapp-service`
- `@intexuraos/api-docs-hub`
- `@intexuraos/web`

**Action:** Change to pattern-based approach.

### Standard 3 Assessment

notion-service routes contain business logic (e.g., integrationRoutes.ts has validation and decision logic).

**Action:** Extract to domain use-cases.

### Standard 4 Assessment

notion-service lacks `domain/` folder structure.

**Action:** Create domain layer with usecases and ports.

### Standard 5 Assessment

Logger exists in `packages/common/src/http/logger.ts` with:

- Health check log suppression
- Request/response logging hooks

**Action:** Enhance to include all required fields consistently.

## Execution Plan

1. **Standard 2** - Pattern-based cross-app isolation (low risk, high impact)
2. **Standard 4 & 3** - notion-service domain introduction and route refactoring
3. **Standard 5** - Observability baseline enhancement
4. **Standard 1** - Document decision (skip or partial implementation)
