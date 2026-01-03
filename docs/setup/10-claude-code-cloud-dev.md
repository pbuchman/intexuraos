# 10 - Claude Code Cloud Development Setup

This document describes how to configure GCP access for Claude Code when running in a cloud environment (not your local machine).

## Overview

**Use this guide when:**

- You're using Claude Code in a web browser or cloud environment
- You don't have `gcloud` CLI installed
- You need to authenticate using a Service Account key file

**For local development on your machine, see:** [05-local-dev-with-gcp-deps.md](./05-local-dev-with-gcp-deps.md)

## Differences from Local Development

| Aspect         | Local Development                     | Claude Code Cloud   |
| -------------- | ------------------------------------- | ------------------- |
| Authentication | Application Default Credentials (ADC) | Service Account Key |
| CLI Tools      | `gcloud` CLI installed                | No CLI tools needed |
| User Account   | Your personal GCP account             | Service Account     |
| Setup Location | Your local machine                    | Cloud environment   |

## Prerequisites

- GCP project set up (see [01-gcp-project.md](./01-gcp-project.md))
- Access to [Google Cloud Console](https://console.cloud.google.com)
- Ability to create Service Accounts (IAM Admin role)

## 1. Create Service Account

### 1.1 Navigate to Service Accounts

1. Open [Google Cloud Console](https://console.cloud.google.com)
2. Select your project
3. Go to **IAM & Admin → Service Accounts**
4. Click **+ CREATE SERVICE ACCOUNT**

### 1.2 Configure Service Account

**Service account details:**

- **Name**: `claude-code-dev`
- **Service account ID**: `claude-code-dev` (auto-generated)
- **Description**: `Service account for Claude Code development environment`

Click **CREATE AND CONTINUE**

### 1.3 Grant Roles

Add the following roles:

| Role                               | Purpose                                       |
| ---------------------------------- | --------------------------------------------- |
| **Cloud Datastore User**           | Read/write Firestore collections              |
| **Secret Manager Secret Accessor** | Access secrets from Secret Manager            |
| **Storage Object Viewer**          | Read from GCS buckets                         |
| **Storage Object Admin**           | Read/write to GCS buckets (for media uploads) |

To add each role:

1. Click **Select a role**
2. Search for the role name
3. Select it
4. Click **+ ADD ANOTHER ROLE** to add more
5. Click **CONTINUE** when done

Skip the "Grant users access" section and click **DONE**.

## 2. Generate Service Account Key

### 2.1 Create Key

1. Find `claude-code-dev@YOUR-PROJECT.iam.gserviceaccount.com` in the list
2. Click the **three dots (⋮)** on the right
3. Select **Manage keys**
4. Click **ADD KEY** → **Create new key**
5. Select **JSON** format
6. Click **CREATE**

A JSON file will be downloaded to your computer (e.g., `YOUR-PROJECT-abc123.json`)

### 2.2 Provide Key to Claude Code

Copy the entire contents of the downloaded JSON file and provide it to Claude Code when requested.

Claude Code will:

1. Create `/home/user/intexuraos/gcp-service-account.json`
2. Add it to `.gitignore` (never committed to git)
3. Create `.env.local` with `GOOGLE_APPLICATION_CREDENTIALS` pointing to the key file
4. Configure environment variables for GCP access

## 3. Verify Connection

After Claude Code configures the credentials, verify the setup:

```bash
./scripts/verify-connections.sh
```

Expected output:

```
✅ GitHub: Ready for git operations
✅ GCP: Service account configured
   Project: intexuraos-dev-pbuchman
   Service Account: claude-code-dev@...
```

## 4. Usage in Applications

Applications using `@google-cloud/*` packages will automatically use the service account credentials.

### Environment Variables Set

`.env.local` contains:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/home/user/intexuraos/gcp-service-account.json
GOOGLE_CLOUD_PROJECT=your-project-id
LOG_LEVEL=debug
```

### Running Services

```bash
# The credentials are automatically loaded from .env.local
cd apps/user-service
npm run dev

# Test the health endpoint
curl http://localhost:8080/health
```

## 5. Security Best Practices

### ✅ DO

- Keep the service account key file secure
- Use the key only in cloud development environments
- Verify the key is gitignored before committing
- Delete and recreate keys if compromised
- Use minimal required permissions

### ❌ DON'T

- Never commit service account keys to git
- Never share keys publicly or in screenshots
- Don't use production service accounts for development
- Don't grant excessive permissions

## 6. Troubleshooting

### "Could not load the default credentials"

**Solution:**

```bash
# Verify the environment variable is set
echo $GOOGLE_APPLICATION_CREDENTIALS
# Should output: /home/user/intexuraos/gcp-service-account.json

# Verify the file exists
ls -la /home/user/intexuraos/gcp-service-account.json
```

### "Permission denied" errors

**Cause:** Service account lacks required IAM roles

**Solution:**

1. Go to [IAM & Admin → IAM](https://console.cloud.google.com/iam-admin/iam)
2. Find `claude-code-dev@...` in the principals list
3. Click the pencil icon to edit
4. Add missing roles from section 1.3

### Key file not found

**Solution:**

1. Verify `.env.local` exists and contains `GOOGLE_APPLICATION_CREDENTIALS`
2. Verify `gcp-service-account.json` exists
3. If missing, regenerate the key (section 2)

## 7. Differences from Local Setup

| Task                    | Local Development       | Claude Code Cloud          |
| ----------------------- | ----------------------- | -------------------------- |
| Install gcloud CLI      | ✅ Required             | ❌ Not needed              |
| Run `gcloud auth login` | ✅ Required             | ❌ Not needed              |
| Service Account Key     | ❌ Optional             | ✅ Required                |
| `.env.local` file       | ✅ Used                 | ✅ Used                    |
| IAM Roles               | Granted to user account | Granted to service account |

## 8. Related Documentation

- [01 - GCP Project Setup](./01-gcp-project.md) - Creating the GCP project
- [02 - Terraform Bootstrap](./02-terraform-bootstrap.md) - Infrastructure setup
- [05 - Local Development](./05-local-dev-with-gcp-deps.md) - For local machine setup
- [Architecture Overview](../README.md#architecture) - System architecture

## 9. File Locations

```
intexuraos/
├── .env.local                          # Environment variables (gitignored)
├── gcp-service-account.json           # Service account key (gitignored)
├── .gitignore                         # Updated with GCP credential patterns
├── scripts/
│   └── verify-connections.sh          # Connection verification script
└── docs/
    └── setup/
        └── 10-claude-code-cloud-dev.md  # This file
```

## 10. Next Steps

After completing this setup:

1. ✅ Service account created with proper roles
2. ✅ Key file downloaded and configured
3. ✅ Environment variables set in `.env.local`
4. ✅ Files properly gitignored
5. 🔄 Run `./scripts/verify-connections.sh` to confirm
6. 🔄 Test a service locally with Firestore access
7. 🔄 Verify Secret Manager access

**You're now ready to develop with full GCP access in Claude Code!** 🚀
