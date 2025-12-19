# Auth0 Setup Guide (Updated 2025-12-19)

This guide covers setting up Auth0 for PraxOS authentication using the Device Authorization Flow (DAF) with refresh token support for daily usage scenarios.

## Prerequisites

- Auth0 account (free tier works)
- `gcloud` CLI installed and authenticated
- GCP project with Secret Manager enabled

## Overview: Device Flow + Refresh Tokens

PraxOS uses OAuth2 Device Authorization Flow for authentication, which is ideal for:
- CLI applications
- IoT devices  
- API consumers that cannot easily handle browser redirects

To support **daily usage without re-authentication**, we implement:
- **Refresh tokens** - Long-lived tokens stored securely server-side
- **Token rotation** - Automatic refresh token rotation for enhanced security
- **Encrypted storage** - AES-256-GCM encryption in Firestore

## 1. Create Auth0 Tenant

1. Go to [Auth0 Dashboard](https://manage.auth0.com/)
2. Click **Create Tenant**
3. Choose a tenant name (e.g., `praxos-dev`)
4. Select region closest to your deployment (e.g., `EU` for Europe)
5. Note your tenant domain: `your-tenant.eu.auth0.com`

## 2. Create API (Resource Server)

The API defines the audience identifier used for token validation.

1. Go to **Applications** → **APIs**
2. Click **Create API**
3. Configure:
   - **Name**: `PraxOS API`
   - **Identifier**: `https://api.praxos.app` (this is your `AUTH_AUDIENCE`)
   - **Signing Algorithm**: `RS256`
4. Click **Create**

### API Settings

After creation, configure:

1. Go to API **Settings** tab
2. **Token Expiration (Seconds)**: `3600` (1 hour for access tokens)
3. **Allow Offline Access**: ✅ **ENABLE THIS** (required for refresh tokens)
4. Click **Save**

> **Note**: Enabling "Allow Offline Access" is essential for refresh tokens. Without this, the `offline_access` scope will be ignored.

## 3. Create Native Application for Device Authorization Flow

1. Go to **Applications** → **Applications**
2. Click **Create Application**
3. Configure:
   - **Name**: `PraxOS CLI`
   - **Type**: `Native`
4. Click **Create**

### Application Settings

1. Go to **Settings** tab
2. Note the **Client ID** (this is your `AUTH0_CLIENT_ID`)
3. Scroll to **Application URIs**:
   - No callback URLs needed for Device Flow
4. Scroll to **Advanced Settings** → **Grant Types**
5. Enable:
   - [x] **Device Code** (required for device flow)
   - [x] **Refresh Token** (required for refresh tokens)
6. Click **Save Changes**

### Refresh Token Rotation Settings

1. Still in **Advanced Settings**, go to **Grant Types** section
2. Locate **Refresh Token Rotation**:
   - **Rotation**: ✅ **ENABLE** (recommended for security)
   - **Reuse Interval**: `0` seconds (immediate revocation on use)
   - **Absolute Lifetime**: `2592000` seconds (30 days)
   - **Idle Lifetime**: `1296000` seconds (15 days)
3. Click **Save Changes**

> **Refresh Token Lifetimes Explained:**
> - **Absolute Lifetime (30 days)**: Maximum token age regardless of usage
> - **Idle Lifetime (15 days)**: Token expires if unused for this period
> 
> For **daily usage**, idle lifetime is the key setting. 15 days means users must authenticate at least once every 15 days. Adjust based on your security requirements:
> - More permissive: 30-90 days idle
> - More restrictive: 7-14 days idle

## 4. Enable Device Authorization Flow on Tenant

1. Go to **Settings** → **Advanced**
2. Under **Grant Types**, ensure **Device Code** is enabled
3. Click **Save**

## 5. Find Issuer and JWKS URL

From your tenant domain, derive:

| Variable        | Value                                                    |
| --------------- | -------------------------------------------------------- |
| `AUTH0_DOMAIN`  | `your-tenant.eu.auth0.com`                               |
| `AUTH_ISSUER`   | `https://your-tenant.eu.auth0.com/`                      |
| `AUTH_JWKS_URL` | `https://your-tenant.eu.auth0.com/.well-known/jwks.json` |
| `AUTH_AUDIENCE` | `https://api.praxos.app` (from API Identifier)           |

## 6. Generate Encryption Key for Refresh Tokens

Refresh tokens are encrypted at rest using AES-256-GCM. Generate a secure encryption key:

```bash
# Using Node.js (if available)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Using OpenSSL
openssl rand -base64 32

# Example output:
# k7J9mL2nP4qR6sT8uV0wX1yZ3aB5cD7eF9gH1iJ3kL5=
```

Save this key securely - you'll need it for Secret Manager.

## 7. Populate Secret Manager (GCP)

Terraform creates the secrets; you populate them with actual values using `gcloud secrets versions add`.

> **Important**: Secrets are created by Terraform with names prefixed `PRAXOS_*`.
> Use `versions add`, not `create`. The secrets already exist.

```bash
# Set your GCP project
export PROJECT_ID=your-gcp-project-id

# Set your Auth0 configuration values
export AUTH0_DOMAIN="your-tenant.eu.auth0.com"
export AUTH0_CLIENT_ID="your-native-app-client-id"
export AUTH0_AUDIENCE="https://api.praxos.app"
export TOKEN_ENCRYPTION_KEY="k7J9mL2nP4qR6sT8uV0wX1yZ3aB5cD7eF9gH1iJ3kL5="

# Populate secret versions (Terraform created the secrets, we add values)

# Auth0 domain (tenant) - required for auth-service DAF endpoints
echo -n "${AUTH0_DOMAIN}" | \
  gcloud secrets versions add PRAXOS_AUTH0_DOMAIN --data-file=- --project=$PROJECT_ID

# Auth0 client ID (from Native app) - required for auth-service DAF endpoints
echo -n "${AUTH0_CLIENT_ID}" | \
  gcloud secrets versions add PRAXOS_AUTH0_CLIENT_ID --data-file=- --project=$PROJECT_ID

# Auth JWKS URL - required for JWT verification
echo -n "https://${AUTH0_DOMAIN}/.well-known/jwks.json" | \
  gcloud secrets versions add PRAXOS_AUTH_JWKS_URL --data-file=- --project=$PROJECT_ID

# Auth issuer - required for JWT verification
echo -n "https://${AUTH0_DOMAIN}/" | \
  gcloud secrets versions add PRAXOS_AUTH_ISSUER --data-file=- --project=$PROJECT_ID

# Auth audience - required for JWT verification
echo -n "${AUTH0_AUDIENCE}" | \
  gcloud secrets versions add PRAXOS_AUTH_AUDIENCE --data-file=- --project=$PROJECT_ID

# Token encryption key - required for encrypting refresh tokens
echo -n "${TOKEN_ENCRYPTION_KEY}" | \
  gcloud secrets versions add PRAXOS_TOKEN_ENCRYPTION_KEY --data-file=- --project=$PROJECT_ID
```

To update an existing secret value:

```bash
echo -n "new-value" | \
  gcloud secrets versions add PRAXOS_AUTH0_DOMAIN --data-file=- --project=$PROJECT_ID
```

## 8. Authentication Flow (with Refresh Tokens)

### Step 1: Request Device Code

```bash
# Using auth-service helper
curl -X POST http://localhost:3000/v1/auth/device/start \
  -H "Content-Type: application/json" \
  -d '{
    "audience": "https://api.praxos.app",
    "scope": "openid profile email offline_access"
  }'
```

> **Note**: The `offline_access` scope is included by default and is **required** for refresh tokens.

Response:

```json
{
  "success": true,
  "data": {
    "device_code": "XXXX-XXXX-XXXX",
    "user_code": "ABCD-EFGH",
    "verification_uri": "https://your-tenant.eu.auth0.com/activate",
    "verification_uri_complete": "https://your-tenant.eu.auth0.com/activate?user_code=ABCD-EFGH",
    "expires_in": 900,
    "interval": 5
  }
}
```

### Step 2: User Authorization

1. Open `verification_uri_complete` in browser
2. Or go to `verification_uri` and enter `user_code` manually
3. Log in with your Auth0 credentials
4. Confirm device authorization

### Step 3: Poll for Token

```bash
# Using auth-service helper
curl -X POST http://localhost:3000/v1/auth/device/poll \
  -H "Content-Type: application/json" \
  -d '{"device_code": "XXXX-XXXX-XXXX"}'
```

**While waiting for user:**

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Authorization pending. User has not yet completed authentication."
  }
}
```

**After user completes authorization:**

```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJSUzI1NiIs...",
    "refresh_token": "v1.MRrT...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "scope": "openid profile email offline_access"
  }
}
```

> **Important**: The refresh token is automatically stored server-side (encrypted) and associated with the user's ID. Clients should **only store the access token**.

### Step 4: Use Access Token

```bash
curl http://localhost:3001/v1/integrations/notion/status \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..."
```

### Step 5: Refresh Token (Daily Usage)

When the access token expires (after 1 hour), refresh it:

```bash
curl -X POST http://localhost:3000/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"userId": "auth0|507f1f77bcf86cd799439011"}'
```

**Success Response:**

```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJSUzI1NiIs...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "scope": "openid profile email offline_access"
  }
}
```

**Re-authentication Required:**

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Refresh token is invalid or expired. User must re-authenticate."
  }
}
```

