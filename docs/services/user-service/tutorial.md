# User Service — Tutorial

> **Time:** 20–30 minutes
> **Prerequisites:** Node.js 20+, IntexuraOS dev environment, Auth0 tenant
> **You'll learn:** How to authenticate, manage LLM API keys, set default models, connect Google and GitHub OAuth, and configure transcription preferences

---

## What You'll Build

A working integration that:

- Authenticates via the device code flow
- Stores and validates LLM API keys
- Tests keys with real provider calls
- Sets a default LLM model for all agents
- Configures transcription preferences
- Connects Google and GitHub accounts
- Accesses internal endpoints for service-to-service communication

---

## Prerequisites

Before starting, ensure you have:

- [ ] IntexuraOS development environment running
- [ ] Auth0 tenant configured
- [ ] Encryption key generated (32 bytes hex)
- [ ] At least one LLM API key (Google, OpenAI, Anthropic, Perplexity, or Zai)

---

## Part 1: Hello World — Get Auth Config (2 minutes)

The simplest endpoint returns non-secret Auth0 configuration for troubleshooting.

### Step 1.1: Get Auth configuration

```bash
curl https://user-service.intexuraos.com/auth/config
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "issuer": "https://YOUR_AUTH0_DOMAIN/",
    "audience": "urn:intexuraos:api",
    "jwksUrl": "https://YOUR_AUTH0_DOMAIN/.well-known/jwks.json",
    "domain": "YOUR_AUTH0_DOMAIN"
  }
}
```

### Checkpoint

You can verify the Auth0 domain and audience are correctly configured for your tenant.

---

## Part 2: Device Code Flow Authentication (5 minutes)

Authenticate without a browser (for CLI/mobile apps).

### Step 2.1: Request device code

```bash
curl -X POST https://user-service.intexuraos.com/auth/device/start \
  -H "Content-Type: application/json" \
  -d '{
    "audience": "urn:intexuraos:api",
    "scope": "openid profile email offline_access"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "device_code": "LoremIpsumDolorSitAmet",
    "user_code": "ABCD-EFGH",
    "verification_uri": "https://YOUR_AUTH0_DOMAIN/activate",
    "verification_uri_complete": "https://YOUR_AUTH0_DOMAIN/activate?user_code=ABCD-EFGH",
    "expires_in": 900,
    "interval": 5
  }
}
```

### Step 2.2: User completes authentication

1. Display `verification_uri_complete` to the user
2. User visits the URL (opens in browser)
3. User enters `user_code` if required
4. User logs in and authorizes the device

### Step 2.3: Poll for token

```bash
# Poll every 5 seconds (respecting the interval)
curl -X POST https://user-service.intexuraos.com/auth/device/poll \
  -H "Content-Type: application/json" \
  -d '{
    "device_code": "LoremIpsumDolorSitAmet"
  }'
```

**Before user authenticates (409 Conflict):**

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Authorization pending. User has not yet completed authentication."
  }
}
```

**After user authenticates (200 OK):**

```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJSUzI1NiIs...",
    "token_type": "Bearer",
    "expires_in": 86400,
    "refresh_token": "DefrgHijKlmnOpq...",
    "scope": "openid profile email offline_access",
    "id_token": "eyJhbGciOiJSUzI1NiIs..."
  }
}
```

### Checkpoint

You now have an access token to authenticate other requests.

---

## Part 3: Add and Validate an LLM API Key (5 minutes)

Store an LLM provider API key with real-time validation.

### Step 3.1: Add an API key

```bash
curl -X PATCH https://user-service.intexuraos.com/users/YOUR_USER_ID/settings/llm-keys \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "apiKey": "sk-proj-XXXXXXXXXXXXXXXXXXXX"
  }'
```

The service validates the key by making a test call to OpenAI before storing it.

**Success response:**

```json
{
  "success": true,
  "data": {
    "provider": "openai",
    "masked": "sk-p...XXXX"
  }
}
```

**Validation failure (invalid key):**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid OpenAI API key"
  }
}
```

