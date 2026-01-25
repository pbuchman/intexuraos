# image-service — Agent Interface

> Machine-readable specification for AI agents interacting with image-service.

---

## Identity

| Attribute | Value                                                                                |
| --------- | ------------------------------------------------------------------------------------ |
| **Name**  | image-service                                                                        |
| **Role**  | AI Image Generation Service                                                          |
| **Goal**  | Generate cover images and optimized prompts using GPT Image 1 and Gemini Flash Image |

---

## Capabilities

### Generate Thumbnail Prompt

**Endpoint:** `POST /internal/images/prompts/generate`

**When to use:** When you need to convert text content into an optimized image generation prompt

**Input Schema:**

```typescript
interface GeneratePromptInput {
  text: string; // Content to visualize (10-60000 characters)
  model: 'gpt-4.1' | 'gemini-2.5-pro'; // LLM for prompt generation
  userId: string; // User ID for API key lookup
}
```

**Output Schema:**

```typescript
interface ThumbnailPrompt {
  title: string; // Short title (max 10 words)
  visualSummary: string; // One sentence visual metaphor
  prompt: string; // Image generation prompt (80-180 words)
  negativePrompt: string; // What to avoid (20-80 words)
  parameters: {
    aspectRatio: '16:9';
    framing: string;
    textOnImage: 'none';
    realism: 'photorealistic' | 'cinematic illustration' | 'clean vector';
    people: string;
    logosTrademarks: 'none';
  };
}

interface GeneratePromptOutput {
  title: string;
  visualSummary: string;
  prompt: string;
  negativePrompt: string;
  parameters: ThumbnailPromptParameters;
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
  "title": "AI and Machine Learning Research",
  "visualSummary": "A futuristic digital artwork featuring neural networks",
  "prompt": "A professional visualization of artificial intelligence research, featuring neural network patterns and data flow in a modern digital art style with deep blue and purple colors",
  "negativePrompt": "blurry, low quality, distorted, ugly, poorly drawn",
  "parameters": {
    "aspectRatio": "16:9",
    "framing": "centered composition with leading space",
    "textOnImage": "none",
    "realism": "cinematic illustration",
    "people": "no people",
    "logosTrademarks": "none"
  }
}
```

### Generate Image

**Endpoint:** `POST /internal/images/generate`

**When to use:** When you need to generate an actual image from a prompt

**Input Schema:**

```typescript
interface GenerateImageInput {
  prompt: string; // Image generation prompt (10-2000 chars)
  model: 'gpt-image-1' | 'gemini-2.5-flash-image'; // Image generation model
  userId: string; // User ID for API key lookup and ownership
  title?: string; // Optional title for slug-based filename
}
```

**Output Schema:**

```typescript
interface GenerateImageData {
  id: string; // Unique image identifier
  thumbnailUrl: string; // GCS public URL for 256px thumbnail
  fullSizeUrl: string; // GCS public URL for full-size image
}

interface GenerateImageOutput {
  id: string;
  thumbnailUrl: string;
  fullSizeUrl: string;
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
  "id": "img_xyz789",
  "thumbnailUrl": "https://storage.googleapis.com/bucket/images/img_xyz789-mountain-sunset-thumb.jpg",
  "fullSizeUrl": "https://storage.googleapis.com/bucket/images/img_xyz789-mountain-sunset.png"
}
```

### Delete Image

**Endpoint:** `DELETE /internal/images/:id`

**When to use:** When content is unshared and the cover image should be removed

**Input Schema:**

```typescript
interface DeleteImageInput {
  id: string; // Image ID to delete
}
```

**Output Schema:**

```typescript
interface DeleteImageOutput {
  deleted: true;
}
```

---

## Constraints

**Do NOT:**

- Generate images without a valid API key for the selected provider
- Use prompt generation for text under 10 characters or over 60000 characters
- Generate images with prompts under 10 characters or over 2000 characters
- Expect image editing - only generation is supported

**Requires:**

- User must have the required provider API key configured in user-service
- `X-Internal-Auth` header must be set with valid internal token
- GCS bucket must be accessible for upload/delete operations

---

## Usage Patterns

### Pattern 1: Research Cover Image Generation

```
1. Research-agent receives research with title
2. Call POST /internal/images/prompts/generate with research title
3. Receive enhanced prompt with visual parameters
4. Call POST /internal/images/generate with enhanced prompt
5. Receive image URLs
6. Store image ID in research document
7. On unshare: DELETE /internal/images/:id
```

### Pattern 2: Prompt-Only Workflow

```
1. Caller has text content that needs visualization
2. Call POST /internal/images/prompts/generate
3. Receive structured prompt with title, summary, parameters
4. Caller may modify prompt before calling image generation
5. Image generation is a separate step
```

---

## Error Handling

| Error Code      | Meaning                      | Recovery Action                      |
| --------------- | ---------------------------- | ------------------------------------ |
| `INVALID_KEY`   | User's API key is invalid    | User must update API key in settings |
| `RATE_LIMITED`  | Provider rate limit exceeded | Retry with exponential backoff       |
| `TIMEOUT`       | Provider request timed out   | Retry with longer timeout            |
| `API_ERROR`     | Provider API error           | Check provider status, retry         |
| `STORAGE_ERROR` | GCS upload failed            | Check GCS permissions, retry         |
| `PARSE_ERROR`   | LLM response parsing failed  | Retry with different model           |

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

| Service      | Why Needed                            | Failure Behavior                   |
| ------------ | ------------------------------------- | ---------------------------------- |
| user-service | Fetch encrypted API keys per provider | Rejects request with 400 error     |
| GCS          | Store generated images and thumbnails | Returns storage error to caller    |
| Firestore    | Persist image metadata for tracking   | Cleans up GCS image, returns error |

---

**Last updated:** 2025-01-25
