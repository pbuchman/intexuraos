# image-service — Agent Interface

> Machine-readable interface definition for AI agents interacting with image-service.

---

## Identity

| Field    | Value                                             |
| --------  | -------------------------------------------------  |
| **Name** | image-service                                     |
| **Role** | AI Image Generation Service                       |
| **Goal** | Generate cover images using DALL-E 3 and Imagen 3 |

---

## Capabilities

### Tools (Endpoints)

```typescript
interface ImageServiceTools {
  // Generate cover image for research
  generateCoverImage(params: {
    researchId: string;
    prompt: string;
    model?: ImageModel;
  }): Promise<GeneratedImage>;

  // Get image metadata
  getImage(imageId: string): Promise<ImageMetadata>;
}
```

### Types

```typescript
type ImageModel = 'dall-e-3' | 'imagen-3';

interface GeneratedImage {
  id: string;
  url: string;
  thumbnailUrl: string;
  prompt: string;
  enhancedPrompt: string;
  model: ImageModel;
  createdAt: string;
}

interface ImageMetadata {
  id: string;
  researchId: string;
  url: string;
  thumbnailUrl: string;
  prompt: string;
  enhancedPrompt: string;
  model: ImageModel;
  width: number;
  height: number;
  size: number;
  createdAt: string;
}
```

---

## Constraints

| Rule                 | Description                                  |
| --------------------  | --------------------------------------------  |
| **API Key Required** | OpenAI key for DALL-E, Google key for Imagen |
| **Research Link**    | Images must be linked to a research ID       |
| **Storage**          | Images stored in Google Cloud Storage        |
| **Thumbnail**        | Auto-generated 400px thumbnail               |

---

## Usage Patterns

### Generate Cover Image

```typescript
const image = await generateCoverImage({
  researchId: 'research_123',
  prompt: 'Quantum computing implications on cryptography',
  model: 'dall-e-3',
});
// image.url contains the full-size image
// image.thumbnailUrl contains the 400px thumbnail
```

### Prompt Enhancement

The service automatically enhances prompts before generation:

```
Input: "AI research"
Enhanced: "A professional, abstract visualization of artificial intelligence
research, featuring neural network patterns and data flow, modern digital
art style, 16:9 aspect ratio"
```

---

## Internal Endpoints

| Method | Path                        | Purpose                                   |
| ------  | ---------------------------  | -----------------------------------------  |
| POST   | `/internal/images/generate` | Generate image (called by research-agent) |
| DELETE | `/internal/images/:id`      | Delete image when research unshared       |

---

**Last updated:** 2026-01-19