**Validation failure (rate limit):**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Rate limit exceeded. Please try again later."
  }
}
```

### Step 3.2: Verify the key is stored

```bash
curl https://user-service.intexuraos.com/users/YOUR_USER_ID/settings/llm-keys \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response (keys are masked):**

```json
{
  "success": true,
  "data": {
    "defaultModel": null,
    "google": null,
    "openai": "sk-p...XXXX",
    "anthropic": null,
    "perplexity": null,
    "zai": null,
    "testResults": {
      "google": null,
      "openai": null,
      "anthropic": null,
      "perplexity": null,
      "zai": null
    }
  }
}
```

### Checkpoint

Your API key is encrypted and stored. The masked preview shows it was saved correctly.

---

## Part 4: Test an LLM API Key (5 minutes)

Test a stored key by making a real LLM call.

### Step 4.1: Test the key

```bash
curl -X POST https://user-service.intexuraos.com/users/YOUR_USER_ID/settings/llm-keys/openai/test \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Success response:**

```json
{
  "success": true,
  "data": {
    "status": "success",
    "message": "Hi! I'm GPT. I'm here to intelligently improve your experience with your workspace.",
    "testedAt": "2026-01-24T10:00:00.000Z"
  }
}
```

**Failure response (billing issue):**

```json
{
  "success": true,
  "data": {
    "status": "failure",
    "message": "OpenAI API quota exceeded. Check billing.",
    "testedAt": "2026-01-24T10:00:00.000Z"
  }
}
```

### Checkpoint

The test result is stored and displayed alongside the key status.

---

## Part 5: Delete an LLM API Key (2 minutes)

Remove a stored API key.

### Step 5.1: Delete the key

```bash
curl -X DELETE https://user-service.intexuraos.com/users/YOUR_USER_ID/settings/llm-keys/openai \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response:**

```json
{
  "success": true
}
```

If the deleted provider was the default model's provider, the default model is automatically cleared.

---

## Part 6: Set Default LLM Model (3 minutes)

Configure which fast model all agents use by default.

### Step 6.1: Set a default model

The service validates that the model is a supported fast model AND that you have an API key configured for the model's provider.

```bash
curl -X PATCH https://user-service.intexuraos.com/users/YOUR_USER_ID/settings \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "defaultModel": "claude-haiku-3-5"
  }'
```

**Success response:**

```json
{
  "success": true,
  "data": {
    "defaultModel": "claude-haiku-3-5"
  }
}
```

**No API key for provider:**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Cannot set default model to claude-haiku-3-5: no API key configured for provider 'anthropic'"
  }
}
```

### Checkpoint

All agents now use "claude-haiku-3-5" by default, and the service ensures the API key exists for Anthropic.

---

## Part 7: Set Transcription Preferences (2 minutes)

Choose which transcription provider processes your voice notes.

### Step 7.1: Set transcription provider

```bash
curl -X PATCH https://user-service.intexuraos.com/users/YOUR_USER_ID/settings/transcription \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "speechmatics"
  }'
```

**Success response:**

```json
{
  "success": true,
  "data": {
    "provider": "speechmatics"
  }
}
```

### Checkpoint

Voice notes from WhatsApp are now processed through Speechmatics.

---

## Part 8: Connect Google OAuth (5 minutes)

Connect a Google account for calendar integration.

### Step 8.1: Initiate OAuth flow

```bash
curl -X POST https://user-service.intexuraos.com/oauth/connections/google/initiate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
  }
}
```

### Step 8.2: Complete OAuth flow

1. Redirect user to `authorizationUrl`
2. User grants calendar permissions
3. Google redirects back to callback URL
4. Service stores encrypted tokens

### Step 8.3: Check connection status

```bash
curl https://user-service.intexuraos.com/oauth/connections/google/status \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Connected response:**

```json
{
  "success": true,
  "data": {
    "connected": true,
    "email": "user@gmail.com",
    "scopes": ["https://www.googleapis.com/auth/calendar.readonly"],
    "createdAt": "2026-01-24T10:00:00.000Z",
    "updatedAt": "2026-01-24T10:00:00.000Z"
  }
}
```

### Checkpoint

