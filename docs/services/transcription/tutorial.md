# Transcription Worker — Tutorial

> **Time:** 15-20 minutes
> **Prerequisites:** Node.js 22+, GCP project access, Speechmatics API key
> **You will learn:** How the transcription worker processes audio, how to test it locally, and how to extend it with a new provider

---

## What You Will Build

An understanding of:

- How the transcription pipeline processes audio files end-to-end
- How to run and test the worker locally
- How to extend the provider factory with a new transcription provider

---

## Prerequisites

Before starting, ensure you have:

- [ ] Access to the IntexuraOS GCP project
- [ ] `INTEXURAOS_SPEECHMATICS_APP_API_KEY` configured
- [ ] pnpm installed and packages built (`pnpm install && pnpm build`)
- [ ] Basic understanding of Pub/Sub CloudEvent handlers

---

## Part 1: Understand the Pipeline (5 minutes)

The transcription worker follows a 7-step pipeline:

```
1. Receive CloudEvent from Pub/Sub (audio-stored topic)
2. Decode and validate AudioStoredEvent from base64 payload
3. Fetch user's provider preference from user-service
4. Generate a signed GCS URL for the audio file (4h expiry)
5. Submit transcription job to provider (Speechmatics)
6. Poll with exponential backoff until done/rejected/timeout
7. Fetch transcript and publish TranscriptionCompletedEvent
```

### Key Design Decisions

The worker always publishes a result event, even on failure. This guarantees that downstream services never need to handle missing events or implement their own timeouts.

All dependencies are injected through the `TranscriptionDeps` interface:

```typescript
interface TranscriptionDeps {
  fetchUserProvider: (userId: string) => Promise<string>;
  generateSignedUrl: (gcsPath: string) => Promise<Result<string, { message: string }>>;
  createProvider: (providerName: string) => SpeechTranscriptionPort;
  publishEvent: (event: TranscriptionCompletedEvent) => Promise<Result<void, PublishError>>;
  pollConfig?: Partial<PollingConfig>;
  sleep?: (ms: number) => Promise<void>;
}
```

**Checkpoint:** You should understand that every code path — signed URL failure, job submission error, poll timeout, job rejection, transcript fetch error, or unexpected exception — ends with a published event.

---

## Part 2: Run the Tests (5 minutes)

### Step 2.1: Run the Full Test Suite

```bash
cd workers/transcription
pnpm test
```

**Expected output:** All tests pass with coverage above 95%.

### Step 2.2: Explore the Test Structure

The tests demonstrate the dependency injection pattern:

```typescript
// From main.test.ts — creating fake dependencies
const deps: TranscriptionDeps = {
  fetchUserProvider: vi.fn().mockResolvedValue('speechmatics'),
  generateSignedUrl: vi.fn().mockResolvedValue(ok('https://signed-url.example.com')),
  createProvider: vi.fn().mockReturnValue(fakeProvider),
  publishEvent: vi.fn().mockResolvedValue(ok(undefined)),
  pollConfig: { initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1, maxAttempts: 3 },
  sleep: vi.fn().mockResolvedValue(undefined),
};
```

Notice that `sleep` is injected to make polling tests instantaneous.

### Step 2.3: Run a Specific Test File

```bash
pnpm vitest run src/__tests__/polling.test.ts
```

**Checkpoint:** You should see the polling tests cover done, rejected, timeout, and transient error scenarios.

---

## Part 3: Understand Error Formatting (5 minutes)

The `formatSpeechmaticsError` function translates raw API errors into user-friendly messages.

### Step 3.1: Review the Error Patterns

```bash
# From the project root
pnpm vitest run workers/transcription/src/__tests__/format-error.test.ts
```

The formatter handles:

| Input Pattern                | Output                                         |
| ---------------------------- | ---------------------------------------------- |
| JSON `{ "message": "..." }`  | Extracted message field                        |
| `insufficient audio`         | "Audio file is too short for transcription"    |
| `rate limit`                 | "Transcription service rate limit exceeded..." |
| Messages over 100 characters | Truncated with `...`                           |

### Step 3.2: Why This Matters

Raw Speechmatics errors can be lengthy JSON blobs with internal codes. The formatter ensures that the `error` field in `TranscriptionCompletedEvent` is always concise and human-readable, because downstream services (like whatsapp-service) may display these messages to users.

