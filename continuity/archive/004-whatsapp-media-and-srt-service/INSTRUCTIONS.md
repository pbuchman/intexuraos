# INSTRUCTIONS — WhatsApp Media Support + srt-service

## Overview

This task implements WhatsApp audio/image message support with a new srt-service for speech transcription.

---

## Task Numbering

Files follow `[tier]-[sequence]-[title].md` pattern:

| Tier | Description                                           |
| ---- | ----------------------------------------------------- |
| 0    | Setup/Infrastructure (Terraform, scaffolding)         |
| 1    | Independent deliverables (ports, adapters, utilities) |
| 2    | Integration (webhook processing, routes, workers)     |
| 3    | UI integration (web app components)                   |
| 4    | Verification (test coverage)                          |
| 5    | Documentation                                         |
| 6    | Final verification                                    |

---

## Execution Order

Execute tasks in tier order. Within a tier, follow sequence number.

### Tier 0: Infrastructure

- 0-0: Enforce max_scale = 1 for existing services
- 0-1: Create WhatsApp Media Bucket Terraform Module
- 0-2: Create Pub/Sub Terraform Module
- 0-3: Scaffold srt-service with Terraform

### Tier 1: Independent Deliverables

- 1-0: Extend WhatsAppMessage Model
- 1-1: Add GCS Media Storage Port/Adapter
- 1-2: Add Thumbnail Generation Service
- 1-3: Add Pub/Sub Publisher to whatsapp-service
- 1-4: Add WhatsApp Media Download Client
- 1-5: Implement srt-service Domain Layer
- 1-6: Implement srt-service Infrastructure Layer

### Tier 2: Integration

- 2-0: Extend Webhook for Image Messages
- 2-1: Extend Webhook for Audio Messages + Publish Event
- 2-2: Add Message Media Routes (Signed URLs)
- 2-3: Implement Message Deletion with Async Cleanup
- 2-4: Implement srt-service Routes
- 2-5: Implement srt-service Audio Event Worker
- 2-6: Implement srt-service Polling Worker

### Tier 3: UI Integration

- 3-0: Update Web App for Media Display

### Tier 4: Verification

- 4-0: Test Coverage for whatsapp-service Media
- 4-1: Test Coverage for srt-service

### Tier 5: Documentation

- 5-0: Documentation Updates

### Tier 6: Final

- 6-0: Final CI Verification and Terraform Apply

---

## Idempotent Execution

Each task is designed to be idempotent:

- Check if changes already exist before applying
- Use deterministic identifiers
- Handle "already exists" as success

---

## Ledger Semantics

CONTINUITY.md tracks:

- **Goal**: Overall objective and success criteria
- **Constraints**: Design decisions and assumptions
- **State**: Done / Now / Next
- **Reasoning**: Why decisions were made

Update after each completed task.

---

## Resume Procedure

1. Read CONTINUITY.md
2. Check State section for current task
3. Continue from "Now" or first incomplete task
4. Update ledger on completion

---

## Verification Commands

```bash
# After each code change
npm run typecheck
npm run lint

# After Terraform changes
cd terraform/environments/dev
terraform fmt -check -recursive
terraform validate

# Final verification
npx prettier --write .
npm run ci
```

---

## Key Design Decisions

1. **Signed URLs** for all media access (no public bucket)
2. **Pub/Sub** for async orchestration (no direct service calls)
3. **Pull subscriptions** for worker control
4. **Own job IDs** in srt-service (not external Speechmatics IDs)
5. **Exponential backoff** for Speechmatics polling (5s → 1h max)
6. **DLQ** for cleanup failures (5 retries)
7. **min_scale = 1** for srt-service (continuous polling)
8. **max_scale = 1** for all services (cost control)
