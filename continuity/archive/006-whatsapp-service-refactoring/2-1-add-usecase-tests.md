# 2-1: Add Tests for New Usecases

## Tier

2 (Dependent on Tier 1)

## Context

New usecases need unit tests to maintain 90% coverage.

## Problem Statement

Extracted usecases have no dedicated tests yet:

- ProcessImageMessageUseCase
- ProcessAudioMessageUseCase
- TranscribeAudioUseCase
- ProcessIncomingMessageUseCase

Coverage thresholds: lines=90%, branches=90%, functions=90%, statements=90%

## Scope

Create test files:

- `__tests__/usecases/processImageMessage.test.ts`
- `__tests__/usecases/processAudioMessage.test.ts`
- `__tests__/usecases/transcribeAudio.test.ts`
- `__tests__/usecases/processIncomingMessage.test.ts`

## Non-Scope

- Route integration tests (existing tests should still work)
- Modifying fakes.ts (unless needed for new ports)

## Required Approach

1. Create fake implementations for new ports (if needed)
2. Test happy paths
3. Test error cases
4. Test edge cases
5. Ensure branch coverage

## Test Categories per Usecase

### ProcessImageMessageUseCase

- Happy path: full image processing
- Error: media URL fetch fails
- Error: download fails
- Error: thumbnail generation fails
- Error: GCS upload fails
- Error: message save fails

### ProcessAudioMessageUseCase

- Happy path: full audio processing
- Error: media URL fetch fails
- Error: download fails
- Error: GCS upload fails
- Error: message save fails

### TranscribeAudioUseCase

- Happy path: job completes
- Error: signed URL fails
- Error: job submission fails
- Error: job rejected
- Error: polling timeout
- Error: transcript fetch fails

### ProcessIncomingMessageUseCase

- Text message: happy path
- Image message: delegates correctly
- Audio message: delegates correctly
- No sender phone number
- Unsupported message type
- User not mapped
- User disconnected

## Step Checklist

- [x] Add fakes for new ports (if needed) - not needed, using mocks
- [x] Create test file structure
- [x] Implement ProcessImageMessageUseCase tests
- [x] Implement ProcessAudioMessageUseCase tests
- [x] Implement TranscribeAudioUseCase tests
- [ ] Implement ProcessIncomingMessageUseCase tests - SKIPPED (see 1-4)
- [ ] Run coverage check - CI verification blocked, terminal unresponsive

## Definition of Done

- All usecases have tests
- 90% coverage maintained
- `npm run test:coverage` passes

## Verification Commands

```bash
npm run test:coverage
```

## Rollback Plan

Delete test files if needed