Google account is connected. Calendar-agent can now access the user's calendar through internal endpoints.

---

## Part 9: Connect GitHub OAuth (5 minutes)

Connect a GitHub account for code automation.

### Step 9.1: Initiate GitHub OAuth flow

```bash
curl -X POST https://user-service.intexuraos.com/oauth/connections/github/initiate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "authorizationUrl": "https://github.com/login/oauth/authorize?..."
  }
}
```

### Step 9.2: Complete OAuth flow

1. Redirect user to `authorizationUrl`
2. User authorizes the GitHub app
3. GitHub redirects back to callback URL
4. Service stores the access token (no refresh token for GitHub)

### Step 9.3: Check connection status

```bash
curl https://user-service.intexuraos.com/oauth/connections/github/status \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Connected response:**

```json
{
  "success": true,
  "data": {
    "connected": true,
    "username": "octocat",
    "scopes": ["repo", "read:user"],
    "createdAt": "2026-03-01T10:00:00.000Z",
    "updatedAt": "2026-03-01T10:00:00.000Z"
  }
}
```

### Checkpoint

GitHub account is connected. Code-agent can now create branches and pull requests on your behalf.

---

## Part 10: Internal Service Access (Service-to-Service) (5 minutes)

Simulate how another service (like research-agent) accesses API keys.

### Step 10.1: Internal request with shared secret

```bash
curl https://user-service.intexuraos.com/internal/users/YOUR_USER_ID/llm-keys \
  -H "X-Internal-Auth: YOUR_SHARED_SECRET"
```

**Response (decrypted keys):**

```json
{
  "success": true,
  "data": {
    "google": "AIzaSyD1XXXXXXXXXXXXXXXXXXXXXXXXXX",
    "openai": "sk-proj-XXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "anthropic": null,
    "perplexity": null,
    "zai": null
  }
}
```

### Step 10.2: Get Google OAuth token (for calendar-agent)

```bash
curl https://user-service.intexuraos.com/internal/users/YOUR_USER_ID/oauth/google/token \
  -H "X-Internal-Auth: YOUR_SHARED_SECRET"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "accessToken": "ya29.a0AfH6...",
    "email": "user@gmail.com"
  }
}
```

This automatically refreshes the token if expired.

### Step 10.3: Get GitHub OAuth token (for code-agent)

```bash
curl https://user-service.intexuraos.com/internal/users/YOUR_USER_ID/oauth/github/token \
  -H "X-Internal-Auth: YOUR_SHARED_SECRET"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "accessToken": "gho_XXXXXXXXXXXXXXXXXX",
    "username": "octocat"
  }
}
```

### Step 10.4: Find user by GitHub username

```bash
curl https://user-service.intexuraos.com/internal/users/by-github-username/octocat \
  -H "X-Internal-Auth: YOUR_SHARED_SECRET"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "userId": "auth0|abc123",
    "username": "octocat"
  }
}
```

### Step 10.5: Get user preferences

```bash
curl https://user-service.intexuraos.com/internal/users/YOUR_USER_ID/settings \
  -H "X-Internal-Auth: YOUR_SHARED_SECRET"
```

**Response:**

```json
{
  "success": true,
  "data": {
    "llmPreferences": {
      "defaultModel": "claude-haiku-3-5"
    },
    "transcriptionPreferences": {
      "provider": "speechmatics"
    }
  }
}
```

---

## Part 11: Handle Errors (3 minutes)

### Error: Invalid API key format

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid OpenAI API key"
  }
}
```

**Solution:** Verify the key format. OpenAI keys start with `sk-`.

### Error: No API key for default model provider

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Cannot set default model to claude-haiku-3-5: no API key configured for provider 'anthropic'"
  }
}
```

**Solution:** Add an API key for the model's provider before setting the default model.

### Error: Rate limit

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Rate limit exceeded. Please try again later."
  }
}
```

**Solution:** Wait and retry. This is NOT an invalid key — the parser correctly identifies rate limits.

### Error: Encryption not configured

```json
{
  "success": false,
  "error": {
    "code": "MISCONFIGURED",
    "message": "Encryption is not configured"
  }
}
```

