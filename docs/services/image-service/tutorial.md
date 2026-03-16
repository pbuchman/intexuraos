# Image Service — Tutorial

> **Time:** 15–30 minutes
> **Prerequisites:** Node.js 20+, GCP project access, internal auth token
> **You'll learn:** How to call image-service from another internal service and handle the two-step generation pipeline

---

## What You'll Build

A working internal integration that:

- Generates an optimized image prompt from text content
- Uses that prompt to generate and store an AI image
- Retrieves the thumbnail and full-size URLs for display
- Cleans up the image when it is no longer needed

---

## Prerequisites

Before starting, ensure you have:

- [ ] Access to the IntexuraOS development environment
- [ ] The `INTEXURAOS_INTERNAL_AUTH_TOKEN` value for your environment
- [ ] A valid `userId` with at least one API key configured (OpenAI or Google), or the platform `INTEXURAOS_GEMINI_APP_API_KEY` set
- [ ] Basic understanding of TypeScript/Node.js

---

## Part 1: Health Check (2 minutes)

Verify the service is reachable before making generation requests.

### Step 1.1: Check Service Health

```bash
curl https://intexuraos-image-service-cj44trunra-lm.a.run.app/health
```

**Expected response:**

```json
{
  "status": "ok",
  "serviceName": "image-service",
  "version": "0.0.4",
  "timestamp": "2026-03-15T10:00:00.000Z",
  "checks": [
    { "name": "firestore", "status": "ok", "latencyMs": 12 },
    { "name": "secrets", "status": "ok", "latencyMs": 0 }
  ]
}
```

### What Just Happened?

The health endpoint checks Firestore connectivity and secret availability. A `"status": "ok"` response means the service is ready to handle generation requests.

---

## Part 2: Generate a Prompt (10 minutes)

The first step of the two-stage pipeline turns raw text into an optimized image generation prompt.

### Step 2.1: Prepare Your Input

You need:
- A text body with at least 10 characters
- A prompt generation model: `"gpt-4.1"` (OpenAI) or `"gemini-2.5-pro"` (Google)
- The `userId` whose API keys will be used for the LLM call

### Step 2.2: Send the Prompt Generation Request

```bash
curl -X POST https://intexuraos-image-service-cj44trunra-lm.a.run.app/internal/images/prompts/generate \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -d '{
    "text": "Renewable energy policy in Southeast Asia is shifting rapidly. Wind and solar adoption is accelerating, but grid infrastructure lags behind ambition.",
    "model": "gemini-2.5-pro",
    "userId": "user-abc-123"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "title": "Southeast Asia Energy Transition",
    "visualSummary": "Wind turbines and solar panels against tropical skyline at dusk",
    "prompt": "Wide-angle panoramic scene of wind turbines rising from lush green rice fields in Southeast Asia, solar panels installed on traditional wooden buildings in the foreground, dramatic golden-hour lighting, low clouds on horizon, sense of scale and human impact...",
    "negativePrompt": "No text overlays, no cartoon style, no urban skyline, no snow, no western architecture",
    "parameters": {
      "framing": "Wide panoramic, horizon-centered",
      "realism": "photorealistic",
      "people": "No people visible"
    }
  }
}
```

### Step 2.3: Inspect the Result

The `prompt` field is ready to pass directly to the image generation endpoint. The `negativePrompt` tells image models what to avoid. The `parameters` object captures composition decisions made by the LLM.

**Checkpoint:** You should see a structured `ThumbnailPrompt` with all five fields: `title`, `visualSummary`, `prompt`, `negativePrompt`, `parameters`.

---

## Part 3: Generate the Image (10 minutes)

Use the prompt from Part 2 to generate an actual image.

### Step 3.1: Send the Image Generation Request

```bash
curl -X POST https://intexuraos-image-service-cj44trunra-lm.a.run.app/internal/images/generate \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -d '{
    "prompt": "Wide-angle panoramic scene of wind turbines rising from lush green rice fields...",
    "model": "gemini-2.5-flash-image",
    "userId": "user-abc-123",
    "title": "Southeast Asia Energy Transition"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "thumbnailUrl": "https://storage.googleapis.com/your-bucket/images/f47ac10b-58cc-4372-a567-0e02b2c3d479-southeast-asia-energy-transition-thumb.jpg",
    "fullSizeUrl": "https://storage.googleapis.com/your-bucket/images/f47ac10b-58cc-4372-a567-0e02b2c3d479-southeast-asia-energy-transition.png"
  }
}
```

### Step 3.2: Understand the URLs

- `thumbnailUrl` — 256px JPEG, suitable for preview cards
- `fullSizeUrl` — Full PNG image, suitable for display pages
- Both URLs are publicly accessible GCS objects with a 1-year cache header

**Checkpoint:** Both URLs should be accessible in your browser and return valid images.

---

## Part 4: Handle Errors (5 minutes)

### Common Error: Missing API Key

**Error response:**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "No google API key configured for this user"
  }
}
```

**Solution:** Either configure a Google API key for the user via user-service, or ensure the platform fallback key `INTEXURAOS_GEMINI_APP_API_KEY` is set in the environment. Alternatively, switch to `model: "gpt-image-1"` if the user has an OpenAI key.

### Common Error: Rate Limited

**Error response:**

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded for prompt generation"
  }
}
```

**Solution:** Wait and retry. This error comes from the upstream LLM provider and is only returned from `/internal/images/prompts/generate`. The image generation endpoint wraps provider errors as `DOWNSTREAM_ERROR`.