> **Daily Usage Pattern**: 
> 1. User authenticates once via device flow
> 2. Refresh token is stored server-side (valid for 15 days idle, 30 days absolute)
> 3. Each day, client calls `/v1/auth/refresh` to get fresh access token
> 4. User doesn't need to re-authenticate unless:
>    - 15 days of inactivity
>    - 30 days since initial authentication
>    - Refresh token manually revoked
>    - Auth0 rotation security event

## 9. What the User Sees

### Device Activation Page

1. User visits `https://your-tenant.eu.auth0.com/activate`
2. If using `verification_uri_complete`, code is pre-filled
3. Otherwise, user enters 8-character `user_code`

### Login Screen

1. Auth0 Universal Login appears
2. User enters credentials (or uses social login if configured)
3. Consent screen may appear for first authorization

### Confirmation

1. "Device connected" success message
2. User can close browser
3. CLI/device receives token via polling

## 10. Security Considerations

### Refresh Token Storage

- ✅ **Encrypted at rest** using AES-256-GCM
- ✅ **Server-side only** - never sent to client
- ✅ **Per-user isolation** - stored with userId as key
- ✅ **Automatic cleanup** - deleted on logout or invalid_grant

### Refresh Token Rotation

When rotation is enabled:
- Each refresh operation returns a **new** refresh token
- The old refresh token is **immediately revoked**
- Reuse of old token **invalidates entire token family** (security feature)
- Protects against token theft and replay attacks

