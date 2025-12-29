/**
 * Claude adapter implementing LlmResearchProvider.
 */

import { createClaudeClient, type ClaudeClient } from '@intexuraos/infra-claude';
import type { Result } from '@intexuraos/common-core';
import type {
  LlmResearchProvider,
  LlmResearchResult,
  LlmError,
} from '../../domain/research/index.js';

export class ClaudeAdapter implements LlmResearchProvider {
  private readonly client: ClaudeClient;

  constructor(apiKey: string) {
    this.client = createClaudeClient({ apiKey });
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    const result = await this.client.research(prompt);

    if (!result.ok) {
      return {
        ok: false,
        error: mapToLlmError(result.error),
      };
    }

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
