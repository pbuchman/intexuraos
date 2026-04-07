# Cover Image Generation Resilience — Provider Failover Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cover image generation resilient to provider failures by adding provider failover. When the preferred provider fails (at any step — prompt or image generation), try the alternate provider. If both providers fail, generate HTML without a cover image and log the specific reason.

**Architecture:** The fix is contained entirely within the `generateCoverImage` function in research-agent. No new packages, no new utilities. The existing `selectImageModel` function picks a preferred provider based on synthesis model and API keys. The new logic wraps the full pipeline (prompt generation + image generation) in a try-with-fallback: if the preferred provider's pipeline fails, try the alternate provider's pipeline. Both providers have a prompt model (text LLM) and an image model.

**Why provider failover instead of retry-with-backoff:** Retry-with-backoff was considered but rejected in favour of immediate provider failover. When a provider returns a 503 (high demand), retrying immediately with the same provider is unlikely to succeed — failover achieves the same resilience goal without the latency penalty of exponential back-off.

**Provider pipelines:**
| Provider   | Prompt Model (text LLM)  | Image Model              |
| ---------- | ------------------------ | ------------------------ |
| Google     | `gemini-2.5-pro`         | `gemini-2.5-flash-image` |
| OpenAI     | `gpt-4.1`                | `gpt-image-1`            |

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

### Root Cause

The Google provider (Gemini 2.5 Pro) returned HTTP 503 (UNAVAILABLE) during the prompt generation step. The research-agent's `generateCoverImage` function received the error and returned `null` with no fallback attempt. The user had both Google and OpenAI API keys configured, so the system could have tried the OpenAI provider instead. The HTML was uploaded without a cover image.

### Why No Image Appears

In `htmlGenerator.ts` (line 394-397), when `coverImage` is `undefined`, both the `<meta property="og:image">` tag and the `<img class="cover-image">` element are omitted entirely. This is correct behavior — the problem is upstream in the failure to generate the image.

---

## Design

### Simple provider failover in `generateCoverImage`

When the preferred provider fails at any step (prompt generation or image generation), try the alternate provider's full pipeline. No retry logic, no new utilities — just a straightforward fallback.

**Flow:**
1. Determine preferred and alternate providers based on synthesis model + available API keys
2. Try full pipeline with preferred provider (prompt model → image model)
3. If ANY step fails, log the error, then try full pipeline with alternate provider
4. If alternate also fails, log the specific reason and return `null` (HTML generated without image)

**Key change:** The current `selectImageModel` function picks ONE model based on preference. The new approach builds a list of available provider pipelines (preferred first, alternate second) and tries them in order.

---

## File Structure

| File                                                                              | Action   | Responsibility                                              |
| --------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| `apps/research-agent/src/domain/research/usecases/runSynthesis.ts`                | Modify   | Add provider failover to `generateCoverImage`               |
| `apps/research-agent/src/__tests__/domain/research/usecases/runSynthesis.test.ts` | Modify   | Tests for failover behavior                                 |

---

## Endpoint Changes

- Modified: None
- Created: None
- Removed: None
- Unchanged: `POST /internal/images/prompts/generate`, `POST /internal/images/generate`

---

## Task 1: Add provider failover to `generateCoverImage`

**Files:**
- Modify: `apps/research-agent/src/domain/research/usecases/runSynthesis.ts` (lines 435-535)
- Modify: `apps/research-agent/src/__tests__/domain/research/usecases/runSynthesis.test.ts`

### Data model

Define a `ProviderPipeline` type that pairs a prompt model with an image model:

```typescript
interface ProviderPipeline {
  name: string;           // 'Google' | 'OpenAI' — for logging
  promptModel: PromptModel;
  imageModel: ImageModel;
}
```

### New function: `getAvailableProviderPipelines`

Replace the current `selectImageModel` with a function that returns an ordered list of available provider pipelines (preferred first):

