/**
 * Claude adapter implementing LlmResearchProvider.
 * Usage logging is handled by the client (packages/infra-claude).
 */

import { type ClaudeClient, createClaudeClient } from '@intexuraos/infra-claude';
import type { Logger, Result } from '@intexuraos/common-core';
import type { ModelPricing } from '@intexuraos/llm-contract';
import { buildResearchPrompt, type ResearchContext } from '@intexuraos/llm-prompts';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
} from '../../domain/research/index.js';

export class ClaudeAdapter implements LlmResearchProvider {
  private readonly client: ClaudeClient;
  private readonly model: string;
  private readonly logger: Logger;

  constructor(
    apiKey: string,
    model: string,
    userId: string,
    pricing: ModelPricing,
    logger: Logger
  ) {
    this.client = createClaudeClient({ apiKey, model, userId, pricing, logger });
    this.model = model;
    this.logger = logger;
  }

  async research(prompt: string, ctx?: ResearchContext): Promise<Result<LlmResearchResult, LlmError>> {
    const builtPrompt = buildResearchPrompt(prompt, ctx);
    this.logger.info({ model: this.model, promptLength: builtPrompt.length }, 'Claude research started');
    const result = await this.client.research(builtPrompt);
    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code, errorMessage: error.message },
        'Claude research failed'
      );
      return { ok: false, error };
    }
    this.logger.info(
      { model: this.model, usage: result.value.usage },
      'Claude research completed'
    );
    return result;
  }
}

function mapToLlmError(error: { code: string; message: string }): LlmError {
  const validCodes = ['API_ERROR', 'TIMEOUT', 'INVALID_KEY', 'RATE_LIMITED'] as const;
  const code = validCodes.includes(error.code as (typeof validCodes)[number])
    ? (error.code as LlmError['code'])
    : 'API_ERROR';

  return { code, message: error.message };
}
