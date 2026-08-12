# user-service - Agent Interface

> Machine-readable interface definition for AI agents interacting with user-service.

---

## Identity

| Field    | Value                                                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name** | user-service                                                                                                                                               |
| **Role** | User Authentication and Settings Service                                                                                                                   |
| **Goal** | Manage authentication, Google + GitHub OAuth connections, LLM API keys for 4 configurable providers, user preferences, and error formatting |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface UserServiceTools {
  // Authentication
  startDeviceAuth(): Promise<DeviceAuthStartResult>;
  pollDeviceAuth(params: { deviceCode: string }): Promise<DeviceAuthPollResult>;
  refreshToken(params: { userId: string }): Promise<TokenResult>;
  getFirebaseToken(): Promise<{ customToken: string }>;
  getCurrentUser(): Promise<UserProfile>;

  // User Settings
  getUserSettings(userId: string): Promise<UserSettings>;
  updateUserSettings(
    userId: string,
    params: { defaultModel: string; fallbackModel?: string | null }
  ): Promise<{ defaultModel: string; fallbackModel: string | null }>;
  updateTranscriptionPreferences(
    userId: string,
    params: { provider: TranscriptionProvider }
  ): Promise<{ provider: TranscriptionProvider }>;
  updateTimezone(
    userId: string,
    params: { timezone: string }
  ): Promise<{ timezone: string }>;

  // LLM API Keys
  getLlmApiKeys(userId: string): Promise<LlmKeysStatus>;
  updateLlmApiKey(
    userId: string,
    params: {
      provider: ConfigurableLlmProvider;
      apiKey: string;
    }
  ): Promise<LlmKeyUpdateResult>;
  testLlmApiKey(userId: string, provider: ConfigurableLlmProvider): Promise<LlmTestResult>;
  deleteLlmApiKey(userId: string, provider: LlmProvider): Promise<void>;

  // OAuth Connections (Google)
  initiateGoogleOAuth(): Promise<{ authorizationUrl: string }>;
  getGoogleOAuthStatus(): Promise<OAuthConnectionStatus>;
  disconnectGoogleOAuth(): Promise<void>;

  // OAuth Connections (GitHub)
  initiateGitHubOAuth(): Promise<{ authorizationUrl: string }>;
  getGitHubOAuthStatus(): Promise<GitHubOAuthConnectionStatus>;
  disconnectGitHubOAuth(): Promise<void>;

  // Internal (service-to-service) -- all wrapped in response contract
  getDecryptedLlmKeys(userId: string): Promise<ApiResponse<DecryptedLlmKeys>>;
  updateLlmLastUsed(userId: string, provider: ConfigurableLlmProvider): Promise<void>;
  getGoogleOAuthToken(userId: string): Promise<ApiResponse<{ accessToken: string; email: string }>>;
  getGitHubOAuthToken(userId: string): Promise<ApiResponse<{ accessToken: string; username: string }>>;
  getUserByGitHubUsername(username: string): Promise<ApiResponse<{ userId: string; username: string }>>;
  getUserPreferences(userId: string): Promise<ApiResponse<{
    llmPreferences?: LlmPreferences;
    transcriptionPreferences?: TranscriptionPreferences;
    timezone?: string;
  }>>;
}
```

### Types

```typescript
type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity' | 'openrouter';
type ConfigurableLlmProvider = Exclude<LlmProvider, 'google'>;
type OAuthProvider = 'google' | 'github';
type TranscriptionProvider = 'speechmatics';

interface ApiResponse<T> {
  success: true;
  data: T;
}

interface DeviceAuthStartResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

interface DeviceAuthPollResult {
  status: 'pending' | 'complete' | 'expired';
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
}

interface TokenResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  scope?: string;
  idToken?: string;
}

interface UserProfile {
  userId: string;
  email?: string;
  name?: string;
  picture?: string;
  hasRefreshToken: boolean;
}

interface UserSettings {
  userId: string;
  llmPreferences?: LlmPreferences;
  transcriptionPreferences?: TranscriptionPreferences;
  timezone?: string;
  createdAt: string;
  updatedAt: string;
}

interface LlmPreferences {
  defaultModel: string; // Eligible model; OpenRouter can use the platform key
  fallbackModel?: string; // Optional, must differ from defaultModel and be resolvable
}

interface TranscriptionPreferences {
  provider: TranscriptionProvider;
}

interface LlmKeysStatus {
  defaultModel: string | null; // User's preferred default LLM model
  fallbackModel: string | null; // User's fallback LLM model (auto-retry when primary unavailable)
  google: null; // Compatibility field; direct Google LLM keys are retired
  openai: string | null;
  anthropic: string | null;
  perplexity: string | null;
  openrouter: string | null;
  testResults: Record<ConfigurableLlmProvider, LlmTestResult | null> & { google: null };
}

interface LlmTestResult {
  status: 'success' | 'failure';
  message: string; // LLM response (success) or formatted error (failure)
  testedAt: string; // ISO 8601 timestamp
}

interface LlmKeyUpdateResult {
  provider: ConfigurableLlmProvider;
  masked: string;
}

