# Image Service

Generate AI-powered cover images and optimized prompts for IntexuraOS research and content.

## The Problem

AI-generated content like research reports and notes needs compelling visual elements for sharing and browsing. Creating cover images manually is time-consuming and requires design skills. Raw text descriptions produce poor results when fed directly to image generation models. Teams need a centralized way to generate, store, and manage images with per-user cost tracking and automatic cleanup.

## How It Helps

### AI-Powered Prompt Generation

Transforms raw text content into structured, optimized image generation prompts using LLMs. The service analyzes input text and produces a complete prompt specification including title, visual metaphor, detailed generation prompt, negative prompt, and rendering parameters like framing and realism style.

**Example:** You submit a research title "Quantum Computing Advances" -- the service returns a structured prompt with visual metaphor, style parameters, and a detailed image generation prompt optimized for photorealistic or illustration styles.

### Multi-Provider Image Generation

Creates images using either OpenAI GPT Image 1 or Google Gemini 2.5 Flash Image, selecting the provider based on the user's configured API keys. Generated images are automatically uploaded to Google Cloud Storage with both full-size PNG and compressed JPEG thumbnails.

**Example:** A research-agent calls the image generation endpoint with an enhanced prompt and model choice. The service generates the image, creates a 256px thumbnail, uploads both to GCS, and returns public URLs ready for embedding.

### Automatic Thumbnail Creation

Every generated image produces both a full-size PNG and a 256px JPEG thumbnail (80% quality) in a single operation. Thumbnails maintain the original aspect ratio with the longest edge capped at 256 pixels, optimized for fast loading in feed views and previews.

**Example:** A 1024x768 image generates a 256x192 JPEG thumbnail alongside the full-size PNG, both served from GCS with one-year cache headers.

### Clean Lifecycle Management

Images follow the lifecycle of the content they belong to. When research is unshared, the cover image is deleted from both GCS storage and the Firestore metadata record in a single operation, preventing orphaned files from accumulating.

**Example:** A user unshares their research report. The research-agent calls DELETE on the image ID, and both the GCS objects (full-size and thumbnail) and the Firestore record are removed.

## Use Case

A research-agent completes a report on "AI Safety and Alignment Strategies." It calls image-service with the research title. The service generates an optimized image prompt using Gemini 2.5 Pro, producing a structured specification with visual metaphor and style parameters. The research-agent then calls the image generation endpoint with that prompt and the user's preferred model. Image-service generates the cover image, creates a thumbnail, uploads both to GCS, saves metadata to Firestore, and returns the public URLs. The research-agent stores the image ID in the research document. When the user later unshares the research, the image is automatically deleted.

## Key Benefits

- Multi-provider flexibility -- choose between OpenAI and Google image generation models
- Structured prompt enhancement turns raw text into optimized generation prompts
- Automatic thumbnail creation reduces client-side processing
- Platform key fallback enables image generation for users without personal API keys
- Clean deletion prevents storage waste when content is removed
- Per-user cost tracking through LLM pricing integration

## Limitations

- Only generates new images; cannot edit, inpaint, or create variations of existing images
- Prompt text input limited to 10-60000 characters; image prompts limited to 10-2000 characters
- No batch generation -- each image requires a separate API call
- No style presets or pre-defined artistic filters
- Thumbnail size fixed at 256px maximum edge; not configurable per request
- Internal-only access -- no public-facing API endpoints

---

_Part of [IntexuraOS](../overview.md) -- AI-powered visual content generation._
