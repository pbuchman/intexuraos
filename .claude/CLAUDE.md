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

### Intra-App Import Rules (enforced by ESLint)

Within each app, imports must respect layer boundaries:

| From             | Must NOT Import        | Reason                                     |
| ---------------- | ---------------------- | ------------------------------------------ |
| `routes/*`       | `../infra/firestore/*` | Use `getServices()` to access repositories |
| `infra/notion/*` | `../firestore/*`       | Accept repositories as function parameters |
| `infra/llm/*`    | `../firestore/*`       | Accept repositories as function parameters |

**Anti-Pattern (FORBIDDEN):**

```ts-example
// In routes/promptRoutes.ts - WRONG
import { getPromptVaultPageId } from '../infra/firestore/promptVaultSettingsRepository.js';

// In infra/notion/promptApi.ts - WRONG
import { getPromptVaultPageId } from '../firestore/promptVaultSettingsRepository.js';
```

**Correct Pattern:**

```ts-example
// In services.ts - create and wire dependencies
const promptVaultSettings = createPromptVaultSettingsRepository();

// In routes - access via getServices()
const { promptVaultSettings } = getServices();

// In infra functions - accept as parameter
async function getUserContext(userId: string, promptVaultSettings: PromptVaultSettingsPort) { ... }
```

### Service-to-Service Communication

Apps communicate via HTTP-based internal endpoints following the pattern:

```
/internal/{service-prefix}/{resource-path}
```

**Service Prefixes:**

| Service               | Prefix        | Example Endpoint                         |
| --------------------- | ------------- | ---------------------------------------- |
| `notion-service`      | `notion`      | `/internal/notion/users/:userId/context` |
| `user-service`        | `user`        | `/internal/users/:uid/llm-keys`          |
| `promptvault-service` | `promptvault` | (future endpoints)                       |
| `whatsapp-service`    | `whatsapp`    | (future endpoints)                       |
| `llm-orchestrator`    | `llm`         | (future endpoints)                       |

**Authentication:**

- Header: `X-Internal-Auth: <token>`
- Env var: `INTEXURAOS_INTERNAL_AUTH_TOKEN`
- Returns `401 Unauthorized` for missing/invalid tokens

**Implementation:**

- Server: Use `validateInternalAuth()` helper (see [service-to-service-communication.md](../docs/architecture/service-to-service-communication.md))
- Client: Create typed service client with `fetch()` + auth header
- Testing: Inject fake clients via dependency injection

**Full documentation:** [docs/architecture/service-to-service-communication.md](../docs/architecture/service-to-service-communication.md)

### Pub/Sub Push Endpoints

**Pattern:** `/internal/{service-prefix}/pubsub/{resource}`

**MANDATORY Logging Requirements:**

All Pub/Sub push endpoint handlers MUST log at these points:

1. **Auth Failures (401):**

   ```typescript
   const authResult = validateInternalAuth(request);
   if (!authResult.valid) {
     request.log.warn(
       {
         reason: authResult.reason,
         headers: {
           'x-internal-auth': request.headers['x-internal-auth'] ? '[REDACTED]' : '[MISSING]',
         },
       },
       'Pub/Sub auth failed'
     );
     // ... return 401
   }
   ```

2. **Message Format Errors (400):**

   ```typescript
   request.log.error({ messageId: body.message.messageId }, 'Failed to decode PubSub message');
   ```

3. **Event Type Validation (400):**

   ```typescript
   request.log.warn(
     {
       type: parsedType,
       messageId: body.message.messageId,
       // Include entity IDs (userId, actionId, commandId, etc.)
     },
     'Unexpected event type'
   );
   ```

4. **Entry Point (Before Processing):**

   ```typescript
   request.log.info(
     {
       messageId: body.message.messageId,
       userId: eventData.userId,
       // Include relevant entity IDs and context
     },
     'Processing {event-name} event'
   );
   ```

5. **Processing Errors (500):**

   ```typescript
   request.log.error(
     {
       error: result.error.message,
       messageId: body.message.messageId,
       // Include full context for debugging
     },
     'Failed to process event'
   );
   ```

6. **Success (200):**

   ```typescript
   request.log.info(
     {
       messageId: body.message.messageId,
       // Include result IDs and summary
     },
     'Successfully processed event'
   );
   ```

**Rule:** Every rejected message (auth, validation, processing failure) MUST be logged with:

- Message ID
- Rejection reason
- Relevant entity IDs for correlation
- NO secrets/tokens in logs (use [REDACTED])

**Verification:** `npm run ci` includes log coverage checks via tests.

