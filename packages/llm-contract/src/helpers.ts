import { err, ok, type Result } from '@intexuraos/common-core';
import type { LLMClient, LLMError, GenerateResult } from './types.js';

export type RealismStyle = 'photorealistic' | 'cinematic illustration' | 'clean vector';

export interface ThumbnailPromptParameters {
  aspectRatio: '16:9';
  framing: string;
  textOnImage: 'none';
  realism: RealismStyle;
  people: string;
  logosTrademarks: 'none';
}

export interface ThumbnailPrompt {
  title: string;
  visualSummary: string;
  prompt: string;
  negativePrompt: string;
  parameters: ThumbnailPromptParameters;
}

export interface ThumbnailPromptError {
  code: LLMError['code'] | 'PARSE_ERROR';
  message: string;
}

export interface ThumbnailPromptResult {
  thumbnailPrompt: ThumbnailPrompt;
  usage: GenerateResult['usage'];
}

const THUMBNAIL_PROMPT_SYSTEM = `You are an expert "Thumbnail Prompt Synthesizer" for image-generation models.

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

Now process the TEXT and output the JSON exactly as specified.`;

const VALID_REALISM_VALUES: RealismStyle[] = [
  'photorealistic',
  'cinematic illustration',
  'clean vector',
];

function isValidRealism(value: unknown): value is RealismStyle {
  return typeof value === 'string' && VALID_REALISM_VALUES.includes(value as RealismStyle);
}

function parseThumbnailPromptResponse(
  response: string
): Result<ThumbnailPrompt, ThumbnailPromptError> {
  let cleaned = response.trim();

  const jsonMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(cleaned);
  if (jsonMatch?.[1] !== undefined) {
    cleaned = jsonMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return err({
      code: 'PARSE_ERROR',
      message: `Failed to parse JSON response: ${response.slice(0, 200)}`,
    });
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return err({ code: 'PARSE_ERROR', message: 'Response is not a valid object' });
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj['title'] !== 'string' || obj['title'].length === 0) {
    return err({ code: 'PARSE_ERROR', message: 'Missing or invalid title' });
  }

  if (typeof obj['visualSummary'] !== 'string' || obj['visualSummary'].length === 0) {
    return err({ code: 'PARSE_ERROR', message: 'Missing or invalid visualSummary' });
  }

  if (typeof obj['prompt'] !== 'string' || obj['prompt'].length === 0) {
    return err({ code: 'PARSE_ERROR', message: 'Missing or invalid prompt' });
  }

  if (typeof obj['negativePrompt'] !== 'string' || obj['negativePrompt'].length === 0) {
    return err({ code: 'PARSE_ERROR', message: 'Missing or invalid negativePrompt' });
  }

  const params = obj['parameters'];
  if (typeof params !== 'object' || params === null) {
    return err({ code: 'PARSE_ERROR', message: 'Missing or invalid parameters' });
  }

  const p = params as Record<string, unknown>;

  if (typeof p['framing'] !== 'string') {
    return err({ code: 'PARSE_ERROR', message: 'Missing or invalid parameters.framing' });
  }

  if (!isValidRealism(p['realism'])) {
    return err({
      code: 'PARSE_ERROR',
      message: `Invalid realism value. Must be one of: ${VALID_REALISM_VALUES.join(', ')}`,
    });
  }

  if (typeof p['people'] !== 'string') {
    return err({ code: 'PARSE_ERROR', message: 'Missing or invalid parameters.people' });
  }

  return ok({
    title: obj['title'],
    visualSummary: obj['visualSummary'],
    prompt: obj['prompt'],
    negativePrompt: obj['negativePrompt'],
    parameters: {
      aspectRatio: '16:9',
      framing: p['framing'],
      textOnImage: 'none',
      realism: p['realism'],
      people: p['people'],
      logosTrademarks: 'none',
    },
  });
}

export async function generateThumbnailPrompt(
  client: LLMClient,
  text: string
): Promise<Result<ThumbnailPromptResult, ThumbnailPromptError>> {
  const fullPrompt = `${THUMBNAIL_PROMPT_SYSTEM}\n\nTEXT:\n${text}`;

  const generateResult = await client.generate(fullPrompt);

  if (!generateResult.ok) {
    return err({
      code: generateResult.error.code,
      message: generateResult.error.message,
    });
  }

  const parseResult = parseThumbnailPromptResponse(generateResult.value.content);

  if (!parseResult.ok) {
    return parseResult;
  }

  return ok({
    thumbnailPrompt: parseResult.value,
    usage: generateResult.value.usage,
  });
}
