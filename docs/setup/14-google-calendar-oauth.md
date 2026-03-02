# Google Calendar OAuth Setup

This guide covers creating Google OAuth credentials and configuring them for IntexuraOS calendar integration.

## Prerequisites

- Google Cloud Console access to the `intexuraos-dev-pbuchman` project
- GCP Secret Manager access
- Terraform applied with Google OAuth secret resources

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

| Field                      | Dev Value                                                              | Prod Value                                                         |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Application type           | Web application                                                        | Web application                                                    |
| Name                       | `IntexuraOS Dev`                                                       | `IntexuraOS`                                                       |
| Authorized redirect URIs   | `https://dev.intexuraos.cloud/api/user-service/oauth/google/callback`  | `https://intexuraos.cloud/api/user-service/oauth/google/callback`  |

4. Copy the **Client ID** and **Client Secret**

> **Note:** Google OAuth uses refresh tokens. The `access_type: 'offline'` and `prompt: 'consent'` parameters ensure a refresh token is returned on first authorization.

## Step 3: Populate GCP Secret Manager

Three secrets need values:

```bash
# Activate service account
gcloud auth activate-service-account --key-file=$HOME/.config/gcloud/sa-key.json

# Client ID
echo -n "YOUR_GOOGLE_CLIENT_ID" | gcloud secrets versions add INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID \
  --data-file=- --project=intexuraos-dev-pbuchman

# Client Secret
echo -n "YOUR_GOOGLE_CLIENT_SECRET" | gcloud secrets versions add INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET \
  --data-file=- --project=intexuraos-dev-pbuchman

# Redirect URI
echo -n "https://dev.intexuraos.cloud/api/user-service/oauth/google/callback" | \
  gcloud secrets versions add INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI \
  --data-file=- --project=intexuraos-dev-pbuchman
```

> **Note:** Use `versions add` (not `create`) — Terraform already created the secret resources. You're adding a version with the actual value.

## Step 4: Add to Dev Environment

On home-dev, add to `~/.envrc.local`:

```bash
export INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID="your-client-id"
export INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET="your-client-secret"
```

> **Note:** `INTEXURAOS_GOOGLE_OAUTH_REDIRECT_URI` is not needed in dev — user-service constructs the callback URL dynamically from the request origin.

Then:

```bash
direnv allow
pm2 restart user-service
```

## Step 5: Re-apply Terraform

```bash
cd terraform/environments/dev
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform apply
```

## Step 6: Enable Calendar API

The Calendar API must be enabled in the GCP project:

```bash
gcloud services enable calendar-json.googleapis.com --project=intexuraos-dev-pbuchman
```

## Verification

```bash
# Check secrets have versions
gcloud secrets versions list INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID --project=intexuraos-dev-pbuchman

# Test the OAuth initiation endpoint
curl -X POST https://dev.intexuraos.cloud/api/user-service/oauth/connections/google/initiate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Expected: response with `authorizationUrl` pointing to `https://accounts.google.com/o/oauth2/v2/auth?...`

## Terraform References

| File                                 | What It Does                                          |
| ------------------------------------ | ----------------------------------------------------- |
| `terraform/environments/dev/main.tf` | Declares secrets in `secret_manager` module           |
| `terraform/environments/dev/main.tf` | Passes secrets to `user_service` module               |
| `apps/user-service/src/index.ts`     | Lists in `REQUIRED_ENV` for startup validation        |
| `ecosystem.config.cjs`               | Maps env vars for PM2 dev environment                 |

## Troubleshooting

| Problem                            | Cause                                   | Fix                                                                   |
| ---------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| "OAuth not configured" (503)       | Missing client ID or secret             | Check `INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID` and `SECRET` are set        |
| "Access blocked: app not verified" | App in testing mode, user not in list   | Add Google account to test users in OAuth consent screen              |
| No refresh token returned          | User already authorized previously      | Revoke at https://myaccount.google.com/permissions, then re-authorize |
| "redirect_uri_mismatch"            | Callback URL doesn't match credentials  | Verify redirect URI in Google Console matches exactly                 |
