# image-service -- Agent Interface

> Machine-readable specification for AI agents interacting with image-service.

---

## Identity

| Attribute | Value                                                                                |
| --------- | ------------------------------------------------------------------------------------ |
| **Name**  | image-service                                                                        |
| **Role**  | AI image generation and prompt enhancement service                                   |
| **Goal**  | Generate cover images and optimized prompts using GPT Image 1 and Gemini Flash Image |

---

## Capabilities

### Generate Thumbnail Prompt

**Endpoint:** `POST /internal/images/prompts/generate`

**When to use:** When you have text content (research title, article excerpt, note body) that needs to be converted into an optimized image generation prompt. Call this before calling the image generation endpoint.

**Input Schema:**

```typescript
interface GeneratePromptInput {
  text: string;   // Content to visualize (10-60000 characters)
  model: 'gpt-4.1' | 'gemini-2.5-pro';  // LLM for prompt generation
  userId: string;  // User ID for API key lookup
}
```

**Output Schema:**

```typescript
interface ThumbnailPrompt {
  title: string;           // Short title (max 10 words)
  visualSummary: string;   // One sentence visual metaphor (max 25 words)
  prompt: string;          // Image generation prompt (80-180 words)
  negativePrompt: string;  // What to avoid (20-80 words)
  parameters: {
    aspectRatio: '16:9';
    framing: string;
    textOnImage: 'none';
    realism: 'photorealistic' | 'cinematic illustration' | 'clean vector';
    people: string;
    logosTrademarks: 'none';
  };
}
```

**Example:**

```json
// Request
{
  "text": "Research about artificial intelligence and machine learning trends",
  "model": "gemini-2.5-pro",
  "userId": "user_abc123"
}

// Response
{
  "success": true,
  "data": {
    "title": "AI and Machine Learning Research",
    "visualSummary": "A futuristic digital artwork featuring neural networks",
    "prompt": "A professional visualization of artificial intelligence research, featuring neural network patterns and data flow in a modern digital art style with deep blue and purple colors",
    "negativePrompt": "blurry, low quality, distorted, ugly, poorly drawn, text, watermark",
    "parameters": {
      "aspectRatio": "16:9",
      "framing": "centered composition with leading space",
      "textOnImage": "none",
      "realism": "cinematic illustration",
      "people": "no people",
      "logosTrademarks": "none"
    }
  }
}
```

### Generate Image

**Endpoint:** `POST /internal/images/generate`

**When to use:** When you have a prompt (either from the prompt generation endpoint or crafted manually) and need to create an actual image. The image is automatically stored in GCS with both full-size and thumbnail versions.

**Input Schema:**

```typescript
interface GenerateImageInput {
  prompt: string;  // Image generation prompt (10-2000 characters)
  model: 'gpt-image-1' | 'gemini-2.5-flash-image';  // Image generation model
  userId: string;  // User ID for API key lookup and ownership
  title?: string;  // Optional title for slug-based filename (max 100 chars)
}
```

**Output Schema:**

```typescript
interface GenerateImageOutput {
  id: string;            // Unique image identifier (UUID v4)
  thumbnailUrl: string;  // GCS public URL for 256px JPEG thumbnail
  fullSizeUrl: string;   // GCS public URL for full-size PNG image
}
```

**Example:**

```json
// Request
{
  "prompt": "A serene mountain landscape at sunset with a lake reflection, photorealistic style",
  "model": "gpt-image-1",
  "userId": "user_abc123",
  "title": "Mountain Sunset"
}

// Response
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "thumbnailUrl": "https://storage.googleapis.com/bucket/images/a1b2c3d4-mountain-sunset-thumb.jpg",
    "fullSizeUrl": "https://storage.googleapis.com/bucket/images/a1b2c3d4-mountain-sunset.png"
  }
}
```

### Delete Image

**Endpoint:** `DELETE /internal/images/:id`

**When to use:** When content that owns an image is unshared or deleted. Removes both GCS objects (full-size and thumbnail) and the Firestore metadata record.

**Input Schema:**

```typescript
interface DeleteImageInput {
  id: string;  // Image ID (UUID, passed as URL path parameter)
}
```

