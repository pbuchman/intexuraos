# Secrets Management

## Overview

IntexuraOS stores secrets in **GCP Secret Manager** with the `INTEXURAOS_*` prefix. Services access secrets via environment variables injected by Cloud Run.

## Secret Inventory

| Secret                             | Purpose                          | Used By          |
| ---------------------------------- | -------------------------------- | ---------------- |
| `INTEXURAOS_AUTH0_DOMAIN`          | Auth0 tenant domain              | user-service     |
| `INTEXURAOS_AUTH0_CLIENT_ID`       | Native app client ID             | user-service     |
| `INTEXURAOS_AUTH0_CLIENT_SECRET`   | Native app client secret         | user-service     |
| `INTEXURAOS_AUTH_JWKS_URL`         | JWKS endpoint for JWT validation | all services     |
| `INTEXURAOS_AUTH_ISSUER`           | Expected JWT issuer              | all services     |
| `INTEXURAOS_AUTH_AUDIENCE`         | Expected JWT audience            | all services     |
| `INTEXURAOS_TOKEN_ENCRYPTION_KEY`  | AES-256 key for refresh tokens   | user-service     |
| `INTEXURAOS_ENCRYPTION_KEY`        | AES-256 key for LLM API keys     | user-service     |
| `INTEXURAOS_WHATSAPP_ACCESS_TOKEN` | WhatsApp API access token        | whatsapp-service |
| `INTEXURAOS_WHATSAPP_PHONE_ID`     | WhatsApp phone number ID         | whatsapp-service |
| `INTEXURAOS_WHATSAPP_VERIFY_TOKEN` | Webhook verification token       | whatsapp-service |
| `INTEXURAOS_WHATSAPP_MEDIA_BUCKET` | GCS bucket for media storage     | whatsapp-service |
| `INTEXURAOS_SPEECHMATICS_API_KEY`  | Speechmatics API key             | whatsapp-service |
| `INTEXURAOS_NOTION_INTERNAL_TOKEN` | Notion internal integration      | notion-service   |

## Local Development

Create `.env.local` in repository root (gitignored):

```bash
# GCP Project
GOOGLE_CLOUD_PROJECT=your-project-id

# Auth0 Configuration
AUTH_JWKS_URL=https://your-tenant.auth0.com/.well-known/jwks.json
AUTH_ISSUER=https://your-tenant.auth0.com/
AUTH_AUDIENCE=urn:intexuraos:api
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret

# Token Encryption (generate with: openssl rand -base64 32)
INTEXURAOS_TOKEN_ENCRYPTION_KEY=your-base64-32-byte-key

# LLM API Keys Encryption (generate with: openssl rand -base64 32)
INTEXURAOS_ENCRYPTION_KEY=your-base64-32-byte-key

# Logging
LOG_LEVEL=debug
```

## Generating Encryption Keys

```bash
# Generate a 256-bit (32-byte) key for AES-256-GCM
openssl rand -base64 32
```

## Secret Manager Setup

### Create a Secret

```bash
# Create secret
echo -n "your-secret-value" | gcloud secrets create INTEXURAOS_MY_SECRET \
  --data-file=- \
  --project=your-project-id

# Grant Cloud Run service account access
gcloud secrets add-iam-policy-binding INTEXURAOS_MY_SECRET \
  --member="serviceAccount:your-service@your-project.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=your-project-id
```

### Update a Secret

```bash
echo -n "new-secret-value" | gcloud secrets versions add INTEXURAOS_MY_SECRET \
  --data-file=- \
  --project=your-project-id
```

### Access in Cloud Run

Secrets are mounted as environment variables via Terraform:

```hcl
resource "google_cloud_run_service" "service" {
  template {
    spec {
      containers {
        env {
          name = "INTEXURAOS_MY_SECRET"
          value_from {
            secret_key_ref {
              name = "INTEXURAOS_MY_SECRET"
              key  = "latest"
            }
          }
        }
      }
    }
  }
}
```

## Security Practices

- **Never commit secrets** to version control
- **Rotate secrets** periodically (especially after team changes)
- **Use least privilege** — grant only necessary secret access per service
- **Audit access** via Cloud Audit Logs
- **Redact in logs** — IntexuraOS automatically redacts secrets (shows first 4 + last 4 chars)

## Troubleshooting

### "Permission denied" accessing secret

1. Verify service account has `secretmanager.secretAccessor` role
2. Check secret name matches exactly (case-sensitive)
3. Ensure secret exists in the correct project

### Secret not updating in Cloud Run

Cloud Run caches secrets at container startup. To force refresh:

```bash
gcloud run services update SERVICE_NAME --region=REGION
```

Or deploy a new revision.
