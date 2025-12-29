# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# IntexuraOS — Claude Instructions

**All rules below are verified by `npm run ci`. If CI passes, rules are satisfied.**

---

## Verification (MANDATORY)

```bash
npm run ci                        # MUST pass before task completion
terraform fmt -check -recursive   # If terraform changed (from /terraform)
terraform validate                # If terraform changed
```

**Do not claim complete until verification passes.**

**NEVER modify `vitest.config.ts` coverage exclusions or thresholds. Write tests instead.**

---

## Architecture

```
apps/
  <app>/src/
    domain/     → Business logic, models, usecases (no external deps)
    infra/      → Adapters (Firestore, Notion, Auth0, etc.)
    routes/     → HTTP transport layer
    services.ts → Dependency injection container
packages/
  common-core/    → Result types, error utilities (leaf package)
  common-http/    → HTTP response helpers, JWT utilities (leaf package)
  http-contracts/ → OpenAPI schemas, Fastify JSON schemas (leaf package)
  http-server/    → Health checks, validation error handler
  infra-firestore/→ Firestore client wrapper
  infra-notion/   → Notion client wrapper
  infra-whatsapp/ → WhatsApp API client
  infra-claude/   → Anthropic Claude API client
  infra-gemini/   → Google Gemini API client
  infra-gpt/      → OpenAI GPT API client
terraform/        → Infrastructure as code
docs/             → All documentation
```

### Import Rules (enforced by ESLint boundaries)

| From             | Can Import                                             |
| ---------------- | ------------------------------------------------------ |
| `common-core`    | nothing (leaf package)                                 |
| `common-http`    | nothing (leaf package)                                 |
| `http-contracts` | nothing (leaf package)                                 |
| `http-server`    | `common-core`, `common-http`                           |
| `infra-*`        | `common-core`, `common-http`                           |
| `apps/*`         | `common-*`, `http-contracts`, `http-server`, `infra-*` |

**Forbidden:**

- Apps importing from other apps
- Deep imports into package internals (`@intexuraos/*/src/*`)

---

## Apps (`apps/**`)

### Requirements

| Requirement                     | Verification                                           |
| ------------------------------- | ------------------------------------------------------ |
| OpenAPI spec at `/openapi.json` | `curl http://localhost:PORT/openapi.json` returns JSON |
| Swagger UI at `/docs`           | `curl http://localhost:PORT/docs` returns 200/302      |
| CORS enabled                    | OpenAPI accessible from api-docs-hub                   |
| Terraform module exists         | Check `terraform/environments/dev/main.tf`             |
| Included in api-docs-hub        | Check `apps/api-docs-hub/src/config.ts`                |
| Health endpoint                 | `GET /health` returns 200                              |

**Exception:** api-docs-hub is exempt from `/openapi.json` (it aggregates other specs).

### App Structure

- `src/domain/**` — business logic, models, usecases (no external deps)
- `src/infra/**` — adapters for external services (Firestore, Notion, Auth0)
- `src/routes/**` — HTTP transport layer
- `src/services.ts` — dependency injection container

Routes obtain dependencies via `getServices()`, not direct instantiation:

```ts-example
// ❌ Direct instantiation — blocks tests
const tokenRepo = new FirestoreAuthTokenRepository();

// ✅ Dependency injection — allows fake injection
const tokenRepo = getServices().authTokenRepository;
```

### Secrets

- Use `INTEXURAOS_*` prefix for environment variables
- Access via env vars or Secret Manager

### New Service Checklist

1. Copy structure from existing service (domain/, infra/, routes/)
2. Create Dockerfile with correct workspace deps
3. Run `npx prettier --write .`
4. Add Terraform module in `terraform/environments/dev/main.tf`
5. Add service account to IAM module
6. Add OpenAPI URL to `apps/api-docs-hub/src/config.ts`
7. Add project reference to root `tsconfig.json`
8. Add to ESLint `no-restricted-imports` patterns in `eslint.config.js`
9. Run `npm run ci`
10. Run `terraform fmt -check -recursive && terraform validate`

---

## Packages (`packages/**`)

**Verification:** `npm run ci` (includes `npm run verify:boundaries` and `npm run verify:common`).

### Package Structure

