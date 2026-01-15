# Task 1-2: Add Summarization Support

**Tier**: 1 (Independent Deliverable)
**Dependencies**: Task 1-0 (domain types updated)

## Purpose

Enable Speechmatics summarization and parse results from `json-v2` format.

## Files to Modify

- `apps/whatsapp-service/src/infra/speechmatics/adapter.ts`

## Implementation

### 1. Update `submitJob` Method

Add `summarization_config` to the job configuration:

```typescript
const response = await this.client.createTranscriptionJob(
  { url: input.audioUrl },
  {
    transcription_config: {
      language: input.language ?? 'auto',
      operating_point: 'enhanced',
      additional_vocab: ADDITIONAL_VOCAB,
    },
    summarization: {
      type: 'bullets',
      length: 'brief',
    },
  }
);
```

### 2. Update `getTranscript` Method

Switch from `'text'` to `'json-v2'` format and parse response:

```typescript
async getTranscript(
  jobId: string
): Promise<Result<TranscriptionTextResult, TranscriptionPortError>> {
  const startTime = Date.now();

  logger.info(
    { event: 'speechmatics_transcript_start', jobId },
    'Fetching transcription result'
  );

  try {
    const result = await this.client.getJobResult(jobId, 'json-v2');
    const durationMs = Date.now() - startTime;

    // Extract summary from json-v2 response
    const summary = result.summary?.content;

    // Reconstruct full text from results array
    const text = result.results
      .map((r: unknown) => {
        if (typeof r === 'object' && r !== null && 'alternatives' in r) {
          const alt = (r as { alternatives: Array<{ content: string }> }).alternatives[0];
          return alt?.content ?? '';
        }
        return '';
      })
      .join(' ');

    const apiCall = createApiCall('fetch_result', true, {
      jobId,
      transcriptLength: text.length,
      hasSummary: summary !== undefined,
    });

    logger.info(
      {
        event: 'speechmatics_transcript_success',
        jobId,
        transcriptLength: text.length,
        hasSummary: summary !== undefined,
        durationMs,
      },
      'Transcription fetched successfully'
    );

    return ok({
      text,
      summary,
      apiCall,
    });
  } catch (error) {
    // ... existing error handling
  }
}
```

## JSON-v2 Response Structure

```typescript
interface JsonV2Response {
  summary?: {
    content: string;
  };
  results: Array<{
    alternatives: Array<{
      content: string;
    }>;
  }>;
}
```

## Rationale

- **json-v2 Only**: Only JSON output includes summary field
- **Text Reconstruction**: Join alternatives to maintain full transcript for search/indexing
- **Optional Summary**: Gracefully handle cases where summary isn't generated

## Verification

Update tests to mock json-v2 response:

```typescript
const mockJsonV2Response = {
  summary: { content: 'Test summary' },
  results: [{ alternatives: [{ content: 'Hello' }] }, { alternatives: [{ content: 'world' }] }],
};

mockGetJobResult.mockResolvedValue(mockJsonV2Response);

const result = await adapter.getTranscript('job-123');

expect(result.ok).toBe(true);
if (result.ok) {
  expect(result.value.text).toBe('Hello world');
  expect(result.value.summary).toBe('Test summary');
}
```

## Completion Criteria

- [ ] `summarization_config` added to job submission
- [ ] `getTranscript` uses `'json-v2'` format
- [ ] Text reconstructed from results array
- [ ] Summary extracted and returned
- [ ] Tests cover json-v2 parsing with/without summary
- [ ] Error handling for malformed responses
