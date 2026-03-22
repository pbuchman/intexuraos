# WhatsApp Service — Technical Debt

**Last Updated:** 2026-03-22
**Analysis Run:** v3.4.0 documentation refresh

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 0     | —        |
| Test Coverage Gaps  | 0     | —        |
| TypeScript Issues   | 0     | —        |
| SRP Violations      | 1     | Medium   |
| Code Duplicates     | 1     | Low      |
| Deprecations        | 0     | —        |
| **Total**           | **2** | —        |

---

## Future Plans

### Planned Features

Features that are planned but not yet implemented:

- **Telegram support** — Add Telegram as an additional messaging channel
- **SMS support** — Add SMS as fallback messaging channel
- **Message threading** — Group related messages into conversation threads
- **Video support** — Handle video messages (currently ignored)
- **Multi-phone per user** — Allow users to connect multiple WhatsApp numbers

### Proposed Enhancements

1. Retry mechanism for failed message deliveries
2. Message read receipts tracking
3. Approval message expiration notifications

---

## Code Smells

### None Significant

No silent catch blocks, no console.log usage, no module-level state issues. The previous medium-priority code smell (processWebhookEvent coupling to FastifyRequest) was resolved in v3.4.0 by extracting `ProcessWebhookEventUseCase` into the domain layer (INT-880).

---

## Test Coverage

### Current Status

All endpoints and use cases have test coverage. The service maintains >95% coverage threshold.

### Coverage Areas

- Routes: Fully tested (webhook, message, message media, mapping, pubsub, verification)
- Use cases: All covered (ProcessWebhookEventUseCase, processAudioMessage, processImageMessage, handleTranscriptionCompleted, extractLinkPreviews)
- Infrastructure: Tested via routes and dedicated infra tests
- Approval reply handling, OutboundMessage tracking
- Phone verification, interactive buttons
- No-nonce buttons, reject intent, read receipts on button click
- Event-driven transcription via srt-service, CTA URL messages

### Test Files

Located in `apps/whatsapp-service/src/__tests__/`:

- `webhookAsyncProcessing.test.ts` — Async webhook processing including button responses
- `webhookReceiver.test.ts` — Webhook HMAC signature validation and receipt
- `webhookVerification.test.ts` — Webhook hub challenge verification
- `messageRoutes.test.ts` — Message list operations
- `messageMediaRoutes.test.ts` — Media URL, thumbnail URL, message deletion
- `mappingRoutes.test.ts` — User phone number mapping (with verification gate)
- `pubsubRoutes.test.ts` — Pub/Sub event handlers (including interactive messages, CTA URL, transcription-completed)
- `verificationRoutes.test.ts` — Phone verification send/confirm/status
- `shared.test.ts` — Shared utility functions (extractButtonResponse with button_reply fix)
- `usecases/processAudioMessage.test.ts` — Audio download and GCS storage
- `usecases/processImageMessage.test.ts` — Image download, thumbnail, GCS storage
- `usecases/handleTranscriptionCompleted.test.ts` — srt-service event handling (INT-684)
- `usecases/extractLinkPreviews.test.ts` — Link preview extraction
- `infra/phoneVerificationRepository.test.ts` — Verification repository
- `infra/sender.test.ts` — WhatsApp sender (sendTextMessage, sendInteractiveMessage, sendCtaUrlMessage)
- `infra/**/*.test.ts` — Other infra implementations

---

## TypeScript Issues

### None Detected

No `@ts-ignore`, `@ts-expect-error`, or `any` types found in production code.

---

## SRP Violations

### Medium Priority

| File                                                         | Issue                                     | Suggestion                                                                |
| ------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------- |
| `domain/whatsapp/usecases/processWebhookEventUseCase.ts`     | Handles routing + 4 message type handlers | Extract handleTextMessage and handleButtonMessage into separate use cases |

**Details:** `processWebhookEventUseCase.ts` contains:

- Message type validation and routing (text, image, audio, button/interactive, reaction)
- Text message handling with reply/approval detection and command.ingest publishing
- Button response handling with intent parsing (7 valid intents)
- Image and audio message delegation to sub-use cases
- Read receipt management

The image and audio handlers already delegate to dedicated use cases (`ProcessImageMessageUseCase`, `ProcessAudioMessageUseCase`). Extracting text and button handlers into their own use cases would complete the pattern.

**Context:** This was partially addressed in v3.4.0 — INT-880 moved the function from `webhookRoutes.ts` into a proper use case class. The remaining step is splitting the internal handlers.

---

## Code Duplicates

### Low Priority

| Pattern                    | Locations                                                 | Suggestion                              |
| -------------------------- | --------------------------------------------------------- | --------------------------------------- |
| Pub/Sub auth detection     | `pubsubRoutes.ts` (4 handlers share identical auth block) | Extract into shared middleware function |

