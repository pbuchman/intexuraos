# Google Calendar OAuth Setup

This guide covers updating the existing Google OAuth client callback allowlist for the
IntexuraOS calendar integration.

## Prerequisites

- Google Cloud Console access to the `intexuraos-dev-pbuchman` project
- GCP Secret Manager access for the OAuth client secret
- Repository access for the versioned OAuth client ID

## Step 1: Verify The Existing OAuth Consent Screen

1. Go to **https://console.cloud.google.com/apis/credentials/consent** (project: `intexuraos-dev-pbuchman`)
2. Open the existing IntexuraOS consent screen.
3. Verify its current values without changing them:

| Field              | Value                               |
| ------------------ | ----------------------------------- |
| App name           | `IntexuraOS`                        |
| User support email | Your email                          |
| Developer contact  | Your email                          |

Preserve the current publishing status, user type, support contact, developer contact,
scopes, and test-user list during a callback-only update.

### Scopes

Verify that the existing consent screen retains these scopes. Do not add or remove scopes
as part of a callback-only update:

| Scope                                                    | Purpose              |
| -------------------------------------------------------- | -------------------- |
| `https://www.googleapis.com/auth/calendar.events`        | Read/write events    |
| `https://www.googleapis.com/auth/calendar.readonly`      | Read-only calendar   |
| `https://www.googleapis.com/auth/userinfo.email`         | Get user email       |

### Test Users

If the app is in "Testing" status, verify that the intended account remains an existing
test user. Do not add or remove test users or change the publishing status as part of a
callback-only update.

## Step 2: Configure The Existing OAuth Client

1. Go to **https://console.cloud.google.com/apis/credentials** (project: `intexuraos-dev-pbuchman`)
2. Open the existing Web application client whose client ID matches
   `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID`.
3. Configure both authorized redirect URIs:

| Field                    | Required values                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Application type         | Web application                                                                                      |
| Authorized redirect URI  | `http://localhost:3000/oauth/connections/google/callback`                                         |
| Authorized redirect URI  | `https://intexuraos.cloud/oauth/connections/google/callback`                                     |

Remove only redirect URIs and JavaScript origins whose origin is
`https://dev.intexuraos.cloud`. Preserve the production and localhost entries and all
unrelated entries. This server-side flow does not require adding a JavaScript origin.
Do not create a client or rotate its secret.

> **Note:** Google OAuth uses refresh tokens. The `access_type: 'offline'` and `prompt: 'consent'` parameters ensure a refresh token is returned on first authorization.

The same client ID and secret serve production and localhost.

## Step 3: Verify The Existing Client ID And Secret

Verify that `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID` in
`config/environments/common.json` matches the existing Web application client opened in
Step 2. Keep the value and its classification in `config/environments/policy.json`
unchanged. The callback URL is derived by user-service from the request origin and is
configured only in Google Console; there is no runtime
`INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` value.

Verify that the existing client secret has an enabled Secret Manager version:

```bash
gcloud secrets versions list INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET \
  --project=intexuraos-dev-pbuchman
```

Changing redirect URIs does not change either credential. Do not update the client ID,
add a secret version, or rotate the secret.

## Step 4: Render Local Configuration

Render the existing local/worker secret package without changing its version:

```bash
./scripts/sync-secrets.sh
direnv allow
```

Start the localhost stack manually with `pnpm dev` when needed.

## Step 5: Confirm No Versioned Configuration Change

No application configuration commit or deployment is required when only the redirect
allowlist changes and the checks above match. Use the normal provisioning and deployment
workflow only for a separate, explicitly approved credential change.

## Step 6: Verify Calendar API

Verify read-only that the Calendar API remains enabled in the GCP project:

```bash
gcloud services list --enabled \
  --project=intexuraos-dev-pbuchman \
  --filter='config.name=calendar-json.googleapis.com' \
  --format='value(config.name)'
```

Expected: `calendar-json.googleapis.com`. Do not enable or disable APIs as part of a
callback-only update.

## Verification

```bash
# Validate the versioned client ID without reading Secret Manager
node scripts/render-runtime-config.mjs --environment local --format dotenv \
  --key INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID >/dev/null

# Check only the client secret has an enabled version
gcloud secrets versions list INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET --project=intexuraos-dev-pbuchman

# Test the OAuth initiation endpoint
curl -X POST https://intexuraos.cloud/api/user/oauth/connections/google/initiate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Expected: response with `authorizationUrl` pointing to `https://accounts.google.com/o/oauth2/v2/auth?...`

## Terraform References

| File                                 | What It Does                                          |
| ------------------------------------ | ----------------------------------------------------- |
| `config/environments/common.json`    | Stores the versioned Google OAuth client ID            |
| `config/environments/policy.json`    | Enforces config-versus-secret classification           |
| `terraform/shared-gcp/main.tf` | Retains the OAuth client secret and its access policy  |
| `apps/user-service/src/index.ts`     | Lists in `REQUIRED_ENV` for startup validation        |
| `ecosystem.config.cjs`               | Maps env vars for PM2 dev environment                 |

## Troubleshooting

| Problem                            | Cause                                   | Fix                                                                   |
| ---------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| "OAuth not configured" (503)       | Missing client ID or secret             | Check `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID` and `SECRET` are set        |
| "Access blocked: app not verified" | App in testing mode, user not in list   | Add Google account to test users in OAuth consent screen              |
| No refresh token returned          | User already authorized previously      | Revoke at https://myaccount.google.com/permissions, then re-authorize |
| "redirect_uri_mismatch"            | Callback URL doesn't match credentials  | Verify redirect URI in Google Console matches exactly                 |