### Pub/Sub Subscriptions (Cloud Run)

**RULE: Never use pull subscriptions. All Pub/Sub consumers MUST use HTTP push.**

```ts-example
// ❌ Pull subscription (FORBIDDEN)
const subscription = pubsub.subscription('my-sub');
subscription.on('message', (message) => { ... });

// ✅ Push subscription (CORRECT)
fastify.post('/internal/pubsub/my-topic', async (request, reply) => {
  const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
  // Process message
  return { success: true };
});
```

**Why:** Cloud Run scales to zero. Pull subscriptions require persistent background processes. Messages accumulate and are never processed.

**Reference Implementation:** See `apps/research-agent/src/routes/internalRoutes.ts`

**Verification:** ESLint `no-restricted-syntax` rule fails build on pull subscription patterns.

### Firestore Collections

**RULE: Each Firestore collection MUST be owned by exactly ONE service.**

**Verification:** `npm run verify:firestore` (runs automatically in `npm run ci`)

**Registry:** All collections declared in `firestore-collections.json` at repo root.

| Collection                       | Owner                          | Description                              |
| -------------------------------- | ------------------------------ | ---------------------------------------- |
| `notion_connections`             | `notion-service`               | Notion OAuth tokens and connection state |
| `promptvault_settings`           | `promptvault-service`          | Prompt Vault page ID configuration       |
| `whatsapp_messages`              | `whatsapp-service`             | WhatsApp messages with metadata          |
| `whatsapp_user_mappings`         | `whatsapp-service`             | Phone number to user ID mappings         |
| `whatsapp_webhook_events`        | `whatsapp-service`             | Raw webhook events for audit             |
| `mobile_notifications`           | `mobile-notifications-service` | Push notifications from devices          |
| `mobile_notification_signatures` | `mobile-notifications-service` | Device signature to user ID bindings     |
| `user_settings`                  | `user-service`                 | User preferences and encrypted API keys  |
| `auth_tokens`                    | `user-service`                 | Encrypted Auth0 refresh tokens           |
| `researches`                     | `llm-orchestrator`             | LLM research queries and results         |

**Ownership Rules:**

✅ **Allowed:**

- Service directly accesses its OWN collections via `getFirestore()`
- Service exposes internal HTTP endpoints for other services to access data
- Read from service-owned collections only

❌ **Forbidden:**

- Accessing collections owned by other services
- Sharing collections between multiple services
- Cross-service Firestore queries

**Adding New Collections:**

1. Add to `firestore-collections.json`:

   ```json
   {
     "collections": {
       "my_new_collection": {
         "owner": "my-service",
         "description": "What this collection stores"
       }
     }
   }
   ```

2. Access only from owning service:

   ```typescript
   import { getFirestore } from '@intexuraos/infra-firestore';

   const db = getFirestore();
   const collection = db.collection('my_new_collection');
   ```

3. Verify: `npm run verify:firestore`

**Cross-Service Data Access:**

If you need data from another service's collection, use service-to-service HTTP:

```typescript
// ❌ Direct Firestore access (VIOLATION)
const db = getFirestore();
const doc = await db.collection('whatsapp_messages').doc(id).get();

// ✅ Service-to-service HTTP (CORRECT)
const response = await fetch(`${WHATSAPP_SERVICE_URL}/internal/whatsapp/messages/${id}`, {
  headers: { 'X-Internal-Auth': INTERNAL_AUTH_TOKEN },
});
```

**Full documentation:** [docs/architecture/firestore-ownership.md](../docs/architecture/firestore-ownership.md)

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

### Firestore Access

Use the singleton from `@intexuraos/infra-firestore`, never instantiate directly:

```ts-example
// ❌ Direct instantiation — creates separate instance
import { Firestore } from '@google-cloud/firestore';
const firestore = new Firestore();

// ✅ Singleton — shared instance, testable via setFirestore()
import { getFirestore } from '@intexuraos/infra-firestore';
const db = getFirestore();
```

Repositories should call `getFirestore()` within methods, not accept Firestore as constructor parameter.

### Secrets

- Use `INTEXURAOS_*` prefix for environment variables
- Access via env vars or Secret Manager

### Environment Variable Validation (MANDATORY)

**FAIL FAST:** Every service MUST validate required environment variables at startup and crash immediately if any are missing.

**Rule:** Validate in service entry point (before starting HTTP server):