```typescript
function getAvailableProviderPipelines(
  imageApiKeys: ImageApiKeys | undefined,
  synthesisModel?: string
): ProviderPipeline[] {
  const hasGoogleKey = imageApiKeys?.google !== undefined;
  const hasOpenAiKey = imageApiKeys?.openai !== undefined;

  const googlePipeline: ProviderPipeline = {
    name: 'Google',
    promptModel: LlmModels.Gemini25Pro,
    imageModel: LlmModels.Gemini25FlashImage,
  };

  const openAiPipeline: ProviderPipeline = {
    name: 'OpenAI',
    promptModel: 'gpt-4.1' as PromptModel,
    imageModel: LlmModels.GPTImage1,
  };

  const preferOpenAi = synthesisModel?.startsWith('gpt-') === true;
  const pipelines: ProviderPipeline[] = [];

  if (preferOpenAi) {
    if (hasOpenAiKey) pipelines.push(openAiPipeline);
    if (hasGoogleKey) pipelines.push(googlePipeline);
  } else {
    if (hasGoogleKey) pipelines.push(googlePipeline);
    if (hasOpenAiKey) pipelines.push(openAiPipeline);
  }

  return pipelines;
}
```

### Reworked `generateCoverImage`

```typescript
async function generateCoverImage(
  client: ImageServiceClient,
  synthesizedResult: string,
  userId: string,
  imageApiKeys: ImageApiKeys | undefined,
  synthesisModel: string | undefined,
  logger: Logger
): Promise<GeneratedImageData | null> {
  const pipelines = getAvailableProviderPipelines(imageApiKeys, synthesisModel);

  if (pipelines.length === 0) {
    logger.info({}, '[4.4.1a] No API keys available for image generation');
    return null;
  }

  logger.info(
    { providers: pipelines.map((p) => p.name) },
    `[4.4.1] Starting cover image generation (${String(pipelines.length)} provider(s) available)`
  );

  const errors: Array<{ provider: string; step: string; code: string; message: string }> = [];

  for (const pipeline of pipelines) {
    logger.info(
      {},
      `[4.4.2] Trying ${pipeline.name} provider (prompt: ${pipeline.promptModel}, image: ${pipeline.imageModel})`
    );

    try {
      // Step 1: Generate prompt
      const promptResult = await client.generatePrompt(
        synthesizedResult,
        pipeline.promptModel,
        userId
      );

      if (!promptResult.ok) {
        logger.warn(
          { errorCode: promptResult.error.code, errorMessage: promptResult.error.message, provider: pipeline.name },
          `[4.4.2] ${pipeline.name} prompt generation failed`
        );
        errors.push({
          provider: pipeline.name,
          step: 'prompt generation',
          code: promptResult.error.code,
          message: promptResult.error.message,
        });
        continue; // Try next provider
      }

      // Step 2: Generate image
      logger.info(
        {},
        `[4.4.3] Prompt generated (title: ${promptResult.value.title}), generating image with ${pipeline.imageModel}`
      );

      const imageResult = await client.generateImage(
        promptResult.value.prompt,
        pipeline.imageModel,
        userId,
        { title: promptResult.value.title }
      );

      if (!imageResult.ok) {
        logger.warn(
          { errorCode: imageResult.error.code, errorMessage: imageResult.error.message, provider: pipeline.name },
          `[4.4.3] ${pipeline.name} image generation failed`
        );
        errors.push({
          provider: pipeline.name,
          step: 'image generation',
          code: imageResult.error.code,
          message: imageResult.error.message,
        });
        continue; // Try next provider
      }

      logger.info(
        { provider: pipeline.name },
        `[4.4.4] Cover image generated successfully via ${pipeline.name}`
      );
      return imageResult.value;
    } catch (error) {
      logger.warn(
        { error, provider: pipeline.name },
        `[4.4.ERR] Unexpected error with ${pipeline.name} provider`
      );
      errors.push({
        provider: pipeline.name,
        step: 'unexpected',
        code: 'UNEXPECTED_ERROR',
        message: String(error),
      });
      continue; // Try next provider
    }
  }

  // All providers failed
  logger.error(
    { errors },
    `[4.4.4] Cover image generation failed — all ${String(pipelines.length)} provider(s) exhausted. HTML will be generated without a cover image.`
  );
  return null;
}
```

### Implementation steps

- [ ] **Step 1: Write failing test — preferred provider fails, alternate succeeds**

Add to the existing cover image generation describe block in `runSynthesis.test.ts`:

