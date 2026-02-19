# Image Service - Technical Reference

## Overview

Image-service generates AI images using OpenAI GPT Image 1 and Google Gemini Flash Image, with LLM-powered prompt enhancement via GPT-4.1 and Gemini 2.5 Pro. Images are stored in GCS with automatic thumbnail generation (256px max edge, JPEG at 80% quality). Runs on Cloud Run with auto-scaling.

## Architecture

```mermaid
graph TB
    subgraph "Internal"
        Caller[research-agent]
    end

    subgraph "image-service"
        API[Fastify Routes]
        Domain[Domain Layer]
        Infra[Infrastructure Layer]
    end

    subgraph "Dependencies"
        UserSvc[user-service]
        LLM[LLM APIs]
        ImgGen[Image APIs]
        Firestore[(Firestore)]
        GCS[(GCS Bucket)]
    end

    Caller -->|POST /internal/images/generate| API
    Caller -->|POST /internal/images/prompts/generate| API
    Caller -->|DELETE /internal/images/:id| API

    API --> Domain
    Domain --> Infra

    Infra -->|getApiKeys| UserSvc
    Infra -->|generateThumbnailPrompt| LLM
    Infra -->|generateImage| ImgGen
    Infra -->|save| Firestore
    Infra -->|upload/delete| GCS

    classDef service fill:#e1f5ff
    classDef storage fill:#fff4e6
    classDef external fill:#f0f0f0

    class API,Domain,Infra service
    class Firestore,GCS storage
    class Caller,UserSvc,LLM,ImgGen external
```

## Data Flow

```mermaid
sequenceDiagram
    autonumber
    participant Caller as research-agent
    participant Service as image-service
    participant UserSvc as user-service
    participant LLM as LLM API
    participant ImgGen as Image API
    participant GCS as GCS
    participant Firestore as Firestore

    Caller->>+Service: POST /internal/images/generate
    Service->>UserSvc: getApiKeys(userId)
    UserSvc-->>Service: {openai, google} keys

    alt First, generate prompt
        Service->>LLM: generateThumbnailPrompt(text)
        LLM-->>Service: enhanced prompt
    end

    Service->>ImgGen: generateImage(prompt)
    ImgGen-->>Service: base64 image data

    Service->>GCS: upload(id, imageData)
    GCS-->>Service: {thumbnailUrl, fullSizeUrl}

    Service->>Firestore: save(GeneratedImage)
    Service-->>-Caller: {id, thumbnailUrl, fullSizeUrl}
```

## Recent Changes

| Commit     | Description                                                 | Date       |
| ---------- | ----------------------------------------------------------- | ---------- |
| `6063175b` | Add dev-mode log formatting for PM2 readability             | 2026-02-16 |
| `a52a6bbc` | Add Dash0 OpenTelemetry integration across all services     | 2026-02-16 |
| `e60eafc1` | Standardize API key secrets to APP naming convention        | 2026-02-15 |
| `c72b7c53` | Switch default LLM to Gemini 2.5 Flash, add Gemini fallback | 2026-02-15 |
| `0f69a74b` | Add default model selector with platform Zai fallback       | 2026-02-09 |
| `c3198407` | Fix all 132 response contract violations across codebase    | 2026-01-30 |
| `dfd702f1` | Add Sentry-enabled logger factory and migrate all apps      | 2026-01-30 |

## API Endpoints

### Internal Endpoints

| Method | Path                                | Purpose                         | Auth            |
| ------ | ----------------------------------- | ------------------------------- | --------------- |
| POST   | `/internal/images/prompts/generate` | Generate image prompt from text | Internal header |
| POST   | `/internal/images/generate`         | Generate image from prompt      | Internal header |
| DELETE | `/internal/images/:id`              | Delete image (used on unshare)  | Internal header |

### System Endpoints

| Method | Path            | Purpose               | Auth |
| ------ | --------------- | --------------------- | ---- |
| GET    | `/health`       | Health check          | None |
| GET    | `/docs`         | Swagger UI            | None |
| GET    | `/openapi.json` | OpenAPI specification | None |

## Domain Model

### GeneratedImage

| Field          | Type                | Description                                       |
| -------------- | ------------------- | ------------------------------------------------- |
| `id`           | `string`            | Unique image identifier (UUID v4)                 |
| `userId`       | `string`            | User who requested generation                     |
| `prompt`       | `string`            | Original or enhanced prompt used for generation   |
| `thumbnailUrl` | `string`            | GCS public URL for thumbnail (256px, JPEG)        |
| `fullSizeUrl`  | `string`            | GCS public URL for full-size image (PNG)          |
| `model`        | `string`            | Model used (e.g., `gpt-image-1`)                  |
| `createdAt`    | `string` (ISO 8601) | Creation timestamp                                |
| `slug`         | `string?`           | URL-safe identifier derived from title (optional) |

### ThumbnailPrompt

