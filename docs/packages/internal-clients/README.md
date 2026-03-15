# @intexuraos/internal-clients

Shared HTTP client library for calling IntexuraOS internal service APIs. Created to eliminate duplicate user-service client code that had spread across multiple services.

**Package:** `@intexuraos/internal-clients` | **Type:** ESM

---

## Overview

This package provides two main capabilities:

1. **User Service Client** — a typed client for the user-service internal API (API keys, LLM client creation, OAuth tokens, GitHub username resolution)
2. **Generic HTTP utility** — `fetchWithAuth()` for authenticated calls to any internal service with `X-Internal-Auth` and optional `X-Trace-Id` headers

All operations return `Result<T, E>` types from `@intexuraos/common-core`, ensuring callers handle both success and failure paths explicitly.

---

## API Reference

### `createUserServiceClient(config: UserServiceConfig): UserServiceClient`

Create a client for the user-service internal API. The returned client provides five methods for interacting with user data.

```typescript
import { createUserServiceClient } from '@intexuraos/internal-clients';

const userClient = createUserServiceClient({
  baseUrl: process.env['INTEXURAOS_USER_SERVICE_URL'],
  internalAuthToken: process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'],
  pricingContext: pricingContext,
  logger: logger,
});
```

#### `UserServiceConfig`

```typescript
interface UserServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
  logger: Logger;
  platformGeminiApiKey?: string | undefined; // platform-level fallback: Gemini 2.5 Flash
}
```

#### `UserServiceClient`

```typescript
interface UserServiceClient {
  getApiKeys(userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>>;
  getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>>;
  reportLlmSuccess(userId: string, provider: LlmProvider): Promise<void>;
  getOAuthToken(
    userId: string,
    provider: OAuthProvider
  ): Promise<Result<OAuthTokenResult, UserServiceError>>;
  resolveGitHubUsername(
    gitHubUsername: string
  ): Promise<Result<{ userId: string } | null, UserServiceError>>;
}
```

#### `getApiKeys(userId: string)`

Fetch decrypted LLM API keys for a user. Calls `GET /internal/users/:userId/llm-keys`.

Returns `Result<DecryptedApiKeys, UserServiceError>` where:

```typescript
interface DecryptedApiKeys {
  google?: string;
  openai?: string;
  anthropic?: string;
  perplexity?: string;
}
```

Null values from the JSON response are converted to `undefined`.

#### `getLlmClient(userId: string)`

Build a fully configured LLM client for a user in a single call. Performs three internal steps:

1. Fetch user settings (`GET /internal/users/:userId/settings`) to determine the default model
2. Fetch the user's API keys for the required provider (`GET /internal/users/:userId/llm-keys`)
3. Create an `LlmGenerateClient` via `@intexuraos/llm-factory`

Falls back to `Gemini25Flash` when the user has no model preference. If the user has no API key for the required provider and `platformGeminiApiKey` is configured, silently falls back to Gemini 2.5 Flash using the platform key.

Returns `Result<LlmGenerateClient, UserServiceError>` with error codes:

| Code            | Meaning                                       |
| --------------- | --------------------------------------------- |
| `NETWORK_ERROR` | Connection failure or timeout                 |
| `API_ERROR`     | Non-2xx HTTP response from user-service       |
| `NO_API_KEY`    | User has no API key for the required provider |
| `INVALID_MODEL` | User preference references an unknown model   |

#### `reportLlmSuccess(userId: string, provider: LlmProvider)`

Report a successful LLM call. Calls `POST /internal/users/:userId/llm-keys/:provider/last-used`. Best-effort — silently ignores all errors.

#### `getOAuthToken(userId: string, provider: OAuthProvider)`

Fetch a valid OAuth access token for a user. Calls `GET /internal/users/:userId/oauth/:provider/token`.

```typescript
type OAuthProvider = 'google' | 'github';

interface OAuthTokenResult {
  accessToken: string;
  email: string;
}
```

Error codes specific to OAuth:

