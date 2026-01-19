/**
 * Thumbnail prompt for generating image prompts from text content.
 * Converts article/post content into structured image generation prompts.
 */

import type { PromptBuilder, PromptDeps } from '../shared/types.js';

export interface ThumbnailPromptInput {
  /** The text content to generate a thumbnail prompt for */
  text: string;
}

export interface ThumbnailPromptDeps extends PromptDeps {
  /** Maximum text length to process (default: 60000) */
  maxTextLength?: number;
}

export const thumbnailPrompt: PromptBuilder<ThumbnailPromptInput, ThumbnailPromptDeps> = {
  name: 'thumbnail-prompt',
  description: 'Generates structured image prompts from text content for thumbnail generation',

  build(input: ThumbnailPromptInput, deps?: ThumbnailPromptDeps): string {
    const maxTextLength = deps?.maxTextLength ?? 60000;
    const text =
      input.text.length > maxTextLength ? input.text.slice(0, maxTextLength) : input.text;

    return `You are an expert "Thumbnail Prompt Synthesizer" for image-generation models.

Task:
Convert the provided TEXT (up to 60,000 characters) into ONE high-quality image-generation prompt that will produce a compelling thumbnail/cover image for that text when shown at small size (preview card / article header thumbnail).

Inputs:
- TEXT: the full article/post/content.

Output:
Return ONLY valid JSON with the following structure (no markdown, no explanation):
{
  "title": "short, punchy title for the image concept, max 10 words",
  "visualSummary": "one sentence describing the core visual metaphor, max 25 words",
  "prompt": "a single image-generation prompt, 80-180 words, optimized for a thumbnail",
  "negativePrompt": "what to avoid, 20-80 words",
  "parameters": {
    "aspectRatio": "16:9",
    "framing": "subject large and readable at small size",
    "textOnImage": "none",
    "realism": "photorealistic OR cinematic illustration OR clean vector",
    "people": "avoid recognizable real persons; use generic silhouettes if needed",
    "logosTrademarks": "none"
  }
}

Rules:
1) Extract the central theme and ONE strongest visual hook from the TEXT (not a collage of everything).
2) Prefer clear subject, bold silhouette, strong contrast, simple background, and a single focal point.
3) Use concrete visual nouns, lighting, lens/framing, environment, color palette, mood, and style cues.
4) No words, captions, UI screenshots, watermarks, or brand marks in the image.
5) If the TEXT contains sensitive personal data, ignore it and generalize.
6) If the TEXT is abstract, choose a tasteful metaphor (objects, environment, symbolism) that matches the tone.
7) If multiple interpretations exist, pick the one most "thumbnail-effective" (instantly readable).
8) For "realism" in parameters, choose exactly one: "photorealistic", "cinematic illustration", or "clean vector" based on the TEXT tone.

Now process the TEXT and output the JSON exactly as specified.

TEXT:
${text}`;
  },
};
