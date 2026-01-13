# Image Service

AI-powered image generation and prompt enhancement for IntexuraOS. Creates cover images for research and generates optimized prompts from text content.

## The Problem

AI-generated content needs visual elements:

1. **Cover images** - Research and notes need thumbnails for sharing
2. **Prompt enhancement** - Raw text needs refinement for image generation
3. **Storage management** - Generated images need persistent storage with CDN access
4. **Cost tracking** - Image generation costs should be tracked per user

## How It Helps

Image-service provides two core capabilities:

1. **Image generation** - Creates images using OpenAI DALL-E 3 or Google Imagen 3
2. **Prompt generation** - Converts text content into optimized image prompts using LLMs

Generated images are:
- Stored in Google Cloud Storage with signed URLs
- Automatically thumbnailed (256px max edge)
- Tracked in Firestore for cost attribution
- Can be deleted when content is unshared

## Use Cases

### Research Cover Images

When research completes:

1. Research-agent calls image-service with research title
2. Image-service generates an optimized prompt from the title
3. Image is generated using DALL-E 3 or Imagen 3
4. Image stored in GCS with signed URLs
5. Research updated with cover image ID
6. When research is unshared, image is deleted

### Thumbnail Prompts

For notes and bookmarks:

1. Text content (title + excerpt) sent to image-service
2. LLM generates an optimized image generation prompt
3. Prompt returned to caller (image not generated yet)

## Key Benefits

**Multi-provider support** - Choose between OpenAI DALL-E 3 and Google Imagen 3

**Smart prompt generation** - LLM-powered prompt enhancement for better results

**Automatic thumbnailing** - 256px thumbnails generated alongside full-size images

**Cost transparency** - Image generation tracked per user for billing

**Clean deletion** - Images removed from GCS when content is unshared

## Limitations

**No image editing** - Only generates new images; cannot modify existing images

**Fixed aspect ratio** - Images generated with 1:1 square aspect ratio only

**No image variations** - Cannot generate variations of an existing image

**Prompt-only mode** - Some operations return prompts without generating images

**No style presets** - No pre-defined artistic styles or filters

**Size limit** - Generated images are 1024x1024 maximum