| Code                   | Meaning                          |
| ---------------------- | -------------------------------- |
| `CONNECTION_NOT_FOUND` | User has not connected OAuth     |
| `TOKEN_REFRESH_FAILED` | Token refresh failed server-side |
| `OAUTH_NOT_CONFIGURED` | OAuth not configured on server   |

#### `resolveGitHubUsername(gitHubUsername: string)`

Resolve a GitHub username to an IntexuraOS `userId`. Calls `GET /internal/users/by-github-username/:gitHubUsername`.

Returns `Result<{ userId: string } | null, UserServiceError>` — returns `null` (not an error) when no user is found.

---

### `fetchWithAuth<T>(config, path, options?): Promise<Result<T, ServiceClientError>>`

Generic authenticated HTTP call to any internal service. Adds `X-Internal-Auth` header automatically and optionally propagates `X-Trace-Id`.

```typescript
import { fetchWithAuth } from '@intexuraos/internal-clients';

const result = await fetchWithAuth<{ items: Item[] }>(
  { baseUrl, internalAuthToken, logger },
  '/internal/items',
  { traceId: request.headers['x-trace-id'] }
);
```

#### `ServiceClientConfig`

```typescript
interface ServiceClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}
```

#### `ServiceClientOptions`

```typescript
interface ServiceClientOptions {
  traceId?: string;
  headers?: Record<string, string>;
  method?: string;
  body?: string | null | ArrayBuffer | ReadableStream<Uint8Array>;
}
```

#### `ServiceClientError`

```typescript
interface ServiceClientError {
  code: 'NETWORK_ERROR' | 'API_ERROR';
  message: string;
}
```

---

## Dependencies

| Package                    | Role                                         |
| -------------------------- | -------------------------------------------- |
| `@intexuraos/common-core`  | `Result` type, `Logger`, `getErrorMessage`   |
| `@intexuraos/llm-contract` | `LlmProvider`, `LlmModels`, model validation |
| `@intexuraos/llm-factory`  | `createLlmClient`, `LlmGenerateClient`       |
| `@intexuraos/llm-pricing`  | `IPricingContext` for model pricing          |

---

## Used By

12 apps import this package:

| App                 | Primary Use                           |
| ------------------- | ------------------------------------- |
| actions-agent       | LLM client + OAuth tokens             |
| calendar-agent      | LLM client + OAuth tokens             |
| chat-agent          | LLM client creation                   |
| code-agent          | fetchWithAuth for cross-service calls |
| commands-agent      | LLM client for command processing     |
| data-insights-agent | LLM client for data analysis          |
| image-service       | LLM client for image generation       |
| linear-agent        | LLM client for issue management       |
| research-agent      | LLM client for research tasks         |
| todos-agent         | LLM client for todo extraction        |
| web-agent           | LLM client for web browsing           |

---

## Recent Changes

| Commit      | Description                                                    |
| ----------- | -------------------------------------------------------------- |
| `93aeac4a3` | Remove ZAI provider and GLM-4.7 models, finalize GLM-5         |
| `b86e8af4d` | Rename `username` to `gitHubUsername` in resolveGitHubUsername |
| `25c2ab2db` | Add resolveGitHubUsername method and github OAuth provider     |
| `c72b7c532` | Switch default LLM to Gemini 2.5 Flash + add Gemini fallback   |

---

## File Structure

```
packages/internal-clients/
  src/
    index.ts                           # Package entry: re-exports all public API
    shared/
      index.ts                         # Re-exports http.ts + errors.ts
      http.ts                          # Re-exports from errors.ts (legacy compat)
      errors.ts                        # fetchWithAuth(), ServiceClientConfig, ServiceClientError
      __tests__/http.test.ts           # Tests for fetchWithAuth
    user-service/
      index.ts                         # Re-exports client.ts + types.ts
      types.ts                         # All TypeScript interfaces
      client.ts                        # createUserServiceClient() implementation
      __tests__/client.test.ts         # Tests for UserServiceClient
```