**Checkpoint:** You should understand that error formatting happens at the orchestration layer (main.ts), not inside the adapter.

---

## Part 4: Add a New Provider (5 minutes)

The provider architecture uses the Ports and Adapters pattern, making it straightforward to add new transcription providers.

### Step 4.1: Implement the Port Interface

Create a new adapter that implements `SpeechTranscriptionPort`:

```typescript
// src/providers/my-provider/adapter.ts
import type { SpeechTranscriptionPort } from '../transcription-provider.js';

export class MyProviderAdapter implements SpeechTranscriptionPort {
  async submitJob(input) {
    // Submit audio URL to your provider
    // Return ok({ jobId, apiCall }) or err({ code, message })
  }

  async pollJob(jobId) {
    // Check job status
    // Return ok({ status: 'running' | 'done' | 'rejected', apiCall })
  }

  async getTranscript(jobId) {
    // Fetch completed transcript
    // Return ok({ text, summary?, detectedLanguage?, apiCall })
  }
}
```

### Step 4.2: Register in the Factory

Add your provider to `provider-factory.ts`:

```typescript
case 'my-provider':
  return new MyProviderAdapter(apiKey, logger);
```

### Step 4.3: User Selection

Users select their provider through user-service settings at `transcriptionPreferences.provider`. The worker fetches this on each invocation, so provider changes take effect on the next audio message.

**Checkpoint:** You should understand that adding a provider requires only a new adapter class and a factory registration — no changes to the orchestration logic.

---

## Troubleshooting

| Problem                                           | Solution                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| "INTEXURAOS_SPEECHMATICS_APP_API_KEY is required" | Set the environment variable before starting                                  |
| Transcription times out                           | Check if audio file is very long; increase `maxAttempts` in poll config       |
| "Audio file is too short"                         | Speechmatics requires minimum audio length; ensure the recording is not empty |
| "Could not connect to transcription service"      | Check network connectivity to `asr.api.speechmatics.com`                      |
| Provider defaults to speechmatics                 | User-service returned an unknown provider name; check user settings           |

---

## Next Steps

Now that you understand the transcription worker:

1. Read the [Technical Reference](technical.md) for full event schemas and configuration details
2. Explore the [custom vocabulary](../../workers/transcription/src/providers/speechmatics/vocabulary.ts) to see domain-specific terms
3. Check how whatsapp-service publishes `AudioStoredEvent` and consumes `TranscriptionCompletedEvent`

---

## Exercises

Test your understanding:

1. **Easy:** Add a new term to the custom vocabulary in `vocabulary.ts` with appropriate `sounds_like` entries
2. **Medium:** Write a test in `main.test.ts` that verifies the worker publishes a failed event when `generateSignedUrl` returns an error
3. **Hard:** Implement a mock provider adapter that returns a hardcoded transcript, register it in the factory, and write tests to verify it works through the full pipeline

<details>
<summary>Solutions</summary>

### Exercise 1: Custom Vocabulary

```typescript
// Add to ADDITIONAL_VOCAB array in vocabulary.ts
{ content: 'MyNewTerm', sounds_like: ['my new term', 'my knew term'] },
```

### Exercise 2: Signed URL Failure Test

```typescript
it('publishes failed event when signed URL generation fails', async () => {
  const deps = createDeps();
  deps.generateSignedUrl = vi.fn().mockResolvedValue(
    err({ message: 'Storage permission denied' })
  );

  await transcribeAudio(audioEvent, deps, logger);

  expect(deps.publishEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'failed',
      error: 'Storage permission denied',
    })
  );
});
```

### Exercise 3: Mock Provider

```typescript
// src/providers/mock/adapter.ts
export class MockTranscriptionAdapter implements SpeechTranscriptionPort {
  async submitJob() {
    return ok({
      jobId: 'mock-job-1',
      apiCall: { timestamp: new Date().toISOString(), operation: 'submit' as const, success: true },
    });
  }

  async pollJob() {
    return ok({
      status: 'done' as const,
      apiCall: { timestamp: new Date().toISOString(), operation: 'poll' as const, success: true },
    });
  }

  async getTranscript() {
    return ok({
      text: 'This is a mock transcript',
      apiCall: { timestamp: new Date().toISOString(), operation: 'fetch_result' as const, success: true },
    });
  }
}

// Register in provider-factory.ts:
case 'mock':
  return new MockTranscriptionAdapter();
```

</details>