**Best Practice**: Enable rotation for production environments.

### Logging and Monitoring

- ✅ **Token redaction** - Tokens never appear in logs (first 4 + last 4 chars only)
- ✅ **Error tracking** - Failed refresh attempts logged with userId
- ❌ **No token introspection** - Tokens validated locally via JWKS

### Refresh Token Revocation

To revoke a user's refresh token:

```bash
# Via Management API (requires API token)
curl -X POST "https://your-tenant.eu.auth0.com/api/v2/device-credentials/{id}" \
  -H "Authorization: Bearer YOUR_MGMT_API_TOKEN" \
  -d '{"type": "refresh_token"}'

# Or delete from Firestore directly (admin only)
# Collection: auth_tokens
# Document ID: {userId}
```

## 11. Common Failure Modes

### Invalid Audience

**Symptom:** `401 Unauthorized` with "Invalid audience"

**Causes:**

- `AUTH_AUDIENCE` doesn't match API Identifier in Auth0
- Missing trailing slash or protocol mismatch

**Fix:** Verify API Identifier in Auth0 Dashboard matches exactly.

### Invalid Issuer

**Symptom:** `401 Unauthorized` with "Invalid issuer"

**Causes:**

- `AUTH_ISSUER` doesn't include trailing slash
- Wrong region in domain (e.g., `.us.` vs `.eu.`)

**Fix:** Use exact format: `https://your-tenant.region.auth0.com/`

### Token Expired

**Symptom:** `401 Unauthorized` with "Token expired"

**Causes:**

- Access token TTL exceeded (1 hour by default)
- Clock skew between client and server

**Fix:** Use refresh endpoint to get new access token. Ensure server time is synced.

### Refresh Token Invalid (invalid_grant)

**Symptom:** `401 UNAUTHORIZED` from `/v1/auth/refresh` with "invalid_grant"

**Causes:**

- Refresh token expired (idle or absolute lifetime exceeded)
- Refresh token manually revoked
- Refresh token reused (rotation enabled and old token reused)
- `offline_access` scope not granted during initial auth

**Fix:** User must re-authenticate via device flow.

### Missing offline_access Scope

**Symptom:** Token response doesn't include `refresh_token`

**Causes:**

- `offline_access` scope not requested in `/device/start`
- API doesn't have "Allow Offline Access" enabled

**Fix:** 
1. Include `offline_access` in scope (default in updated auth-service)
2. Verify API settings in Auth0 Dashboard

### Wrong Domain

**Symptom:** `401 Unauthorized` with "Unable to verify signature"

**Causes:**

- `AUTH_JWKS_URL` points to wrong tenant
- JWKS endpoint unreachable

**Fix:** Verify JWKS URL is accessible:

```bash
curl https://your-tenant.eu.auth0.com/.well-known/jwks.json
```

### Missing Environment Variables

**Symptom:** `503 MISCONFIGURED`