```typescript
it('falls back to alternate provider when preferred provider prompt generation fails', async () => {
  // Google prompt fails (503), OpenAI prompt succeeds, OpenAI image succeeds
  const mockClient = {
    generatePrompt: vi.fn().mockImplementation(
      async (_text: string, model: string, _userId: string) => {
        if (model === 'gemini-2.5-pro') {
          return err({ code: 'API_ERROR', message: 'HTTP 502: 503 high demand' });
        }
        return ok({ title: 'Test', visualSummary: 'summary', prompt: 'a scene', negativePrompt: '', parameters: { framing: 'wide', realism: 'photorealistic', people: 'none' } });
      }
    ),
    generateImage: vi.fn().mockResolvedValue(ok({
      id: 'img-1', thumbnailUrl: 'https://example.com/thumb.jpg', fullSizeUrl: 'https://example.com/full.jpg',
    })),
    deleteImage: vi.fn(),
  };
  // Provide both Google and OpenAI API keys
  // Assert: generatePrompt called twice (once with gemini-2.5-pro, once with gpt-4.1)
  // Assert: generateImage called once with gpt-image-1
  // Assert: result has coverImageId set
});
```

Note: Exact test setup depends on the existing patterns in `runSynthesis.test.ts`. The engineer should read the existing tests and follow the same mock/service setup pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/research-agent && npx vitest run src/__tests__/domain/research/usecases/runSynthesis.test.ts -t "falls back"`
Expected: FAIL — no failover logic exists yet

- [ ] **Step 3: Write failing test — both providers fail, returns null with log**

```typescript
it('returns null and logs reason when all providers fail', async () => {
  const mockClient = {
    generatePrompt: vi.fn().mockResolvedValue(
      err({ code: 'API_ERROR', message: 'provider unavailable' })
    ),
    generateImage: vi.fn(),
    deleteImage: vi.fn(),
  };
  // Provide both Google and OpenAI API keys
  // Assert: generatePrompt called twice (both providers attempted)
  // Assert: generateImage never called
  // Assert: result has no coverImageId
  // Assert: logger.error called with message about all providers exhausted
});
```

- [ ] **Step 4: Write failing test — preferred provider image generation fails, alternate succeeds**

```typescript
it('falls back to alternate provider when preferred provider image generation fails', async () => {
  const mockClient = {
    generatePrompt: vi.fn().mockResolvedValue(
      ok({ title: 'Test', visualSummary: 'summary', prompt: 'a scene', negativePrompt: '', parameters: { framing: 'wide', realism: 'photorealistic', people: 'none' } })
    ),
    generateImage: vi.fn().mockImplementation(
      async (_prompt: string, model: string, _userId: string) => {
        if (model === 'gemini-2.5-flash-image') {
          return err({ code: 'API_ERROR', message: 'image generation failed' });
        }
        return ok({ id: 'img-1', thumbnailUrl: 'https://example.com/thumb.jpg', fullSizeUrl: 'https://example.com/full.jpg' });
      }
    ),
    deleteImage: vi.fn(),
  };
  // Provide both Google and OpenAI API keys
  // Assert: generatePrompt called twice (once per provider — prompt is regenerated per provider)
  // Assert: generateImage called twice (Google fails, OpenAI succeeds)
  // Assert: result has coverImageId set
});
```

- [ ] **Step 5: Implement the provider failover**

Apply the changes described above:
1. Add `ProviderPipeline` interface
2. Replace `selectImageModel` with `getAvailableProviderPipelines`
3. Rewrite `generateCoverImage` with the failover loop
4. Add import for `PromptModel` type:
   ```typescript
   import type { PromptModel } from '../../../infra/image/index.js';
   ```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/research-agent && npx vitest run src/__tests__/domain/research/usecases/runSynthesis.test.ts`
Expected: All PASS

- [ ] **Step 7: Write test — single provider available, succeeds on first try**

```typescript
it('succeeds with single available provider (no fallback needed)', async () => {
  // Only Google key available, Google pipeline succeeds
  // Assert: generatePrompt called once with gemini-2.5-pro
  // Assert: generateImage called once with gemini-2.5-flash-image
});
```

- [ ] **Step 8: Run full workspace verification**

Run: `pnpm run verify:workspace:tracked -- research-agent`
Expected: PASS with coverage

- [ ] **Step 9: Run full CI**

Run: `pnpm run ci:tracked`
Expected: All checks pass

- [ ] **Step 10: Commit**

```bash
git add apps/research-agent/src/domain/research/usecases/runSynthesis.ts apps/research-agent/src/__tests__/domain/research/usecases/runSynthesis.test.ts
git commit -m "feat(research-agent): add provider failover for cover image generation

When one image generation provider fails (at prompt or image step),
automatically tries the alternate provider. If both fail, generates
HTML without cover image and logs the specific reason per provider."
```
