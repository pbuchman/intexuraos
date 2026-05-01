/**
 * Context label generation service.
 * Automatically generates labels for contexts that don't have them.
 */

import { LlmModels } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import type { Gemini25Flash } from '@intexuraos/llm-contract';
import type { TitleGenerator } from '../ports/llmProvider.js';

export interface ContextWithLabel {
  content: string;
  label?: string;
}

export async function generateContextLabels(
  contexts: ContextWithLabel[],
  googleApiKey: string | undefined,
  userId: string,
  createTitleGenerator: (
    model: Gemini25Flash,
    apiKey: string,
    userId: string,
    logger: Logger
  ) => TitleGenerator,
  logger: Logger
): Promise<ContextWithLabel[]> {
  if (googleApiKey === undefined) {
    return contexts;
  }

  const generator = createTitleGenerator(LlmModels.Gemini25Flash, googleApiKey, userId, logger);

  return await Promise.all(
    contexts.map(async (ctx) => {
      if (ctx.label !== undefined && ctx.label !== '') {
        return ctx;
      }
      const labelResult = await generator.generateContextLabel(ctx.content);
      const result: ContextWithLabel = {
        content: ctx.content,
      };
      if (labelResult.ok) {
        result.label = labelResult.value.label;
      }
      return result;
    })
  );
}
