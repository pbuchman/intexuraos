# INSTRUCTIONS — 005-inline-speechmatics-transcription

## Overview

This task eliminates `srt-service` and integrates Speechmatics transcription directly into `whatsapp-service` using the domain port pattern.

## Rules and Numbering

Issue files follow `[tier]-[sequence]-[title].md` pattern:

- **Tier 0**: Setup, diagnostics, validation of pre-existing changes
- **Tier 1**: Independent deletions and implementations
- **Tier 2**: Dependent/integrative work
- **Tier 3**: Documentation and verification

## Idempotent Execution Process

1. Each issue file contains a step checklist
2. Steps are atomic and can be re-run safely
3. Verification commands confirm completion
4. Rollback plan provided for each issue

## Ledger Semantics

- `CONTINUITY.md` is the single source of truth
- Every decision logged with reasoning
- State tracks Done/Now/Next
- Open questions flagged until resolved

## Resume Procedure After Interruption

1. Read `CONTINUITY.md`
2. Check current state (Now)
3. Continue from that point
4. Append to ledger (never overwrite)

## Task Tiers

### Tier 0 — Validation

- `0-0-validate-preconditions.md` — Verify repo state, validate pre-existing changes

### Tier 1 — Independent Deliverables

- `1-0-domain-types-and-port.md` — Finalize TranscriptionState types and SpeechTranscriptionPort
- `1-1-speechmatics-adapter.md` — Implement SpeechmaticsTranscriptionAdapter
- `1-2-delete-srt-service.md` — Delete apps/srt-service entirely
- `1-3-delete-srt-client.md` — Delete whatsapp-service/infra/srt
- `1-4-delete-transcription-worker.md` — Delete transcription Pub/Sub worker
- `1-5-remove-transcription-pubsub-terraform.md` — Remove transcription Pub/Sub from terraform

### Tier 2 — Integrative Work

- `2-0-update-webhook-routes.md` — Integrate transcription into audio message processing
- `2-1-update-message-repository.md` — Update Firestore adapter for TranscriptionState
- `2-2-update-services-container.md` — Wire new adapter, remove old SRT client
- `2-3-update-api-docs-hub.md` — Remove SRT service from API docs aggregator
- `2-4-update-terraform-iam-and-secrets.md` — Update IAM, add secrets to whatsapp-service
- `2-5-update-root-configs.md` — Update tsconfig.json, package.json references

### Tier 3 — Documentation and Verification

- `3-0-test-coverage.md` — Ensure tests pass, coverage thresholds met
- `3-1-update-documentation.md` — Update README, architecture docs, Cloud Run risks

## Verification Commands

```bash
# After all code changes
npm run ci

# After terraform changes
cd terraform && terraform fmt -check -recursive && terraform validate
```

## Success Metrics

1. No references to `srt-service` in codebase
2. No transcription-related Pub/Sub (media-cleanup preserved)
3. Audio messages trigger in-process transcription
4. WhatsApp reply sent with transcript or error
5. All tests pass, coverage thresholds met
6. Terraform validates
