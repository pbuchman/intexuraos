# WhatsApp Service - Technical Debt

**Last Updated:** 2026-01-24
**Version:** 2.0.0

---

## Summary

| Category            | Count | Severity |
| ------------------- | ----- | -------- |
| TODO/FIXME Comments | 1     | Low      |
| Test Coverage Gaps  | 0     | -        |
| TypeScript Issues   | 0     | -        |
| SRP Violations      | 1     | Medium   |
| Code Duplicates     | 0     | -        |
| Deprecations        | 0     | -        |
| **Total**           | **2** | -        |

---

## Future Plans

### Planned Features

Features that are planned but not yet implemented:

- **Telegram support** - Add Telegram as an additional messaging channel
- **SMS support** - Add SMS as fallback messaging channel
- **Message threading** - Group related messages into conversation threads
- **Video support** - Handle video messages (currently ignored)
- **Multi-phone per user** - Allow users to connect multiple WhatsApp numbers

### Proposed Enhancements

1. Firestore transactions for OutboundMessage save + WhatsApp send (atomicity)
2. Retry mechanism for failed message deliveries
3. Message read receipts tracking
4. Approval message expiration notifications

---

## Code Smells

### Medium Priority

| File                      | Issue                                      | Impact                                          |
| ------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `routes/webhookRoutes.ts` | processWebhookEvent accepts FastifyRequest | Coupling between Pub/Sub handler and HTTP layer |

**Details:** The `processWebhookEvent` function is exported for use by the Pub/Sub endpoint but still accepts `FastifyRequest` instead of a plain payload object. This creates unnecessary coupling and makes unit testing harder.

**Suggested Fix:** Refactor to accept a typed payload object directly, with the route handler extracting the necessary fields from the request.

### Low Priority

| File                          | Issue        | Impact                          |
| ----------------------------- | ------------ | ------------------------------- |
| `routes/webhookRoutes.ts:298` | TODO comment | Architectural improvement noted |

**Details:** `TODO: Refactor to accept payload directly (not FastifyRequest) for cleaner Pub/Sub integration.`

---

## Test Coverage

### Current Status

All endpoints and use cases have test coverage. The service maintains >95% coverage threshold.

### Coverage Areas

- Routes: Fully tested (webhook, message, mapping, pubsub)
- Use cases: All covered (processAudioMessage, processImageMessage, transcribeAudio)
- Infrastructure: Tested via routes
- v2.0.0 features: Approval reply handling, reaction processing, OutboundMessage tracking

### Test Files (29 total)

Located in `apps/whatsapp-service/src/__tests__/`:

- `routes/webhookRoutes.test.ts` - Webhook validation, signature verification
- `routes/messageRoutes.test.ts` - Message CRUD operations
- `routes/mappingRoutes.test.ts` - User phone number mapping
- `routes/pubsubRoutes.test.ts` - Pub/Sub event handlers
- `domain/usecases/*.test.ts` - Business logic
- `infra/**/*.test.ts` - Repository implementations

---

## TypeScript Issues

### None Detected

No `any` types, `@ts-ignore`, or `@ts-expect-error` directives found.

---

## SRP Violations

### Medium Priority

| File                      | Lines | Issue                                               | Suggestion                                                   |
| ------------------------- | ----- | --------------------------------------------------- | ------------------------------------------------------------ |
| `routes/webhookRoutes.ts` | 1077  | Handles webhook validation, routing, and 4 handlers | Extract handleTextMessage, handleReactionMessage to usecases |

**Details:** The `webhookRoutes.ts` file has grown significantly with v2.0.0 changes. It now contains:

- Webhook validation logic
- Message type routing
- Text message handling with reply/approval detection
- Reaction message handling with emoji mapping
- Image and audio message handlers (delegating to usecases)

**Suggested Fix:** Extract `handleTextMessage` and `handleReactionMessage` into domain usecases for better testability and separation of concerns.

---

## Code Duplicates

### None Significant

Minor duplication exists in test setup code across test files (fakes, mocks), which is acceptable for test isolation.

---

## Deprecations

### None Detected

No deprecated APIs or dependencies in use.

---

## Race Condition Fixes (v2.0.0)

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

| Date       | Issue                                      | Resolution                               |
| ---------- | ------------------------------------------ | ---------------------------------------- |
| 2026-01-16 | Approval events published without actionId | Only publish when actionId extracted     |
| 2026-01-14 | Duplicate actions from approval replies    | Skip command.ingest for known approvals  |
| 2026-01-13 | Reactions not triggering approval flow     | Add reaction handling with emoji mapping |
| 2026-01-11 | No reply correlation for approval messages | Add OutboundMessage tracking             |

---

## Related

- [Features](features.md) - User-facing documentation
- [Technical](technical.md) - Developer reference
- [Tutorial](tutorial.md) - Integration guide
