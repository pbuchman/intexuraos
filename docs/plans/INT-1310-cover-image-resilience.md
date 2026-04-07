# Cover Image Generation Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cover image generation resilient to transient LLM API failures (503 "high demand") by adding retry-with-backoff for the prompt generation step and model fallback for image generation.

**Architecture:** The fix targets two layers: (1) the `generateCoverImage` function in research-agent which orchestrates the image pipeline, and (2) a new retry utility in `common-core`. When the prompt generation call fails with a transient error (503/UNAVAILABLE/RATE_LIMITED), the system retries up to 2 times with exponential backoff. If the selected image model fails, it falls back to the alternate provider's model. No changes to image-service internals or HTML generation are needed.

**Tech Stack:** TypeScript, Fastify, Result pattern (`@intexuraos/common-core`)

---

## Root Cause Analysis

### Evidence from Production Logs (2026-04-07)

Research ID: `97c8b579-c778-45d5-8368-2bd852460fc7`

**Timeline:**
1. `14:03:55.483Z` — `[4.4.1] Starting cover image generation`
2. `14:03:55.483Z` — `[4.4.1b] Selected image model: gemini-2.5-flash-image (Google key: present, OpenAI key: present)`
3. `14:03:55.483Z` — `[4.4.2] Calling image-service /internal/images/prompts/generate (model: gemini-2.5-pro)`
4. `14:04:13.315Z` — `[4.4.2] Failed to generate cover image prompt from image-service`
   - `errorCode: API_ERROR`
   - `errorMessage: HTTP 502: {"success":false,"error":{"code":"DOWNSTREAM_ERROR","message":"{\"error\":{\"code\":503,\"message\":\"This model is currently experiencing high demand. Spikes in demand are usually temporary...`
5. `14:04:13.414Z` — `[4.4.4] Cover image generation returned null (see previous errors)`
6. `14:04:13.414Z` — `[4.5.1] Generating shareable HTML` (proceeds without image)
7. `14:04:13.861Z` — `[4.5.3] HTML uploaded successfully` (no cover image in HTML)

**Image-service logs confirm:**
- `14:04:11.929Z` — Received prompt generation request, model: `gemini-2.5-pro`
- `14:04:13.202Z` — LLM usage logged: `success: False`, `errorMessage: {"error":{"code":503,"message":"This model is currently experiencing high demand..."}}`
- `14:04:13.304Z` — `Prompt generation failed`, `errorCode: API_ERROR`
- `14:04:13.305Z` — Response: `statusCode: 502`

### Root Cause

The Gemini 2.5 Pro model returned HTTP 503 (UNAVAILABLE) due to temporary high demand. The image-service correctly propagated this as a `DOWNSTREAM_ERROR` with HTTP 502. The research-agent's `generateCoverImage` function received the error and returned `null` — **there is zero retry logic anywhere in the image generation pipeline**. The HTML was generated and uploaded without a cover image, and there is no mechanism to retroactively add the image later.

### Why No Image Appears

In `htmlGenerator.ts` (line 394-397), when `coverImage` is `undefined`, both the `<meta property="og:image">` tag and the `<img class="cover-image">` element are omitted entirely. This is correct behavior — the problem is upstream in the failure to generate the image.

---

## Design

### Option A: Retry with backoff in `generateCoverImage` (Recommended)

Add retry logic directly in the research-agent's `generateCoverImage` function for the prompt generation step. This is the simplest change with the highest impact because:
- The 503 error is explicitly documented as "usually temporary"
- The prompt generation call took only ~18 seconds — retrying 1-2 times adds acceptable latency
- Both API keys were present (Google + OpenAI), but only Google was tried for prompt generation

**Retry scope:** Only the prompt generation step (`client.generatePrompt`) — not the image generation step. Prompt generation is the step that failed, and it's a lightweight LLM call (~1.4s when it works). Image generation is heavier and uses a different model/provider.

**Fallback scope:** For prompt generation, fall back from `gemini-2.5-pro` to `gpt-4.1` if the user has an OpenAI key and retries are exhausted. For image generation (already has model selection logic), add a fallback to the alternate model if the primary fails.

### Option B: Async re-generation (Not recommended for now)

Add a "regenerate image" endpoint that can be triggered manually or by a scheduled job. This is more complex and doesn't solve the immediate problem of transient failures.

### Chosen: Option A

---

## File Structure

| File                                                                              | Action   | Responsibility                               |
| --------------------------------------------------------------------------------- | -------- | -------------------------------------------- |
| `packages/common-core/src/retry.ts`                                               | Create   | Generic `retryWithBackoff` utility           |
| `packages/common-core/src/index.ts`                                               | Modify   | Export the new retry utility                 |
| `packages/common-core/src/__tests__/retry.test.ts`                                | Create   | Tests for retry utility                      |
| `apps/research-agent/src/domain/research/usecases/runSynthesis.ts`                | Modify   | Add retry + fallback to `generateCoverImage` |
| `apps/research-agent/src/__tests__/domain/research/usecases/runSynthesis.test.ts` | Modify   | Tests for retry/fallback behavior            |

