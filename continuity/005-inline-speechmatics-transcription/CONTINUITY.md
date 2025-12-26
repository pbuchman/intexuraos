# CONTINUITY LEDGER — 005-inline-speechmatics-transcription

## Goal (incl. success criteria)

Eliminate `srt-service` entirely and integrate Speechmatics transcription directly into `whatsapp-service`.

**Success criteria:**
1. `apps/srt-service/` directory deleted
2. Transcription-related Pub/Sub removed (keep media-cleanup)
3. `@speechmatics/batch-client` npm package used in whatsapp-service
4. Domain port `SpeechTranscriptionPort` allows provider swapping
5. In-process async transcription: webhook returns 200, background task handles transcription
6. WhatsApp reply sent to user with transcript (quoting original audio) or error details
7. `TranscriptionState` stored in message entity with full API call tracking
8. All steps logged, all external API calls logged
9. Documentation updated including Cloud Run risks
10. `npm run ci` passes
11. `terraform fmt -check -recursive && terraform validate` passes

## Constraints / Assumptions

- Secret naming: `INTEXURAOS_SPEECHMATICS_API_KEY` (already exists)
- Keep `media-cleanup` Pub/Sub (only remove transcription-related)
- In-process async (not Cloud Tasks) — document risks
- Use npm package `@speechmatics/batch-client`, not vendored SDK
- WhatsApp reply must quote original audio message
- Notify user on both success and failure

## Key Decisions

1. **Background worker approach**: In-process async (fire-and-forget Promise after webhook returns)
   - Alternatives considered: Cloud Tasks (more reliable but adds complexity), keep Pub/Sub (contradicts requirements)
   - Rationale: User accepted Cloud Run risks; simpler implementation
   - Risk: Container may be killed before completion; documented in architecture docs

2. **TranscriptionState structure**: Agreed with user on:
   ```typescript
   interface TranscriptionState {
     status: 'pending' | 'processing' | 'completed' | 'failed';
     speechmaticsJobId?: string;
     text?: string;
     error?: { code: string; message: string; };
     lastApiCall?: { timestamp: string; operation: string; success: boolean; response?: unknown; };
     startedAt?: string;
     completedAt?: string;
   }
   ```

3. **WhatsApp reply format**: Quote original message, send transcript text on success, error details on failure

## Reasoning Narrative

### Session 1 (2024-12-26)
- Investigated codebase structure: srt-service, whatsapp-service, terraform, speechmatics-js-sdk
- Asked clarifying questions about: Pub/Sub scope, background worker approach, reply format, SDK source
- User confirmed: keep media-cleanup Pub/Sub, in-process async, quote original message, use npm package
- Started implementation but jumped ahead without creating continuity folder — PROCESS VIOLATION
- Restarting with proper continuity process

### Initial Code Changes (to be validated/reverted if needed)
- Modified `apps/whatsapp-service/src/domain/inbox/models/WhatsAppMessage.ts` — added TranscriptionState types
- Created `apps/whatsapp-service/src/domain/inbox/ports/transcription.ts` — SpeechTranscriptionPort interface
- Modified `apps/whatsapp-service/src/domain/inbox/index.ts` — exports
- Modified `apps/whatsapp-service/src/domain/inbox/ports/repositories.ts` — updated updateTranscription signature
- Installed `@speechmatics/batch-client` in whatsapp-service

## State

### Done:
- Phase 2: Task breakdown complete (17 files created)

### Now:
- WAITING FOR USER CONFIRMATION to proceed with execution

### Next:
- 0-0: Validate preconditions

## Open Questions
- (none)

## Working Set

### Files Modified (pre-process, need validation):
- `apps/whatsapp-service/src/domain/inbox/models/WhatsAppMessage.ts`
- `apps/whatsapp-service/src/domain/inbox/ports/transcription.ts` (new)
- `apps/whatsapp-service/src/domain/inbox/index.ts`
- `apps/whatsapp-service/src/domain/inbox/ports/repositories.ts`
- `apps/whatsapp-service/package.json`

### Files to Delete:
- `apps/srt-service/` (entire directory)
- `apps/whatsapp-service/src/infra/srt/`
- `apps/whatsapp-service/src/workers/transcriptionWorker.ts`
- `cloudbuild/scripts/deploy-srt-service.sh`

### Files to Modify:
- `apps/whatsapp-service/src/services.ts`
- `apps/whatsapp-service/src/config.ts`
- `apps/whatsapp-service/src/routes/v1/webhookRoutes.ts`
- `apps/api-docs-hub/src/config.ts`
- `terraform/environments/dev/main.tf`
- `terraform/modules/iam/main.tf`
- `terraform/modules/whatsapp-media-bucket/main.tf`
- `tsconfig.json`
- `README.md`
- `docs/` (architecture docs)

