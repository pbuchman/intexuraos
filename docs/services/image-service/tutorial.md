# Image Service -- Tutorial

> **Time:** 15-20 minutes
> **Prerequisites:** Node.js 22+, IntexuraOS development environment
> **You will learn:** How to generate AI images and optimized prompts using image-service internal endpoints

Image-service is an internal service with no public endpoints. All functional endpoints require the `X-Internal-Auth` header. This tutorial covers integration from the perspective of a calling service such as research-agent.

---

## What You Will Build

A working integration that:

- Generates optimized image prompts from text content
- Creates AI-generated images with automatic thumbnailing
- Manages the full image lifecycle including deletion

---

## Prerequisites

Before starting, ensure you have:

- [ ] IntexuraOS development environment running (services accessible via localhost)
- [ ] Internal auth token (`INTEXURAOS_INTERNAL_AUTH_TOKEN`)
- [ ] A valid user ID (API keys optional -- platform fallback keys used if user has none configured)

---

## Part 1: Generate an Image Prompt (5 minutes)

Generate an optimized, structured image prompt from text content.

### Step 1.1: Send text for prompt generation

```bash
curl -X POST http://localhost:8120/internal/images/prompts/generate \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Research about artificial intelligence and machine learning trends in 2026",
    "model": "gemini-2.5-pro",
    "userId": "user_abc123"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "title": "AI and Machine Learning Trends",
    "visualSummary": "Interconnected neural network nodes representing evolving machine learning patterns",
    "prompt": "A professional visualization of artificial intelligence research, featuring glowing neural network nodes with luminous blue connections against a dark gradient background, abstract data streams and geometric layers suggesting complexity and intelligence, minimalist scientific illustration with deep blue and purple tones, 16:9 wide format",
    "negativePrompt": "blurry, low quality, text on image, watermark, photorealistic people, corporate clipart, busy background, logos",
    "parameters": {
      "framing": "centered composition with radial depth",
      "realism": "cinematic illustration",
      "people": "no people"
    }
  }
}
```

### What Just Happened?

The service sent your text to the Gemini 2.5 Pro LLM, which analyzed the content and generated a structured prompt optimized for image generation. The response includes a title, visual summary, the generation prompt itself, a negative prompt (what to avoid), and rendering parameters covering framing, realism style, and people directives. Use the `data.prompt` field when calling the image generation endpoint.

**Checkpoint:** You should see a `success: true` response with all five fields populated in `data`.

---

## Part 2: Generate an Image (10 minutes)

Create an actual image using one of the supported image generation models.

### Step 2.1: Generate with OpenAI GPT Image 1

```bash
curl -X POST http://localhost:8120/internal/images/generate \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A professional visualization of artificial intelligence research, featuring glowing neural network nodes with luminous blue connections against a dark gradient background",
    "model": "gpt-image-1",
    "userId": "user_abc123",
    "title": "AI Research Trends"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "thumbnailUrl": "https://storage.googleapis.com/bucket/images/a1b2c3d4-ai-research-trends-thumb.jpg",
    "fullSizeUrl": "https://storage.googleapis.com/bucket/images/a1b2c3d4-ai-research-trends.png"
  }
}
```

### Step 2.2: Generate with Google Gemini Flash Image

```bash
curl -X POST http://localhost:8120/internal/images/generate \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cyberpunk cityscape with neon lights reflecting off wet streets, cinematic illustration style",
    "model": "gemini-2.5-flash-image",
    "userId": "user_abc123"
  }'
```

**Note:** When no `title` is provided, the GCS path uses a directory structure (`images/{id}/full.png`) instead of the slug-based flat path (`images/{id}-{slug}.png`).

### What Just Happened?

The service retrieved the user's API key from user-service (or fell back to a platform key), called the image generation API, received base64-encoded image data, created a 256px thumbnail using Sharp, uploaded both the full-size PNG and thumbnail JPEG to GCS with one-year cache headers, saved the metadata to Firestore, and returned the public URLs.

**Checkpoint:** You should see a `success: true` response with `id`, `thumbnailUrl`, and `fullSizeUrl`. Both URLs should be accessible in a browser.

---

## Part 3: Handle Errors (5 minutes)

### Common Error: Missing API Key

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "No openai API key configured for this user"
  }
}
```

HTTP status: 400

**Cause:** The user has not configured an API key for the requested provider, and no platform fallback key is available.

**Solution:** The user must add the provider API key via settings, or configure the platform fallback key (`INTEXURAOS_GEMINI_APP_API_KEY` or `INTEXURAOS_ZAI_APP_API_KEY`).

### Common Error: Rate Limited

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded for OpenAI API"
  }
}
```

HTTP status: 429 (from prompt endpoint) or 502 (from image endpoint)

**Cause:** The upstream provider's rate limit has been exceeded.

**Solution:** Implement exponential backoff and retry. Consider switching to an alternative provider.

### Common Error: Downstream Failure

```json
{
  "success": false,
  "error": {
    "code": "DOWNSTREAM_ERROR",
    "message": "Failed to retrieve API keys"
  }
}
```

HTTP status: 502

**Cause:** The user-service is unreachable or returned an error.

**Solution:** Verify user-service is healthy. Check network connectivity between services.