---

## Endpoint Changes

- Modified: None
- Created: None
- Removed: None
- Unchanged: `POST /internal/images/prompts/generate`, `POST /internal/images/generate`

---

## Task 1: Create `retryWithBackoff` utility in `common-core`

**Files:**
- Create: `packages/common-core/src/retry.ts`
- Create: `packages/common-core/src/__tests__/retry.test.ts`
- Modify: `packages/common-core/src/index.ts`

- [ ] **Step 1: Write the failing test for retryWithBackoff — success on first try**

```typescript
// packages/common-core/src/__tests__/retry.test.ts
import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff } from '../retry.js';
import { ok, err, type Result } from '../index.js';

describe('retryWithBackoff', () => {
  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue(ok('done'));

    const result = await retryWithBackoff(fn, {
      maxRetries: 2,
      baseDelayMs: 100,
      shouldRetry: () => true,
    });

    expect(result).toEqual(ok('done'));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/common-core && npx vitest run src/__tests__/retry.test.ts`
Expected: FAIL — module `../retry.js` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/common-core/src/retry.ts
import type { Result } from './result.js';

export interface RetryOptions<E> {
  /** Maximum number of retry attempts (0 = no retries, just one attempt) */
  maxRetries: number;
  /** Base delay in ms — actual delay is baseDelayMs * 2^attempt */
  baseDelayMs: number;
  /** Predicate: should this error be retried? */
  shouldRetry: (error: E) => boolean;
}

