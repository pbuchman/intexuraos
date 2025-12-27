# 1-5: Remove Transcription Pub/Sub from Terraform

**Tier:** 1 (Independent Deliverable)

## Context Snapshot

Terraform has two Pub/Sub modules:

1. `pubsub_media_cleanup` — KEEP (used for media deletion cleanup)
2. `pubsub_transcription_completed` — DELETE (no longer needed)

## Problem Statement

Remove transcription-completed Pub/Sub topic and subscription from Terraform while preserving media-cleanup.

## Scope

**In scope:**

- Remove `module "pubsub_transcription_completed"` from `terraform/environments/dev/main.tf`
- Remove any references to this module in other resources

**Out of scope:**

- IAM changes for srt-service (2-4)
- srt-service module removal (2-4)
- Keep pubsub_media_cleanup

## Required Approach

1. Remove module "pubsub_transcription_completed" block
2. Remove any depends_on references to it
3. Verify media_cleanup module untouched

## Step Checklist

- [ ] Remove `module "pubsub_transcription_completed"` from main.tf
- [ ] Remove depends_on references to pubsub_transcription_completed
- [ ] Verify `module "pubsub_media_cleanup"` is preserved
- [ ] Run `terraform fmt -recursive`
- [ ] Run `terraform validate`

## Definition of Done

- No reference to pubsub_transcription_completed in terraform
- pubsub_media_cleanup preserved
- `terraform validate` passes

## Verification Commands

```bash
cd terraform
grep -r "pubsub_transcription_completed" . && echo "FAIL: Still has references" || echo "OK: No references"
grep -r "pubsub_media_cleanup" . && echo "OK: Media cleanup preserved"
terraform fmt -check -recursive
terraform validate
```

## Rollback Plan

```bash
git checkout -- terraform/
```
