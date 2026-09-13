# GitHub OAuth App Setup

This guide covers creating a GitHub OAuth App and configuring the secrets for IntexuraOS GitHub integration.

## Prerequisites

- GitHub account with permission to create OAuth Apps
- GCP Secret Manager access for the OAuth client secret
- Terraform applied with GitHub OAuth secret resources

## Step 1: Configure The Existing GitHub OAuth App

1. Go to **https://github.com/settings/developers** → **OAuth Apps** and open the
   existing IntexuraOS app whose client ID matches
   `INTEXURAOS_GITHUB_OAUTH_CLIENT_ID`.
2. Keep the production homepage and configure both callback URLs:

| Field                      | Required values                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Homepage URL               | `https://intexuraos.cloud`                                                                           |
| Authorization callback URL | `http://localhost:3000/oauth/connections/github/callback`                                             |
| Authorization callback URL | `https://intexuraos.cloud/oauth/connections/github/callback`                                         |

Add the production and localhost URLs as exact entries. Remove only obsolete callbacks
whose origin is `https://dev.intexuraos.cloud`; preserve unrelated callbacks and the
existing legacy callback matching setting. Do not generate a new client secret.

> **Note:** Keep user-token expiration disabled for the existing app. The current
> implementation stores a non-expiring token and does not implement GitHub refresh tokens.

The same client ID and secret serve production and localhost.

## Step 2: Configure Client ID And Secret

For an existing installation, skip the provisioning instructions below. Verify the
existing configuration using the Verification section; a callback-only update
requires no client-ID change or secret upload. Keep all existing secret versions.

### Initial Provisioning Only

The client ID is non-secret repository-backed configuration. Update
`INTEXURAOS_GITHUB_OAUTH_CLIENT_ID` in
`config/environments/common.json` and keep its classification in
`config/environments/policy.json`.

Only the client secret belongs in Secret Manager:

```bash
# Activate service account
gcloud auth activate-service-account --key-file=$HOME/.config/gcloud/sa-key.json

echo -n "YOUR_GITHUB_CLIENT_SECRET" | gcloud secrets versions add INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET \
  --data-file=- --project=intexuraos-dev-pbuchman
```

Use `versions add` rather than `create`; Terraform owns the secret container.
Do not add a new Secret Manager version for the client ID.

## Step 3: Render Local Configuration

Render the existing local/worker secret package without changing its version:

```bash
./scripts/sync-secrets.sh
direnv allow
```

Start the localhost stack manually with `pnpm dev` when needed.

## Step 4: Deploy The Versioned Configuration

Skip this step for a callback-only update; it changes no versioned configuration.

Commit the `config/environments/` change with the application change and use
the normal deployment workflow. Terraform is required only when the actual
client-secret container or its IAM policy changes.

## Verification

```bash
# Validate the versioned client ID without reading Secret Manager
node scripts/render-runtime-config.mjs --environment local --format dotenv \
  --key INTEXURAOS_GITHUB_OAUTH_CLIENT_ID >/dev/null

# Check only the client secret has an enabled version
gcloud secrets versions list INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET --project=intexuraos-dev-pbuchman

# Test the OAuth initiation endpoint
curl -X POST https://intexuraos.cloud/api/user/oauth/connections/github/initiate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Expected: response with `authorizationUrl` pointing to `https://github.com/login/oauth/authorize?...`

## Terraform References

| File                                 | What It Does                                         |
| ------------------------------------ | ---------------------------------------------------- |
| `config/environments/common.json`    | Stores the versioned OAuth client ID                  |
| `config/environments/policy.json`    | Enforces config-versus-secret classification          |
| `terraform/shared-gcp/main.tf` | Retains the OAuth client secret and its access policy |
| `apps/user-service/src/index.ts`     | Lists in `REQUIRED_ENV` for startup validation       |
| `ecosystem.config.cjs`               | Maps env vars for PM2 dev environment                |