| Field            | Type                        | Description                                     |
| ---------------- | --------------------------- | ----------------------------------------------- |
| `title`          | `string`                    | Short title for the image (max 10 words)        |
| `visualSummary`  | `string`                    | One sentence describing the visual metaphor     |
| `prompt`         | `string`                    | Image generation prompt (80-180 words)          |
| `negativePrompt` | `string`                    | What to avoid (20-80 words)                     |
| `parameters`     | `ThumbnailPromptParameters` | Generation settings (aspect ratio, style, etc.) |

### ThumbnailPromptParameters

| Field             | Type           | Values                                                           |
| ----------------- | -------------- | ---------------------------------------------------------------- |
| `aspectRatio`     | `string`       | `"16:9"` (fixed)                                                 |
| `framing`         | `string`       | LLM-generated framing description                                |
| `textOnImage`     | `string`       | `"none"` (fixed)                                                 |
| `realism`         | `RealismStyle` | `"photorealistic"`, `"cinematic illustration"`, `"clean vector"` |
| `people`          | `string`       | LLM-generated people description                                 |
| `logosTrademarks` | `string`       | `"none"` (fixed)                                                 |

## Supported Models

### Image Generation Models

| Model                    | Provider | Description                           |
| ------------------------ | -------- | ------------------------------------- |
| `gpt-image-1`            | OpenAI   | GPT Image 1 (image generation model)  |
| `gemini-2.5-flash-image` | Google   | Gemini Flash Image (image generation) |

### Prompt Generation Models

| Model            | Provider | Purpose            |
| ---------------- | -------- | ------------------ |
| `gpt-4.1`        | OpenAI   | Prompt enhancement |
| `gemini-2.5-pro` | Google   | Prompt enhancement |

## Dependencies

### Internal Services

| Service        | Endpoint                           | Purpose                  |
| -------------- | ---------------------------------- | ------------------------ |
| `user-service` | `/internal/users/:userId/api-keys` | Fetch encrypted API keys |

### External Services

| Service           | Purpose                            |
| ----------------- | ---------------------------------- |
| OpenAI API        | GPT Image 1, GPT-4.1               |
| Google Imagen API | Gemini Flash Image, Gemini 2.5 Pro |

### Infrastructure

| Component                                 | Purpose                    |
| ----------------------------------------- | -------------------------- |
| Firestore (`generated_images` collection) | Image metadata persistence |
| GCS (`INTEXURAOS_IMAGE_BUCKET`)           | Image storage              |

## Configuration

| Variable                              | Required | Description                                   |
| ------------------------------------- | -------- | --------------------------------------------- |
| `INTEXURAOS_USER_SERVICE_URL`         | Yes      | User-service base URL                         |
| `INTEXURAOS_INTERNAL_AUTH_TOKEN`      | Yes      | Shared secret for internal auth               |
| `INTEXURAOS_GCP_PROJECT_ID`           | Yes      | Google Cloud project ID                       |
| `INTEXURAOS_AUTH_JWKS_URL`            | Yes      | JWKS endpoint for JWT verification            |
| `INTEXURAOS_AUTH_ISSUER`              | Yes      | JWT issuer                                    |
| `INTEXURAOS_AUTH_AUDIENCE`            | Yes      | JWT audience                                  |
| `INTEXURAOS_IMAGE_BUCKET`             | Yes      | GCS bucket for image storage                  |
| `INTEXURAOS_IMAGE_PUBLIC_BASE_URL`    | Yes      | Public base URL for GCS objects               |
| `INTEXURAOS_APP_SETTINGS_SERVICE_URL` | Yes      | App settings service (pricing data)           |
| `INTEXURAOS_SENTRY_DSN`               | No       | Sentry error tracking                         |
| `INTEXURAOS_ZAI_APP_API_KEY`          | No       | Platform Zai API key for user fallback        |
| `INTEXURAOS_GEMINI_APP_API_KEY`       | No       | Platform Gemini API key for user fallback     |
| `INTEXURAOS_DASH0_OTLP_ENDPOINT`      | No       | Dash0 OTLP endpoint for OpenTelemetry tracing |

## Gotchas

**Slug generation**: The `slug` field is derived from the title using slugify() for clean URLs (max 50 chars, lowercase, hyphens for spaces). Only used for research cover images.

**Thumbnail size**: Thumbnails are exactly 256px on the longest edge, maintaining aspect ratio, saved as JPEG at 80% quality for size optimization.

**GCS path patterns**:

- With slug: `images/{id}-{slug}.png` / `images/{id}-{slug}-thumb.jpg`
- Without slug: `images/{id}/full.png` / `images/{id}/thumbnail.jpg`

**Deletion cascade**: When deleting an image, both GCS objects and Firestore record are removed. If GCS deletion fails, the record is still removed from Firestore (orphan cleanup not implemented).

**API key validation**: Service validates that the user has the required provider API key before generation. Missing keys return 400 with specific provider mentioned.

**Image format**: All images are generated as PNG format for maximum quality; thumbnails are JPEG for size optimization.

