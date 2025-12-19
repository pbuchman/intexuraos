# Auth0 Setup Guide

This guide covers setting up Auth0 for PraxOS authentication using the Device Authorization Flow (DAF).

## Prerequisites

- Auth0 account (free tier works)
- `gcloud` CLI installed and authenticated
- GCP project with Secret Manager enabled

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
2. Set **Token Expiration (Seconds)**: `3600` (1 hour for v1 sandbox)
3. Enable **Allow Offline Access** if you need refresh tokens later
4. Click **Save**

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
   - [x] Device Code
6. Click **Save Changes**

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

## 6. Populate Secret Manager (GCP)

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
```

To update an existing secret value:

```bash
echo -n "new-value" | \
  gcloud secrets versions add PRAXOS_AUTH0_DOMAIN --data-file=- --project=$PROJECT_ID
```

## 7. Obtain Token via Device Authorization Flow

### Step 1: Request Device Code

```bash
# Using auth-service helper
curl -X POST http://localhost:3000/v1/auth/device/start \
  -H "Content-Type: application/json" \
  -d '{"audience": "https://api.praxos.app", "scope": "openid profile email"}'

# Or directly via Auth0
curl -X POST "https://your-tenant.eu.auth0.com/oauth/device/code" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "audience=https://api.praxos.app" \
  -d "scope=openid profile email"
```

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

# Or directly via Auth0
curl -X POST "https://your-tenant.eu.auth0.com/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "device_code=XXXX-XXXX-XXXX" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code"
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
    "token_type": "Bearer",
    "expires_in": 3600
  }
}
```

### Step 4: Use Token

```bash
curl http://localhost:3001/v1/integrations/notion/status \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..."
```

## 8. What the User Sees

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

## 9. Common Failure Modes

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

- Token TTL exceeded
- Clock skew between client and server

**Fix:** Request new token. Ensure server time is synced.

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

- One or more of `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE` not set
- For auth-service: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID` not set

**Fix:** Set all required environment variables:

```bash
export AUTH0_DOMAIN=your-tenant.eu.auth0.com
export AUTH0_CLIENT_ID=your-client-id
export AUTH_JWKS_URL=https://your-tenant.eu.auth0.com/.well-known/jwks.json
export AUTH_ISSUER=https://your-tenant.eu.auth0.com/
export AUTH_AUDIENCE=https://api.praxos.app
```

### Device Code Expired

**Symptom:** `400` error with "expired_token" during polling

**Causes:**

- User didn't complete authorization within `expires_in` seconds
- Polling after expiration

**Fix:** Restart flow with new device code request.

### Slow Polling (Rate Limited)

**Symptom:** `400` error with "slow_down"

**Causes:**

- Polling faster than `interval` seconds

**Fix:** Respect the `interval` value from device code response.

## Environment Variable Summary

### auth-service

| Variable          | Description              | Example                   |
| ----------------- | ------------------------ | ------------------------- |
| `AUTH0_DOMAIN`    | Auth0 tenant domain      | `praxos-dev.eu.auth0.com` |
| `AUTH0_CLIENT_ID` | Native app client ID     | `abc123...`               |
| `AUTH_AUDIENCE`   | API identifier (default) | `https://api.praxos.app`  |

### notion-gpt-service (and other protected services)

| Variable        | Description       | Example                                                 |
| --------------- | ----------------- | ------------------------------------------------------- |
| `AUTH_JWKS_URL` | JWKS endpoint URL | `https://praxos-dev.eu.auth0.com/.well-known/jwks.json` |
| `AUTH_ISSUER`   | Token issuer      | `https://praxos-dev.eu.auth0.com/`                      |
| `AUTH_AUDIENCE` | Expected audience | `https://api.praxos.app`                                |

## Security Notes (v1 Sandbox)

- **No JWT blacklist**: Revoked tokens remain valid until expiry
- **Short TTL only**: Use 1-hour expiry for access tokens
- **No refresh tokens**: Request new token via DAF when expired
- **Client secret not used**: Native apps use PKCE or device flow without secret
