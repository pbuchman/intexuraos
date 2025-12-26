# 2-1: Update Message Repository

**Tier:** 2 (Dependent/Integrative)

**Depends on:** 1-0

## Context Snapshot

The Firestore adapter for WhatsAppMessageRepository needs to handle the new TranscriptionState structure.

Current signature:

```ts-example
updateTranscription(userId, messageId, { transcriptionJobId, transcriptionStatus, transcription? })
```

New signature:

```ts-example
updateTranscription(userId, messageId, transcription: TranscriptionState)
```

## Problem Statement

Update Firestore adapter to persist full TranscriptionState object.

## Scope

**In scope:**

- `apps/whatsapp-service/src/adapters.ts` (MessageRepositoryAdapter)
- Firestore field mapping for transcription

**Out of scope:**

- Port definition (1-0, already done)

## Required Approach

1. Update MessageRepositoryAdapter.updateTranscription to accept TranscriptionState
2. Map TranscriptionState to Firestore document fields
3. Handle nested objects (error, lastApiCall)

## Step Checklist

- [ ] Update MessageRepositoryAdapter.updateTranscription signature
- [ ] Update Firestore update call to use transcription field
- [ ] Ensure nested objects serialized correctly
- [ ] Run `npm run typecheck`

## Definition of Done

- Repository adapter accepts TranscriptionState
- Firestore document updated with all fields
- TypeScript compiles

## Verification Commands

```bash
npm run typecheck
grep -A 30 "updateTranscription" apps/whatsapp-service/src/adapters.ts
```

## Rollback Plan

```bash
git checkout -- apps/whatsapp-service/src/adapters.ts
```