**Causes:**

- One or more required environment variables not set

**Fix:** Set all required environment variables:

```bash
export AUTH0_DOMAIN=your-tenant.eu.auth0.com
export AUTH0_CLIENT_ID=your-client-id
export AUTH_JWKS_URL=https://your-tenant.eu.auth0.com/.well-known/jwks.json
export AUTH_ISSUER=https://your-tenant.eu.auth0.com/
export AUTH_AUDIENCE=https://api.praxos.app
export PRAXOS_TOKEN_ENCRYPTION_KEY=your-base64-key
```

### Device Code Expired

**Symptom:** `400` error with "expired_token" during polling

**Causes:**

- User didn't complete authorization within `expires_in` seconds (900 default)
- Polling after expiration

**Fix:** Restart flow with new device code request.

### Slow Polling (Rate Limited)

**Symptom:** `400` error with "slow_down"

**Causes:**

- Polling faster than `interval` seconds (5 default)

**Fix:** Respect the `interval` value from device code response.

## 12. Environment Variable Summary

### auth-service

| Variable                      | Description                                     | Example                                          |
| ----------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `AUTH0_DOMAIN`                | Auth0 tenant domain                             | `praxos-dev.eu.auth0.com`                        |
| `AUTH0_CLIENT_ID`             | Native app client ID                            | `abc123...`                                      |
| `AUTH_AUDIENCE`               | API identifier (default for device flow)        | `https://api.praxos.app`                         |
| `AUTH_JWKS_URL`               | JWKS endpoint URL for token verification        | `https://praxos-dev.eu.auth0.com/.well-known/jwks.json` |
| `AUTH_ISSUER`                 | Token issuer for verification                   | `https://praxos-dev.eu.auth0.com/`               |
| `PRAXOS_TOKEN_ENCRYPTION_KEY` | AES-256 encryption key (base64, 32 bytes)       | `k7J9mL2nP4qR6s...`                              |

### notion-gpt-service (and other protected services)

| Variable        | Description       | Example                                                 |
| --------------- | ----------------- | ------------------------------------------------------- |
| `AUTH_JWKS_URL` | JWKS endpoint URL | `https://praxos-dev.eu.auth0.com/.well-known/jwks.json` |
| `AUTH_ISSUER`   | Token issuer      | `https://praxos-dev.eu.auth0.com/`                      |
| `AUTH_AUDIENCE` | Expected audience | `https://api.praxos.app`                                |

## 13. Troubleshooting Checklist

When debugging auth issues, verify in order:

1. ✅ **Auth0 API Settings**: "Allow Offline Access" enabled
2. ✅ **Auth0 App Grants**: Device Code + Refresh Token enabled
3. ✅ **Rotation Settings**: Configured with appropriate lifetimes
4. ✅ **Scope**: `offline_access` included in `/device/start` request
5. ✅ **Environment Variables**: All required vars set correctly
6. ✅ **Encryption Key**: Valid base64-encoded 32-byte key
7. ✅ **Token Response**: Includes `refresh_token` field
8. ✅ **Firestore**: `auth_tokens` collection exists and has write permissions
9. ✅ **Logs**: Check for token storage errors in auth-service logs
10. ✅ **Token Expiry**: Check idle and absolute lifetimes haven't expired

## 14. Production Checklist

Before going to production:

- [ ] Refresh token rotation **enabled**
- [ ] Idle lifetime set to match usage pattern (15 days for daily usage)
- [ ] Absolute lifetime set appropriately (30 days recommended)
- [ ] Encryption key generated securely and stored in Secret Manager
- [ ] Encryption key **never** committed to version control
- [ ] Access token TTL set to 1 hour (not longer)
- [ ] Monitor refresh token usage and failure rates
- [ ] Have process for user support (expired refresh tokens)
- [ ] Test full flow: auth → daily refresh → idle expiry
- [ ] Document token revocation process for security incidents

## 15. References (2025-12-19)

Official Auth0 documentation references:

- [Device Authorization Flow](https://auth0.com/docs/get-started/authentication-and-authorization-flow/device-authorization-flow) - Latest device flow implementation
- [Refresh Tokens](https://auth0.com/docs/secure/tokens/refresh-tokens) - Refresh token concepts and best practices
- [Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation) - Automatic rotation for enhanced security
- [Native Applications](https://auth0.com/docs/get-started/applications/application-types#native-applications) - Native app (no client secret)
- [offline_access Scope](https://auth0.com/docs/get-started/apis/scopes/openid-connect-scopes#offline-access) - Required for refresh tokens

All references verified as current on 2025-12-19.
