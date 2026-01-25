# Image Service - Tutorial

> **Time:** 15-20 minutes
> **Prerequisites:** Node.js 22+, IntexuraOS development environment
> **You'll learn:** How to generate AI images and optimized prompts using image-service

Image-service is an internal service with no public endpoints. This tutorial covers the internal endpoints used by other services like research-agent.

**Version:** 2.1.0 (INT-269 internal-clients migration)

## v2.1.0 Updates

**INT-269 Internal-Clients Migration (January 2025):**

- User service client migrated to `@intexuraos/internal-clients/user-service` package
- API key retrieval now uses shared client implementation
- No breaking changes - endpoints and responses unchanged

---

## Prerequisites

- IntexuraOS development environment running
- Internal auth token (`INTEXURAOS_INTERNAL_AUTH_TOKEN`)
- User with configured API keys (OpenAI or Google)

## Part 1: Hello World - Generate an Image Prompt

Generate an optimized image prompt from text content.

### Step 1: Generate prompt

```bash
curl -X POST https://image-service.intexuraos.com/internal/images/prompts/generate \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Research about artificial intelligence and machine learning trends",
    "model": "gemini-2.5-pro",
    "userId": "user_abc123"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "prompt": "A futuristic digital artwork featuring neural networks and AI circuits, with glowing blue connections representing machine learning, in a clean minimalist style with a dark background",
    "model": "gemini-2.5-pro"
  }
}
```

### Checkpoint

You've generated an optimized prompt for image generation. The LLM has transformed the raw text into a detailed visual description.

## Part 2: Generate an Image

Create an actual image using GPT Image 1 or Gemini Flash Image.

### Step 1: Generate with OpenAI

```bash
curl -X POST https://image-service.intexuraos.com/internal/images/generate \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A serene mountain landscape at sunset with a lake reflection",
    "model": "gpt-image-1",
    "userId": "user_abc123",
    "title": "Mountain Sunset"
  }'
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "id": "img_xyz789",
    "thumbnailUrl": "https://storage.googleapis.com/...",
    "fullSizeUrl": "https://storage.googleapis.com/...",
    "thumbnailGcsPath": "generated-images/thumbnails/img_xyz789.jpg",
    "gcsPath": "generated-images/full/img_xyz789.png"
  }
}
```

### Step 2: Generate with Google Imagen

```bash
curl -X POST https://image-service.intexuraos.com/internal/images/generate \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cyberpunk cityscape with neon lights",
    "model": "gemini-2.5-flash-image",
    "userId": "user_abc123"
  }'
```

## Part 3: Handle Errors

### Error: Missing API key

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "No openai API key configured for this user"
  }
}
```

**Cause:** User hasn't configured the required provider API key.

**Solution:** User must add the API key via the settings service.

### Error: Rate limited

```json
{
  "success": false,
  "error": {
    "code": "DOWNSTREAM_ERROR",
    "message": "Rate limit exceeded for OpenAI API"
  }
}
```

**Cause:** The provider's rate limit has been exceeded.

**Solution:** Implement exponential backoff and retry later.

### Error: Content policy violation

```json
{
  "success": false,
  "error": {
    "code": "DOWNSTREAM_ERROR",
    "message": "Content policy violation"
  }
}
```

**Cause:** The prompt violates the provider's content policy.

**Solution:** Modify the prompt to comply with content guidelines.

## Part 4: Real-World Scenario - Research Cover Image

Complete flow for generating a research cover image.

### Step 1: Research-agent generates prompt

```bash
# Research-agent calls this endpoint
curl -X POST https://image-service.intexuraos.com/internal/images/prompts/generate \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Quantum Computing Advances: Qubits, Entanglement, and Future Applications",
    "model": "gemini-2.5-pro",
    "userId": "user_abc123"
  }'
```

### Step 2: Research-agent generates image

```bash
curl -X POST https://image-service.intexuraos.com/internal/images/generate \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Abstract quantum computing visualization with glowing qubits and entanglement lines, deep blue and purple color scheme, minimalist scientific illustration style",
    "model": "gemini-2.5-flash-image",
    "userId": "user_abc123",
    "title": "Quantum Computing Advances",
    "slug": "quantum-computing-advances"
  }'
```

### Step 3: Store image ID in research

```bash
# Research-agent updates the research document with coverImageId
```

### Step 4: Delete when unshared

```bash
curl -X DELETE https://image-service.intexuraos.com/internal/images/img_xyz789 \
  -H "X-Internal-Auth: YOUR_INTERNAL_TOKEN"
```

## Troubleshooting

| Issue                    | Symptom                              | Solution                           |
| ------------------------ | ------------------------------------ | ---------------------------------- |
| API key not found        | 400 Bad Request                      | User must add API key via settings |
| GCS upload fails         | Image saved but URL generation fails | Check GCS bucket permissions       |
| Image generation timeout | 502 Downstream Error                 | Provider is slow; increase timeout |
| Corrupted image          | Image doesn't display                | Check base64 decoding              |
| Thumbnail not generated  | Only full-size URL returned          | Verify image processing pipeline   |

## Exercises

### Easy

1. Generate a prompt from simple text
2. Generate a 1:1 square image with GPT Image 1
3. Delete a generated image

### Medium

1. Generate a prompt then use it to create an image
2. Compare results between GPT Image 1 and Gemini Flash Image
3. Implement retry logic for rate-limited requests

### Hard

1. Build a batch image generation workflow
2. Implement image deduplication (avoid generating same prompt twice)
3. Create a cost estimator before image generation
