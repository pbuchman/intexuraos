# User Service

Central authentication and settings management for IntexuraOS. Handles Auth0 device flow authentication, AES-256-GCM encrypted API key storage, LLM key validation, and OAuth token management.

## The Problem

Building a production AI assistant requires secure infrastructure that most developers should not build from scratch:

1. **Secure authentication** - User login that works across web, mobile, and CLI without storing passwords
2. **API key management** - Store Claude, OpenAI, Google, Perplexity, and Zai keys securely with encryption at rest
3. **Key validation** - Verify API keys work before storing them (catch typos and expired keys early)
4. **OAuth integration** - Connect to Google for calendar access with automatic token refresh
5. **Error interpretation** - Translate cryptic LLM provider errors into actionable messages

## How It Helps

### Encrypted API Key Storage

Store LLM provider keys with AES-256-GCM encryption. Keys are encrypted immediately upon submission and never stored in plaintext.

**Example:** User adds their OpenAI key through the web UI. The key is validated with OpenAI's API, encrypted with a per-environment key, and stored in Firestore. When research-agent needs the key, it requests the decrypted version through an internal endpoint - the key never leaves server memory unencrypted.

### Real-Time Key Validation

Validate API keys with actual provider calls before storing them. This catches typos, expired keys, and billing issues immediately.

**Example:** User enters an Anthropic key with insufficient credits. The validation call returns a billing error. Instead of storing a broken key and confusing the user later, the service immediately shows: "Insufficient Anthropic API credits. Please add funds at console.anthropic.com"

### Intelligent Error Formatting

Transform provider-specific error responses into clear, actionable messages. The error parser handles rate limits, billing issues, invalid keys, and quota exhaustion across all 5 LLM providers.

**Example:** OpenAI returns `429 Rate limit reached for default in organization org-123 on tokens: Limit 90000, Used 85000, Requested 10000.` The service formats this as: "tokens: 85000/90000 used, need 10000 more" - immediately showing the user what happened and why.

### Auth0 Device Code Flow

Enable CLI and mobile apps to authenticate without browser redirects. Users see a code, visit a URL on any device, and the CLI polls for completion.

**Example:** Running `intex login` from terminal shows: "Visit https://auth.intexuraos.com/activate and enter code: ABCD-EFGH". User opens phone browser, enters code, completes login. CLI receives tokens and stores them securely.

### Google OAuth Integration

Connect Google accounts for calendar access with automatic token refresh. Tokens are encrypted and refreshed before expiration.

**Example:** User connects their Google account once. Calendar-agent requests a valid token through an internal endpoint. If the token expired, user-service automatically refreshes it using the stored refresh token - no user interaction required.

## Use Cases

### Web App Authentication

1. User clicks "Login" in the web app
2. Redirected to Auth0 Universal Login page
3. After authentication, redirected back with authorization code
4. Service exchanges code for access and refresh tokens
5. User is logged in and can access their settings

### API Key Management Workflow

1. User navigates to Settings > LLM Keys
2. Selects provider (Google, OpenAI, Anthropic, Perplexity, or Zai)
3. Enters API key
4. Service validates key with provider API (catches invalid/expired keys)
5. On success: Key encrypted and stored, masked preview shown
6. On failure: User-friendly error displayed (rate limit, billing, invalid key)
7. User can test stored keys anytime with the "Test" button
8. Test results (success/failure with message) stored for display

### Service-to-Service Key Distribution

1. Research-agent needs user's OpenAI key for a query
2. Calls `GET /internal/users/:uid/llm-keys` with internal auth header
3. User-service decrypts and returns the key
4. Research-agent uses the key for one request
5. Key never written to disk by research-agent
6. User-service updates `lastUsed` timestamp for cost tracking

## Key Benefits

**Zero-knowledge key distribution** - Internal services receive decrypted keys in memory but never store them

**Immediate validation feedback** - API keys validated before storage, catching problems early

**Intelligent error messages** - Provider-specific errors translated to actionable messages

**Rate limit awareness** - Error parser detects rate limits before API key errors, avoiding misleading diagnostics (v2.0.0)

**Automatic token refresh** - OAuth tokens refreshed seamlessly before expiry

**5 LLM providers supported** - Google (Gemini), OpenAI (GPT), Anthropic (Claude), Perplexity, and Zai (GLM)

## Limitations

**Auth0 dependency** - Service requires Auth0 tenant configuration; no built-in username/password

**Single OAuth provider** - Only Google OAuth is currently implemented (Microsoft planned)

**Validation costs** - Key validation makes actual API calls to providers, which costs money (uses cheapest models)

**No per-key rate limits** - Rate limiting is provider-enforced, not user-configurable

**No backup codes** - If OAuth tokens are revoked at provider, user must re-authenticate

---

_Part of [IntexuraOS](../overview.md) - Your intelligent workspace._
