# GitHub OAuth App Setup

This guide covers creating a GitHub OAuth App and configuring the secrets for IntexuraOS GitHub integration.

## Prerequisites

- GitHub account with permission to create OAuth Apps
- GCP Secret Manager access (`intexuraos-dev-pbuchman` project)
- Terraform applied with GitHub OAuth secret resources

## Step 1: Create GitHub OAuth App

1. Go to **https://github.com/settings/developers** → **OAuth Apps** → **New OAuth App**
2. Fill in the form:

| Field                        | Dev Value                                                             | Prod Value                                                        |
| ---------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Application name             | `IntexuraOS Dev`                                                      | `IntexuraOS`                                                      |
| Homepage URL                 | `https://dev.intexuraos.cloud`                                        | `https://intexuraos.cloud`                                        |
| Authorization callback URL   | `https://dev.intexuraos.cloud/api/user-service/oauth/github/callback` | `https://intexuraos.cloud/api/user-service/oauth/github/callback` |

3. Click **Register application**
4. Copy the **Client ID**
5. Click **Generate a new client secret** and copy the **Client Secret**

> **Note:** GitHub OAuth Apps do not use refresh tokens. Access tokens do not expire unless the user revokes access.

## Step 2: Populate GCP Secret Manager

Terraform creates the empty secret resources. You must add the values manually:

```bash
# Activate service account
gcloud auth activate-service-account --key-file=$HOME/.config/gcloud/sa-key.json

# Add secret values (replace with actual values)
echo -n "YOUR_GITHUB_CLIENT_ID" | gcloud secrets versions add INTEXURAOS_GITHUB_OAUTH_CLIENT_ID \
  --data-file=- --project=intexuraos-dev-pbuchman

echo -n "YOUR_GITHUB_CLIENT_SECRET" | gcloud secrets versions add INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET \
  --data-file=- --project=intexuraos-dev-pbuchman
```

> **Note:** Use `versions add` (not `create`) — Terraform already created the secret resources. You're adding the first version with the actual value.

## Step 3: Add to Dev Environment

On home-dev, add to `~/.envrc.local`:

```bash
export INTEXURAOS_GITHUB_OAUTH_CLIENT_ID="your-client-id"
export INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET="your-client-secret"
```

Then:

```bash
direnv allow
pm2 restart user-service
```

## Step 4: Re-apply Terraform

```bash
cd terraform/environments/dev
STORAGE_EMULATOR_HOST= FIRESTORE_EMULATOR_HOST= PUBSUB_EMULATOR_HOST= \
GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/sa-key.json \
terraform apply
```

This wires the secrets to the user-service Cloud Run deployment.

## Verification

```bash
# Check secret exists and has a version
gcloud secrets versions list INTEXURAOS_GITHUB_OAUTH_CLIENT_ID --project=intexuraos-dev-pbuchman

# Test the OAuth initiation endpoint
curl -X POST https://dev.intexuraos.cloud/api/user-service/oauth/connections/github/initiate \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Expected: response with `authorizationUrl` pointing to `https://github.com/login/oauth/authorize?...`

## Terraform References

| File                                 | What It Does                                         |
| ------------------------------------ | ---------------------------------------------------- |
| `terraform/environments/dev/main.tf` | Declares secrets in `secret_manager` module          |
| `terraform/environments/dev/main.tf` | Passes secrets to `user_service` module              |
| `apps/user-service/src/index.ts`     | Lists in `REQUIRED_ENV` for startup validation       |
| `ecosystem.config.cjs`               | Maps env vars for PM2 dev environment                |
