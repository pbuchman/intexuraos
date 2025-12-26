# CONTINUITY LEDGER — WhatsApp Media Support + srt-service

**Task ID:** 004-whatsapp-media-and-srt-service  
**Created:** 2025-12-26  
**Status:** 🔄 PLANNING_COMPLETE

---

## Goal

Implement WhatsApp audio/image message support with:

1. Private GCS bucket for media storage (signed URL access only)
2. Thumbnail generation (256px max edge, using sharp)
3. Pub/Sub event-driven architecture for async workflows
4. New srt-service for Speechmatics transcription with background polling
5. Web app media display (thumbnails, modal, HTML5 audio player)

**Success Criteria:**

- WhatsApp webhook accepts text, image, and audio messages
- Media stored in private GCS bucket with deterministic paths
- Thumbnails generated and stored for images
- Browser accesses media via short-lived signed URLs only
- Message deletion triggers async cleanup with DLQ
- srt-service receives audio events via Pub/Sub pull subscription
- srt-service creates jobs with own IDs, polls Speechmatics with exponential backoff
- All services max_scale = 1 (cost control)
- CI passes, Terraform validates

---

## Constraints / Assumptions

- Media path: `whatsapp/{userId}/{messageId}/{mediaId}.{ext}`
- Thumbnails: `whatsapp/{userId}/{messageId}/{mediaId}_thumb.{ext}`
- Thumbnail size: 256px max on longest edge
- Signed URL TTL: short-lived (e.g., 15 minutes)
- Cleanup: Pub/Sub with 5 retry attempts, then DLQ
- srt-service polling: exponential backoff 5s → 10s → 20s → ... → max 1h
- srt-service requires min_scale = 1 for continuous polling worker
- All other services: max_scale = 1
- Phase 1: no Speechmatics webhooks, polling only
- Phase 1: no media retention TTL (delete only on user action)

---

## Key Decisions

| Timestamp  | Decision                          | Rationale                                                |
| ---------- | --------------------------------- | -------------------------------------------------------- |
| 2025-12-26 | Signed URLs for media access      | Browser never gets bucket creds; supports range requests |
| 2025-12-26 | sharp for thumbnail generation    | Server-side in whatsapp-service; 256px max edge          |
| 2025-12-26 | Pub/Sub for async orchestration   | Decoupled services; whatsapp → srt via events            |
| 2025-12-26 | Pull subscription for srt-service | Worker controls acking, retries, idempotency             |
| 2025-12-26 | DLQ for cleanup failures          | 5 retries, then dead-letter for inspection               |
| 2025-12-26 | Background polling worker         | Continuous; requires min_scale = 1                       |
| 2025-12-26 | Own srtJobId                      | Strong idempotency; one job per (messageId, mediaId)     |

---

## Reasoning Narrative

User requirements specify event-driven architecture with Pub/Sub as backbone. Initial plan had direct service calls; revised to Pub/Sub after clarification. Thumbnail generation in-service (not Cloud Function) to avoid additional infra complexity. Pull subscription chosen over push to give srt-service full control over message processing and acking. Exponential backoff for Speechmatics polling avoids rate limiting while ensuring timely status updates.

---

## Task Breakdown

### Tier 0: Infrastructure

| Task | Title                                         | Status  | Dependencies |
| ---- | --------------------------------------------- | ------- | ------------ |
| 0-0  | Enforce max_scale = 1 for existing services   | ✅ DONE | -            |
| 0-1  | Create WhatsApp Media Bucket Terraform Module | ✅ DONE | -            |
| 0-2  | Create Pub/Sub Terraform Module               | ✅ DONE | -            |
| 0-3  | Scaffold srt-service with Terraform           | ✅ DONE | -            |

### Tier 1: Independent Deliverables

| Task | Title                                      | Status  | Dependencies |
| ---- | ------------------------------------------ | ------- | ------------ |
| 1-0  | Extend WhatsAppMessage Model               | ✅ DONE | -            |
| 1-1  | Add GCS Media Storage Port/Adapter         | ✅ DONE | -            |
| 1-2  | Add Thumbnail Generation Service           | ✅ DONE | -            |
| 1-3  | Add Pub/Sub Publisher to whatsapp-service  | ✅ DONE | -            |
| 1-4  | Add WhatsApp Media Download Client         | ✅ DONE | -            |
| 1-5  | Implement srt-service Domain Layer         | ✅ DONE | 0-3          |
| 1-6  | Implement srt-service Infrastructure Layer | ✅ DONE | 1-5          |

