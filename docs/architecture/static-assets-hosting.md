# Static Assets Hosting

## Overview

IntexuraOS uses a public Google Cloud Storage (GCS) bucket to serve static assets including branding materials, logos, illustrations, and documentation visuals.

## Architecture

### Source of Truth

- **Location**: `docs/assets/**` (entire directory, recursively)
- Files in this directory are eligible for an explicit reviewed publication to the GCS bucket.

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

3. **Terraform-owned bucket**
   - The bucket and IAM are retained GCP infrastructure.
   - App/web service deployment no longer runs through GCP Cloud Build.

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

3. Terraform does not upload objects. Perform the separately reviewed publication below only when
   the bucket should change.

### Publication Model

A push does not publish assets. The current pipeline has no `sync-static-assets` step and no
push-triggered application deployment. Publishing to the retained public bucket is an explicit
reviewed manual operation; it neither starts nor resumes the Home Dev application profile.

### Reviewed Manual Sync

First review the exact dry-run delta. Because `-d` deletes remote objects absent from the tracked
directory, do not run the mutating command unless that deletion set is intended:

```bash
# Set variables
ASSET_ENVIRONMENT=dev
ASSET_BUCKET_NAME=intexuraos-static-assets-$ASSET_ENVIRONMENT

# Review only
gsutil -m rsync -n -r -d docs/assets/ gs://$ASSET_BUCKET_NAME/

# Execute only after review
gsutil -m rsync -r -d docs/assets/ gs://$ASSET_BUCKET_NAME/

# Verify sync
gsutil ls -r gs://$ASSET_BUCKET_NAME/
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

2. Commit the change through the normal reviewed pull-request flow. Merging or pushing does not
   publish it.
3. If immediate GCS publication is required, run the reviewed dry-run and manual sync above.
4. Verify the expected object through its public URL:

   ```
   https://storage.googleapis.com/intexuraos-static-assets-dev/{your-path}
   ```

### Removing Assets

1. Delete files from `docs/assets/**`

2. Commit the deletion through the normal reviewed pull-request flow. The remote object remains
   until a separate publication.
3. Review the `gsutil rsync -n -r -d` output and explicitly authorize the object deletion before
   running the mutating sync. The bucket has no object versioning, so do not treat deletion as
   automatically recoverable.

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

- Only explicitly authorized operator or automation principals may have write access
- No public write access (only read)
- Manual uploads require GCP authentication

### CORS Policy

- Allows all origins (`*`) for GET and HEAD requests
- Required for loading assets from different domains
- Max age: 3600 seconds (1 hour)

## Troubleshooting

### Repository And Bucket Differ

1. Remember that a push does not publish assets.
2. Run the reviewed `gsutil rsync -n -r -d` dry run against the exact bucket.
3. Check the bucket name matches the retained environment.
4. Verify the operator identity has only the required object permissions.

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

- **No automatic publication**: Asset sync is not part of the CI pipeline
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
