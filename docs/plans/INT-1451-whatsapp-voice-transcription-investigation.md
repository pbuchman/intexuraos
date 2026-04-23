# INT-1451 — WhatsApp Voice Message Transcription: Investigation & Fix Plan

**Linear:** [INT-1451](https://linear.app/pbuchman/issue/INT-1451/investigate-and-resolve-missing-transcriptions-for-whatsapp-voice)
**Environment scope:** dev (`dev.intexuraos.cloud` home-dev PM2) — same bug latent in Cloud Run / Hetzner prod.
**Goal:** Diagnose why 3 WhatsApp voice messages in dev were stored but never transcribed, fix the silent-failure path, and verify transcription end-to-end.

---

## 1. Observed Symptom

User sent three WhatsApp voice messages to the WhatsApp Business number whose webhook is configured for the **dev** environment. The messages did not produce transcriptions, yet adjacent flows (bookmarks, summaries, plain text commands) continue to work. The Speechmatics transcription worker shows **no execution logs since it was deployed on 2026-03-07** in dev GCP.

## 2. Evidence Collected

| #   | Evidence                                                                                                                                                                                                                                                                                                                                                                                              | Source                                                                                                                             | Interpretation                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Cloud Function `intexuraos-transcription-dev` has only `NOTICE` logs at `2026-03-07T01:35/01:37` (deploy events). No invocations in the last 90 days.                                                                                                                                                                                                                                                 | `gcloud functions describe` + `gcloud logging read 'resource.labels.function_name="intexuraos-transcription-dev"' --freshness=90d` | The function is active and wired, but no event ever reaches it.                                                                                      |
| E2  | Eventarc push subscription `eventarc-europe-central2-intexuraos-transcription-dev-206068-sub-607` is `ACTIVE` on topic `intexuraos-audio-stored-dev`, pushing to the Cloud Run URL with OIDC.                                                                                                                                                                                                         | `gcloud pubsub subscriptions list --filter=topic:intexuraos-audio-stored-dev`                                                      | The delivery pipe from the topic to the worker is healthy. Nothing is being published into the topic.                                                |
| E3  | Dev Cloud Run `intexuraos-whatsapp-service` receives only `/internal/whatsapp/pubsub/send-message` traffic. No `/webhook` or `/internal/whatsapp/pubsub/process-webhook` requests in the last 3 days.                                                                                                                                                                                                 | `gcloud logging read 'resource.labels.service_name="intexuraos-whatsapp-service"'` filtered by `jsonPayload.req.url`               | Dev GCP Cloud Run is NOT the inbound webhook receiver. Webhook lands elsewhere (home-dev PM2 or prod Hetzner).                                       |
| E4  | `ProcessAudioMessageUseCase.execute()` calls `webhookEventRepository.updateEventStatus(eventId, 'completed', {})` on line 231 **before** returning.                                                                                                                                                                                                                                                   | `apps/whatsapp-service/src/domain/whatsapp/usecases/processAudioMessage.ts:230-231`                                                | The webhook event row is marked "completed" regardless of whether the downstream transcription publish succeeds.                                     |
| E5  | `handleAudioMessage` in `processWebhookEventUseCase.ts:433-454` awaits `eventPublisher.publishAudioStored(...)` AFTER the use case has already updated the event status. On failure it only `logger.error(...)` and returns — the webhook event status is **not** reverted.                                                                                                                           | `apps/whatsapp-service/src/domain/whatsapp/usecases/processWebhookEventUseCase.ts:433-454`                                         | A publish failure is silently swallowed: message exists in Firestore + GCS, typing indicator sent to user, but no audio-stored event is emitted.     |
| E6  | `BasePubSubPublisher.publishToTopic(null, …)` returns `ok(undefined)` without publishing anything when `topicName` is `null`.                                                                                                                                                                                                                                                                         | `packages/infra-pubsub/src/basePublisher.ts:52-58`                                                                                 | Missing topic configuration cannot be detected at the `handleAudioMessage` level — it looks like success.                                            |
| E7  | `ecosystem.config.cjs:96-97` fallback is `INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC = 'audio-stored-dev'`, but the actual GCP topic is `intexuraos-audio-stored-dev`. Peer topics use the same broken pattern: `'approval-reply'` vs `intexuraos-approval-reply-dev`, `'commands-ingest'` vs `intexuraos-commands-ingest-dev`, `'whatsapp-webhook-process'` vs `intexuraos-whatsapp-webhook-process-dev`.  | `ecosystem.config.cjs:94-99`; `gcloud pubsub topics list`                                                                          | If the home-dev shell does not export the correct env var, the fallback points to a non-existent topic, producing `TOPIC_NOT_FOUND` on publish.      |
| E8  | `apps/whatsapp-service/src/index.ts:29` includes `INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC` in `REQUIRED_ENV`, so the service refuses to start without it.                                                                                                                                                                                                                                                | `apps/whatsapp-service/src/index.ts:11-34`                                                                                         | If home-dev is up at all, the variable is defined — but it may still point at a non-existent topic via the fallback.                                 |
| E9  | `workers/transcription/src/index.ts:74-78` publishes completion events to `INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC` which in dev is set to `intexuraos-transcription-completed-dev`. However the Hetzner-prod push subscription only exists on `intexuraos-srt-transcription-completed-dev`. The dev-push subscription exists on **both** topics, pointing to dev Cloud Run whatsapp-service. | `gcloud functions describe intexuraos-transcription-dev`; `gcloud pubsub subscriptions list`                                       | A latent second bug: completions emitted from the Cloud Function would not reach the Hetzner prod Whatsapp service once this flow is fixed for prod. |

### Where the webhook actually lands

Only two targets have subscriptions for WhatsApp-related topics in this GCP project:

- `…-cj44trunra-lm.a.run.app` — dev Cloud Run services (receives `send-message`, `process-webhook-push`, `media-cleanup`, etc.).
- `intexuraos.cloud` — prod Hetzner (receives `…-prod-hetzner` subscriptions).

There is **no** Pub/Sub subscription that pushes to `dev.intexuraos.cloud` (home-dev PM2). Home-dev only receives inbound HTTP directly from Meta's webhook when the Meta app is configured to call `dev.intexuraos.cloud/api/whatsapp/webhook`. Whichever environment is currently pointed at by Meta (per user: dev) performs the audio-stored publish — and that publish has to succeed for transcription to run on the Cloud Function.

## 3. Likely Root Causes (ranked)

1. **Silent publish failure (E4–E6).** The webhook event is marked `completed` before the `audio.stored` publish is even attempted, and a failed publish is swallowed with a log line. This is the primary architectural bug: it guarantees missing transcriptions cannot be observed from the webhook-event state.
2. **Dev topic-name fallback mismatch (E7).** If home-dev's shell env is missing `INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC`, the ecosystem fallback resolves to `audio-stored-dev`, which does not exist in GCP → `TOPIC_NOT_FOUND` on every audio message. This must be verified by inspecting the live env on home-dev.
3. **Latent completed-topic mismatch (E9).** Once (1) is fixed, transcription results will land on `intexuraos-transcription-completed-dev`; only dev Cloud Run has a consumer for that topic — prod Hetzner would miss them. This is not causing today's dev symptom but must be fixed before shipping.

## 4. Endpoint Changes

No new HTTP endpoints.

- **Modified:** `POST /internal/whatsapp/pubsub/process-webhook` (whatsapp-service) — audio branch returns failure when publish fails; webhook event transitions to `failed` instead of `completed` when the audio-stored publish is rejected.
- **Created:** none.
- **Removed:** none.
- **Unchanged:** all outbound `/internal/whatsapp/*` routes, `/webhook`, transcription worker CloudEvent entrypoint.

## 5. Remediation Tasks

Each task is independently committable. Tests always precede implementation.

### Task 1 — Confirm live-env topic binding on home-dev

**Goal:** Rule out / confirm E7. Not a code change; produces the data we need to pick the correct fix for Tasks 2 and 3.

**Files:**
- Read-only on home-dev: `pm2 env <whatsapp-service-id>` or `/proc/<pid>/environ` grep.

- [ ] **Step 1:** SSH to home-dev and dump the env for the whatsapp-service PM2 process:

```bash
pm2 jlist | jq '.[] | select(.name=="whatsapp-service") | .pm2_env | {INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC, INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC, INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC, INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC}'
```

- [ ] **Step 2:** Record the values in the INT-1451 Linear comment. Three outcomes:
  - All four values are `intexuraos-*-dev` → home-dev env is correct; root cause is the silent failure in Task 2.
  - `INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC=audio-stored-dev` (or any non-existent topic) → Task 3 is required in addition to Task 2.
  - Values differ across services → separate config drift ticket.

- [ ] **Step 3:** Also dump Firestore for the three affected messages to confirm they hit step 4 of `ProcessAudioMessageUseCase`:

```bash
gcloud firestore documents list --database='(default)' --collection=whatsapp_messages \
  --filter='userId="<user-id>" AND mediaType="audio"' \
  --order-by='receivedAt desc' --limit=5 \
  --project=intexuraos-dev-pbuchman
```

Verify: the messages have `gcsPath`, `mediaType="audio"`, and a linked `webhookEventId` whose `status="completed"`. If `status="failed"` with `failureDetails` then a different upstream step failed (image-service style errors); Task 2 already handles the success-but-no-transcription case.

### Task 2 — Make audio-stored publish failure a hard failure

**Files:**
- Modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/processAudioMessage.ts` (add event publishing inside the use case).
- Modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/processWebhookEventUseCase.ts:396-455` (stop publishing here; rely on the use case).
- Modify: `apps/whatsapp-service/src/domain/whatsapp/ports/mediaStorage.ts`: no change.
- Modify: the `ProcessAudioMessageDeps` interface to require `eventPublisher: Pick<EventPublisherPort, 'publishAudioStored'>`.
- Test: `apps/whatsapp-service/src/__tests__/usecases/processAudioMessage.test.ts` (existing file — extend).
- Test: `apps/whatsapp-service/src/__tests__/webhookAsyncProcessing.test.ts` — update the audio branch expectations.

- [ ] **Step 1: Write the failing test — publish failure must mark the event `failed`.**

Add to `apps/whatsapp-service/src/__tests__/usecases/processAudioMessage.test.ts` (create if missing — pattern matches `processImageMessage.test.ts`):

```typescript
import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { ProcessAudioMessageUseCase } from '../../domain/whatsapp/usecases/processAudioMessage.js';

describe('ProcessAudioMessageUseCase — audio-stored publish', () => {
  it('marks webhook event failed when publishAudioStored fails', async () => {
    const updateEventStatus = vi.fn(async () => ok(undefined));
    const deps = {
      webhookEventRepository: { updateEventStatus },
      messageRepository: { saveMessage: vi.fn(async () => ok({ id: 'msg-1' })) },
      mediaStorage: { upload: vi.fn(async () => ok({ gcsPath: 'u/1/m-1.ogg' })) },
      whatsappCloudApi: {
        getMediaUrl: vi.fn(async () => ok({ url: 'https://example/audio' })),
        downloadMedia: vi.fn(async () => ok(Buffer.from('abc'))),
      },
      eventPublisher: {
        publishAudioStored: vi.fn(async () =>
          err({ code: 'TOPIC_NOT_FOUND', message: 'Topic audio-stored-dev not found' })
        ),
      },
    } as unknown as ConstructorParameters<typeof ProcessAudioMessageUseCase>[0];

    const usecase = new ProcessAudioMessageUseCase(deps);
    const result = await usecase.execute(
      {
        eventId: 'evt-1',
        userId: 'u1',
        waMessageId: 'wam-1',
        fromNumber: '111',
        toNumber: '222',
        timestamp: '2026-04-23T00:00:00Z',
        senderName: null,
        phoneNumberId: null,
        audioMedia: { id: 'media-1', mimeType: 'audio/ogg' },
      },
      { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
    );

    expect(result.ok).toBe(false);
    expect(updateEventStatus).toHaveBeenCalledWith(
      'evt-1',
      'failed',
      expect.objectContaining({
        failureDetails: expect.stringContaining('Topic audio-stored-dev not found'),
      })
    );
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails (use case does not publish yet).**

```bash
pnpm --filter @intexuraos/whatsapp-service test -- processAudioMessage
```

Expected: FAIL with `updateEventStatus` called with `'completed'`, not `'failed'`, or the test errors because `eventPublisher` is not part of `ProcessAudioMessageDeps`.

- [ ] **Step 3: Move the publish into the use case and make it a hard failure.**

Change `ProcessAudioMessageDeps` to include:

```typescript
export interface ProcessAudioMessageDeps {
  webhookEventRepository: WhatsAppWebhookEventRepository;
  messageRepository: WhatsAppMessageRepository;
  mediaStorage: MediaStoragePort;
  whatsappCloudApi: WhatsAppCloudApiPort;
  eventPublisher: Pick<EventPublisherPort, 'publishAudioStored'>;
}
```

In `execute()`, replace the block at lines 230-242 with:

```typescript
// Step 5: Publish audio.stored BEFORE marking webhook as completed.
// A failed publish is a hard failure — we must not lose the transcription trigger.
const publishResult = await this.deps.eventPublisher.publishAudioStored({
  type: 'whatsapp.audio.stored',
  userId,
  messageId: saveResult.value.id,
  mediaId: audioMedia.id,
  gcsPath: uploadResult.value.gcsPath,
  mimeType: audioMedia.mimeType,
  timestamp: new Date().toISOString(),
});

if (!publishResult.ok) {
  const failureDetails = `Failed to publish audio.stored: ${publishResult.error.message}`;
  logger.error(
    { event: 'audio_publish_failed', eventId, error: publishResult.error },
    failureDetails
  );
  await webhookEventRepository.updateEventStatus(eventId, 'failed', { failureDetails });
  return err({ code: 'INTERNAL_ERROR', message: failureDetails });
}

// Step 6: Mark webhook event as completed only after publish succeeded.
await webhookEventRepository.updateEventStatus(eventId, 'completed', {});
```

- [ ] **Step 4: Remove the now-duplicate publish block from `processWebhookEventUseCase.handleAudioMessage` (lines 433-454).**

The wrapper becomes:

```typescript
const usecase = new ProcessAudioMessageUseCase({
  webhookEventRepository,
  messageRepository,
  mediaStorage,
  whatsappCloudApi,
  eventPublisher,
});

const result = await usecase.execute({ … }, logger);

if (result.ok) {
  await this.markAudioAsReadWithTyping(payload, savedEvent, whatsappCloudApi, logger);
}
```

- [ ] **Step 5: Update the existing `webhookAsyncProcessing.test.ts` audio expectations** so a successful flow still calls `updateEventStatus(..., 'completed', ...)` exactly once, and add a case for publish failure mirroring Step 1.

- [ ] **Step 6: Run `pnpm run verify:workspace:tracked -- whatsapp-service`.**

Expected: PASS. Coverage must remain ≥95%.

- [ ] **Step 7: Commit.**

```bash
git add apps/whatsapp-service/src
git commit -m "[INT-1451] Fail audio webhook when audio.stored publish fails"
```

### Task 3 — Fix dev ecosystem topic-name fallbacks

Only required if Task 1 Step 2 reveals home-dev is using the broken fallbacks. Even if not, the fallbacks are a landmine: align them to the Terraform-managed names.

**Files:**
- Modify: `ecosystem.config.cjs:76-100` (whatsapp-service env block).

- [ ] **Step 1: Update the fallbacks to match Terraform:**

```javascript
INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC:
  process.env.INTEXURAOS_PUBSUB_MEDIA_CLEANUP_TOPIC ?? 'intexuraos-whatsapp-media-cleanup-dev',
INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC:
  process.env.INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC ?? 'intexuraos-commands-ingest-dev',
INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION:
  process.env.INTEXURAOS_PUBSUB_MEDIA_CLEANUP_SUBSCRIPTION ?? 'intexuraos-whatsapp-media-cleanup-dev-push',
INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC:
  process.env.INTEXURAOS_PUBSUB_WEBHOOK_PROCESS_TOPIC ?? 'intexuraos-whatsapp-webhook-process-dev',
INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC:
  process.env.INTEXURAOS_PUBSUB_AUDIO_STORED_TOPIC ?? 'intexuraos-audio-stored-dev',
INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC:
  process.env.INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC ?? 'intexuraos-approval-reply-dev',
INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC:
  process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_TOPIC ?? 'intexuraos-whatsapp-send-dev',
INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION:
  process.env.INTEXURAOS_PUBSUB_WHATSAPP_SEND_SUBSCRIPTION ?? 'intexuraos-whatsapp-send-dev-push',
```

Confirm each name against `terraform/environments/dev/main.tf`. If the Terraform name disagrees, Terraform wins.

- [ ] **Step 2: Restart whatsapp-service on home-dev** (via the existing deploy path — do not reach into PM2 manually).

```bash
ssh home-dev 'cd intexuraos && git pull && pm2 restart whatsapp-service --update-env'
```

- [ ] **Step 3: Send a single WhatsApp voice note from the dev-bound number and verify in sequence:**
  - `pm2 logs whatsapp-service` shows `Publishing audio stored event to Pub/Sub` with `topic: intexuraos-audio-stored-dev`.
  - `gcloud logging read 'resource.labels.function_name="intexuraos-transcription-dev"' --freshness=10m` shows an invocation with `event: transcription_start`.
  - Cloud Run whatsapp-service receives `POST /internal/whatsapp/pubsub/transcription-completed`.
  - The Firestore `whatsapp_messages` document for the voice note now has `transcription.text` set.

- [ ] **Step 4: Commit.**

```bash
git add ecosystem.config.cjs
git commit -m "[INT-1451] Align PM2 topic fallbacks with terraform-managed names"
```

### Task 4 — Tighten `publishToTopic` contract for required topics

Make the silent-success path in `BasePubSubPublisher.publishToTopic(null, …)` impossible to reach for topics that must always be configured. Today all callers that legitimately tolerate `null` are optional fire-and-forget (link preview, commands ingest for some variants); `publishAudioStored` and `publishApprovalReply` must not.

**Files:**
- Modify: `packages/infra-pubsub/src/basePublisher.ts`.
- Modify: `apps/whatsapp-service/src/infra/pubsub/publisher.ts` — make `audioStoredTopic` non-optional.
- Modify: `apps/whatsapp-service/src/services.ts` — require `audioStoredTopic` in `ServiceConfig`.
- Modify: `apps/whatsapp-service/src/config.ts` — drop `.optional()` from `audioStoredTopic`.
- Modify: `apps/whatsapp-service/src/server.ts` (wiring).
- Test: `apps/whatsapp-service/src/__tests__/infra/pubsubPublisher.test.ts` (existing).

- [ ] **Step 1: Write the failing test — constructor should throw when required topic missing.**

```typescript
it('throws when audioStoredTopic is undefined', () => {
  expect(() =>
    new GcpPubSubPublisher({
      projectId: 'p',
      mediaCleanupTopic: 'mc',
      // audioStoredTopic intentionally omitted
      logger,
    } as any)
  ).toThrow(/audioStoredTopic/);
});
```

- [ ] **Step 2: Run it.** Expected: FAIL (no validation today).

- [ ] **Step 3: Change `GcpPubSubPublisherConfig.audioStoredTopic` and `approvalReplyTopic` to required `string`.** Update the constructor to validate and throw if missing. Update call sites in `services.ts` so that `buildPubSubConfig` always passes these values (config module already marks them `REQUIRED_ENV`).

- [ ] **Step 4: Change `publishToTopic` signature** to `topicName: string` (drop nullability). Add a new `publishToOptionalTopic(topicName: string | null, …)` used only by genuinely optional callers (`publishExtractLinkPreviews`, `publishCommandIngest` if we keep it optional — audit each call site).

- [ ] **Step 5: Run `pnpm run ci:tracked`.** Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/infra-pubsub apps/whatsapp-service
git commit -m "[INT-1451] Make critical Pub/Sub topics non-nullable at the type level"
```

### Task 5 — Consolidate transcription-completed topic

**Files:**
- Modify: `terraform/environments/dev/main.tf` — remove legacy `intexuraos-transcription-completed-dev` topic + subscriptions once traffic has migrated.
- Modify: Cloud Function env var `INTEXURAOS_PUBSUB_TRANSCRIPTION_COMPLETED_TOPIC` → `intexuraos-srt-transcription-completed-dev`.
- Modify: `workers/transcription/src/types.ts` — no code change beyond doc reference.

- [ ] **Step 1: Verify on both topics `intexuraos-transcription-completed-dev` and `intexuraos-srt-transcription-completed-dev` that the `-dev-push` subscription points to dev Cloud Run whatsapp-service. Only keep one.**

```bash
gcloud pubsub subscriptions list --project=intexuraos-dev-pbuchman \
  --filter='topic:transcription-completed' \
  --format='value(name,topic,pushConfig.pushEndpoint)'
```

- [ ] **Step 2: Terraform: update `transcription-completed` topic var on the Cloud Function to the `srt-` name, apply, and deploy the function. Remove the legacy topic resource (and its DLQ) after one clean audio transcription succeeds on the new name.**

- [ ] **Step 3: Verify prod Hetzner whatsapp-service receives `POST /internal/whatsapp/pubsub/transcription-completed` when the next prod voice note is transcribed** (this was the latent gap in E9). Prod is out of scope for today's fix but this step unblocks it.

- [ ] **Step 4: Commit.**

```bash
git add terraform workers/transcription
git commit -m "[INT-1451] Consolidate transcription-completed onto srt- topic"
```

### Task 6 — Add observability for publish failures

**Files:**
- Modify: `packages/infra-pubsub/src/basePublisher.ts` — when publish fails, emit a Sentry breadcrumb + `logger.error` with structured fields `{topic, code, context}` so an alert policy can fire on `severity:ERROR AND jsonPayload.event="audio_publish_failed"`.
- Add: a GCP alert policy in `terraform/environments/dev/main.tf` (and prod counterpart) that triggers when `count(jsonPayload.event="audio_publish_failed") > 0 over 5 minutes`.

- [ ] **Step 1: Confirm `@intexuraos/infra-sentry` exposes `addBreadcrumb`.** Read `packages/infra-sentry/src/index.ts`; if it does not, add a minimal passthrough (out of scope otherwise).

- [ ] **Step 2: In `basePublisher.ts` catch block, emit the breadcrumb before returning `err(...)`.**

- [ ] **Step 3: Author the alert policy in Terraform** (log-based metric + `google_monitoring_alert_policy`).

- [ ] **Step 4: Commit.**

```bash
git add packages/infra-pubsub terraform
git commit -m "[INT-1451] Alert on whatsapp audio.stored publish failures"
```

## 6. Verification Plan

After Tasks 1–4 land and are deployed to home-dev:

1. Send a fresh voice note to the dev-bound WhatsApp number.
2. Inside 10 seconds, `pm2 logs whatsapp-service` must show the `audio_processed` log followed by `Successfully published audio stored event`.
3. Inside 30 seconds, `gcloud logging read 'resource.labels.function_name="intexuraos-transcription-dev"' --freshness=5m` must show `transcription_start` through `transcription_completed`.
4. Inside 60 seconds, the Firestore message document has a populated `transcription.text` and `transcription.detectedLanguage`.
5. Replay one of the three original failed messages (same GCS path) through the transcription topic manually:

```bash
gcloud pubsub topics publish intexuraos-audio-stored-dev \
  --project=intexuraos-dev-pbuchman \
  --message='{"type":"whatsapp.audio.stored","userId":"<uid>","messageId":"<msgId>","mediaId":"<mediaId>","gcsPath":"<gcsPath>","mimeType":"audio/ogg","timestamp":"2026-04-23T12:00:00Z"}'
```

and confirm the transcription Cloud Function runs end-to-end.

## 7. Out of Scope

- Prod Hetzner env — same fixes apply but must be shipped separately once dev is stable.
- Adding a retry DLQ subscription on `intexuraos-audio-stored-dev` (the function already retries per its `retryPolicy: RETRY_POLICY_RETRY`). Revisit only if repeated publish failures are seen after Task 6 ships.
- Replacing Speechmatics with another provider.

## 8. Risks

- Task 2 changes behavior: audio webhooks that previously silently succeeded will now mark the webhook event as `failed` when the publish path is broken. This is intentional (visibility) but will spike the `failed` count until the upstream config is corrected. Task 1 must run first so we know whether Task 3 is needed before Task 2 is deployed.
- Task 4 is a type-narrowing change; if any caller in another app passes `undefined` for `audioStoredTopic` we will break their build. Grep for `GcpPubSubPublisher(` across `apps/` first.
- Task 5 touches Terraform and a Cloud Function redeploy — must be run by a human with prod access; the plan stops at proposing the change.