```typescript
function validateRequiredEnv(vars: string[]): void {
  const missing = vars.filter((v) => process.env[v] === undefined || process.env[v] === '');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        `Ensure these are set in Terraform env_vars or .envrc.local for local development.`
    );
  }
}

// In index.ts (BEFORE starting server)
validateRequiredEnv([
  'INTEXURAOS_INTERNAL_AUTH_TOKEN',
  'AUTH_JWKS_URL',
  'AUTH_ISSUER',
  'AUTH_AUDIENCE',
  // ... all required vars
]);
```

**Why:** Missing environment variables must cause immediate startup failure, not runtime errors after deployment. This prevents:

- Services running in degraded state
- Silent failures in production
- Runtime crashes during request handling
- Debugging environment issues post-deployment

**Deployment:** Services must be created via Terraform FIRST (with all env vars configured) before Cloud Build can deploy updates.

### Validation Best Practices

**Rule:** Validation array MUST match Terraform configuration exactly.

**Verification Process:**

1. Find service Terraform module in `terraform/environments/dev/main.tf`
2. List all keys in `secrets = {}` block
3. List all keys in `env_vars = {}` block
4. Ensure ALL are in `validateRequiredEnv()` array (or Zod schema for whatsapp-service)
5. **CRITICAL:** Verify each variable is ACTUALLY USED in code (search codebase)

**Example:**

Terraform configuration:

```hcl
secrets = {
  AUTH_JWKS_URL         = module.secret_manager.secret_ids["INTEXURAOS_AUTH_JWKS_URL"]
  INTERNAL_AUTH_TOKEN   = module.secret_manager.secret_ids["INTEXURAOS_INTERNAL_AUTH_TOKEN"]
}
env_vars = {
  GOOGLE_CLOUD_PROJECT = var.project_id
  USER_SERVICE_URL     = module.user_service.service_url
}
```

Service validation:

```typescript
validateRequiredEnv([
  'GOOGLE_CLOUD_PROJECT', // from env_vars
  'USER_SERVICE_URL', // from env_vars
  'AUTH_JWKS_URL', // from secrets (uses left-hand key name)
  'INTERNAL_AUTH_TOKEN', // from secrets (uses left-hand key name)
]);
```

**Audit Commands:**

1. **Check what service validates:**

   ```bash
   grep "validateRequiredEnv\|REQUIRED_ENV" apps/service-name/src/index.ts
   ```

2. **Check what Terraform configures:**

   ```bash
   grep -A 20 "module \"service-name\"" terraform/environments/dev/main.tf | grep -E "secrets|env_vars" -A 5
   ```

3. **Verify variable is used in code:**
   ```bash
   grep -r "process.env\['VAR_NAME'\]" apps/service-name/src --include="*.ts" --exclude-dir=__tests__
   ```

**Warning Signs:**

- Variable in Terraform but never accessed in code → **Remove from Terraform**
- Variable used in code but not in Terraform → **Add to Terraform**
- Variable validated at startup but never used → **Remove from validation**

### New Service Checklist

1. Copy structure from existing service (domain/, infra/, routes/)
2. Create Dockerfile with correct workspace deps
3. Add startup validation in index.ts with `validateRequiredEnv()` from `@intexuraos/http-server`
   - Include `GOOGLE_CLOUD_PROJECT` if service uses Firestore
   - Include all required secrets (AUTH\_\*, service-specific vars)
4. Run `npx prettier --write .`
5. Add Terraform module in `terraform/environments/dev/main.tf`
   - Include `GOOGLE_CLOUD_PROJECT = var.project_id` in `env_vars` if service uses Firestore
6. Add service account to IAM module
7. Add OpenAPI URL to `apps/api-docs-hub/src/config.ts`
8. Add project reference to root `tsconfig.json`
9. Add to ESLint `no-restricted-imports` patterns in `eslint.config.js`
10. Run `npm run ci`
11. Run `tf fmt -check -recursive && tf validate`
12. **CRITICAL:** Run `terraform apply` in `terraform/environments/dev/` to create service with env vars BEFORE pushing code
13. Add Cloud Build deployment script in `cloudbuild/scripts/deploy-<service>.sh`
    - Script must check if service exists before deploying (fail if not)
    - Only updates image, does NOT modify env vars/secrets (managed by Terraform)

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
tf fmt -check -recursive      # From /terraform
tf validate                   # From /terraform or environment dir
```

### Rules

| Rule                              | Verification               |
| --------------------------------- | -------------------------- |
| Formatted                         | `tf fmt -check -recursive` |
| Valid syntax                      | `tf validate`              |
| No hardcoded secrets              | Manual review              |
| Variables have description + type | `tf validate`              |
| Outputs have description          | `tf validate`              |

### Structure

```
terraform/
├── environments/dev/   # Environment config
├── modules/            # Reusable modules
├── variables.tf        # Input variables
└── outputs.tf          # Outputs
```

### Change Process

1. `tf fmt -recursive`
2. `tf validate`
3. `tf plan` (review before apply)
4. Document in commit message

### Web Hosting Gotcha

When changing `terraform/modules/web-app`:

- Backend buckets do **not** honor GCS `website.main_page_suffix`
- `GET /` will 404 unless the URL map rewrites `/` → `/index.html`

Reference: `docs/architecture/web-app-hosting.md`

### Checklist

- [ ] `tf fmt -check -recursive` passes
- [ ] `tf validate` passes
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

### Error Handling

**Silent catch** — always document why errors are ignored:

```ts-example
// ❌ try { await op(); } catch {}
// ✅ try { await op(); } catch { /* Best-effort cleanup */ }
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

