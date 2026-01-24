# User Service - Tutorial

This tutorial covers authentication, LLM API key management, and OAuth integration using the user-service.

## Prerequisites

- IntexuraOS development environment running
- Auth0 tenant configured
- Encryption key generated (32 bytes hex)
- At least one LLM API key (Google, OpenAI, Anthropic, Perplexity, or Zai)

## Part 1: Hello World - Get Auth Config

The simplest endpoint returns non-secret Auth0 configuration for troubleshooting.

### Step 1: Get Auth configuration

```bash
curl https://user-service.intexuraos.com/auth/config
```

**Expected response:**

```json
{
  "issuer": "https://YOUR_AUTH0_DOMAIN/",
  "audience": "urn:intexuraos:api",
  "jwksUrl": "https://YOUR_AUTH0_DOMAIN/.well-known/jwks.json",
  "domain": "YOUR_AUTH0_DOMAIN"
}
```

### Checkpoint

You can verify the Auth0 domain and audience are correctly configured for your tenant.

## Part 2: Device Code Flow Authentication

Authenticate without a browser (for CLI/mobile apps).

### Step 1: Request device code

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
  "device_code": "LoremIpsumDolorSitAmet",
  "user_code": "ABCD-EFGH",
  "verification_uri": "https://YOUR_AUTH0_DOMAIN/activate",
  "verification_uri_complete": "https://YOUR_AUTH0_DOMAIN/activate?user_code=ABCD-EFGH",
  "expires_in": 900,
  "interval": 5
}
```

### Step 2: User completes authentication

1. Display `verification_uri_complete` to the user
2. User visits the URL (opens in browser)
3. User enters `user_code` if required
4. User logs in and authorizes the device

### Step 3: Poll for token

```bash
# Poll every 5 seconds (respecting the interval)
curl -X POST https://user-service.intexuraos.com/auth/device/poll \
  -H "Content-Type: application/json" \
  -d '{
    "device_code": "LoremIpsumDolorSitAmet"
  }'
```

**Before user authenticates:**

```json
{
  "error": "authorization_pending",
  "error_description": "Authorization pending"
}
```

**After user authenticates:**

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "refresh_token": "DefrgHijKlmnOpq...",
  "scope": "openid profile email offline_access",
  "id_token": "eyJhbGciOiJSUzI1NiIs..."
}
```

### Checkpoint

You now have an access token to authenticate other requests.

## Part 3: Add and Validate an LLM API Key

Store an LLM provider API key with real-time validation.

### Step 1: Add an API key

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

**Validation failure (rate limit - v2.0.0 fix):**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Rate limit exceeded. Please try again later."
  }
}
```

### Step 2: Verify the key is stored

```bash
curl https://user-service.intexuraos.com/users/YOUR_USER_ID/settings/llm-keys \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response (keys are masked):**

```json
{
  "success": true,
  "data": {
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

## Part 4: Test an LLM API Key

Test a stored key by making a real LLM call.

### Step 1: Test the key

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

**Failure response (Anthropic billing):**

```json
{
  "success": true,
  "data": {
    "status": "failure",
    "message": "Insufficient Anthropic API credits. Please add funds at console.anthropic.com",
    "testedAt": "2026-01-24T10:00:00.000Z"
  }
}
```

### Step 2: Check test results

```bash
curl https://user-service.intexuraos.com/users/YOUR_USER_ID/settings/llm-keys \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Test results are now visible in the response:

```json
{
  "success": true,
  "data": {
    "openai": "sk-p...XXXX",
    "testResults": {
      "openai": {
        "status": "success",
        "message": "Hi! I'm GPT...",
        "testedAt": "2026-01-24T10:00:00.000Z"
      }
    }
  }
}
```

### Checkpoint

The test result is stored and displayed alongside the key status.

## Part 5: Delete an LLM API Key

Remove a stored API key.

### Step 1: Delete the key

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

### Step 2: Verify deletion

