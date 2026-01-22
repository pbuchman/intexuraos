# Task 1-0: Update Domain Types

**Tier**: 1 (Independent Deliverable)
**Dependencies**: None

## Purpose

Add optional `summary` field to the transcription domain model to support AI-generated summaries from Speechmatics.

## Files to Modify

- `apps/whatsapp-service/src/domain/whatsapp/ports/transcription.ts`

## Changes

### 1. Update `TranscriptionTextResult` Interface

Add optional `summary` field:

```typescript
export interface TranscriptionTextResult {
  /**
   * The transcribed text.
   */
  text: string;

  /**
   * Optional AI-generated summary of the audio content.
   * Only available when using transcription providers that support summarization.
   */
  summary?: string;

  /**
   * API call details for tracking.
   */
  apiCall: TranscriptionApiCall;
}
```

## Rationale

- **Backward Compatible**: Optional field maintains existing contract
- **Port Interface**: Correct layer for domain model changes
- **Consumer Agnostic**: Implementation details hidden behind port

## Verification

Run typecheck to ensure no breaking changes:

```bash
pnpm run typecheck -- whatsapp-service
```

## Completion Criteria

- [ ] `TranscriptionTextResult` has `summary?: string` field
- [ ] Typecheck passes (no existing consumers broken)
- [ ] Tests updated (if any existing tests reference this type)
