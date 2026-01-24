# user-service — Agent Interface

> Machine-readable interface definition for AI agents interacting with user-service.

---

## Identity

| Field    | Value                                                                        |
| --------  | ----------------------------------------------------------------------------  |
| **Name** | user-service                                                                 |
| **Role** | User Authentication and Settings Service                                     |
| **Goal** | Manage authentication, OAuth connections, LLM API keys, and user preferences |

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
  getOAuthStatus(): Promise<OAuthConnectionsStatus>;
  connectOAuth(provider: OAuthProvider): Promise<OAuthConnectResult>;
  disconnectOAuth(provider: OAuthProvider): Promise<void>;
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
  createdAt: string;
  updatedAt: string;
}

interface LlmKeysStatus {
  google: string | null; // Masked key preview
  openai: string | null;
  anthropic: string | null;
  perplexity: string | null;
  zai: string | null;
  testResults: Record<LlmProvider, LlmTestResult | null>;
}

interface LlmTestResult {
  status: 'success' | 'failure';
  message: string;
  testedAt: string;
}

interface LlmKeyUpdateResult {
  provider: LlmProvider;
  masked: string;
}
```

---

## Constraints

| Rule                  | Description                                         |
| ---------------------  | ---------------------------------------------------  |
| **Self-Access Only**  | Users can only access their own settings            |
| **Encrypted Storage** | API keys encrypted at rest with user-specific key   |
| **Key Validation**    | API keys validated with provider before storing     |
| **5 Providers**       | Supports Google, OpenAI, Anthropic, Perplexity, Zai |

---

## Usage Patterns

### Device Authentication Flow

```typescript
// Step 1: Start device auth
const start = await startDeviceAuth();
// Show user: "Go to {start.verificationUri} and enter code {start.userCode}"

// Step 2: Poll for completion
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
// Add or update API key (validates with provider)
await updateLlmApiKey(userId, {
  provider: 'openai',
  apiKey: 'sk-...',
});

// Test the key with a sample request
const testResult = await testLlmApiKey(userId, 'openai');
// testResult.message contains the LLM's response
```

### Check LLM Keys Status

```typescript
const keys = await getLlmApiKeys(userId);
// keys.google shows "sk-****abc" (masked) if configured
// keys.testResults.google shows last test result
```

---

## Internal Endpoints

| Method | Path                            | Purpose                                           |
| ------  | -------------------------------  | -------------------------------------------------  |
| GET    | `/internal/users/:uid/llm-keys` | Get decrypted LLM keys (called by research-agent) |
| GET    | `/internal/users/:uid/oauth`    | Get OAuth tokens (called by calendar-agent)       |

---

## Security Notes

- API keys are encrypted using AES-256-GCM
- Keys are validated with actual provider API before storage
- Masked previews show only first 4 and last 4 characters
- OAuth tokens refreshed automatically when near expiration

---

**Last updated:** 2026-01-19
