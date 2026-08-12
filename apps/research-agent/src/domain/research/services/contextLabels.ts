/**
 * Context label generation service.
 * Automatically generates labels for contexts that don't have them.
 */

import {
  DEFAULT_PLATFORM_LLM_MODEL,
  type ResearchModel,
} from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import type { TitleGenerator } from '../ports/llmProvider.js';

export interface ContextWithLabel {
  content: string;
  label?: string;
}

export async function generateContextLabels(
  contexts: ContextWithLabel[],
  openRouterApiKey: string | undefined,
  userId: string,
  createTitleGenerator: (
    model: ResearchModel,
    apiKey: string,
    userId: string,
    logger: Logger,
    researchId?: string
  ) => TitleGenerator,
  logger: Logger,
  researchId?: string
): Promise<ContextWithLabel[]> {
  if (openRouterApiKey === undefined) {
    return contexts;
  }

  const generator = createTitleGenerator(
    DEFAULT_PLATFORM_LLM_MODEL,
    openRouterApiKey,
    userId,
    logger,
    researchId
  );

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