### Common Error: Internal Auth Failed

**Error response:**

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Internal auth failed for generate image"
  }
}
```

**Solution:** Ensure the `X-Internal-Auth` header matches `INTEXURAOS_INTERNAL_AUTH_TOKEN` exactly. This header is required on all three functional endpoints.

---

## Part 5: Clean Up (5 minutes)

When a user unshares content, delete the associated image.

### Step 5.1: Delete the Image

```bash
curl -X DELETE https://intexuraos-image-service-cj44trunra-lm.a.run.app/internal/images/f47ac10b-58cc-4372-a567-0e02b2c3d479 \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": { "deleted": true }
}
```

### What Just Happened?

The service deleted both GCS files (full PNG and thumbnail JPEG) and the Firestore record. The response is always `{ deleted: true }` — even if GCS deletion partially fails, the Firestore record is cleaned up and the error is logged for investigation.

---

## Part 6: Full Two-Step Integration (TypeScript)

Here is the complete pattern for calling image-service from another internal service:

```typescript
async function generateCoverImage(
  text: string,
  title: string,
  userId: string,
  logger: Logger
): Promise<{ id: string; thumbnailUrl: string; fullSizeUrl: string } | null> {
  const headers = { 'X-Internal-Auth': INTERNAL_AUTH_TOKEN };

  // Step 1: Generate the structured prompt from content
  const promptRes = await fetch(`${IMAGE_SERVICE_URL}/internal/images/prompts/generate`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model: 'gemini-2.5-pro', userId }),
  });
  const promptBody = await promptRes.json();

  if (!promptBody.success) {
    logger.warn({ error: promptBody.error }, 'Prompt generation failed — skipping cover image');
    return null;
  }

  // Step 2: Generate the image using the structured prompt
  const imageRes = await fetch(`${IMAGE_SERVICE_URL}/internal/images/generate`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: promptBody.data.prompt,
      model: 'gemini-2.5-flash-image',
      userId,
      title,
    }),
  });
  const imageBody = await imageRes.json();

  if (!imageBody.success) {
    logger.warn({ error: imageBody.error }, 'Image generation failed — skipping cover image');
    return null;
  }

  return imageBody.data; // { id, thumbnailUrl, fullSizeUrl }
}
```

**Result:** Store the returned `id` with your content record for later cleanup, and use `thumbnailUrl` and `fullSizeUrl` directly in UI components.

---

## Troubleshooting

| Problem                       | Solution                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `401 UNAUTHORIZED`            | Check `X-Internal-Auth` header matches `INTEXURAOS_INTERNAL_AUTH_TOKEN`         |
| `400 INVALID_REQUEST`         | Ensure `userId` has a matching provider API key configured                      |
| `502 DOWNSTREAM_ERROR`        | Upstream LLM or image API failed — retry with exponential backoff               |
| `RATE_LIMITED` (prompt only)  | Wait and retry — error originates from upstream provider                        |
| Image URLs return 403         | GCS bucket policy may not allow public reads — check bucket IAM settings        |
| `500 INTERNAL_ERROR`          | Image generated but Firestore save failed — GCS cleanup attempted automatically |

---

## Next Steps

Now that you understand the basics:

1. Read the [Technical Reference](technical.md) for full schema details and gotchas
2. Review the [Agent Interface](agent.md) for machine-readable capability definitions
3. Check the [Features](features.md) page for the user-facing explanation of what this service provides

---

## Exercises

Test your understanding:

1. **Easy:** Call the prompt generation endpoint with `model: "gpt-4.1"` and compare the output structure to the Gemini result
2. **Medium:** Send a title with special characters and unicode — observe how `slugify()` normalizes the filename in the returned GCS URL
3. **Hard:** Implement a retry wrapper that handles `RATE_LIMITED` from prompt generation and `DOWNSTREAM_ERROR` from image generation with different backoff strategies for each

<details>
<summary>Solutions</summary>

### Exercise 1: GPT-4.1 Prompt Generation

```bash
curl -X POST .../internal/images/prompts/generate \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: $TOKEN" \
  -d '{
    "text": "Renewable energy policy in Southeast Asia...",
    "model": "gpt-4.1",
    "userId": "user-abc-123"
  }'
```

The response structure is identical — same `ThumbnailPrompt` shape regardless of which model was used.

### Exercise 2: Slug Normalization

A title of `"Résumé & Future Plans! (2026)"` becomes the slug `resume-future-plans-2026` — unicode normalized via NFD decomposition, diacritics stripped, special characters removed, spaces become hyphens, capped at 50 characters.

### Exercise 3: Retry Wrapper

```typescript
async function generatePromptWithRetry(
  text: string,
  userId: string,
  maxRetries = 3
): Promise<ThumbnailPrompt | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await callPromptEndpoint(text, userId);

    if (result.success) return result.data;

    if (result.error.code === 'RATE_LIMITED') {
      // Exponential backoff for rate limits
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    // DOWNSTREAM_ERROR or other non-retryable errors
    return null;
  }
  return null;
}

async function generateImageWithRetry(
  prompt: string,
  userId: string,
  maxRetries = 2
): Promise<GeneratedImageData | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await callImageEndpoint(prompt, userId);

    if (result.success) return result.data;

    if (result.error.code === 'DOWNSTREAM_ERROR') {
      // Shorter backoff — image generation is expensive
      const delay = (attempt + 1) * 2000; // 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    return null;
  }
  return null;
}
```

</details>
