# Task 1-1: Add Custom Vocabulary Support

**Tier**: 1 (Independent Deliverable)
**Dependencies**: Task 1-0 (domain types updated)

## Purpose

Configure Speechmatics `additional_vocab` to improve recognition of IntexuraOS and domain-specific terms.

## Files to Modify

- `apps/whatsapp-service/src/infra/speechmatics/adapter.ts`

## Vocabulary Definition

Create a constant array with domain terms. The full vocabulary list from `1-1-implementation-plan.md` includes:

```typescript
const ADDITIONAL_VOCAB = [
  {
    content: 'IntexuraOS',
    sounds_like: ['in tex ura o s', 'in tech sura o s', 'inteksura os', 'in texture os'],
  },
  { content: 'pbuchman', sounds_like: ['p buck man', 'p book man', 'piotr buchman'] },
  { content: 'pnpm', sounds_like: ['p n p m', 'pin pm', 'pee en pee em', 'performant npm'] },
  { content: 'tf', sounds_like: ['tea eff', 'terraform'] },
  { content: 'gh', sounds_like: ['gee aitch', 'git hub'] },
  { content: 'ci:tracked', sounds_like: ['see eye tracked', 'c i tracked'] },
  // ... (full list in implementation plan)
] as const;
```

## Implementation

### Update `submitJob` Method

Modify the transcription config to include vocabulary:

```typescript
const response = await this.client.createTranscriptionJob(
  { url: input.audioUrl },
  {
    transcription_config: {
      language: input.language ?? 'auto',
      operating_point: 'enhanced',
      additional_vocab: ADDITIONAL_VOCAB,
    },
  }
);
```

## Rationale

- **Hardcoded vs Configurable**: Simpler to start with hardcoded; can be made configurable later
- **sounds_like**: Improves recognition by providing common mispronunciations
- **Enhanced Operating Point**: Already using; better accuracy with custom vocabulary

## Verification

Tests should verify the vocabulary is passed through:

```typescript
expect(mockCreateTranscriptionJob).toHaveBeenCalledWith(
  { url: input.audioUrl },
  expect.objectContaining({
    transcription_config: expect.objectContaining({
      additional_vocab: expect.any(Array),
    }),
  })
);
```

## Completion Criteria

- [ ] `ADDITIONAL_VOCAB` constant defined with domain terms
- [ ] `submitJob` passes `additional_vocab` to API
- [ ] Tests verify vocabulary configuration
- [ ] Typecheck passes
