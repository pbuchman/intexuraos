# Google Calendar OAuth Setup

This guide covers creating Google OAuth credentials and configuring them for IntexuraOS calendar integration.

## Prerequisites

- Google Cloud Console access to the `intexuraos-dev-pbuchman` project
- GCP Secret Manager access for the OAuth client secret
- Repository access for the versioned OAuth client ID

## Step 1: Create OAuth Consent Screen

1. Go to **https://console.cloud.google.com/apis/credentials/consent** (project: `intexuraos-dev-pbuchman`)
2. Select **External** user type → **Create**
3. Fill in:

| Field              | Value                               |
| ------------------ | ----------------------------------- |
| App name           | `IntexuraOS`                        |
| User support email | Your email                          |
| Developer contact  | Your email                          |

4. Click **Save and Continue**

### Scopes

Add these scopes:

| Scope                                                    | Purpose              |
| -------------------------------------------------------- | -------------------- |
| `https://www.googleapis.com/auth/calendar.events`        | Read/write events    |
| `https://www.googleapis.com/auth/calendar.readonly`      | Read-only calendar   |
| `https://www.googleapis.com/auth/userinfo.email`         | Get user email       |

### Test Users

While the app is in "Testing" status, add your Google account(s) as test users. Only test users can complete the OAuth flow until the app is published.

## Step 2: Create OAuth Client ID

1. Go to **https://console.cloud.google.com/apis/credentials** (project: `intexuraos-dev-pbuchman`)
2. Click **Create Credentials** → **OAuth client ID**
3. Fill in:

| Field                    | Retained DEV recovery value                                             | Production value                                                    |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Application type         | Web application                                                         | Web application                                                     |
| Name                     | `IntexuraOS Dev`                                                        | `IntexuraOS`                                                        |
| Authorized redirect URIs | `https://dev.intexuraos.cloud/api/user-service/oauth/google/callback`   | `https://intexuraos.cloud/api/user-service/oauth/google/callback`   |

4. Copy the **Client ID** and **Client Secret**

> **Note:** Google OAuth uses refresh tokens. The `access_type: 'offline'` and `prompt: 'consent'` parameters ensure a refresh token is returned on first authorization.

Keep the retained DEV recovery redirect allow-listed so a reviewed resume remains possible, but
do not use it for routine authorization or verification while DEV is hibernated. Normal OAuth
traffic and all ordinary checks use production.

## Step 3: Configure Client ID And Secret

Store `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID` in
`config/environments/common.json`. The callback URL is derived by user-service
from the request origin and is configured only in Google Console; there is no
runtime `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` value.

Only the client secret belongs in Secret Manager:

```bash
# Activate service account
gcloud auth activate-service-account --key-file=$HOME/.config/gcloud/sa-key.json

# Client Secret
echo -n "YOUR_GOOGLE_CLIENT_SECRET" | gcloud secrets versions add INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET \
  --data-file=- --project=intexuraos-dev-pbuchman
```

Use `versions add` rather than `create`; Terraform owns the client-secret
container. Do not add versions for the client ID or redirect URI.

## Step 4: Stage The Retained DEV Recovery Configuration

During an approved Home Dev staging window, regenerate the merged environment without starting the
retained DEV application stack:

```bash
./scripts/sync-secrets.sh
direnv allow
```

Do not restart `user-service` while DEV is hibernated. If callback recovery must be exercised, use
the DEV hibernation runbook's explicitly authorized resume transaction; its mode controller owns
validation and service start order. A direct `pm2 restart` is not a resume procedure.

## Step 5: Deploy The Versioned Configuration

Commit the `config/environments/` change and use the normal deployment
workflow. Terraform is required only when the client-secret container or its
IAM policy changes.

## Step 6: Enable Calendar API

The Calendar API must be enabled in the GCP project:

```bash
gcloud services enable calendar-json.googleapis.com --project=intexuraos-dev-pbuchman
```

## Verification

```bash
# Validate the versioned client ID without reading Secret Manager
node scripts/render-runtime-config.mjs --environment dev --format dotenv \
  --key INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID >/dev/null

# Check only the client secret has an enabled version
gcloud secrets versions list INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET --project=intexuraos-dev-pbuchman

# Test the OAuth initiation endpoint
curl -X POST https://intexuraos.cloud/api/user-service/oauth/connections/google/initiate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Expected: response with `authorizationUrl` pointing to `https://accounts.google.com/o/oauth2/v2/auth?...`

## Terraform References

| File                                 | What It Does                                          |
| ------------------------------------ | ----------------------------------------------------- |
| `config/environments/common.json`    | Stores the versioned Google OAuth client ID            |
| `config/environments/policy.json`    | Enforces config-versus-secret classification           |
| `terraform/environments/dev/main.tf` | Retains the OAuth client secret and its access policy  |
| `apps/user-service/src/index.ts`     | Lists in `REQUIRED_ENV` for startup validation        |
| `ecosystem.config.cjs`               | Maps env vars for PM2 dev environment                 |

## Troubleshooting

| Problem                            | Cause                                   | Fix                                                                   |
| ---------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| "OAuth not configured" (503)       | Missing client ID or secret             | Check `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID` and `SECRET` are set        |
| "Access blocked: app not verified" | App in testing mode, user not in list   | Add Google account to test users in OAuth consent screen              |
| No refresh token returned          | User already authorized previously      | Revoke at https://myaccount.google.com/permissions, then re-authorize |
| "redirect_uri_mismatch"            | Callback URL doesn't match credentials  | Verify redirect URI in Google Console matches exactly                 |