export async function retryWithBackoff<T, E>(
  fn: () => Promise<Result<T, E>>,
  options: RetryOptions<E>
): Promise<Result<T, E>> {
  let lastResult: Result<T, E> | undefined;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    const result = await fn();

    if (result.ok) {
      return result;
    }

    lastResult = result;

    if (attempt < options.maxRetries && options.shouldRetry(result.error)) {
      const delay = options.baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // lastResult is guaranteed to be set because maxRetries >= 0 means at least one iteration
  return lastResult!;
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/common-core/src/index.ts`:

```typescript
export { retryWithBackoff, type RetryOptions } from './retry.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/common-core && npx vitest run src/__tests__/retry.test.ts`
Expected: PASS

- [ ] **Step 6: Write additional tests — retry on failure, then succeed**

```typescript
it('retries on retryable error and succeeds', async () => {
  const fn = vi
    .fn()
    .mockResolvedValueOnce(err({ code: 'TRANSIENT', message: 'temporary' }))
    .mockResolvedValueOnce(ok('recovered'));

  const result = await retryWithBackoff(fn, {
    maxRetries: 2,
    baseDelayMs: 10, // short for tests
    shouldRetry: (e: { code: string }) => e.code === 'TRANSIENT',
  });

  expect(result).toEqual(ok('recovered'));
  expect(fn).toHaveBeenCalledTimes(2);
});

it('does not retry non-retryable errors', async () => {
  const fn = vi
    .fn()
    .mockResolvedValue(err({ code: 'PERMANENT', message: 'fatal' }));

  const result = await retryWithBackoff(fn, {
    maxRetries: 2,
    baseDelayMs: 10,
    shouldRetry: (e: { code: string }) => e.code === 'TRANSIENT',
  });

  expect(result).toEqual(err({ code: 'PERMANENT', message: 'fatal' }));
  expect(fn).toHaveBeenCalledTimes(1);
});

it('returns last error after all retries exhausted', async () => {
  const fn = vi
    .fn()
    .mockResolvedValue(err({ code: 'TRANSIENT', message: 'still failing' }));

  const result = await retryWithBackoff(fn, {
    maxRetries: 2,
    baseDelayMs: 10,
    shouldRetry: (e: { code: string }) => e.code === 'TRANSIENT',
  });

  expect(result).toEqual(err({ code: 'TRANSIENT', message: 'still failing' }));
  expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
});
```

- [ ] **Step 7: Run all retry tests**

Run: `cd packages/common-core && npx vitest run src/__tests__/retry.test.ts`
Expected: All PASS

- [ ] **Step 8: Build common-core**

Run: `cd packages/common-core && pnpm build`
Expected: Build succeeds

- [ ] **Step 9: Commit**

```bash
git add packages/common-core/src/retry.ts packages/common-core/src/__tests__/retry.test.ts packages/common-core/src/index.ts
git commit -m "feat(common-core): add retryWithBackoff utility for transient error resilience"
```

---

## Task 2: Add retry + prompt model fallback to `generateCoverImage`

**Files:**
- Modify: `apps/research-agent/src/domain/research/usecases/runSynthesis.ts` (lines 465-535)
- Modify: `apps/research-agent/src/__tests__/domain/research/usecases/runSynthesis.test.ts`

- [ ] **Step 1: Write the failing test — retry on transient prompt generation failure**

Add to the existing `runSynthesis.test.ts`, in the cover image generation describe block:

```typescript
it('retries prompt generation on transient API_ERROR and succeeds', async () => {
  // First call fails with API_ERROR (simulating 503), second succeeds
  const mockClient = {
    generatePrompt: vi
      .fn()
      .mockResolvedValueOnce(err({ code: 'API_ERROR', message: 'HTTP 502: DOWNSTREAM_ERROR 503' }))
      .mockResolvedValueOnce(ok({
        title: 'Test',
        visualSummary: 'summary',
        prompt: 'a beautiful scene',
        negativePrompt: '',
        parameters: { framing: 'wide', realism: 'photorealistic', people: 'none' },
      })),
    generateImage: vi.fn().mockResolvedValue(ok({
      id: 'img-1',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      fullSizeUrl: 'https://example.com/full.jpg',
    })),
    deleteImage: vi.fn(),
  };

  // ... invoke runSynthesis with mockClient as imageServiceClient ...
  // Assert generatePrompt was called twice
  expect(mockClient.generatePrompt).toHaveBeenCalledTimes(2);
  // Assert image was generated successfully
  // Assert the research result has coverImageId set
});
```

Note: The exact test setup depends on the existing test patterns in `runSynthesis.test.ts`. The engineer should read the existing tests and follow the same mock/service setup pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/research-agent && npx vitest run src/__tests__/domain/research/usecases/runSynthesis.test.ts -t "retries prompt generation"`
Expected: FAIL — no retry logic exists yet

- [ ] **Step 3: Write the failing test — fallback prompt model when retries exhausted**

```typescript
it('falls back to gpt-4.1 for prompt generation when gemini-2.5-pro retries exhausted and OpenAI key available', async () => {
  // All gemini-2.5-pro calls fail, then gpt-4.1 succeeds
  const mockClient = {
    generatePrompt: vi
      .fn()
      .mockImplementation(async (_text: string, model: string, _userId: string) => {
        if (model === 'gemini-2.5-pro') {
          return err({ code: 'API_ERROR', message: 'HTTP 502: 503 high demand' });
        }
        return ok({
          title: 'Test',
          visualSummary: 'summary',
          prompt: 'a scene',
          negativePrompt: '',
          parameters: { framing: 'wide', realism: 'photorealistic', people: 'none' },
        });
      }),
    generateImage: vi.fn().mockResolvedValue(ok({
      id: 'img-1',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      fullSizeUrl: 'https://example.com/full.jpg',
    })),
    deleteImage: vi.fn(),
  };

  // imageApiKeys must have both google and openai keys set
  // Assert generatePrompt was called 3 times with gemini-2.5-pro (1 + 2 retries)
  // then 1 time with gpt-4.1
  // Assert image was generated successfully
});
```

- [ ] **Step 4: Modify `generateCoverImage` to add retry + fallback**

In `apps/research-agent/src/domain/research/usecases/runSynthesis.ts`, update the `generateCoverImage` function:

```typescript
import { retryWithBackoff } from '@intexuraos/common-core';

// Add these constants near the top of the file or inside generateCoverImage:
const PROMPT_RETRY_MAX = 2;
const PROMPT_RETRY_BASE_DELAY_MS = 2000;

async function generateCoverImage(
  client: ImageServiceClient,
  synthesizedResult: string,
  userId: string,
  imageApiKeys: ImageApiKeys | undefined,
  synthesisModel: string | undefined,
  logger: Logger
): Promise<GeneratedImageData | null> {
  const primaryPromptModel = LlmModels.Gemini25Pro;
  const imageModel = selectImageModel(imageApiKeys, synthesisModel);

  if (imageModel === null) {
    logger.info(
      {},
      '[4.4.1a] No API keys available for image generation (neither Google nor OpenAI key set)'
    );
    return null;
  }

  logger.info(
    {},
    `[4.4.1b] Selected image model: ${imageModel} (Google key: ${imageApiKeys?.google !== undefined ? 'present' : 'missing'}, OpenAI key: ${imageApiKeys?.openai !== undefined ? 'present' : 'missing'})`
  );

  try {
    // Step 1: Generate prompt with retry + fallback
    const promptResult = await generatePromptWithResilience(
      client,
      synthesizedResult,
      userId,
      primaryPromptModel,
      imageApiKeys,
      logger
    );

    if (promptResult === null) {
      return null;
    }

    // Step 2: Generate image (existing logic, unchanged)
    logger.info(
      {},
      `[4.4.3] Prompt generated (title: ${promptResult.title}), calling image-service /internal/images/generate (model: ${imageModel})`
    );

    const imageResult = await client.generateImage(promptResult.prompt, imageModel, userId, {
      title: promptResult.title,
    });
    if (!imageResult.ok) {
      logger.error(
        {
          errorCode: imageResult.error.code,
          errorMessage: imageResult.error.message,
          model: imageModel,
          userId,
        },
        '[4.4.3] Failed to generate cover image from image-service'
      );
      return null;
    }

    return imageResult.value;
  } catch (error) {
    logger.error({ error, userId }, '[4.4.ERR] Unexpected error during cover image generation');
    return null;
  }
}

async function generatePromptWithResilience(
  client: ImageServiceClient,
  text: string,
  userId: string,
  primaryModel: PromptModel,
  imageApiKeys: ImageApiKeys | undefined,
  logger: Logger
): Promise<ThumbnailPrompt | null> {
  // Try primary model with retries
  logger.info({}, `[4.4.2] Calling image-service /internal/images/prompts/generate (model: ${primaryModel})`);

  const isTransientError = (error: ImageServiceError): boolean =>
    error.code === 'API_ERROR' && (error.message.includes('503') || error.message.includes('UNAVAILABLE') || error.message.includes('high demand'));

  const primaryResult = await retryWithBackoff(
    () => client.generatePrompt(text, primaryModel, userId),
    {
      maxRetries: PROMPT_RETRY_MAX,
      baseDelayMs: PROMPT_RETRY_BASE_DELAY_MS,
      shouldRetry: (error) => {
        const retryable = isTransientError(error);
        if (retryable) {
          logger.warn(
            { errorCode: error.code, model: primaryModel },
            '[4.4.2] Prompt generation failed with transient error, retrying...'
          );
        }
        return retryable;
      },
    }
  );

  if (primaryResult.ok) {
    return primaryResult.value;
  }

  // Primary model exhausted retries — try fallback model if available
  const fallbackModel = selectFallbackPromptModel(primaryModel, imageApiKeys);

  if (fallbackModel !== null) {
    logger.warn(
      { primaryModel, fallbackModel },
      `[4.4.2b] Primary prompt model failed, falling back to ${fallbackModel}`
    );

    const fallbackResult = await client.generatePrompt(text, fallbackModel, userId);

    if (fallbackResult.ok) {
      logger.info({}, `[4.4.2b] Fallback prompt model ${fallbackModel} succeeded`);
      return fallbackResult.value;
    }

    logger.error(
      {
        errorCode: fallbackResult.error.code,
        errorMessage: fallbackResult.error.message,
        model: fallbackModel,
        userId,
      },
      '[4.4.2b] Fallback prompt model also failed'
    );
  } else {
    logger.error(
      {
        errorCode: primaryResult.error.code,
        errorMessage: primaryResult.error.message,
        model: primaryModel,
        userId,
      },
      '[4.4.2] Failed to generate cover image prompt (no fallback available)'
    );
  }

  return null;
}

function selectFallbackPromptModel(
  primaryModel: PromptModel,
  imageApiKeys: ImageApiKeys | undefined
): PromptModel | null {
  // If primary was Gemini and user has OpenAI key, fall back to GPT
  if (primaryModel === LlmModels.Gemini25Pro && imageApiKeys?.openai !== undefined) {
    return 'gpt-4.1';
  }
  // If primary was GPT and user has Google key, fall back to Gemini
  if (primaryModel === 'gpt-4.1' && imageApiKeys?.google !== undefined) {
    return LlmModels.Gemini25Pro;
  }
  return null;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/research-agent && npx vitest run src/__tests__/domain/research/usecases/runSynthesis.test.ts`
Expected: All PASS

- [ ] **Step 6: Run full workspace verification**

Run: `pnpm run verify:workspace:tracked -- research-agent`
Expected: PASS with coverage

- [ ] **Step 7: Commit**

```bash
git add apps/research-agent/src/domain/research/usecases/runSynthesis.ts apps/research-agent/src/__tests__/domain/research/usecases/runSynthesis.test.ts
git commit -m "feat(research-agent): add retry + fallback for cover image prompt generation

Addresses transient 503 errors from Gemini API during prompt generation.
Retries up to 2 times with exponential backoff, then falls back to
alternate prompt model (gpt-4.1 <-> gemini-2.5-pro) if user has both keys."
```

---

## Task 3: Final verification

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: All packages build successfully

- [ ] **Step 2: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All checks pass

- [ ] **Step 3: Commit any remaining fixes**

If CI revealed issues, fix and commit.
