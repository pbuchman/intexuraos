# GitHub OAuth App Setup

This guide covers creating a GitHub OAuth App and configuring the secrets for IntexuraOS GitHub integration.

## Prerequisites

- GitHub account with permission to create OAuth Apps
- GCP Secret Manager access for the OAuth client secret
- Terraform applied with GitHub OAuth secret resources

## Step 1: Create GitHub OAuth App

1. Go to **https://github.com/settings/developers** → **OAuth Apps** → **New OAuth App**
2. Fill in the form:

| Field                      | Retained DEV recovery value                                           | Production value                                                  |
| -------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Application name           | `IntexuraOS Dev`                                                      | `IntexuraOS`                                                      |
| Homepage URL               | `https://dev.intexuraos.cloud`                                        | `https://intexuraos.cloud`                                        |
| Authorization callback URL | `https://dev.intexuraos.cloud/api/user-service/oauth/github/callback` | `https://intexuraos.cloud/api/user-service/oauth/github/callback` |

3. Click **Register application**
4. Copy the **Client ID**
5. Click **Generate a new client secret** and copy the **Client Secret**

> **Note:** GitHub OAuth Apps do not use refresh tokens. Access tokens do not expire unless the user revokes access.

Keep the retained DEV recovery callback allow-listed so a reviewed resume remains possible, but
do not use it for routine login or verification while DEV is hibernated. Normal OAuth traffic and
all ordinary checks use production.

## Step 2: Configure Client ID And Secret

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

## Step 3: Stage The Retained DEV Recovery Configuration

During an approved Home Dev staging window, regenerate the merged environment without starting the
retained DEV application stack:

```bash
./scripts/sync-secrets.sh
direnv allow
```

Do not restart `user-service` while DEV is hibernated. If callback recovery must be exercised, use
the DEV hibernation runbook's explicitly authorized resume transaction; its mode controller owns
validation and service start order. A direct `pm2 restart` is not a resume procedure.

## Step 4: Deploy The Versioned Configuration

Commit the `config/environments/` change with the application change and use
the normal deployment workflow. Terraform is required only when the actual
client-secret container or its IAM policy changes.

## Verification

```bash
# Validate the versioned client ID without reading Secret Manager
node scripts/render-runtime-config.mjs --environment dev --format dotenv \
  --key INTEXURAOS_GITHUB_OAUTH_CLIENT_ID >/dev/null

# Check only the client secret has an enabled version
gcloud secrets versions list INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET --project=intexuraos-dev-pbuchman

# Test the OAuth initiation endpoint
curl -X POST https://intexuraos.cloud/api/user-service/oauth/connections/github/initiate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Expected: response with `authorizationUrl` pointing to `https://github.com/login/oauth/authorize?...`

## Terraform References

| File                                 | What It Does                                         |
| ------------------------------------ | ---------------------------------------------------- |
| `config/environments/common.json`    | Stores the versioned OAuth client ID                  |
| `config/environments/policy.json`    | Enforces config-versus-secret classification          |
| `terraform/environments/dev/main.tf` | Retains the OAuth client secret and its access policy |
| `apps/user-service/src/index.ts`     | Lists in `REQUIRED_ENV` for startup validation       |
| `ecosystem.config.cjs`               | Maps env vars for PM2 dev environment                |
