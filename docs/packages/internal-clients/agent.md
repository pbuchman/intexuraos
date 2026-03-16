# @intexuraos/internal-clients — Agent Reference

Machine-readable export and interface reference for `@intexuraos/internal-clients`.

---

## Package Metadata

```yaml
name: '@intexuraos/internal-clients'
entry: './src/index.ts'
type: 'module'
private: true
```

---

## Exports

### Functions

```typescript
function createUserServiceClient(config: UserServiceConfig): UserServiceClient;

function fetchWithAuth<T>(
  config: ServiceClientConfig,
  path: string,
  options?: ServiceClientOptions
): Promise<Result<T, ServiceClientError>>;
```

### Interfaces

```typescript
interface UserServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  pricingContext: IPricingContext;
  logger: Logger;
  platformGeminiApiKey?: string | undefined; // fallback: Gemini 2.5 Flash when user has no key
}

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

interface DecryptedApiKeys {
  google?: string;
  openai?: string;
  anthropic?: string;
  perplexity?: string;
}

interface OAuthTokenResult {
  accessToken: string;
  email: string;
}

interface UserServiceError {
  code:
    | 'NETWORK_ERROR'
    | 'API_ERROR'
    | 'NO_API_KEY'
    | 'INVALID_MODEL'
    | 'CONNECTION_NOT_FOUND'
    | 'TOKEN_REFRESH_FAILED'
    | 'OAUTH_NOT_CONFIGURED';
  message: string;
}

interface ServiceClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: Logger;
}

interface ServiceClientOptions {
  traceId?: string;
  headers?: Record<string, string>;
  method?: string;
  body?: string | null | ArrayBuffer | ReadableStream<Uint8Array>;
}

interface ServiceClientError {
  code: 'NETWORK_ERROR' | 'API_ERROR';
  message: string;
}
```

### Type Aliases

```typescript
type OAuthProvider = 'google' | 'github';
```

### Re-exports

```typescript
export type { LlmProvider } from '@intexuraos/llm-contract';
```

---

## Internal HTTP Endpoints Called

| Method | Path                                                   | Called By                    |
| ------ | ------------------------------------------------------ | ---------------------------- |
| GET    | `/internal/users/:userId/llm-keys`                     | `getApiKeys`, `getLlmClient` |
| GET    | `/internal/users/:userId/settings`                     | `getLlmClient`               |
| POST   | `/internal/users/:userId/llm-keys/:provider/last-used` | `reportLlmSuccess`           |
| GET    | `/internal/users/:userId/oauth/:provider/token`        | `getOAuthToken`              |
| GET    | `/internal/users/by-github-username/:gitHubUsername`   | `resolveGitHubUsername`      |

All endpoints require `X-Internal-Auth` header.

---

## Dependency Graph

```
@intexuraos/internal-clients
  +-- @intexuraos/common-core    (Result, Logger, ok, err, getErrorMessage)
  +-- @intexuraos/llm-contract   (LlmProvider, LlmModels, LlmProviders, isValidModel, getProviderForModel)
  +-- @intexuraos/llm-factory    (createLlmClient, LlmClientConfig, LlmGenerateClient)
  +-- @intexuraos/llm-pricing    (IPricingContext)
```

---

## Consumer Apps

```
actions-agent, calendar-agent, chat-agent, code-agent, commands-agent,
data-insights-agent, image-service, linear-agent, research-agent,
todos-agent, web-agent
```

---

## File Map

```
src/index.ts                              -> re-exports user-service + shared
src/shared/index.ts                       -> re-exports http.ts + errors.ts
src/shared/http.ts                        -> re-exports from errors.ts
src/shared/errors.ts                      -> fetchWithAuth, ServiceClientConfig, ServiceClientError, ServiceClientOptions
src/user-service/index.ts                 -> re-exports client.ts + types.ts
src/user-service/types.ts                 -> UserServiceConfig, UserServiceClient, DecryptedApiKeys, OAuthTokenResult, OAuthProvider, UserServiceError
src/user-service/client.ts                -> createUserServiceClient, providerToKeyField
```
