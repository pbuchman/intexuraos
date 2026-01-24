# Task 2-0: Service Layer Integration

**Tier**: 2 (Dependent/Integrative)
**Dependencies**: Tasks 1-0, 1-1, 1-2, 1-3

## Purpose

Integrate the summary field into the service layer and persistence (Firestore).

## Files to Review/Modify

- `apps/whatsapp-service/src/domain/whatsapp/models/WhatsAppMessage.ts`
- `apps/whatsapp-service/src/usecases/transcribeAudio.ts` (if exists)
- Any use cases that handle `TranscriptionCompletedEvent`

## Implementation Steps

### 1. Update Firestore Schema (if needed)

Review `WhatsAppMessage` domain model to ensure it can store the summary:

```typescript
// Check if transcription object exists and can be extended
export interface WhatsAppMessage {
  // ... existing fields
  transcription?: {
    text: string;
    summary?: string; // Add if not present
    apiCalls: TranscriptionApiCall[];
  };
}
```

### 2. Update Use Case

Ensure `TranscribeAudioUseCase` passes through the summary:

```typescript
// When storing transcription result
const message = await this.messageRepo.update(messageId, {
  transcription: {
    text: result.text,
    summary: result.summary, // Pass through summary
    apiCalls: existingApiCalls.concat(result.apiCall),
  },
});
```

### 3. Verify Event Propagation

Check that `TranscriptionCompletedEvent` (if used) includes summary:

```typescript
export interface TranscriptionCompletedEvent {
  messageId: string;
  transcription: {
    text: string;
    summary?: string;
  };
}
```

## Verification

- [ ] Typecheck passes
- [ ] Existing tests still pass
- [ ] New test for summary persistence

## Completion Criteria

- [ ] Summary field persisted to Firestore
- [ ] Use case passes through summary
- [ ] Events include summary if available
- [ ] Tests verify integration
