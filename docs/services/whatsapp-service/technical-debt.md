# WhatsApp Service — Technical Debt

**Last Updated:** 2026-03-15
**Analysis Run:** v3.3.0 documentation refresh (v8 ignore test replacement INT-799, silent dispatch fix INT-810/811)

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 1     | Low      |
| Test Coverage Gaps  | 0     | —        |
| TypeScript Issues   | 0     | —        |
| SRP Violations      | 1     | Medium   |
| Code Duplicates     | 0     | —        |
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

### Medium Priority

| File                      | Issue                                      | Impact                                          |
| ------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `routes/webhookRoutes.ts` | processWebhookEvent accepts FastifyRequest | Coupling between Pub/Sub handler and HTTP layer |

**Details:** The `processWebhookEvent` function is exported for use by the Pub/Sub endpoint but still accepts `FastifyRequest` instead of a plain payload object. This creates unnecessary coupling and makes unit testing harder. There is also a TODO comment in the code acknowledging this issue.

**Suggested Fix:** Refactor to accept a typed payload object directly, with the route handler extracting the necessary fields from the request.

---

## Test Coverage

### Current Status

All endpoints and use cases have test coverage. The service maintains >95% coverage threshold.

### Coverage Areas

- Routes: Fully tested (webhook, message, mapping, pubsub, verification)
- Use cases: All covered (processAudioMessage, processImageMessage, handleTranscriptionCompleted, extractLinkPreviews)
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
- `messageRoutes.test.ts` — Message CRUD operations
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

No `@ts-ignore`, `@ts-expect-error`, or `any` types found.

---

## SRP Violations

### Medium Priority

| File                      | Issue                                               | Suggestion                                                 |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| `routes/webhookRoutes.ts` | Handles webhook validation, routing, and 5 handlers | Extract handleTextMessage, handleButtonMessage to usecases |

**Details:** `webhookRoutes.ts` contains:

- Webhook validation logic
- Message type routing (text, image, audio, button/interactive)
- Text message handling with reply/approval detection
- Button response handling with intent parsing (7 valid intents)
- Image and audio message handlers (delegating to usecases)

**Suggested Fix:** Extract `handleTextMessage` and `handleButtonMessage` into domain usecases for better testability and separation of concerns.

---

## Code Duplicates

### None Significant

Minor duplication exists in test setup code across test files (fakes, mocks), which is acceptable for test isolation.

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
