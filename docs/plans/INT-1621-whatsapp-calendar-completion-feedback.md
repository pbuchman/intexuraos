# WhatsApp Calendar Completion Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure successful WhatsApp calendar auto-executions send a completion message to users whose WhatsApp notification preference is `important`.

**Architecture:** The calendar event creation path already succeeds: WhatsApp webhook -> `commands-agent` -> `actions-agent` -> `calendar-agent` -> Google Calendar. The fix is in the completion-notification branch of `actions-agent`: mark calendar completion WhatsApp messages as important so `whatsapp-service` does not drop them for important-only users. Keep the existing `whatsapp-service` preference filter unchanged.

**Tech Stack:** TypeScript, Fastify, Pub/Sub emulator, Firestore, Google Calendar API, vitest, `@intexuraos/whatsapp-pubsub-client`.

---

## Investigation Evidence

The incident happened on the dev environment around `2026-05-09T07:51Z`.

| Evidence | Observation | Impact |
|----------|-------------|--------|
| `whatsapp_webhook_events/0d20d074-d2c5-4664-b97e-c6c4285918f3` | Webhook status `completed`, received `2026-05-09T07:51:08.808Z`, processed `2026-05-09T07:51:09.772Z`. | Meta webhook receipt and async processing worked. |
| `whatsapp_messages/2165f4c3-d8dd-4e33-811e-10f973f2e160` | Message was saved with the incident WhatsApp message ID and text. | The incoming message was not lost. |
| `commands/whatsapp_text:wamid...` | Classified as `calendar` with confidence `0.95`, status `classified`, action `50ea9225-067f-40be-95c6-28cc5424c1c8`. | Command classification worked and crossed the auto-execute threshold. |
| `actions/50ea9225-067f-40be-95c6-28cc5424c1c8` | Status `completed`, payload includes `resource_url` and message `Event "Pakowanie na wyjazd" created successfully`. | `actions-agent` considered the calendar action successful. |
| `calendar_processed_actions/50ea9225-067f-40be-95c6-28cc5424c1c8` | Stored event ID `1l0mm9g05e7fn1jrjkv9nmqcrk` and Google Calendar URL. | `calendar-agent` persisted idempotency evidence for the created event. |
| Google Calendar API lookup | Event exists with status `confirmed`, summary `Pakowanie na wyjazd`, start `2026-05-13T20:15:00+02:00`, end `2026-05-13T21:15:00+02:00`. | The calendar event was created successfully. |
| `whatsapp_notification_preferences/google-oauth2|113131655542389277022` | `notificationLevel` is `important`. | Non-important outbound WhatsApp messages are dropped. |
| `whatsapp_outbound_messages` | No outbound message was saved for `calendar-complete-50ea9225-067f-40be-95c6-28cc5424c1c8`. | The user did not receive the completion CTA, making successful creation look like a no-op. |

## Root Cause

`executeCalendarAction` publishes the post-success WhatsApp completion message without `important: true`. For users whose notification preference is `important`, `whatsapp-service` treats absent `important` as non-important and drops the send before calling the WhatsApp sender or saving `whatsapp_outbound_messages`.

The event creation path is healthy; the broken behavior is missing user feedback after calendar auto-execution.

## Endpoint Changes

- **Modified:** None.
- **Created:** None.
- **Removed:** None.
- **Unchanged:** `POST /internal/whatsapp/pubsub/send-message` keeps the existing important-only filtering contract. `POST /internal/actions/process` and `POST /internal/calendar/process-action` keep their request and response contracts.

## Files

- Modify: `apps/actions-agent/src/domain/usecases/executeCalendarAction.ts`
  - Add `important: true` to the calendar completion `whatsappPublisher.publishSendMessage(...)` call.
- Modify: `apps/actions-agent/src/__tests__/executeCalendarAction.test.ts`
  - Add a regression test proving calendar completion messages are published with `important: true`.
  - Extend one existing completion-message assertion if it keeps the test suite smaller.
- Read-only audit: `apps/actions-agent/src/domain/usecases/*.ts`
  - Audit all `publishSendMessage(...)` call sites and confirm the calendar completion case is the only required code change for this incident.

### Task 1: Add Regression Test For Calendar Completion Importance

**Files:**
- Modify: `apps/actions-agent/src/__tests__/executeCalendarAction.test.ts`

- [ ] **Step 1: Add the failing test**

Add this test near the existing `publishes WhatsApp notification with Google Calendar URL on success` test:

```typescript
  it('marks calendar completion WhatsApp notification as important', async () => {
    const action = createAction({ status: 'awaiting_approval' });
    await fakeActionRepo.save(action);

    const usecase = createExecuteCalendarActionUseCase({
      actionRepository: fakeActionRepo,
      calendarServiceClient: fakeCalendarClient,
      whatsappPublisher: fakeWhatsappPublisher,
      webAppUrl: 'https://app.test.com',
      logger: createMockLogger(),
    });

    await usecase('action-123');

    const messages = fakeWhatsappPublisher.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.correlationId).toBe('calendar-complete-action-123');
    expect(messages[0]?.important).toBe(true);
  });
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
pnpm --filter @intexuraos/actions-agent test -- executeCalendarAction.test.ts
```

Expected: FAIL because `messages[0]?.important` is `undefined`.

### Task 2: Mark Calendar Completion Notifications Important

**Files:**
- Modify: `apps/actions-agent/src/domain/usecases/executeCalendarAction.ts`

- [ ] **Step 1: Update the calendar completion publish call**

Change the success notification publish block to include `important: true`:

```typescript
      const publishResult = await whatsappPublisher.publishSendMessage({
        userId: action.userId,
        message: whatsappMessage,
        ctaUrl: { displayText: 'View in Calendar', url: fullUrl },
        correlationId: `calendar-complete-${actionId}`,
        important: true,
      });
```

- [ ] **Step 2: Run the focused test and confirm it passes**

Run:

```bash
pnpm --filter @intexuraos/actions-agent test -- executeCalendarAction.test.ts
```

Expected: PASS.

### Task 3: Audit Related WhatsApp Notification Call Sites

**Files:**
- Read: `apps/actions-agent/src/domain/usecases/*.ts`
- Optional modify only if the audit finds the same incident pattern in another calendar completion path: `apps/actions-agent/src/domain/usecases/approval/*.ts`

- [ ] **Step 1: List all Actions Agent WhatsApp publishes**

Run:

```bash
rg -n "publishSendMessage\\(" apps/actions-agent/src/domain/usecases
```

Expected: The list includes `handleActionTemplate.ts`, `executeCalendarAction.ts`, `executeActionTemplate.ts`, `executeLinkAction.ts`, `executeCodeAction.ts`, and approval handlers.

- [ ] **Step 2: Classify each call site**

Use this checklist:

```text
approval request: already important or must remain important
calendar completion after external write: important
calendar failure/error notification: important if present
non-calendar bookmark/link completion: leave unchanged unless there is direct evidence users expect it under important-only preferences
code task operational state notification: leave unchanged in this issue unless existing tests already assert importance
```

- [ ] **Step 3: Add tests only for changed call sites**

If the audit finds another calendar completion path that sends WhatsApp without `important: true`, add an adjacent regression test using the local fake publisher and then apply the same one-line fix. Do not broaden the issue to unrelated notification categories.

### Task 4: Verify The Existing WhatsApp Filter Contract Still Holds

**Files:**
- Read: `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`

- [ ] **Step 1: Run the relevant WhatsApp service tests**

Run:

```bash
pnpm --filter @intexuraos/whatsapp-service test -- pubsubRoutes.test.ts
```

Expected: PASS. Existing tests should continue to prove:

```text
level='important' and important=true delivers
level='important' and important absent drops
level='important' and important=false drops
```

- [ ] **Step 2: Run the actions-agent workspace verification**

Run:

```bash
pnpm run verify:workspace:tracked -- actions-agent
```

Expected: PASS.

- [ ] **Step 3: Run tracked CI before commit**

Run:

```bash
pnpm run ci:tracked
```

Expected: PASS.

## Manual Verification After Deployment

After the fix reaches dev:

- Send a WhatsApp message that classifies as a high-confidence calendar action.
- Confirm Firestore has a new `calendar_processed_actions/{actionId}` document with `eventId` and `resourceUrl`.
- Confirm Google Calendar has the created event.
- Confirm `whatsapp_outbound_messages` has a new document with `correlationId = calendar-complete-{actionId}`.
- Confirm WhatsApp receives the completion CTA even when `whatsapp_notification_preferences/{userId}.notificationLevel` is `important`.

## Key Decisions

- Keep `whatsapp-service` important-only filtering unchanged; it behaved as designed.
- Treat calendar completion after an external Google Calendar write as important user feedback.
- Keep the implementation scoped to `actions-agent` unless the audit finds another calendar completion path with the same missing flag.

## Risks

- Important-only users will receive calendar completion messages that were previously filtered. This is intended for externally visible calendar writes.
- If Pub/Sub delivery itself is unhealthy, this fix will not mask that issue. The manual verification checks `whatsapp_outbound_messages` to distinguish filtering from delivery failure.
