# WhatsApp Video Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WhatsApp video transcription for public WhatsApp and private WhatsApp video messages using the existing transcription worker pipeline.

**Architecture:** Generalize the current audio-stored transcription trigger into a media transcription request while preserving compatibility with the existing `whatsapp.audio.stored` event. Public WhatsApp video messages will be downloaded, stored in GCS, saved as `mediaType: 'video'`, and queued for transcription. Private WhatsApp video media will be accepted, stored, and queued when chat transcription is enabled.

**Tech Stack:** TypeScript, Fastify, Firestore adapters, Google Cloud Storage, Pub/Sub, Speechmatics Batch API, Vite React web app, Vitest.

## Global Constraints

- Test-first: write failing tests before implementation.
- Keep apps isolated; use existing `services.ts` DI and domain ports.
- No new persistent infrastructure unless Terraform, Pub/Sub UI, and test publisher wiring are all updated.
- No new service env vars are expected for this feature.
- Preserve compatibility with existing `whatsapp.audio.stored` messages.

---

## Endpoint Changes

**Modified**
- `POST /internal/whatsapp/private/media`: accept `video/*` uploads in addition to image/audio.
- `GET /whatsapp/messages`: include `mediaType: "video"` and transcription fields for transcribed videos.
- `GET /whatsapp/messages/:message_id/media`: already returns original media for any public stored media path; schema/docs remain valid.
- `GET /private/chats/:chatId/messages`: response shape already passes through message fields; video transcription becomes visible when stored.

**Created**
- None.

**Removed**
- None.

**Unchanged**
- `/internal/whatsapp/pubsub/transcription-completed` keeps consuming `srt.transcription.completed`.
- Existing `whatsapp.audio.stored` Pub/Sub payloads remain accepted.

## Tasks

### Task 1: Public WhatsApp Video Ingestion

**Files**
- Modify: `apps/whatsapp-service/src/routes/shared.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/models/WhatsAppMessage.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/events/events.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/ports/eventPublisher.ts`
- Modify: `apps/whatsapp-service/src/infra/pubsub/publisher.ts`
- Create or modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/processVideoMessage.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/processWebhookEventUseCase.ts`
- Test: `apps/whatsapp-service/src/__tests__/usecases/processVideoMessage.test.ts`
- Test: `apps/whatsapp-service/src/__tests__/webhookAsyncProcessing.test.ts`

**Steps**
- [ ] Write failing tests proving a public WhatsApp `video` webhook stores media, saves `mediaType: 'video'`, and publishes a transcription request with `mediaKind: 'video'`.
- [ ] Run the focused tests and verify they fail because video extraction/processing is missing.
- [ ] Add video payload extraction, public `video` media type, media transcription request event type, and publisher method.
- [ ] Implement the public video use case by following the existing audio use-case storage and hard publish-failure semantics.
- [ ] Wire `messageType === 'video'` in `ProcessWebhookEventUseCase`.
- [ ] Run focused whatsapp-service tests and keep them green.

### Task 2: Private WhatsApp Video Transcription

**Files**
- Modify: `apps/whatsapp-service/src/routes/privateMediaRoutes.ts`
- Modify: `apps/whatsapp-service/src/domain/whatsapp/usecases/ingestPrivateWhatsAppEvents.ts`
- Test: `apps/whatsapp-service/src/__tests__/privateMediaRoutes.test.ts`
- Test: `apps/whatsapp-service/src/__tests__/usecases/ingestPrivateWhatsAppEvents.test.ts`
- Test: `apps/whatsapp-service/src/__tests__/privateSyncRoutes.test.ts`

**Steps**
- [ ] Write failing tests proving private video uploads are accepted and stored.
- [ ] Write failing tests proving a stored private video in a transcription-enabled chat publishes a transcription request.
- [ ] Run focused tests and verify they fail for the expected missing behavior.
- [ ] Allow `video/*` in private media upload and add video MIME extension support.
- [ ] Publish transcription requests for private `audio` and `video`, preserving duplicate and disabled-chat behavior.
- [ ] Run focused private WhatsApp tests and keep them green.

### Task 3: Transcription Worker Contract

**Files**
- Modify: `workers/transcription/src/types.ts`
- Modify: `workers/transcription/src/handler.ts`
- Modify: `workers/transcription/src/main.ts`
- Test: `workers/transcription/src/__tests__/handler.test.ts`
- Test: `workers/transcription/src/__tests__/main.test.ts`

**Steps**
- [ ] Write failing worker tests proving `whatsapp.media.transcription.requested` with `mediaKind: 'video'` is accepted and transcribed.
- [ ] Run focused worker tests and verify they fail because only `whatsapp.audio.stored` is accepted.
- [ ] Add a generic media transcription request type while accepting legacy `whatsapp.audio.stored`.
- [ ] Rename internal language where useful without changing the function entry point `transcribeAudio`.
- [ ] Run focused transcription worker tests and keep them green.

### Task 4: Completion Handling And Intex Forwarding

**Files**
- Modify: `apps/whatsapp-service/src/domain/whatsapp/events/events.ts`
- Modify: `apps/whatsapp-service/src/routes/pubsubRoutes.ts`
- Test: `apps/whatsapp-service/src/__tests__/pubsubRoutes.test.ts`

**Steps**
- [ ] Write failing tests proving a completed public video transcript updates the message and publishes `sourceType: 'whatsapp_video_transcript'`.
- [ ] Run focused tests and verify they fail because completion always emits `whatsapp_audio_transcript`.
- [ ] Extend transcription completion events with optional `mediaKind`.
- [ ] Use message media type or event `mediaKind` to choose audio versus video transcript source type.
- [ ] Preserve private completion storage-only behavior.
- [ ] Run focused pubsub route tests and keep them green.

### Task 5: Web API And UI Type Surfaces

**Files**
- Modify: `apps/whatsapp-service/src/routes/messageRoutes.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/components/whatsapp/shared.tsx`
- Modify: `apps/web/src/components/whatsapp/MessageItem.tsx`
- Modify: `apps/web/src/pages/WhatsAppNotesPage.tsx`
- Modify: `apps/web/src/pages/PrivateWhatsAppLogPage.tsx`
- Test: existing relevant web and whatsapp-service tests.

**Steps**
- [ ] Write failing tests proving public video appears in API schemas/UI filters and private video transcript rendering is not audio-gated.
- [ ] Run focused tests and verify they fail for missing video support.
- [ ] Add `video` to public web/backend media types and filters.
- [ ] Display video transcript states wherever audio transcripts are currently displayed.
- [ ] Run focused web and whatsapp-service tests and keep them green.

### Task 6: Final Verification And PR

**Files**
- All changed files.

**Steps**
- [ ] Run `pnpm run verify:workspace:tracked -- whatsapp-service`.
- [ ] Run `pnpm run verify:workspace:tracked -- transcription`.
- [ ] Run `pnpm run verify:workspace:tracked -- web`.
- [ ] Run `pnpm run ci:tracked`.
- [ ] Inspect `git status -sb` and `git diff`.
- [ ] Commit only after `pnpm run ci:tracked` passes.
- [ ] Push branch.
- [ ] Open a draft PR targeting `development`; include `Fixes INT-XXX` only if the real issue ID is provided.
