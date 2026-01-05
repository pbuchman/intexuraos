/**
 * Claude adapter implementing LlmResearchProvider.
 * Usage logging is handled by the client (packages/infra-claude).
 */

import { type ClaudeClient, createClaudeClient } from '@intexuraos/infra-claude';
import type { Result } from '@intexuraos/common-core';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
} from '../../domain/research/index.js';

export class ClaudeAdapter implements LlmResearchProvider {
  private readonly client: ClaudeClient;

  constructor(apiKey: string, model: string, userId: string) {
    this.client = createClaudeClient({ apiKey, model, userId });
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    const result = await this.client.research(prompt);
    if (!result.ok) {
      return { ok: false, error: mapToLlmError(result.error) };
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
