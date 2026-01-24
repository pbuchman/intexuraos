# user-service - Agent Interface

> Machine-readable interface definition for AI agents interacting with user-service.

---

## Identity

| Field    | Value                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------- |
| **Name** | user-service                                                                                   |
| **Role** | User Authentication and Settings Service                                                       |
| **Goal** | Manage authentication, OAuth connections, LLM API keys, user preferences, and error formatting |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface UserServiceTools {
  // Authentication
  startDeviceAuth(): Promise<DeviceAuthStartResult>;
  pollDeviceAuth(params: { deviceCode: string }): Promise<DeviceAuthPollResult>;
  refreshToken(params: { refreshToken: string }): Promise<TokenResult>;
  getFirebaseToken(): Promise<FirebaseTokenResult>;

  // User Settings
  getUserSettings(userId: string): Promise<UserSettings>;

  // LLM API Keys
  getLlmApiKeys(userId: string): Promise<LlmKeysStatus>;
  updateLlmApiKey(
    userId: string,
    params: {
      provider: LlmProvider;
      apiKey: string;
    }
  ): Promise<LlmKeyUpdateResult>;
  testLlmApiKey(userId: string, provider: LlmProvider): Promise<LlmTestResult>;
  deleteLlmApiKey(userId: string, provider: LlmProvider): Promise<void>;

  // OAuth Connections
  initiateGoogleOAuth(): Promise<{ authorizationUrl: string }>;
  getGoogleOAuthStatus(): Promise<OAuthConnectionStatus>;
  disconnectGoogleOAuth(): Promise<void>;

  // Internal (service-to-service)
  getDecryptedLlmKeys(userId: string): Promise<DecryptedLlmKeys>;
  updateLlmLastUsed(userId: string, provider: LlmProvider): Promise<void>;
  getGoogleOAuthToken(userId: string): Promise<{ accessToken: string; email: string }>;
  getUserLlmPreferences(userId: string): Promise<{ llmPreferences?: LlmPreferences }>;
}
```

### Types

```typescript
type LlmProvider = 'google' | 'openai' | 'anthropic' | 'perplexity' | 'zai';
type OAuthProvider = 'google';

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
  refreshToken: string;
  expiresIn: number;
}

interface UserSettings {
  userId: string;
  llmPreferences?: LlmPreferences;
  createdAt: string;
  updatedAt: string;
}

interface LlmPreferences {
  defaultModel: string;
}

interface LlmKeysStatus {
  google: string | null; // Masked key preview (e.g., "AIza...XXXX")
  openai: string | null;
  anthropic: string | null;
  perplexity: string | null;
  zai: string | null;
  testResults: Record<LlmProvider, LlmTestResult | null>;
}

interface LlmTestResult {
  status: 'success' | 'failure';
  message: string; // LLM response (success) or formatted error (failure)
  testedAt: string; // ISO 8601 timestamp
}

interface LlmKeyUpdateResult {
  provider: LlmProvider;
  masked: string;
}

interface DecryptedLlmKeys {
  google: string | null;
  openai: string | null;
  anthropic: string | null;
  perplexity: string | null;
  zai: string | null;
}

interface OAuthConnectionStatus {
  connected: boolean;
  email: string | null;
  scopes: string[] | null;
  createdAt: string | null;
  updatedAt: string | null;
}
```

---

## Constraints

| Rule                      | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| **Self-Access Only**      | Users can only access their own settings                |
| **Encrypted Storage**     | API keys encrypted at rest with AES-256-GCM             |
| **Key Validation**        | API keys validated with provider before storing         |
| **5 Providers**           | Supports Google, OpenAI, Anthropic, Perplexity, Zai     |
| **Rate Limit Precedence** | Error parser checks rate limits before API key errors   |
| **Internal Auth**         | Service-to-service calls require X-Internal-Auth header |

---

## Error Formatting Rules (v2.0.0)

The service formats provider-specific errors into user-friendly messages. Error detection follows precedence:

```
1. Provider-specific JSON parsing (Gemini, OpenAI, Anthropic)
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
| Google    | Invalid key     | "The API key is invalid or has expired"                                         |
| Google    | Quota exhausted | "Quota: X tokens/min"                                                           |
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

// If rate limited during validation:
// Error: "Rate limit exceeded. Please try again later."
// (v2.0.0 fix: this is NOT shown as "invalid key")

// Test the key with a sample request
const testResult = await testLlmApiKey(userId, 'openai');
// testResult.message contains the LLM's response or formatted error
```

### Check LLM Keys Status

```typescript
const keys = await getLlmApiKeys(userId);
// keys.google shows "AIza...XXXX" (masked) if configured
// keys.testResults.google shows last test result
```

### Internal Service Access

```typescript
// Called by research-agent to get decrypted keys
const decrypted = await getDecryptedLlmKeys(userId);
// decrypted.openai contains full "sk-proj-..." key

// Called by calendar-agent to get OAuth token
const oauth = await getGoogleOAuthToken(userId);
// oauth.accessToken is valid (auto-refreshed if expired)
```

---

## Internal Endpoints

| Method | Path                                         | Purpose                                           |
| ------ | -------------------------------------------- | ------------------------------------------------- |
| GET    | `/internal/users/:uid/llm-keys`              | Get decrypted LLM keys (called by research-agent) |
| POST   | `/internal/users/:uid/llm-keys/:p/last-used` | Update last used timestamp                        |
| GET    | `/internal/users/:uid/oauth/google/token`    | Get valid OAuth token (called by calendar-agent)  |
| GET    | `/internal/users/:uid/settings`              | Get user LLM preferences (default model)          |

---

## Security Notes

- API keys are encrypted using AES-256-GCM before storage
- Keys are validated with actual provider API before storage
- Masked previews show only first 4 and last 4 characters
- OAuth tokens refreshed automatically when near expiration
- Internal endpoints require X-Internal-Auth header matching shared secret

---

## Validation Models

Keys are validated using cheap, fast models to minimize cost:

| Provider   | Model            |
| ---------- | ---------------- |
| Google     | gemini-2.0-flash |
| OpenAI     | gpt-4o-mini      |
| Anthropic  | claude-3.5-haiku |
| Perplexity | sonar            |
| Zai        | glm-4.7          |

---

**Last updated:** 2026-01-24
