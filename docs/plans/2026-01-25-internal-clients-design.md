# Internal Clients Package Design

**Date:** 2026-01-25
**Status:** Approved

## Problem

8 duplicate `userServiceClient.ts` implementations exist across apps (63-265 lines each). This causes:

1. **Maintenance burden** — API changes require updating 8+ files
2. **Consistency issues** — Different apps implement the same client slightly differently
3. **Onboarding friction** — New services copy-paste and adapt existing clients

## Solution

Create `packages/internal-clients` with subpath exports for each service client.

### Scope

- Start with `user-service` client only (highest duplication, highest ROI)
- Include all three methods: `getApiKeys`, `getLlmClient`, `reportLlmSuccess`
- Expand to other service clients later using the same pattern

## Package Structure

```
packages/internal-clients/
├── src/
│   ├── index.ts                         # Optional: re-exports all clients
│   ├── shared/
│   │   ├── index.ts
│   │   ├── http.ts                      # fetchWithAuth, headers
│   │   ├── errors.ts                    # ServiceClientError base type
│   │   └── __tests__/
│   │       └── http.test.ts
│   └── user-service/
│       ├── index.ts                     # Public exports
│       ├── client.ts                    # createUserServiceClient
│       ├── types.ts                     # UserServiceConfig, DecryptedApiKeys, etc.
│       └── __tests__/
│           └── client.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Package Exports

```json
{
  "name": "@intexuraos/internal-clients",
  "exports": {
    "./user-service": {
      "types": "./dist/user-service/index.d.ts",
      "import": "./dist/user-service/index.js"
    }
  },
  "dependencies": {
    "@intexuraos/common-core": "workspace:*",
    "@intexuraos/llm-contract": "workspace:*",
    "@intexuraos/llm-factory": "workspace:*",
    "@intexuraos/llm-pricing": "workspace:*"
  }
}
```

### Usage

```typescript
import { createUserServiceClient } from '@intexuraos/internal-clients/user-service';
```

## Types

Reuse existing types from LLM packages:

```typescript
import type { LlmProvider } from '@intexuraos/llm-contract';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { IPricingContext } from '@intexuraos/llm-pricing';
```

Define only what's unique to this client:

```typescript
export interface UserServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
  logger: Logger;
}

export interface DecryptedApiKeys {
  google?: string;
  openai?: string;
  anthropic?: string;
  perplexity?: string;
  zai?: string;
}

export interface UserServiceError {
  code: 'NETWORK_ERROR' | 'API_ERROR' | 'NO_API_KEY' | 'INVALID_MODEL';
  message: string;
}
```

## Shared Utilities

**`src/shared/http.ts`:**

```typescript
export interface ServiceClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}

export async function fetchWithAuth<T>(
  config: ServiceClientConfig,
  path: string,
  options?: RequestInit
): Promise<Result<T, ServiceClientError>>;
```

**`src/shared/errors.ts`:**

```typescript
export type ServiceClientError =
  | { type: 'network'; message: string }
  | { type: 'unauthorized'; message: string }
  | { type: 'not_found'; resource: string }
  | { type: 'downstream'; statusCode: number; body: unknown };
```

## Client Interface

```typescript
export interface UserServiceClient {
  getApiKeys(userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>>;
  getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>>;
  reportLlmSuccess(userId: string, provider: LlmProvider): Promise<void>;
}

export function createUserServiceClient(config: UserServiceConfig): UserServiceClient;
```

**Endpoints called:**

| Method             | Internal Path                                                                     |
| ------------------ | --------------------------------------------------------------------------------- |
| `getApiKeys`       | `GET /internal/users/{userId}/llm-keys`                                           |
| `getLlmClient`     | `GET /internal/users/{userId}/settings` + `GET /internal/users/{userId}/llm-keys` |
| `reportLlmSuccess` | `POST /internal/users/{userId}/llm-keys/{provider}/last-used`                     |

## Migration Strategy

### Phase 1: Create Package

1. Create `packages/internal-clients` with `user-service` subfolder
2. Copy the most complete implementation (research-agent's 265-line version)
3. Add comprehensive tests (95% coverage minimum)
4. Build and verify package exports work

### Phase 2: Migrate Apps (Atomic Per-App)

For each app, in a single commit:

1. **DELETE local files first:**
   - `apps/<app>/src/infra/user/userServiceClient.ts`
   - `apps/<app>/src/__tests__/**/userServiceClient.test.ts`
   - Remove from `apps/<app>/src/infra/user/index.ts` (if barrel export)

2. **THEN apply new import:**
   - Update `apps/<app>/src/services.ts` to import from `@intexuraos/internal-clients/user-service`
   - Update any other files that imported the local client

3. **Run CI to verify nothing is broken**

**Migration order:**

| Order | App                 | Risk   | Notes                                                    |
| ----- | ------------------- | ------ | -------------------------------------------------------- |
| 1     | image-service       | Low    | Minimal client, good first test                          |
| 2     | calendar-agent      | Low    | Simple                                                   |
| 3     | web-agent           | Medium |                                                          |
| 4     | data-insights-agent | Medium |                                                          |
| 5     | actions-agent       | Medium |                                                          |
| 6     | todos-agent         | Medium |                                                          |
| 7     | commands-agent      | Medium |                                                          |
| 8     | research-agent      | Low    | Source of truth - last to avoid changes during migration |

## Testing Strategy

**Package-level tests:**

```typescript
describe('createUserServiceClient', () => {
  describe('getApiKeys', () => {
    it('returns decrypted keys on success');
    it('handles 404 - user not found');
    it('handles 401 - invalid auth token');
    it('handles network errors');
    it('converts null values to undefined');
  });

  describe('getLlmClient', () => {
    it('fetches settings and keys, returns configured client');
    it('uses default model when user has no preference');
    it('returns NO_API_KEY when provider key missing');
    it('returns INVALID_MODEL when user preference invalid');
    it('handles settings fetch failure');
    it('handles keys fetch failure');
  });

  describe('reportLlmSuccess', () => {
    it('calls last-used endpoint with correct provider');
    it('silently ignores failures (best effort)');
  });
});
```

**Test approach:**

- Use `nock` to mock HTTP calls to user-service
- No real network calls - fully isolated
- Cover all error codes in `UserServiceError`

**App-level tests after migration:**

- Apps no longer need `userServiceClient.test.ts`
- Integration tests (`routes.test.ts`) still mock the client via `services.ts` fakes

## Future Expansion

Adding a new service client (e.g., `calendar-agent`):

1. Create `src/calendar-agent/` folder with same structure
2. Add export to `package.json`:
   ```json
   "./calendar-agent": {
     "types": "./dist/calendar-agent/index.d.ts",
     "import": "./dist/calendar-agent/index.js"
   }
   ```
3. Import: `import { createCalendarAgentClient } from '@intexuraos/internal-clients/calendar-agent';`
