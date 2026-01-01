# 2-0 Terraform

## Tier

2 (Dependent)

## Context

Add Cloud Run service, PubSub topic/subscription, and IAM for commands-router.

## Problem

Need infrastructure to deploy service and receive PubSub messages.

## Scope

- Cloud Run module for commands-router
- PubSub topic: commands-ingest
- PubSub push subscription to Cloud Run
- Service account with required roles
- CloudBuild config

## Non-Scope

- Production environment

## Approach

1. Add service account to IAM module
2. Add Cloud Run module
3. Add PubSub topic module
4. Add to cloudbuild.yaml
5. Add to api-docs-hub config
6. Add to root tsconfig.json

## Files to Modify

- `terraform/environments/dev/main.tf`
- `terraform/modules/iam/variables.tf` (if needed)
- `cloudbuild/cloudbuild.yaml`
- `apps/api-docs-hub/src/config.ts`
- `tsconfig.json` (root)

## Checklist

- [ ] Service account added
- [ ] Cloud Run module added
- [ ] PubSub topic created
- [ ] PubSub subscription with push config
- [ ] CloudBuild config updated
- [ ] API docs hub updated
- [ ] Root tsconfig updated
- [ ] `terraform fmt -recursive`
- [ ] `terraform validate`

## Definition of Done

Terraform validates, infrastructure ready to deploy.

## Verification

```bash
cd terraform && terraform fmt -check -recursive && terraform validate
```

## Rollback

Revert terraform changes.

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