| Package           | Purpose                                 | Dependencies       |
| ----------------- | --------------------------------------- | ------------------ |
| `common-core`     | Result types, error utilities           | none (leaf)        |
| `common-http`     | HTTP response helpers, JWT utilities    | none (leaf)        |
| `http-contracts`  | OpenAPI schemas, Fastify JSON schemas   | none (leaf)        |
| `http-server`     | Health checks, validation error handler | `common-core/http` |
| `infra-firestore` | Firestore client wrapper                | `common-core/http` |
| `infra-notion`    | Notion API client wrapper               | `common-core/http` |
| `infra-whatsapp`  | WhatsApp Business API client            | `common-core/http` |
| `infra-claude`    | Anthropic Claude API client             | `common-core/http` |
| `infra-gemini`    | Google Gemini API client                | `common-core/http` |
| `infra-gpt`       | OpenAI GPT API client                   | `common-core/http` |

### Common Package Rules

| Rule                     | Verification            |
| ------------------------ | ----------------------- |
| No domain-specific logic | `npm run verify:common` |
| No external service deps | Code review             |
| Imports nothing          | ESLint boundaries       |

**`packages/common-core` contains:**

- Result types and utilities (`Result<T, E>`)
- Error message extraction utilities
- Redaction utilities

**`packages/common-http` contains:**

- HTTP response helpers
- JWT/auth utilities

**Forbidden in common packages:**

- Business logic / domain rules
- App-specific code
- External service implementations

### Package Naming

- `@intexuraos/common-core`
- `@intexuraos/common-http`
- `@intexuraos/http-contracts`
- `@intexuraos/http-server`
- `@intexuraos/infra-firestore`
- `@intexuraos/infra-notion`
- `@intexuraos/infra-whatsapp`
- `@intexuraos/infra-claude`
- `@intexuraos/infra-gemini`
- `@intexuraos/infra-gpt`

---

## Terraform (`terraform/**`)

**Verification:**

```bash
terraform fmt -check -recursive   # From /terraform
terraform validate                # From /terraform or environment dir
```

### Rules

| Rule                              | Verification                      |
| --------------------------------- | --------------------------------- |
| Formatted                         | `terraform fmt -check -recursive` |
| Valid syntax                      | `terraform validate`              |
| No hardcoded secrets              | Manual review                     |
| Variables have description + type | `terraform validate`              |
| Outputs have description          | `terraform validate`              |

### Structure

```
terraform/
├── environments/dev/   # Environment config
├── modules/            # Reusable modules
├── variables.tf        # Input variables
└── outputs.tf          # Outputs
```

### Change Process

1. `terraform fmt -recursive`
2. `terraform validate`
3. `terraform plan` (review before apply)
4. Document in commit message

### Web Hosting Gotcha

When changing `terraform/modules/web-app`:

- Backend buckets do **not** honor GCS `website.main_page_suffix`
- `GET /` will 404 unless the URL map rewrites `/` → `/index.html`

Reference: `docs/architecture/web-app-hosting.md`

### Checklist

- [ ] `terraform fmt -check -recursive` passes
- [ ] `terraform validate` passes
- [ ] No hardcoded secrets/regions/project IDs
- [ ] Plan reviewed (if environment access available)

---

## Web App (`apps/web/**`)

**Verification:** `npm run ci` from repo root.

### Hosting & Routing (CRITICAL)

The web app is deployed as static assets to GCS and served via HTTP(S) Load Balancer with backend bucket.

**Hash routing required** — backend buckets do NOT support SPA fallback:

```ts-example
// ❌ /notion (will 404 in production)
// ✅ /#/notion (works with HashRouter)
```

**Implementation:** `apps/web/src/App.tsx` uses `HashRouter`.

### Component Architecture

| Location             | Purpose                |
| -------------------- | ---------------------- |
| `src/components/`    | Feature components     |
| `src/components/ui/` | Reusable UI components |
| `src/context/`       | Context providers      |
| `src/hooks/`         | Custom hooks           |
| `src/pages/`         | Route target pages     |
| `src/services/`      | API service clients    |

**Rules:**

- Each file has ONE clear responsibility (SRP)
- Components exceeding ~150 lines should be split
- Avoid prop drilling beyond 2 levels
- All API calls through typed service clients
- Use `useApiClient` hook for authenticated requests

### Authentication

- Use `@auth0/auth0-react` SDK for SPA authentication
- Never store tokens in localStorage directly — SDK handles it
- Protected routes must check `isAuthenticated` from `useAuth`
- Login redirects through Auth0 Universal Login

### Styling

- TailwindCSS for all styling
- No inline style objects
- Color palette: blue primary (`blue-600`), yellow accents (`amber-400`)
- Consistent spacing using Tailwind scale

### Environment Variables