### Tier 2: Integration

| Task | Title                                             | Status  | Dependencies       |
| ---- | ------------------------------------------------- | ------- | ------------------ |
| 2-0  | Extend Webhook for Image Messages                 | ✅ DONE | 1-0, 1-1, 1-2, 1-4 |
| 2-1  | Extend Webhook for Audio Messages + Publish Event | ✅ DONE | 1-0, 1-1, 1-3, 1-4 |
| 2-2  | Add Message Media Routes (Signed URLs)            | ✅ DONE | 1-0, 1-1, 2-0, 2-1 |
| 2-3  | Implement Message Deletion with Async Cleanup     | ✅ DONE | 1-0, 1-1, 1-3      |
| 2-4  | Implement srt-service Routes                      | ✅ DONE | 1-5, 1-6           |
| 2-5  | Implement srt-service Audio Event Worker          | ✅ DONE | 1-5, 1-6, 2-4      |
| 2-6  | Implement srt-service Polling Worker              | ✅ DONE | 1-5, 1-6           |

### Tier 3: UI Integration

| Task | Title                            | Status  | Dependencies  |
| ---- | -------------------------------- | ------- | ------------- |
| 3-0  | Update Web App for Media Display | ⬜ TODO | 2-0, 2-1, 2-2 |

### Tier 4: Verification

| Task | Title                                    | Status  | Dependencies       |
| ---- | ---------------------------------------- | ------- | ------------------ |
| 4-0  | Test Coverage for whatsapp-service Media | ⬜ TODO | 2-0, 2-1, 2-2, 2-3 |
| 4-1  | Test Coverage for srt-service            | ✅ DONE | 2-4, 2-5, 2-6      |

### Tier 5: Documentation

| Task | Title                 | Status  | Dependencies       |
| ---- | --------------------- | ------- | ------------------ |
| 5-0  | Documentation Updates | ✅ DONE | All implementation |

### Tier 6: Final

| Task | Title                 | Status  | Dependencies |
| ---- | --------------------- | ------- | ------------ |
| 6-0  | Final CI Verification | ⬜ TODO | All tasks    |

---

## State

**Done:**

- Initial planning session
- Requirements clarification (Q1-Q6 + polling question)
- Decision log populated
- Task breakdown complete
- Tier 0 complete (0-0, 0-1, 0-2, 0-3)
- Tier 1 complete (1-0 through 1-6)
- Task 2-0: Extend Webhook for Image Messages
- Task 2-1: Extend Webhook for Audio Messages + Publish Event
- Task 2-2: Add Message Media Routes (Signed URLs)
- Task 2-3: Implement Message Deletion with Async Cleanup
- Task 2-4: Implement srt-service Routes
- Task 2-5: Implement srt-service Audio Event Worker
- Task 2-6: Implement srt-service Polling Worker
- Task 4-1: Test Coverage for srt-service
- Task 5-0: Documentation Updates

**Now:**

- All backend implementation complete
- Tier 3 (Web UI) and Tier 4 (whatsapp-service tests) remaining

**Next:**

- Task 3-0: Update Web App for Media Display
- Task 4-0: Test Coverage for whatsapp-service Media

---

## Open Questions

None — all design ambiguities resolved.

---

## Working Set

Files to create/modify:

- `terraform/modules/whatsapp-media-bucket/`
- `terraform/modules/pubsub/`
- `terraform/environments/dev/main.tf`
- `apps/whatsapp-service/src/domain/inbox/models/WhatsAppMessage.ts`
- `apps/whatsapp-service/src/infra/gcs/`
- `apps/whatsapp-service/src/infra/pubsub/`
- `apps/whatsapp-service/src/infra/media/`
- `apps/whatsapp-service/src/workers/`
- `apps/srt-service/` (new service)
- `apps/web/src/pages/WhatsAppNotesPage.tsx`
- `apps/web/src/components/ImageModal.tsx`
- `apps/web/src/components/AudioPlayer.tsx`
- `docs/architecture/api-contracts.md`
- `CHANGELOG.md`
