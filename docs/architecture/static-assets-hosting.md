# Static Assets Hosting

## Overview

IntexuraOS uses a public Google Cloud Storage (GCS) bucket to serve static assets including branding materials, logos, illustrations, and documentation visuals.

## Architecture

### Source of Truth

- **Location**: `docs/assets/**` (entire directory, recursively)
- All files in this directory are synchronized to the GCS bucket

### Infrastructure Components

1. **GCS Bucket** (`terraform/modules/static-assets`)
   - Bucket name: `intexuraos-static-assets-{environment}`
   - Region: Same as other IntexuraOS resources
   - Public read access (anonymous)
   - Uniform bucket-level access enabled
   - CORS enabled for cross-origin requests
   - Lifecycle: Delete objects after 90 days

2. **IAM Configuration**
   - Public read access via `allUsers` member
   - Role: `roles/storage.objectViewer`

3. **Cloud Build Sync** (`cloudbuild/cloudbuild.yaml`)
   - Dedicated `sync-static-assets` step
   - Uses `gsutil rsync` for efficient synchronization
   - Runs independently of service builds (no affected gating)

## Access

### Public URLs

Static assets are accessible via:

```
https://storage.googleapis.com/intexuraos-static-assets-{environment}/{path}
```

Example:

```
https://storage.googleapis.com/intexuraos-static-assets-dev/branding/exports/primary/logo-primary-light.png
```

### Terraform Outputs

After deploying the infrastructure:

```bash
cd terraform/environments/dev
terraform output static_assets_bucket_name    # intexuraos-static-assets-dev
terraform output static_assets_public_url     # https://storage.googleapis.com/intexuraos-static-assets-dev
```

## Deployment

### Initial Setup

1. Apply Terraform configuration:

```bash
cd terraform/environments/dev
terraform init
terraform plan
terraform apply
```

2. The bucket is created automatically with public read access.

3. Initial sync happens on the first Cloud Build run after the trigger executes.

### Continuous Deployment

Cloud Build automatically syncs assets on every pipeline run via the `sync-static-assets` step. The step is independent from service deployments and does not wait on Docker builds.

### Manual Sync (if needed)

If you need to manually sync assets:

```bash
# Set variables
ENVIRONMENT=dev
BUCKET_NAME=intexuraos-static-assets-$ENVIRONMENT

# Sync all assets
gsutil -m rsync -r -d docs/assets/ gs://$BUCKET_NAME/

# Verify sync
gsutil ls -r gs://$BUCKET_NAME/
```

## Development Workflow

### Adding New Assets

1. Add files to `docs/assets/**` following the existing structure:

   ```
   docs/assets/
   ├── branding/
   │   ├── exports/
   │   │   ├── primary/
   │   │   └── icon/
   │   └── prompts/
   └── [other categories]/
   ```

2. Commit and push changes to development branch

3. Cloud Build automatically:
   - Detects changes to `docs/assets/**`
   - Syncs to GCS bucket
   - Makes assets publicly available

4. Access via public URL:
   ```
   https://storage.googleapis.com/intexuraos-static-assets-dev/{your-path}
   ```

### Removing Assets

1. Delete files from `docs/assets/**`

2. Commit and push changes

3. Cloud Build runs `gsutil rsync -d` which:
   - Deletes files from bucket that don't exist in source
   - Keeps bucket in sync with repository

## Testing

### Verify Bucket Access

```bash
# Check bucket exists and is public
curl -I https://storage.googleapis.com/intexuraos-static-assets-dev/branding/exports/primary/logo-primary-light.png

# Should return 200 OK without authentication
```

### List Bucket Contents

```bash
# Using gsutil (requires auth)
gsutil ls -r gs://intexuraos-static-assets-dev/

# Public API (no auth)
curl https://storage.googleapis.com/storage/v1/b/intexuraos-static-assets-dev/o
```

## Security Considerations

### Public Access

- Bucket is **intentionally public** for anonymous read access
- Only files in `docs/assets/**` are synchronized
- No secrets or sensitive data should be placed in `docs/assets/**`

### Write Access

- Cloud Build service account has write access
- No public write access (only read)
- Manual uploads require GCP authentication

### CORS Policy

- Allows all origins (`*`) for GET and HEAD requests
- Required for loading assets from different domains
- Max age: 3600 seconds (1 hour)

## Troubleshooting

### Assets Not Syncing

1. Check Cloud Build logs for `sync-static-assets` step
2. Check bucket name matches environment
3. Verify Cloud Build service account has storage.objects.create permission

### 404 Errors

1. Verify file exists in repository under `docs/assets/**`
2. Check file was synced: `gsutil ls gs://intexuraos-static-assets-dev/your-path`
3. Verify bucket name in URL matches environment
4. Check path is correct (case-sensitive)

### Permission Errors

1. Verify bucket IAM: `gsutil iam get gs://intexuraos-static-assets-dev`
2. Check `allUsers` has `roles/storage.objectViewer`
3. Verify public access prevention is set to `inherited`
4. Check uniform bucket-level access is enabled

## Limitations

- **No CI checks**: Asset sync is not part of CI pipeline
- **No tests**: Static assets module has no automated tests
- **DEV environment only**: Currently only configured for development
- **No versioning**: Assets are overwritten, not versioned
- **Lifecycle**: Objects older than 90 days are automatically deleted

## Future Enhancements

Potential improvements (not currently implemented):

- CDN integration for faster global access
- Image optimization pipeline
- Asset versioning for cache busting
- Multi-environment support (staging, production)
- Asset validation and size limits