### Common Error: Unauthorized

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Internal auth failed for generate image"
  }
}
```

HTTP status: 401

**Cause:** Missing or invalid `X-Internal-Auth` header.

**Solution:** Ensure the `X-Internal-Auth` header matches the configured `INTEXURAOS_INTERNAL_AUTH_TOKEN`.

---

## Part 4: Real-World Scenario -- Research Cover Image (10 minutes)

Complete end-to-end flow for generating and managing a research cover image.

### Step 4.1: Research-agent generates a prompt from research title

```bash
curl -X POST http://localhost:8120/internal/images/prompts/generate \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Quantum Computing Advances: Qubits, Entanglement, and Future Applications in Cryptography",
    "model": "gemini-2.5-pro",
    "userId": "user_abc123"
  }'
```

Save the `data.prompt` from the response.

### Step 4.2: Research-agent generates the cover image

```bash
curl -X POST http://localhost:8120/internal/images/generate \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Abstract quantum computing visualization with glowing qubits connected by entanglement lines, deep blue and purple color scheme, minimalist scientific illustration style with geometric precision",
    "model": "gemini-2.5-flash-image",
    "userId": "user_abc123",
    "title": "Quantum Computing Advances"
  }'
```

Save the `data.id` and `data.thumbnailUrl` from the response.

### Step 4.3: Store image ID in the research document

The research-agent updates its research document with the `coverImageId` field pointing to the generated image. This establishes the lifecycle link between the research and the image.

### Step 4.4: Delete when research is unshared

```bash
curl -X DELETE http://localhost:8120/internal/images/a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN"
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

Both the GCS objects (full-size PNG and thumbnail JPEG) and the Firestore metadata record are removed.

---

## Troubleshooting

| Problem                  | Symptom                            | Solution                                                  |
| ------------------------ | ---------------------------------- | --------------------------------------------------------- |
| API key not found        | 400 INVALID_REQUEST                | User must add API key or configure platform fallback      |
| GCS upload fails         | 500 INTERNAL_ERROR                 | Check GCS bucket permissions and INTEXURAOS_IMAGE_BUCKET  |
| Image generation timeout | 502 DOWNSTREAM_ERROR               | Provider is slow; retry with backoff                      |
| Auth failure             | 401 UNAUTHORIZED                   | Check X-Internal-Auth header value                        |
| Prompt parse error       | 502 DOWNSTREAM_ERROR (PARSE_ERROR) | LLM returned malformed JSON; retry or switch model        |
| User-service unreachable | 502 DOWNSTREAM_ERROR               | Check user-service health and INTEXURAOS_USER_SERVICE_URL |

---

## Next Steps

Now that you understand the basics:

1. Explore different prompt generation models (GPT-4.1 vs Gemini 2.5 Pro) and compare prompt quality
2. Read the [Technical Reference](technical.md) for full API schemas and domain model details
3. Check the [Agent Interface](agent.md) for machine-readable integration specifications

---

## Exercises

Test your understanding:

1. **Easy:** Generate a prompt from a short text and examine the structured response fields
2. **Medium:** Generate a prompt, then use the returned `data.prompt` to create an image with both OpenAI and Google models -- compare the results
3. **Hard:** Build a retry workflow that handles rate limiting (429) with exponential backoff and falls back to an alternative provider when the primary provider is unavailable

<details>
<summary>Solutions</summary>

### Exercise 1: Examine Prompt Structure

```bash
curl -X POST http://localhost:8120/internal/images/prompts/generate \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "The future of renewable energy and solar panel technology",
    "model": "gemini-2.5-pro",
    "userId": "user_abc123"
  }'
```

Examine the response: `title` (max 10 words), `visualSummary` (1 sentence), `prompt` (80-180 words), `negativePrompt` (20-80 words), and `parameters` with `framing` (LLM-generated), `realism` (one of three styles), and `people` (LLM-generated directive).

### Exercise 2: Compare Providers

```bash
# Step 1: Generate prompt
PROMPT_RESPONSE=$(curl -s -X POST http://localhost:8120/internal/images/prompts/generate \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Ocean biodiversity and coral reef conservation", "model": "gemini-2.5-pro", "userId": "user_abc123"}')

# Step 2: Extract prompt field
PROMPT=$(echo $PROMPT_RESPONSE | jq -r '.data.prompt')

# Step 3: Generate with OpenAI
curl -X POST http://localhost:8120/internal/images/generate \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"$PROMPT\", \"model\": \"gpt-image-1\", \"userId\": \"user_abc123\", \"title\": \"Ocean Biodiversity\"}"

# Step 4: Generate with Google
curl -X POST http://localhost:8120/internal/images/generate \
  -H "X-Internal-Auth: $INTEXURAOS_INTERNAL_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": \"$PROMPT\", \"model\": \"gemini-2.5-flash-image\", \"userId\": \"user_abc123\", \"title\": \"Ocean Biodiversity\"}"
```

Compare the thumbnailUrl and fullSizeUrl outputs from both providers.

### Exercise 3: Retry with Fallback

```typescript
async function generateImageWithFallback(
  prompt: string,
  userId: string,
  title: string
): Promise<GenerateImageResponse> {
  const models = ['gpt-image-1', 'gemini-2.5-flash-image'] as const;
  const maxRetries = 3;

  for (const model of models) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const response = await fetch(
        'http://localhost:8120/internal/images/generate',
        {
          method: 'POST',
          headers: {
            'X-Internal-Auth': process.env.INTEXURAOS_INTERNAL_AUTH_TOKEN!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prompt, model, userId, title }),
        }
      );

      if (response.ok) {
        return await response.json();
      }

      if (response.status === 429) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Non-retryable error for this model, try next model
      break;
    }
  }

  throw new Error('All providers and retries exhausted');
}
```

</details>