**Output Schema:**

```typescript
interface DeleteImageOutput {
  deleted: true;
}
```

**Example:**

```json
// Request: DELETE /internal/images/a1b2c3d4-e5f6-7890-abcd-ef1234567890

// Response
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

---

## Constraints

**Do NOT:**

- Call image generation without first ensuring the user has the required provider API key (or platform fallback keys are configured)
- Send prompt text under 10 characters or over 60000 characters
- Send image generation prompts under 10 characters or over 2000 characters
- Expect image editing, inpainting, or variation generation -- only new image creation is supported
- Assume deduplication -- identical prompts generate separate images with unique IDs

**Requires:**

- `X-Internal-Auth` header must be set with valid internal token on all requests
- User must have the required provider API key configured in user-service, OR platform fallback keys must be set (`INTEXURAOS_GEMINI_APP_API_KEY`, `INTEXURAOS_ZAI_APP_API_KEY`)
- GCS bucket must be accessible for upload/delete operations

---

## Usage Patterns

### Pattern 1: Research Cover Image Generation

```
1. Research-agent receives completed research with title
2. Call POST /internal/images/prompts/generate with research title as text
3. Extract data.prompt from response
4. Call POST /internal/images/generate with extracted prompt and title
5. Receive {id, thumbnailUrl, fullSizeUrl}
6. Store image ID in research document as coverImageId
7. When research is unshared: DELETE /internal/images/:id
```

### Pattern 2: Prompt-Only Workflow

```
1. Caller has text content that needs visualization
2. Call POST /internal/images/prompts/generate with text
3. Receive structured prompt with title, summary, and parameters
4. Caller may inspect or modify the prompt before image generation
5. Image generation is a separate step via POST /internal/images/generate
```

### Pattern 3: Direct Image Generation (Skip Prompt Enhancement)

```
1. Caller already has an optimized prompt
2. Call POST /internal/images/generate directly with prompt, model, userId
3. Optionally include title for slug-based filenames
4. Receive {id, thumbnailUrl, fullSizeUrl}
```

---

## Error Handling

| Error Code         | HTTP Status | Meaning                          | Recovery Action                             |
| ------------------ | ----------- | -------------------------------- | ------------------------------------------- |
| `UNAUTHORIZED`     | 401         | Invalid internal auth header     | Fix X-Internal-Auth header value            |
| `INVALID_REQUEST`  | 400         | Missing API key for provider     | User must add API key or configure fallback |
| `RATE_LIMITED`     | 429         | Provider rate limit exceeded     | Retry with exponential backoff              |
| `DOWNSTREAM_ERROR` | 502         | Provider or user-service failure | Check provider/service status, retry        |
| `INTERNAL_ERROR`   | 500         | Firestore save failed            | GCS image cleaned up; retry full operation  |
| `PARSE_ERROR`      | 502         | LLM response malformed           | Retry with same or different model          |

---

## Rate Limits

No service-level rate limits. Provider limits apply:

| Provider | Limit Type         | Notes                      |
| -------- | ------------------ | -------------------------- |
| OpenAI   | Per-account limits | Configured via API keys    |
| Google   | Per-project quotas | Configured via GCP project |

---

## Events Published

None. Image-service does not publish Pub/Sub events.

---

## Dependencies

| Service           | Why Needed                                 | Failure Behavior                                 |
| ----------------- | ------------------------------------------ | ------------------------------------------------ |
| user-service      | Fetch encrypted API keys per provider      | Rejects request with 502 DOWNSTREAM_ERROR        |
| GCS               | Store generated images and thumbnails      | Returns STORAGE_ERROR; image generation reverted |
| Firestore         | Persist image metadata for tracking        | Cleans up GCS image, returns 500 INTERNAL_ERROR  |
| OpenAI API        | GPT Image 1 generation, GPT-4.1 prompts    | Returns DOWNSTREAM_ERROR to caller               |
| Google Gemini API | Gemini Flash Image, Gemini 2.5 Pro prompts | Returns DOWNSTREAM_ERROR to caller               |

---

**Last updated:** 2026-02-22
