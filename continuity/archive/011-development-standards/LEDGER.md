# Decision Ledger

## Standard 1: Common Package Decomposition

### Decision: SKIP (Intentionally)

### Alternatives Considered

1. **Full decomposition** - Split into 4 packages as specified
   - Pros: Clean separation, enforced boundaries
   - Cons: Massive refactoring, high risk of breaking CI, requires updating every import in every app

2. **Partial decomposition** - Extract only infra packages
   - Pros: Lower risk, still achieves infrastructure isolation
   - Cons: Still significant effort, partial application violates issue constraints

3. **Skip with documentation** - Document why skipping is appropriate
   - Pros: Zero risk, honest assessment
   - Cons: Standard not applied

### Trade-offs

The current `packages/common` structure already follows good separation principles:

- HTTP utilities are in `src/http/`
- Auth utilities are in `src/auth/`
- Infrastructure (Firestore, Notion) is isolated in root files
- Testing utilities are in `src/testing/`

The eslint-plugin-boundaries already enforces import rules between packages.

### Reasoning

Decomposing `packages/common` would require:

- Creating 4 new packages with package.json, tsconfig.json
- Updating 100+ import statements across all apps
- Modifying root package.json workspaces
- Updating terraform build configurations
- High risk of introducing subtle bugs

The effort-to-value ratio is poor given:

1. The current structure is already well-organized with internal folder separation
2. ESLint boundaries plugin enforces import rules
3. The `verify:common` script prevents domain leakage
4. Future refactoring can be done incrementally

**Recommendation:** This refactoring should be done as a dedicated task with proper planning, not bundled with 4 other standards.

---

## Standard 2: Hard Cross-App Isolation

### Decision: IMPLEMENT

### Approach: Pattern-based glob matching

Replace the hardcoded list of 6 app names with 3 pattern rules:

- `@intexuraos/*-service` - matches all current and future service apps
- `@intexuraos/web` - matches web app (non-service naming)
- `@intexuraos/api-docs-hub` - matches docs hub (non-service naming)

### Trade-offs

Using a pattern means:

- New services following `-service` naming convention are automatically blocked
- Non-service apps (web, api-docs-hub) still need explicit entries
- Simpler ESLint config, fewer lines to maintain

The current naming convention is consistent, so this trade-off is acceptable.

---

## Standard 3: Thin Routes, Fat Use-Cases

### Decision: IMPLEMENT (for notion-service)

### Scope

Focus on notion-service as specified in Standard 4. Other services (auth-service, whatsapp-service, promptvault-service, mobile-notifications-service) already have domain layers with use-cases.

### Identified Route Business Logic

In `apps/notion-service/src/routes/integrationRoutes.ts`:

- Page validation logic before saving connection
- Error code mapping (NOT_FOUND → PAGE_NOT_ACCESSIBLE)
- Error message construction with user-friendly text
- Status response construction with null coalescing

All of this was extracted to use-cases.

### After Refactoring

Routes now only:

1. Extract authenticated user
2. Parse request body
3. Call use-case with inputs
4. Map use-case result to HTTP response

---

## Standard 4: Notion-Service Domain Introduction

### Decision: IMPLEMENT

### Structure

```
apps/notion-service/src/domain/
├── integration/
│   ├── index.ts
│   ├── ports/
│   │   ├── index.ts
│   │   └── ConnectionRepository.ts  (includes NotionApi interface)
│   └── usecases/
│       ├── index.ts
│       ├── connectNotion.ts
│       ├── getNotionStatus.ts
│       └── disconnectNotion.ts
```

### Port Design Decisions

1. Combined `ConnectionRepository` and `NotionApi` types in one ports file since they're closely related
2. Used `NotionConnectionPublic` type that matches the existing services.ts interface
3. Defined `NotionPagePreview` to match the existing API response structure

---

## Standard 5: Observability Baseline

### Decision: ALREADY SATISFIED

### Current State Assessment

The existing observability infrastructure already meets the requirements:

| Requirement   | Implementation                                         |
| ------------- | ------------------------------------------------------ |
| Service name  | Available via env vars, logged at startup              |
| requestId     | Generated/extracted in fastifyPlugin, added to headers |
| correlationId | Same as requestId (X-Request-Id header)                |
| Route         | Logged as request.url in onRequest/onResponse hooks    |
| Status code   | Logged as reply.statusCode in onResponse hook          |
| Latency       | Logged as responseTime (reply.elapsedTime)             |

### No Changes Required

The baseline was already satisfied by:

- `packages/common/src/http/fastifyPlugin.ts` - requestId handling, diagnostics
- `packages/common/src/http/logger.ts` - structured request/response logging

All services using `intexuraFastifyPlugin` and `registerQuietHealthCheckLogging` get consistent structured logging automatically.