```bash
curl https://user-service.intexuraos.com/users/YOUR_USER_ID/settings/llm-keys \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

The provider now shows `null`.

## Part 6: Connect Google OAuth

Connect a Google account for calendar integration.

### Step 1: Initiate OAuth flow

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

### Step 2: Complete OAuth flow

1. Redirect user to `authorizationUrl`
2. User grants calendar permissions
3. Google redirects back to callback URL
4. Service stores encrypted tokens

### Step 3: Check connection status

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

## Part 7: Internal Service Access (Service-to-Service)

Simulate how another service (like research-agent) accesses API keys.

### Step 1: Internal request with shared secret

```bash
curl https://user-service.intexuraos.com/internal/users/YOUR_USER_ID/llm-keys \
  -H "X-Internal-Auth: YOUR_SHARED_SECRET"
```

**Response (decrypted keys):**

```json
{
  "google": "AIzaSyD1XXXXXXXXXXXXXXXXXXXXXXXXXX",
  "openai": "sk-proj-XXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "anthropic": null,
  "perplexity": null,
  "zai": null
}
```

### Step 2: Update last used timestamp

```bash
curl -X POST https://user-service.intexuraos.com/internal/users/YOUR_USER_ID/llm-keys/openai/last-used \
  -H "X-Internal-Auth: YOUR_SHARED_SECRET"
```

Returns 204 No Content on success.

### Step 3: Get Google OAuth token (for calendar-agent)

```bash
curl https://user-service.intexuraos.com/internal/users/YOUR_USER_ID/oauth/google/token \
  -H "X-Internal-Auth: YOUR_SHARED_SECRET"
```

**Response:**

```json
{
  "accessToken": "ya29.a0AfH6...",
  "email": "user@gmail.com"
}
```

This automatically refreshes the token if expired.

### Step 4: Get user LLM preferences

```bash
curl https://user-service.intexuraos.com/internal/users/YOUR_USER_ID/settings \
  -H "X-Internal-Auth: YOUR_SHARED_SECRET"
```

**Response:**

```json
{
  "llmPreferences": {
    "defaultModel": "gpt-4o"
  }
}
```

## Part 8: Handle Errors

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

### Error: Rate limit (v2.0.0)

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Rate limit exceeded. Please try again later."
  }
}
```

**Solution:** Wait and retry. This is NOT an invalid key - the parser correctly identifies rate limits.

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

### Error: OAuth not configured

```json
{
  "success": false,
  "error": {
    "code": "MISCONFIGURED",
    "message": "Google OAuth is not configured"
  }
}
```

**Solution:** Set `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID` and `INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET`.

## Troubleshooting

| Issue                   | Symptom                         | Solution                                                  |
| ----------------------- | ------------------------------- | --------------------------------------------------------- |
| Device code expires     | Polling never succeeds          | Device codes expire in 15 minutes; user must restart flow |
| Encryption key errors   | Keys fail to save               | Verify 64-character hex string for encryption key         |
| Auth0 errors            | 401 Unauthorized                | Verify Auth0 client ID/secret are correct                 |
| OAuth not configured    | Google OAuth returns 503        | Set GOOGLE_OAUTH_CLIENT_ID and SECRET                     |
| Token refresh fails     | Access token expired            | User may have revoked access; re-authentication required  |
| Rate limit shown as key | "Invalid API key" for 429 error | Update to v2.0.0 - rate limits now correctly identified   |
| Test costs money        | Charges on provider account     | Test endpoint makes real API calls; use sparingly         |

## Exercises

### Easy

1. Get the Auth configuration
2. List your LLM API key status
3. Check Google OAuth connection status

### Medium

1. Complete the device code flow end-to-end
2. Add an API key and verify it's encrypted in Firestore
3. Test an API key and verify the result is stored

### Hard

1. Build a CLI client that completes device code flow
2. Implement a service that fetches internal API keys
3. Create a full OAuth flow handler for calendar integration