**Base64 handling**: OpenAI returns base64-encoded images which are decoded before uploading to GCS.

**Prompt-only endpoint**: `/prompts/generate` only generates prompts; it does not generate images. Caller must call `/images/generate` separately.

**No deduplication**: Each image generation creates a new unique ID. Identical prompts generate separate images.

**Internal-only access**: All functional endpoints require `X-Internal-Auth` header. No public API endpoints.

**Rate limit error code**: Rate limited responses now return `reply.fail('RATE_LIMITED', message)` with proper 429 status code, instead of the previous manual `apiFail()` approach.

**Auth failure response**: Internal auth failures now return standardized `{ success: false, error: { code: 'UNAUTHORIZED', message } }` instead of `{ error: 'Unauthorized' }`.

## File Structure

```
apps/image-service/src/
  domain/
    models/
      ImageGenerationModel.ts      # GPT Image 1, Gemini Flash Image
      ImagePromptModel.ts           # GPT-4.1, Gemini 2.5 Pro
      GeneratedImage.ts             # GeneratedImage entity
      ThumbnailPrompt.ts            # Prompt response structure
    ports/
      generatedImageRepository.ts   # Firestore interface
      imageGenerator.ts             # Image generation interface
      imageStorage.ts               # GCS storage interface
      promptGenerator.ts            # LLM prompt generation interface
  infra/
    firestore/
      GeneratedImageFirestoreRepository.ts
    image/
      OpenAIImageGenerator.ts       # GPT Image 1 integration
      GoogleImageGenerator.ts       # Gemini Flash Image integration
      FakeImageGenerator.ts         # Testing fake
    llm/
      GptPromptAdapter.ts           # GPT-4.1 prompt generation
      GeminiPromptAdapter.ts        # Gemini prompt generation
      parseResponse.ts              # LLM response parser
    storage/
      GcsImageStorage.ts            # GCS operations with Sharp
    # UserServiceClient imported directly from @intexuraos/internal-clients
  routes/
    internalRoutes.ts               # POST /internal/images/generate
                                   # POST /internal/images/prompts/generate
                                   # DELETE /internal/images/:id
    schemas/
      imageSchemas.ts               # Image generation schemas
      promptSchemas.ts              # Prompt generation schemas
  services.ts                       # DI container
  index.ts                          # Entry point
  server.ts                         # Fastify server setup
```

## Migration Notes

### Dev-Mode Log Formatting (2026-02-16)

- `server.ts` now uses `createLogStream()` from `@intexuraos/infra-sentry` instead of raw pino JSON
- Colorized output format in development: `service-name | HH:mm:ss | LEVEL | message | {extras}`
- No behavior change in production or test environments

### Dash0 OpenTelemetry Integration (2026-02-16)

- Added distributed tracing, metrics, and log export via OTLP/HTTP to Dash0
- New `packages/infra-otel` package loaded via Node `--import` preload in Dockerfile
- No-op when `INTEXURAOS_DASH0_OTLP_ENDPOINT` is unset — transparent to services

### API Key Naming Standardization and Gemini Fallback (2026-02-15)

- `INTEXURAOS_ZAI_APP_API_KEY` consolidated from `INTEXURAOS_GUEST_ZAI_API_KEY` + `INTEXURAOS_ZAI_API_KEY`
- `INTEXURAOS_GEMINI_APP_API_KEY` added as primary platform fallback before ZAI
- `platformZaiApiKey` and `platformGeminiApiKey` both passed to `createUserServiceClient()`
- Gemini 2.5 Flash is now the primary fallback model (ZAI GLM was too slow at 29s for title generation)

### Platform Key Fallback (2026-02-09)

- Users without their own provider API key now fall back to platform-owned Zai key
- `UserServiceClient.getApiKeys()` returns platform keys if user has none configured
- Image generation proceeds for all users, not just those with personal API keys

### Response Contract Migration (2026-02-08)

- All internal endpoints migrated from ad-hoc response formats to `reply.ok()` / `reply.fail()`
- `apiFail` import removed from `@intexuraos/common-http`
- Rate limit errors: `apiFail()` + `reply.status(429).send()` -> `reply.fail('RATE_LIMITED', message)`
- Auth failures: `{ error: 'Unauthorized' }` -> `reply.fail('UNAUTHORIZED', message)`
- Sentry logger: `pino()` -> `createAppLogger()` from `@intexuraos/infra-sentry`

### INT-301 Direct Import Consolidation (2026-01-26)

- Deleted local `infra/user/index.ts` re-export barrel
- All user service client types imported directly from `@intexuraos/internal-clients`
- `FakeUserServiceClient` updated with `getOAuthToken` method

### INT-269 Internal-Clients Migration (2025-01-25)

- User service client migrated from direct HTTP calls to `@intexuraos/internal-clients` package
- `UserServiceClient` now imported from shared package
- `getApiKeys()` method signature unchanged - backwards compatible
