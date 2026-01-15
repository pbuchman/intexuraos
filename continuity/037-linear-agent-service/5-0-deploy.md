# Task 5-0: Deploy Infrastructure and Service

## Tier

5 (Deployment)

## Context

All code is complete. Now deploy the infrastructure and service.

## Problem Statement

Need to:

1. Run CI to ensure all tests pass
2. Apply Terraform to create Cloud Run service
3. Push initial Docker image
4. Verify deployment is healthy

## Scope

### In Scope

- Run full CI verification
- Apply Terraform changes
- Push Docker image using push-missing-images.sh
- Verify Cloud Run service is healthy

### Out of Scope

- End-to-end testing (next task)
- Production deployment

## Required Approach

1. **Run** `pnpm run ci:tracked` to verify all tests pass
2. **Apply** Terraform to create service
3. **Push** initial image using scripts
4. **Verify** health endpoint responds

## Step Checklist

- [ ] Run `pnpm run ci:tracked` - must pass
- [ ] Navigate to `terraform/environments/dev`
- [ ] Run `tf plan` to see changes
- [ ] Run `tf apply` to create infrastructure
- [ ] Run `./scripts/push-missing-images.sh` to push initial image
- [ ] Verify service URL responds to health check
- [ ] Check Cloud Run console for service status

## Definition of Done

- CI passes
- Terraform applied successfully
- Service running on Cloud Run
- Health endpoint returns 200

## Verification Commands

```bash
# Full CI verification
pnpm run ci:tracked

# Terraform
cd terraform/environments/dev
tf fmt -recursive
tf validate
tf plan
tf apply

cd ../../..

# Push missing images (for new service)
./scripts/push-missing-images.sh

# Check service health (get URL from Terraform output or GCP console)
# SERVICE_URL=https://intexuraos-linear-agent-XXX.a.run.app
# curl $SERVICE_URL/health

# Or use gcloud
gcloud run services describe intexuraos-linear-agent --region=europe-central2 --format='value(status.url)'
```

## Rollback Plan

```bash
# If Terraform fails, check error messages
# If service is unhealthy, check Cloud Run logs
gcloud run logs read --service=intexuraos-linear-agent --region=europe-central2 --limit=50
```

## Expected Terraform Changes

Terraform should create:

- Cloud Run service `intexuraos-linear-agent`
- Service account for linear-agent
- IAM bindings

No Pub/Sub topics needed for linear-agent (synchronous flow).

## Troubleshooting

### Image not found error

Run `./scripts/push-missing-images.sh` to push initial placeholder image.

### Service not starting

Check Cloud Run logs for startup errors. Common issues:

- Missing environment variables
- Invalid image
- Service account permissions

### Health check failing

- Verify service is actually running
- Check if there are startup validation errors
- Ensure all required env vars are set in Terraform

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