**Solution:** Verify `INTEXURAOS_ENCRYPTION_KEY` is set to a 64-character hex string.

### Error: Forbidden (403)

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Cannot access other user settings"
  }
}
```

**Solution:** Ensure the authenticated user's ID matches the `:uid` parameter.

### Error: Invalid transcription provider

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid provider: whisper"
  }
}
```

**Solution:** Only `speechmatics` is currently supported as a transcription provider.

---

## Troubleshooting

| Issue                   | Symptom                         | Solution                                                         |
| ----------------------- | ------------------------------- | ---------------------------------------------------------------- |
| Device code expires     | Polling never succeeds          | Device codes expire in 15 minutes; user must restart flow        |
| Encryption key errors   | Keys fail to save               | Verify 64-character hex string for encryption key                |
| Auth0 errors            | 401 Unauthorized                | Verify Auth0 client ID/secret are correct                        |
| OAuth not configured    | Google/GitHub OAuth returns 503 | Set OAuth client ID and secret env vars                          |
| Token refresh fails     | Access token expired            | User may have revoked access; re-authentication required         |
| Rate limit misdiagnosed | "Invalid API key" for 429 error | Rate limits are correctly identified — ensure service is current |
| Test costs money        | Charges on provider account     | Test endpoint makes real API calls; use sparingly                |
| Pricing fetch fails     | Service fails to start          | Ensure app-settings-service is running and accessible            |
| Default model rejected  | 400 INVALID_REQUEST             | Model must pass `isFastModel()` AND have API key set             |
| GitHub token not found  | 404 NOT_FOUND                   | User must connect GitHub account first                           |

---

## Next Steps

Now that you understand the basics:

1. Explore the [Technical Reference](technical.md) for full API details
2. Read [agent.md](agent.md) for machine-readable interface definitions
3. Check out the web app Settings page to see the UI built on these APIs

---

## Exercises

### Easy

1. Get the Auth configuration
2. List your LLM API key status
3. Check Google and GitHub OAuth connection status

### Medium

1. Complete the device code flow end-to-end
2. Add an API key and verify it's encrypted in Firestore
3. Test an API key and verify the result is stored
4. Set a default model and read it back via the internal endpoint
5. Set a transcription provider preference

### Hard

1. Build a CLI client that completes device code flow
2. Implement a service that fetches internal API keys
3. Create a full OAuth flow handler for calendar integration
4. Connect GitHub and use the internal endpoint to find a user by username

<details>
<summary>Solutions</summary>

### Exercise 1: Easy — Get Auth Config

```bash
curl https://user-service.intexuraos.com/auth/config
```

### Exercise 2: Medium — Add and Test Key

```bash
# Add key
curl -X PATCH https://user-service.intexuraos.com/users/$UID/settings/llm-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider": "openai", "apiKey": "sk-proj-..."}'

# Test key
curl -X POST https://user-service.intexuraos.com/users/$UID/settings/llm-keys/openai/test \
  -H "Authorization: Bearer $TOKEN"
```

### Exercise 3: Hard — CLI Device Code Flow

```typescript
async function deviceLogin(): Promise<string> {
  // Start
  const start = await fetch('/auth/device/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audience: 'urn:intexuraos:api',
      scope: 'openid profile email offline_access',
    }),
  });
  const { data } = await start.json();

  console.log(`Visit ${data.verification_uri_complete}`);
  console.log(`Enter code: ${data.user_code}`);

  // Poll
  while (true) {
    await new Promise((r) => setTimeout(r, data.interval * 1000));
    const poll = await fetch('/auth/device/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: data.device_code }),
    });

    if (poll.status === 200) {
      const { data: tokens } = await poll.json();
      return tokens.access_token;
    }
  }
}
```

### Exercise 4: Hard — Find User by GitHub Username

```bash
# Connect GitHub first (via OAuth flow in browser)
# Then look up the user by their GitHub username
curl https://user-service.intexuraos.com/internal/users/by-github-username/octocat \
  -H "X-Internal-Auth: $INTERNAL_AUTH_TOKEN"
```

</details>