### Dependency Injection

**Re-exports from services.ts** — services.ts should only export DI container:

```ts-example
// ❌ export * from './infra/firestore/index.js';  // Bypasses DI
// ✅ Only export getServices, setServices, resetServices, initServices
```

**Module-level mutable state** — pass dependencies explicitly:

```ts-example
// ❌ let logger: Logger | undefined;  // Mutated at runtime
//    getServices() captures via closure
// ✅ Pass logger into factory functions: createAdapter(logger)
```

**Test fallbacks in production** — throw if not initialized:

```ts-example
// ❌ return container ?? { fakeRepo: new FakeRepo() };
// ✅ if (!container) throw new Error('Call initServices() first');
```

### Architecture

**Domain logic in infra layer** — keep domain pure:

```ts-example
// ❌ packages/infra-*/src/client.ts contains maskApiKey()
// ✅ Move to domain layer or common-core
```

**Infra re-exporting domain types** — respect layer boundaries:

```ts-example
// ❌ // infra/firestore/messageRepository.ts
//    export type { WhatsAppMessage } from '../../domain/index.js';
// ✅ Import domain types where needed, don't re-export from infra
```

### Code Quality

**Redundant variable** — return directly:

```ts-example
// ❌ const result = await fetch(url); return result;
// ✅ return await fetch(url);
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

### Known Technical Debt (Documented)

**Duplicated OpenAPI schemas** — each server.ts has inline schemas:

```ts-example
// Issue: coreComponentSchemas from http-contracts can't be spread
//        due to Fastify's strict swagger types
// Status: Keep inline until Fastify types improve or custom wrapper created
// Files: apps/*/src/server.ts buildOpenApiOptions()
```

---

## Testing

**No external dependencies.** Tests use in-memory fake repositories.

- Tests do NOT require `gcloud`, Firebase emulator, or cloud connectivity
- All Firestore operations mocked via fake repositories
- All external HTTP calls mocked via `nock`
- Just run `npm run test` — everything is self-contained

### Test File TypeScript Configuration

**Test files (`src/**tests**/**`) are EXCLUDED from TypeScript compilation (`tsc`).\*\*

This is intentional — tests are:

- Run by Vitest which uses **esbuild** for transpilation (not `tsc`)
- Ignored by ESLint (in `eslint.config.js` ignores)
- Not part of the production build

**Why this matters:**

1. `npm run typecheck` does NOT compile test files
2. `npm run build` does NOT compile test files
3. Vitest handles test transpilation internally

**IDE shows errors in test files (expected behavior):**

```
TS2307: Cannot find module '@intexuraos/common-core' or its corresponding type declarations.
```

**This is a FALSE POSITIVE.** The error appears because:

- Test files are in `exclude` in `tsconfig.json`
- IDE's TypeScript Language Server cannot resolve workspace package imports
- But Vitest resolves them correctly at runtime

**DO NOT attempt to "fix" these IDE errors by:**

- ❌ Removing `src/__tests__` from `exclude` in `tsconfig.json`
- ❌ Adding test dependencies to production dependencies
- ❌ Creating separate tsconfig for tests

**If you remove `__tests__` from exclude, `npm run build` will FAIL with:**

- Missing type declarations (e.g., `Cannot find module 'nock'`)
- Implicit `any` errors in test code
- Other strict mode violations in test files

**Verification:** Tests work correctly despite IDE errors:

```bash
npm run test                    # All tests pass
npm run typecheck               # No errors (tests excluded)
npm run build                   # No errors (tests excluded)
```

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
2. If terraform changed: `tf fmt -check -recursive && tf validate`
3. If CI fails → fix → repeat
4. **If coverage fails → write tests. NEVER modify vitest.config.ts exclusions.**
5. Only when all pass → task complete
