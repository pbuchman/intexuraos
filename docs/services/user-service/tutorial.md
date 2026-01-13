# User Service - Tutorial

This tutorial covers authentication, user settings, and API key management using the user-service.

## Prerequisites

- IntexuraOS development environment running
- Auth0 tenant configured
- Encryption key generated (32 bytes hex)

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

## Part 3: Manage API Keys

Store and retrieve LLM provider API keys.

### Step 1: Update API keys

```bash
curl -X PUT https://user-service.intexuraos.com/users/YOUR_USER_ID/llm-keys \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "google": "YOUR_GOOGLE_AI_KEY",
    "openai": "YOUR_OPENAI_KEY"
  }'
```

Keys are immediately encrypted with AES-256-GCM before storage.

### Step 2: Retrieve your settings

```bash
curl https://user-service.intexuraos.com/users/YOUR_USER_ID/settings \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Response (keys are masked):**

```json
{
  "success": true,
  "data": {
    "userId": "user_abc123",
    "llmApiKeys": {
      "google": "gAIAXXXX...XXXX",
      "openai": "sk-XXXX...XXXX"
    },
    "llmTestResults": {
      "google": {
        "status": "valid",
        "testedAt": "2026-01-13T10:00:00Z"
      }
    },
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-13T10:00:00Z"
  }
}
```

### Step 3: Test an API key

```bash
curl https://user-service.intexuraos.com/users/YOUR_USER_ID/llm-keys/test?provider=google \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

This makes an actual API call to verify the key is valid.

### Step 4: Delete an API key

```bash
curl -X DELETE https://user-service.intexuraos.com/users/YOUR_USER_ID/llm-keys/openai \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Part 4: Handle Errors

### Error: Invalid API key format

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid API key format for provider: google"
  }
}
```

**Cause:** The API key doesn't match the expected format for the provider.

**Solution:** Verify the key format:

- Google: Starts with `AIza`
- OpenAI: Starts with `sk-`
- Anthropic: Starts with `sk-ant-`
- Perplexity: Starts with `pplx-`

### Error: Encryption failed

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Failed to encrypt API key"
  }
}
```

**Cause:** The encryption key is not configured or invalid.

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

**Cause:** Trying to access another user's settings.

**Solution:** Ensure the authenticated user's ID matches the `:uid` parameter.

## Part 5: Real-World Scenario - Internal Service Access

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
  "perplexity": null
}
```

### Step 2: Update last used timestamp

```bash
curl -X POST https://user-service.intexuraos.com/internal/users/YOUR_USER_ID/llm-keys/google/last-used \
  -H "X-Internal-Auth: YOUR_SHARED_SECRET"
```

Returns 204 No Content on success.

### Step 3: Get Google OAuth token

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

## Troubleshooting

| Issue                 | Symptom                  | Solution                                                  |
| --------------------- | ------------------------ | --------------------------------------------------------- |
| Device code expires   | Polling never succeeds   | Device codes expire in 15 minutes; user must restart flow |
| Encryption key errors | Keys fail to save        | Verify 64-character hex string for encryption key         |
| Auth0 errors          | 401 Unauthorized         | Verify Auth0 client ID/secret are correct                 |
| OAuth not configured  | Google OAuth returns 500 | Set GOOGLE_OAUTH_CLIENT_ID and SECRET                     |
| Token refresh fails   | Access token expired     | User may have revoked access; re-authentication required  |

## Exercises

### Easy

1. Get the Auth configuration
2. List your user settings
3. Get the masked API key for one provider

### Medium

1. Complete the device code flow end-to-end
2. Add an API key and verify it's encrypted in Firestore
3. Test an API key and verify the result is stored

### Hard

1. Build a CLI client that completes device code flow
2. Implement a service that fetches internal API keys
3. Create an OAuth flow handler for calendar integration
