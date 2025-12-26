# 2-0: Update Webhook Routes

**Tier:** 2 (Dependent/Integrative)

**Depends on:** 1-0, 1-1

## Context Snapshot

`apps/whatsapp-service/src/routes/v1/webhookRoutes.ts` contains `processAudioMessage()` which currently:

1. Uploads audio to GCS
2. Saves message to Firestore
3. Calls srt-service HTTP API to create/submit job

Need to replace with in-process async transcription.

## Problem Statement

Integrate transcription directly into audio message processing with fire-and-forget background task.

## Scope

**In scope:**

- Update `processAudioMessage()` to start background transcription
- Create `transcribeAudioAsync()` function for background processing
- Implement polling loop
- Send WhatsApp reply on completion/failure
- Quote original audio message in reply

**Out of scope:**

- Domain types (1-0)
- Adapter implementation (1-1)
- services.ts wiring (2-2)

## Required Approach

1. After saving message to Firestore, update transcription status to 'pending'
2. Fire-and-forget: `void transcribeAudioAsync(...)`
3. Background function:
   - Submit job to Speechmatics
   - Poll until done/rejected (with timeout)
   - Fetch transcript
   - Update message in Firestore
   - Send WhatsApp reply quoting original message

## Step Checklist

- [ ] Create `transcribeAudioAsync()` function
- [ ] Implement Speechmatics job submission
- [ ] Implement polling with exponential backoff
- [ ] Implement transcript fetching
- [ ] Implement Firestore update with TranscriptionState
- [ ] Implement WhatsApp reply (success case)
- [ ] Implement WhatsApp reply (failure case)
- [ ] Update `processAudioMessage()` to call transcribeAudioAsync
- [ ] Add comprehensive logging for all steps
- [ ] Run `npm run typecheck`

## Definition of Done

- Audio messages trigger background transcription
- All steps logged
- Firestore updated with full TranscriptionState
- WhatsApp reply sent quoting original message
- TypeScript compiles

## Verification Commands

```bash
npm run typecheck
grep -A 20 "transcribeAudioAsync" apps/whatsapp-service/src/routes/v1/webhookRoutes.ts
```

## Rollback Plan

```bash
git checkout -- apps/whatsapp-service/src/routes/v1/webhookRoutes.ts
```