interface DecryptedLlmKeys {
  google: null; // Compatibility field; never returned as an executable key
  openai: string | null;
  anthropic: string | null;
  perplexity: string | null;
  openrouter: string | null;
}

interface OAuthConnectionStatus {
  connected: boolean;
  email: string | null;
  scopes: string[] | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface GitHubOAuthConnectionStatus {
  connected: boolean;
  username: string | null;
  scopes: string[] | null;
  createdAt: string | null;
  updatedAt: string | null;
}
```

---

## Constraints

| Rule                           | Description                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------ |
| **Self-Access Only**           | Users can only access their own settings                                       |
| **Encrypted Storage**          | API keys encrypted at rest with AES-256-GCM                                    |
| **Key Validation**             | API keys validated with provider before storing                                |
| **4 Configurable Providers**   | Supports OpenAI, Anthropic, Perplexity, and OpenRouter LLM keys                |
| **No Direct Google LLM**       | Google model calls use `or:google/...` through OpenRouter; OAuth is unaffected |
| **Rate Limit Precedence**      | Error parser checks rate limits before API key errors                          |
| **Internal Auth**              | Service-to-service calls require X-Internal-Auth header                        |
| **Model Validation**           | `defaultModel` must pass `isDefaultEligibleModel()` and be resolvable          |
| **Fallback Validation**        | `fallbackModel` must differ from default, pass eligibility, and be resolvable  |
| **Model Cascade on Delete**    | Deleting API key clears default/fallback if they use the deleted provider      |
| **OAuth2 Raw Responses**       | `/auth/oauth/*` routes use flat OAuth2-spec responses                          |
| **GitHub Tokens Never Expire** | GitHub access tokens stored with far-future expiry (9999-12-31)                |
| **OAuth State TTL**            | OAuth state parameters expire after 10 minutes                                 |
| **OpenRouter Zero-Cost Valid** | OpenRouter keys validated via `/api/v1/key` (no token cost)                    |
| **IANA Timezone Only**         | Timezone must be a valid IANA string (e.g., `Europe/Berlin`)                   |

---

## Error Formatting Rules

The service formats provider-specific errors into user-friendly messages. Error detection follows precedence:

```
1. Provider-specific JSON parsing (OpenAI, Anthropic)
2. Generic pattern matching with precedence:
   a. Rate limit (429, rate_limit, quota exceeded) -> "Rate limit exceeded..."
   b. API key (api_key, invalid key) -> "The API key is invalid..."
   c. Timeout, network, connection
   d. Truncate long messages
```

### Common Error Messages

| Provider  | Error Type      | Formatted Message                                                               |
| --------- | --------------- | ------------------------------------------------------------------------------- |
| Any       | Rate limit      | "Rate limit exceeded. Please try again later."                                  |
| OpenAI    | Rate limit      | "tokens: X/Y used, need Z more"                                                 |
| OpenAI    | Quota exceeded  | "OpenAI API quota exceeded. Check billing."                                     |
| Anthropic | Credit balance  | "Insufficient Anthropic API credits. Please add funds at console.anthropic.com" |
| Anthropic | Rate limit      | "Anthropic API rate limit reached"                                              |

---

## Usage Patterns

### Device Authentication Flow

```typescript
// Step 1: Start device auth
const start = await startDeviceAuth();
// Show user: "Go to {start.verificationUri} and enter code {start.userCode}"

// Step 2: Poll for completion (respect interval)
let result;
do {
  await sleep(start.interval * 1000);
  result = await pollDeviceAuth({ deviceCode: start.deviceCode });
} while (result.status === 'pending');

// Step 3: Use tokens
if (result.status === 'complete') {
  const { accessToken, refreshToken } = result;
}
```

### Configure LLM Provider

```typescript
// Add or update API key (validates with provider first)
const updateResult = await updateLlmApiKey(userId, {
  provider: 'openai',
  apiKey: 'sk-...',
});
// updateResult.masked shows "sk-p...XXXX"

// Add OpenRouter key (zero-cost validation via /api/v1/key)
const orResult = await updateLlmApiKey(userId, {
  provider: 'openrouter',
  apiKey: 'sk-or-v1-...',
});

// Test the key with a sample request
const testResult = await testLlmApiKey(userId, 'openai');
// testResult.message contains the LLM's response or formatted error
```

### Set Default and Fallback Models

```typescript
// Set preferred default model + fallback -- each route must be resolvable
const result = await updateUserSettings(userId, {
  defaultModel: 'claude-3-5-haiku-20241022',
  fallbackModel: 'gpt-4o-mini',
});
// Fails with INVALID_REQUEST if a non-OpenRouter provider has no configured user key
// Fails with INVALID_REQUEST if fallbackModel === defaultModel

// Clear fallback by passing null
const cleared = await updateUserSettings(userId, {
  defaultModel: 'claude-3-5-haiku-20241022',
  fallbackModel: null,
});

// Deleting API key cascades:
// - If default model uses deleted provider: both default and fallback cleared
// - If only fallback uses deleted provider: only fallback cleared
await deleteLlmApiKey(userId, 'openai');
```

### Set Transcription Provider

```typescript
// Set preferred transcription provider
const result = await updateTranscriptionPreferences(userId, { provider: 'speechmatics' });
// Only 'speechmatics' is currently valid
```

### Set Timezone

```typescript
// Set preferred timezone (IANA string)
const result = await updateTimezone(userId, { timezone: 'Europe/Berlin' });
// Fails with INVALID_REQUEST if not a valid IANA timezone
```

### Internal Service Access

```typescript
// Called by research-agent to get decrypted keys (includes openrouter)
const response = await getDecryptedLlmKeys(userId);
// response.data.openai contains full "sk-proj-..." key
// response.data.openrouter contains full "sk-or-v1-..." key

// Called by calendar-agent to get Google OAuth token
const googleOAuth = await getGoogleOAuthToken(userId);
// googleOAuth.data.accessToken is valid (auto-refreshed if expired)

// Called by code-agent to get GitHub OAuth token
const githubOAuth = await getGitHubOAuthToken(userId);
// githubOAuth.data.accessToken -- GitHub tokens never expire

// Called by code-agent to find user by GitHub username
const user = await getUserByGitHubUsername('octocat');
// user.data.userId -- used for routing GitHub webhooks to the right user

// Called by any service to get user preferences (includes fallback model and timezone)
const prefs = await getUserPreferences(userId);
// prefs.data.llmPreferences?.defaultModel -- user's preferred model
// prefs.data.llmPreferences?.fallbackModel -- user's fallback model
// prefs.data.transcriptionPreferences?.provider -- user's preferred transcription provider
// prefs.data.timezone -- user's IANA timezone (e.g., "Europe/Berlin")
```

---

## Internal Endpoints

| Method | Path                                                | Purpose                                                        |
| ------ | --------------------------------------------------- | -------------------------------------------------------------- |
| GET    | `/internal/users/:uid/llm-keys`                     | Get decrypted LLM keys (called by research-agent)              |
| POST   | `/internal/users/:uid/llm-keys/:provider/last-used` | Update last used timestamp                                     |
| GET    | `/internal/users/:uid/oauth/google/token`           | Get valid Google OAuth token (called by calendar-agent)        |
| GET    | `/internal/users/:uid/oauth/github/token`           | Get GitHub OAuth token (called by code-agent)                  |
| GET    | `/internal/users/by-github-username/:username`      | Find user by GitHub username (called by code-agent)            |
| GET    | `/internal/users/:uid/settings`                     | Get user preferences (LLM + fallback + transcription + tz)     |

---

## Error Handling

| Error Code    | HTTP | Meaning                                 | Recovery Action                     |
| ------------- | ---- | --------------------------------------- | ----------------------------------- |
| UNAUTHORIZED  | 401  | Invalid or missing token                | Refresh access token                |
| FORBIDDEN     | 403  | Cannot access other user's data         | Use the authenticated user's own ID |
| NOT_FOUND     | 404  | Resource not found (key, connection)    | Verify resource exists              |
| CONFLICT      | 409  | Auth pending (device flow)              | Continue polling                    |
| MISCONFIGURED | 503  | Service dependency not configured       | Check env vars                      |
| DOWNSTREAM    | 502  | External service (Auth0, Google) failed | Retry with backoff                  |

---

## Security Notes

- API keys are encrypted using AES-256-GCM before storage
- Keys are validated with actual provider API before storage (OpenRouter uses zero-cost key check)
- Masked previews show only first 4 and last 4 characters
- Google OAuth tokens refreshed automatically when near expiration (5-minute buffer)
- GitHub OAuth tokens never expire unless revoked at GitHub
- Internal endpoints require X-Internal-Auth header matching shared secret
- Auth0 namespaced claims (`https://intexuraos.cloud/`) used for API audience tokens
- OAuth state tokens include CSRF nonce and expire after 10 minutes

---

## Validation Models

Configurable keys are validated using cheap, fast models to minimize cost. OpenRouter uses a dedicated key-check endpoint at zero token cost. Direct Google LLM keys cannot be added or tested; Google-family models use `or:google/...` identifiers through OpenRouter.

| Provider   | Validation Method     | Model            |
| ---------- | --------------------- | ---------------- |
| OpenAI     | Model call (generate) | gpt-4o-mini      |
| Anthropic  | Model call (generate) | claude-3.5-haiku |
| Perplexity | Model call (generate) | sonar            |
| OpenRouter | `/api/v1/key` check   | N/A              |

---

## Dependencies

| Service            | Why Needed                   | Failure Behavior                        |
| ------------------ | ---------------------------- | --------------------------------------- |
| Auth0              | User authentication          | Auth endpoints return 503               |
| Google OAuth       | Calendar token management    | OAuth endpoints return 503              |
| GitHub OAuth       | Code automation tokens       | GitHub OAuth endpoints return 503       |
| llm-usage-service  | LLM usage reporting          | Usage not tracked (non-fatal)           |
| Firebase Admin SDK | Custom token generation      | Firebase token endpoint returns 500     |
| Firestore          | All persistent state         | Endpoints return 500                    |
| LLM APIs (4)       | Key validation and testing   | Validation/test returns formatted error |

---

**Last updated:** 2026-04-22