- Exposed to client via `envPrefix: 'INTEXURAOS_'` in Vite
- Access via `import.meta.env.INTEXURAOS_*`
- Extract constants, no magic strings

### Testing Requirements

**Must test:**

- Custom hooks
- Context providers
- API service clients (mocked fetch)
- Page-level user interactions
- Form validation logic

**Coverage:** 80%+ line coverage for hooks and services.

### Web Task Checklist

- [ ] `npm run ci` passes
- [ ] Logic changes have corresponding tests
- [ ] No `any` without documented justification
- [ ] Components are minimal and focused (SRP)
- [ ] New links/routes use hash routing (`/#/...`)

---

## Code Rules

| Rule                                 | Verification            |
| ------------------------------------ | ----------------------- |
| Zero `tsc` errors                    | `npm run typecheck`     |
| Zero ESLint warnings                 | `npm run lint`          |
| Test coverage (see vitest.config.ts) | `npm run test:coverage` |
| ESM only (`import`/`export`)         | `npm run lint`          |
| Explicit return types on exports     | `npm run lint`          |
| No `@ts-ignore`, `@ts-expect-error`  | `npm run lint`          |
| No unused code                       | `npm run lint`          |
| Prettier formatted                   | `npm run format:check`  |
| No `console.log`                     | `npm run lint`          |
| No `any` without justification       | `npm run lint`          |

**After creating or modifying files:** Run `npx prettier --write .` before `npm run ci`.

---

## Protected Files — ABSOLUTE PROHIBITION

| File               | Protected Section     | Reason                                 |
| ------------------ | --------------------- | -------------------------------------- |
| `vitest.config.ts` | `coverage.thresholds` | Coverage thresholds are project policy |
| `vitest.config.ts` | `coverage.exclude`    | Exclusions require justification       |

**ABSOLUTE RULE — NO EXCEPTIONS:**

1. **NEVER** modify `vitest.config.ts` coverage exclusions or thresholds
2. **NEVER** ask for permission to modify them — the answer is always NO
3. **ALWAYS** write tests to achieve coverage instead
4. If coverage fails, write more tests — do not touch exclusions

This rule exists because excluding code from coverage is technical debt that compounds over time.

---

## TypeScript Patterns

**Array access** — `noUncheckedIndexedAccess` returns `T | undefined`:

```ts-example
// ❌ const first = arr[0];
// ✅ const first = arr[0] ?? fallback;
```

**Optional properties** — `exactOptionalPropertyTypes` forbids `undefined`:

```ts-example
// ❌ { optional: condition ? value : undefined }
// ✅ if (condition) { obj.optional = value; }
```

**Non-null assertion** — forbidden:

```ts-example
// ❌ obj.prop!
// ✅ obj.prop as Type (or runtime check)
```

**Strict boolean expressions** — nullable values require explicit checks:

```ts-example
// ❌ {error ? <div>{error}</div> : null}
// ✅ {error !== null && error !== '' ? <div>{error}</div> : null}

// ❌ {status?.connected ? 'Connected' : 'Disconnected'}
// ✅ {status?.connected === true ? 'Connected' : 'Disconnected'}
```

**Explicit return types** — all inline functions must have return types:

```ts-example
// ❌ login: () => { doLogin(); }
// ✅ login: (): void => { doLogin(); }
```

**Template literals** — numbers must be converted:

```ts-example
// ❌ `Found ${items.length} items`
// ✅ `Found ${String(items.length)} items`
```

---

## Code Smells (Fix & Document)

**RULE: When fixing a new code smell not listed here, YOU MUST add it to this section.**

**Silent catch** — always document why errors are ignored:

```ts-example
// ❌ try { await op(); } catch {}
// ✅ try { await op(); } catch { /* Best-effort cleanup */ }
```

**Redundant variable** — return directly:

```ts-example
// ❌ const result = await fetch(url); return result;
// ✅ return await fetch(url);
```

**Inline error extraction** — use utility:

```ts-example
// ❌ error instanceof Error ? error.message : 'Unknown'
// ✅ getErrorMessage(error, 'Unknown Firestore error')
```

**Throw inside try-catch** — don't throw exceptions caught by same block:

```ts-example
// ❌ try { if (bad) throw new Error(); } catch (e) { ... }
// ✅ Separate try-catch from conditional throw
```

**Redundant defensive check** — trust TypeScript's type narrowing:

```ts-example
// ❌ After isErr(result), checking !result.ok is redundant
// ✅ Direct access after type guard
```

**Duplicated documentation** — single source of truth:

