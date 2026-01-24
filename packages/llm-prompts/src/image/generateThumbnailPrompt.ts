/**
 * Helper function for generating thumbnail prompts using an LLM client.
 * Moved from llm-contract to break cyclic dependency.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { LLMClient, LLMError, GenerateResult } from '@intexuraos/llm-contract';
import { thumbnailPrompt } from './thumbnailPrompt.js';

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
  const fullPrompt = thumbnailPrompt.build({ text });

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
