# Task 1-3: Update Tests

**Tier**: 1 (Independent Deliverable)
**Dependencies**: Tasks 1-1, 1-2 (adapter changes)

## Purpose

Update test suite to verify new functionality: custom vocabulary, summarization config, and json-v2 response parsing.

## Files to Modify

- `apps/whatsapp-service/src/__tests__/infra/speechmaticsAdapter.test.ts`

## Test Updates

### 1. Update `submitJob` Tests

Add verification for `additional_vocab` and `summarization_config`:

```typescript
it('passes additional vocabulary in transcription config', async () => {
  mockCreateTranscriptionJob.mockResolvedValue({ id: 'job-123' });

  await adapter.submitJob({
    audioUrl: 'https://storage.example.com/audio.ogg',
    mimeType: 'audio/ogg',
  });

  expect(mockCreateTranscriptionJob).toHaveBeenCalledWith(
    { url: 'https://storage.example.com/audio.ogg' },
    expect.objectContaining({
      transcription_config: expect.objectContaining({
        additional_vocab: expect.any(Array),
      }),
    })
  );
});

it('passes summarization config', async () => {
  mockCreateTranscriptionJob.mockResolvedValue({ id: 'job-123' });

  await adapter.submitJob({
    audioUrl: 'https://storage.example.com/audio.ogg',
    mimeType: 'audio/ogg',
  });

  expect(mockCreateTranscriptionJob).toHaveBeenCalledWith(
    { url: 'https://storage.example.com/audio.ogg' },
    expect.objectContaining({
      summarization: expect.objectContaining({
        type: 'bullets',
        length: 'brief',
      }),
    })
  );
});
```

### 2. Update `getTranscript` Tests

Add tests for json-v2 response parsing:

```typescript
describe('getTranscript with json-v2', () => {
  it('returns text and summary when present', async () => {
    const mockJsonV2Response = {
      summary: { content: 'Summary of the audio' },
      results: [{ alternatives: [{ content: 'Hello' }] }, { alternatives: [{ content: 'world' }] }],
    };
    mockGetJobResult.mockResolvedValue(mockJsonV2Response);

    const result = await adapter.getTranscript('job-123');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('Hello world');
      expect(result.value.summary).toBe('Summary of the audio');
    }

    expect(mockGetJobResult).toHaveBeenCalledWith('job-123', 'json-v2');
  });

  it('returns text without summary when summary missing', async () => {
    const mockJsonV2Response = {
      results: [{ alternatives: [{ content: 'No summary here' }] }],
    };
    mockGetJobResult.mockResolvedValue(mockJsonV2Response);

    const result = await adapter.getTranscript('job-456');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('No summary here');
      expect(result.value.summary).toBeUndefined();
    }
  });

  it('handles empty results array', async () => {
    mockGetJobResult.mockResolvedValue({
      results: [],
    });

    const result = await adapter.getTranscript('job-empty');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('');
    }
  });

  it('handles missing alternatives in results', async () => {
    mockGetJobResult.mockResolvedValue({
      results: [
        { alternatives: [{ content: 'Valid' }] },
        { alternatives: [] }, // No alternatives
        {}, // Missing alternatives key
      ],
    });

    const result = await adapter.getTranscript('job-malformed');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('Valid');
    }
  });
});
```

### 3. Add Coverage for Vocabulary

Test that key vocabulary terms are included:

```typescript
it('includes IntexuraOS in additional vocabulary', async () => {
  mockCreateTranscriptionJob.mockResolvedValue({ id: 'job-123' });

  await adapter.submitJob({
    audioUrl: 'https://storage.example.com/audio.ogg',
    mimeType: 'audio/ogg',
  });

  const config = mockCreateTranscriptionJob.mock.calls[0][1];
  const vocab = config.transcription_config.additional_vocab;

  const intexuraEntry = vocab.find((v: { content: string }) => v.content === 'IntexuraOS');
  expect(intexuraEntry).toBeDefined();
  expect(intexuraEntry.sounds_like).toEqual(expect.arrayContaining(['in tex ura o s']));
});
```

## Completion Criteria

- [ ] All existing tests still pass
- [ ] New tests for `additional_vocab` configuration
- [ ] New tests for `summarization_config` configuration
- [ ] New tests for json-v2 response parsing
- [ ] New tests for edge cases (missing summary, empty results, malformed data)
- [ ] Coverage at 95%
