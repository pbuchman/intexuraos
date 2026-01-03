import { err, ok, type Result } from '@intexuraos/common-core';
import type { ThumbnailPrompt, RealismStyle } from '../../domain/index.js';
import type { PromptGenerationError } from '../../domain/ports/promptGenerator.js';

const VALID_REALISM_VALUES: RealismStyle[] = [
  'photorealistic',
  'cinematic illustration',
  'clean vector',
];

function isValidRealism(value: unknown): value is RealismStyle {
  return typeof value === 'string' && VALID_REALISM_VALUES.includes(value as RealismStyle);
}

export function parseThumbnailPromptResponse(
  response: string
): Result<ThumbnailPrompt, PromptGenerationError> {
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
    return err({
      code: 'PARSE_ERROR',
      message: 'Response is not a valid object',
    });
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

  const title = obj['title'];
  const visualSummary = obj['visualSummary'];
  const prompt = obj['prompt'];
  const negativePrompt = obj['negativePrompt'];
  const framing = p['framing'];
  const people = p['people'];
  const realism = p['realism'];

  const result: ThumbnailPrompt = {
    title,
    visualSummary,
    prompt,
    negativePrompt,
    parameters: {
      aspectRatio: '16:9',
      framing,
      textOnImage: 'none',
      realism,
      people,
      logosTrademarks: 'none',
    },
  };

  return ok(result);
}
