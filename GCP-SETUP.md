# Google Cloud Platform - Local Development Setup

✅ **Status: Configured and Ready**

## Overview

This environment is configured to connect to Google Cloud Platform using a Service Account.

## Credentials

- **Project ID**: `intexuraos-dev-pbuchman`
- **Service Account**: `claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com`
- **Key File**: `/home/user/intexuraos/gcp-service-account.json` (gitignored)

## Environment Variables

The `.env.local` file contains:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/home/user/intexuraos/gcp-service-account.json
GOOGLE_CLOUD_PROJECT=intexuraos-dev-pbuchman
LOG_LEVEL=debug
```

## Usage in Node.js Applications

Applications using `@google-cloud/*` libraries will automatically pick up credentials from the `GOOGLE_APPLICATION_CREDENTIALS` environment variable.

### Option 1: Using .env.local (Recommended)

If your application loads `.env.local` automatically (e.g., via dotenv):

```bash
cd apps/user-service
npm run dev
```

The credentials will be loaded automatically.

### Option 2: Export in Shell

For manual testing or scripts:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/home/user/intexuraos/gcp-service-account.json
node your-script.js
```

### Option 3: Inline Export

```bash
GOOGLE_APPLICATION_CREDENTIALS=/home/user/intexuraos/gcp-service-account.json node your-script.js
```

## Verifying Connection

Run the verification script:

```bash
./verify-connections.sh
```

This will check:
- ✅ GitHub/Git connectivity
- ✅ GCP credentials configuration
- ✅ Security (gitignore verification)
- ✅ Current branch status

## Service Account Permissions

The `claude-code-dev` service account has the following roles:

- **Cloud Datastore User** - Read/write Firestore
- **Secret Manager Secret Accessor** - Read secrets
- **Storage Object Viewer** - Read from GCS buckets
- **Storage Object Admin** - Read/write to specific buckets

## Testing GCP Connection

### Test Firestore Access

```bash
cd apps/user-service
export GOOGLE_APPLICATION_CREDENTIALS=/home/user/intexuraos/gcp-service-account.json
npm run dev
# Then check GET /health endpoint
```

### Test Secret Manager Access

```bash
cd apps/user-service
export GOOGLE_APPLICATION_CREDENTIALS=/home/user/intexuraos/gcp-service-account.json
node -e "
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
const client = new SecretManagerServiceClient();
const [version] = await client.accessSecretVersion({
  name: 'projects/intexuraos-dev-pbuchman/secrets/INTEXURAOS_AUTH0_DOMAIN/versions/latest',
});
console.log('Secret accessed successfully');
"
```

## Security Notes

⚠️ **IMPORTANT**:

1. The service account key file is **gitignored** and will NOT be committed
2. Never share the service account key file publicly
3. Never commit `.env.local` to git
4. If the key is compromised, delete it in GCP Console and create a new one

## Troubleshooting

### "Could not load the default credentials"

Make sure `GOOGLE_APPLICATION_CREDENTIALS` is set:

```bash
echo $GOOGLE_APPLICATION_CREDENTIALS
# Should output: /home/user/intexuraos/gcp-service-account.json
```

### "Permission denied" errors

Check that the service account has the necessary IAM roles in GCP Console:

https://console.cloud.google.com/iam-admin/serviceaccounts?project=intexuraos-dev-pbuchman

### Key file not found

Verify the file exists:

```bash
ls -la /home/user/intexuraos/gcp-service-account.json
```

If missing, you'll need to create a new service account key in GCP Console.

## Next Steps

1. ✅ Credentials configured
2. ✅ Environment variables set
3. ✅ Security verified (gitignore)
4. 🔄 Test by running a service locally
5. 🔄 Verify Firestore connectivity
6. 🔄 Verify Secret Manager access

## Related Documentation

- [Local Development Guide](docs/setup/05-local-dev-with-gcp-deps.md)
- [GCP Project Setup](docs/setup/01-gcp-project.md)
- [Architecture Overview](README.md#architecture)