```ts-example
// ❌ Same doc block in multiple files
// ✅ Canonical location, reference elsewhere
```

---

## Testing

**No external dependencies.** Tests use in-memory fake repositories.

- Tests do NOT require `gcloud`, Firebase emulator, or cloud connectivity
- All Firestore operations mocked via fake repositories
- All external HTTP calls mocked via `nock`
- Just run `npm run test` — everything is self-contained

### Common Commands

```bash
npm run test                           # Run all tests
npm run test:watch                     # Watch mode
npm run test:coverage                  # With coverage report
npx vitest path/to/file.test.ts        # Run single test file
npx vitest -t "test name pattern"      # Run tests matching pattern
```

### Test Setup Pattern

```ts-example
import { setServices, resetServices } from '../services.js';
import { FakeRepository } from './fakes.js';

describe('MyRoute', () => {
  let fakeRepo: FakeRepository;

  beforeEach(() => {
    fakeRepo = new FakeRepository();
    setServices({ repository: fakeRepo });
  });

  afterEach(() => {
    resetServices();
  });
});
```

### Test Architecture

| Component                | Test Strategy                                               |
| ------------------------ | ----------------------------------------------------------- |
| Routes (`src/routes/**`) | Integration tests via `app.inject()` with fake repositories |
| Domain (`src/domain/**`) | Unit tests with fake ports                                  |
| Infra (`src/infra/**`)   | Tested indirectly through route integration tests           |

### Coverage Thresholds

Current values in `vitest.config.ts`: lines 95%, branches 95%, functions 95%, statements 95%.

**NEVER modify coverage thresholds or exclusions. Write tests to meet thresholds.**

---

## Git Commits

**Format:**

1. First line: imperative, max 50 chars
2. Second line: empty
3. Body: optional, 1-3 sentences explaining what/why

```
Fix login redirect handling

Added proper redirect URL validation to prevent open redirect vulnerability.
```

**Rules:**

- No emojis, no markdown, no AI references
- If branch matches `^[A-Z]+[0-9]+-(.*)`$, prefix commit with ticket ID

---

## Complex Tasks — Continuity Workflow

For multi-step features or refactoring, use the continuity process:

### Setup

1. Create numbered directory: `continuity/NNN-task-name/`
2. Create files:
   - `INSTRUCTIONS.md` — goal, scope, constraints, success criteria
   - `CONTINUITY.md` — ledger tracking progress and decisions
   - `[tier]-[seq]-[title].md` — individual subtask files

### Subtask Numbering

```
0-0-setup.md       ← Tier 0: diagnostics/setup
1-0-feature-a.md   ← Tier 1: independent deliverables
1-1-feature-b.md
2-0-integration.md ← Tier 2: dependent/integrative work
```

### Ledger (CONTINUITY.md)

Must track:

- Goal and success criteria
- Done / Now / Next status
- Key decisions with reasoning
- Open questions

### Completion

1. Second-to-last task: verify test coverage
2. Archive to `continuity/archive/NNN-task-name/`
3. Only claim complete after archival

---

## API Contracts

### Response Envelopes

**Success:**

```json
{ "success": true, "data": {...}, "diagnostics": { "requestId": "...", "durationMs": 42 } }
```

**Error:**

```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." }, "diagnostics": {...} }
```

### Error Codes

| Code               | HTTP | Description                      |
| ------------------ | ---- | -------------------------------- |
| `INVALID_REQUEST`  | 400  | Malformed request                |
| `UNAUTHORIZED`     | 401  | Missing/invalid authentication   |
| `FORBIDDEN`        | 403  | Authenticated but not authorized |
| `NOT_FOUND`        | 404  | Resource does not exist          |
| `CONFLICT`         | 409  | Resource state conflict          |
| `DOWNSTREAM_ERROR` | 502  | External service failure         |
| `INTERNAL_ERROR`   | 500  | Unexpected server error          |
| `MISCONFIGURED`    | 503  | Missing configuration            |

### Required Endpoints (all apps except api-docs-hub)

- `GET /health` — returns health status (no auth required)
- `GET /openapi.json` — OpenAPI spec (no auth required)
- `GET /docs` — Swagger UI (no auth required)

---

## Task Completion

1. Run `npm run ci` — must pass
2. If terraform changed: `terraform fmt -check -recursive && terraform validate`
3. If CI fails → fix → repeat
4. **If coverage fails → write tests. NEVER modify vitest.config.ts exclusions.**
5. Only when all pass → task complete
