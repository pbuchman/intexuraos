# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# IntexuraOS — Claude Instructions

**All rules below are verified by `npm run ci`. If CI passes, rules are satisfied.**

---

## Verification (MANDATORY)

```bash
npm run ci                    # MUST pass before task completion
tf fmt -check -recursive      # If terraform changed (from /terraform)
tf validate                   # If terraform changed
```

**IMPORTANT:** Use `tf` command instead of `terraform`. This is an alias configured in the user's shell environment. Note: The alias may not be available in spawned subshells - if `tf` is not found, the user should run commands manually.

**Do not claim complete until verification passes.**

**NEVER modify `vitest.config.ts` coverage exclusions or thresholds. Write tests instead.**

---

## Architecture

```
apps/<app>/src/
  domain/     → Business logic (no external deps)
  infra/      → Adapters (Firestore, APIs, etc.)
  routes/     → HTTP transport
  services.ts → DI container
packages/
  common-*/   → Leaf packages (Result types, HTTP helpers)
  infra-*/    → External service wrappers
terraform/    → Infrastructure as code
docs/         → Documentation
```

### Import Rules

**ESLint enforced.** Apps can't import other apps. Routes use `getServices()`, not direct infra imports.

### Service-to-Service Communication

Pattern: `/internal/{service-prefix}/{path}` with `X-Internal-Auth` header. Use `validateInternalAuth()` server-side.

Docs: [docs/architecture/service-to-service-communication.md](../docs/architecture/service-to-service-communication.md)

### Endpoint Logging

**RULE:** ALL endpoints (`/internal/*`, webhooks, Pub/Sub) MUST use `logIncomingRequest()` at entry BEFORE auth/validation.

- Headers auto-redacted via `SENSITIVE_FIELDS`
- Include `messageId` for Pub/Sub, `eventId` for webhooks
- Reference: `apps/actions-agent/src/routes/internalRoutes.ts`, `apps/whatsapp-service/src/routes/webhookRoutes.ts`

### Pub/Sub Subscriptions

**RULE:** Never use pull subscriptions — Cloud Run scales to zero. Use HTTP push endpoints only.

### Use Case Logging

**RULE:** Use cases MUST accept `logger: Logger` as dependency. See [docs/patterns/use-case-logging.md](../docs/patterns/use-case-logging.md).

### Firestore Collections

**RULE:** Each collection owned by exactly ONE service. Cross-service access via HTTP only.

- Registry: `firestore-collections.json`
- Verification: `npm run verify:firestore`
- Docs: [docs/architecture/firestore-ownership.md](../docs/architecture/firestore-ownership.md)

### Firestore Composite Indexes

**RULE:** Multi-field queries require indexes in `firestore.indexes.json`. Queries fail in production without them.

---

## Apps (`apps/**`)

- Use `getServices()` for deps, `getFirestore()` singleton for DB
- Env vars: `INTEXURAOS_*` prefix (except `NODE_ENV`, `PORT`, emulators)
- Fail-fast: `validateRequiredEnv()` at startup, must match Terraform config
- New service: Use `/create-service` command

---

## Packages (`packages/**`)

`common-*` are leaf packages (no deps). `infra-*` wrap external services. No domain logic in packages.

---

## Pub/Sub Publishers (`packages/infra-pubsub`)

**RULE:** All publishers MUST extend `BasePubSubPublisher`. Topic names from env vars only (no hardcoding).

Verification: `npm run verify:pubsub`. Docs: [docs/architecture/pubsub-standards.md](../docs/architecture/pubsub-standards.md)

---

## Terraform (`terraform/**`)

**Gotchas:**

- Cloud Run images managed by Cloud Build, not Terraform (uses `ignore_changes`)
- "Image not found": run `./scripts/push-missing-images.sh` for new services
- Web app: backend buckets need URL rewrite for `/` → `/index.html`

---

## Web App (`apps/web/**`)

**CRITICAL:** Hash routing only (`/#/path`) — backend buckets don't support SPA fallback.

**Rules:** TailwindCSS only, `@auth0/auth0-react` for auth, `useApiClient` for API calls, SRP (split at ~150 lines), env vars via `import.meta.env.INTEXURAOS_*`.

---

## TypeScript Patterns

Strict mode enabled: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `strictBooleanExpressions`. Compiler errors guide fixes — use `arr[0] ?? fallback`, explicit `=== true` checks, `String()` for template numbers.

---

## Code Smells (Fix & Document)

**RULE:** When fixing a new smell, add it here.

| Smell                      | ❌ Wrong                       | ✅ Fix                    |
| -------------------------- | ------------------------------ | ------------------------- |
| Silent catch               | `catch {}`                     | `catch { /* reason */ }`  |
| Inline error               | `error instanceof Error ? ...` | `getErrorMessage(error)`  |
| Throw in try               | `try { if (x) throw } catch`   | Separate blocks           |
| Re-export from services.ts | `export * from './infra/...'`  | Only export DI functions  |
| Module-level state         | `let logger: Logger`           | Pass to factory functions |
| Test fallback in prod      | `container ?? { fake }`        | Throw if not init         |
| Domain in infra            | `maskApiKey()` in infra        | Move to common-core       |
| Infra re-exports domain    | `export type from domain`      | Import where needed       |
| Manual header redaction    | Inline `[REDACTED]`            | `logIncomingRequest()`    |
| Redundant variable         | `const r = f(); return r`      | `return f()`              |
| Redundant check            | Check after type guard         | Trust narrowing           |

**Known debt:** OpenAPI schemas duplicated per server.ts (Fastify types limitation).

---

## Code Auditing & Consistency

**RULE:** When fixing a pattern in one service, audit ALL other services for the same issue before committing.

**Full guide:** [docs/patterns/auditing.md](../docs/patterns/auditing.md)

---

## Testing

**No external deps.** In-memory fakes, `nock` for HTTP. Just `npm run test`.

- TypeScript: `npm run typecheck:tests` (uses `tsconfig.tests-check.json`)
- Pattern: `setServices({fakes})` in `beforeEach`, `resetServices()` in `afterEach`
- Routes: integration via `app.inject()`. Domain: unit tests. Infra: tested via routes.
- **Coverage: 95%. NEVER modify thresholds — write tests.**

---

## Git Push Policy

**RULE: NEVER push without explicit instruction.**

- `"commit"` → local only, no push
- `"commit and push"` → push once
- Multiple commits → ask before pushing

---

## Complex Tasks — Continuity Workflow

For multi-step features, use numbered directories in `continuity/`. See [continuity/README.md](../continuity/README.md).
