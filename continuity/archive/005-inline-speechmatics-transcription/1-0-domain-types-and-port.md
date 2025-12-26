# 1-0: Domain Types and Port

**Tier:** 1 (Independent Deliverable)

## Context Snapshot

Domain layer needs:

- `TranscriptionState` type on WhatsAppMessage
- `SpeechTranscriptionPort` interface for provider abstraction

Pre-existing changes may have partially completed this.

## Problem Statement

Finalize domain types and port interface to enable provider-agnostic transcription.

## Scope

**In scope:**

- `apps/whatsapp-service/src/domain/inbox/models/WhatsAppMessage.ts`
- `apps/whatsapp-service/src/domain/inbox/ports/transcription.ts`
- `apps/whatsapp-service/src/domain/inbox/ports/repositories.ts`
- `apps/whatsapp-service/src/domain/inbox/index.ts`

**Out of scope:**

- Adapter implementation (1-1)
- Repository implementation (2-1)

## Required Approach

1. Ensure TranscriptionState has all required fields
2. Ensure SpeechTranscriptionPort has submit/poll/getTranscript methods
3. Ensure repository port has updated signature
4. Ensure all types exported from index

## Step Checklist

- [ ] Verify/fix TranscriptionState in WhatsAppMessage.ts
- [ ] Verify/fix SpeechTranscriptionPort in transcription.ts
- [ ] Verify/fix updateTranscription signature in repositories.ts
- [ ] Verify/fix exports in index.ts
- [ ] Run `npm run typecheck`

## Definition of Done

- All domain types defined per spec
- TypeScript compiles
- Types exported correctly

## Verification Commands

```bash
npm run typecheck
grep -r "TranscriptionState" apps/whatsapp-service/src/domain/
grep -r "SpeechTranscriptionPort" apps/whatsapp-service/src/domain/
```

## Rollback Plan

```bash
git checkout -- apps/whatsapp-service/src/domain/inbox/
```