**Details:** Each Pub/Sub handler in `pubsubRoutes.ts` repeats the same `from: noreply@google.com` detection and `validateInternalAuth` fallback logic. This is a minor duplication since the pattern is stable and well-tested, but extracting it into a shared middleware would reduce boilerplate.

---

## Deprecations

### None Detected

No deprecated APIs or dependencies in use. Speechmatics direct dependency was removed in INT-684; transcription is now handled by srt-service.

---

## Race Condition Fixes

### INT-201: Duplicate Actions from Approval Replies

**Issue:** When a user replied to an approval message, both `action.approval.reply` AND `command.ingest` events were published, causing duplicate action creation.

**Fix (fc3f8663):** When a text message is a reply to an approval message with a known actionId:

1. Extract actionId from correlationId
2. Publish only `action.approval.reply` with the actionId
3. Skip publishing `command.ingest`

**Status:** Resolved

### INT-212: Publish Approval Reply Only When actionId Found

**Issue:** ApprovalReplyEvents were published even when the replied-to message wasn't an approval message, causing unnecessary processing.

**Fix (01c99b31):** Only publish `action.approval.reply` when:

1. OutboundMessage exists for the replyToWamid
2. CorrelationId matches approval pattern: `action-{type}-approval-{actionId}`

**Status:** Resolved

---

## Resolved Issues

### Historical Issues

| Date       | Issue                                                             | Resolution                                                                  |
| ---------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 2026-03-19 | v8-ignore overrides entry for whatsapp-service                    | Standardized format and removed override (INT-989)                          |
| 2026-03-18 | messageRoutes.ts handled listing, media, and deletion             | Split into messageRoutes.ts and messageMediaRoutes.ts (INT-883)             |
| 2026-03-17 | Duplicated HTTP patterns in sender.ts                             | Extracted shared request helpers (INT-882)                                  |
| 2026-03-16 | processWebhookEvent coupled to FastifyRequest                     | Extracted into ProcessWebhookEventUseCase in domain layer (INT-880)         |
| 2026-03-15 | v8 ignore blocks in sender and pubsub/webhook routes              | Replaced with real tests (INT-858, INT-860)                                 |
| 2026-03-10 | v8 ignore blocks in sender, repository, routes                    | Replaced with real tests across 5 files (INT-799)                           |
| 2026-03-10 | Silent dispatch failures swallowed by Pub/Sub publish             | Fixed dispatch error surfacing and nested transaction issue (INT-810/811)   |
| 2026-03-06 | Speechmatics direct dependency creates tight coupling             | INT-684: Migrated to event-driven transcription via srt-service             |
| 2026-03-06 | PR notifications lacked actionable links                          | Added CTA URL message support for deep links to PRs and dashboards          |
| 2026-02-15 | SPEECHMATICS_API_KEY non-standard naming                          | Renamed to SPEECHMATICS_APP_API_KEY convention (later removed entirely)     |
| 2026-02-09 | Interactive button extraction failed with button_reply type       | Accept both "button" and "button_reply" in extractButtonResponse            |
| 2026-02-09 | Nonce requirement created friction without clear security benefit | Remove nonces from button IDs (INT-524)                                     |
| 2026-02-09 | Emoji reactions deprecated for approvals                          | Mark as REACTION_NOT_SUPPORTED, buttons are the only approval UI            |
| 2026-02-06 | button_reply payload structure mismatch                           | Fix payload extraction for WhatsApp button responses                        |
| 2026-01-30 | Response contract violations in Pub/Sub routes                    | Migrate to reply.ok()/reply.fail() contract                                 |
| 2026-01-30 | Loggers missing Sentry integration                                | Migrate to createAppLogger from @intexuraos/infra-sentry                    |
| 2026-01-28 | OPTIONAL_ENV pattern causing startup issues                       | Remove OPTIONAL_ENV, make WHATSAPP_SEND_TOPIC optional                      |
| 2026-01-28 | Env vars not registered in REQUIRED_ENV                           | Add mandatory env var registration enforcement                              |
| 2026-01-16 | Approval events published without actionId                        | Only publish when actionId extracted                                        |
| 2026-01-14 | Duplicate actions from approval replies                           | Skip command.ingest for known approvals                                     |
| 2026-01-13 | Reactions not triggering approval flow                            | Add reaction handling (later removed)                                       |
| 2026-01-11 | No reply correlation for approval messages                        | Add OutboundMessage tracking                                                |

---

## Related

- [Features](features.md) — User-facing documentation
- [Technical](technical.md) — Developer reference
- [Tutorial](tutorial.md) — Integration guide
