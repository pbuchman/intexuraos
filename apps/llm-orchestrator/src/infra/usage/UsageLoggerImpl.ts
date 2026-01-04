import type { UsageLogger, UsageLogParams } from '@intexuraos/llm-contract';
import type { UsageStatsRepository } from '../../domain/research/ports/usageStatsRepository.js';
import type { LlmCallType } from '../../domain/research/models/LlmUsageStats.js';
import type { LlmProvider } from '../../domain/research/models/Research.js';

interface LoggerLike {
  error(obj: object, msg: string): void;
}

function mapMethodToCallType(method: string): LlmCallType {
  switch (method) {
    case 'research':
      return 'research';
    case 'generate':
      return 'synthesis';
    case 'generateImage':
      return 'image_generation';
    case 'generateThumbnailPrompt':
      return 'image_prompt';
    default:
      return 'other';
  }
}

function mapProviderString(provider: string): LlmProvider {
  switch (provider) {
    case 'google':
      return 'google';
    case 'openai':
      return 'openai';
    case 'anthropic':
      return 'anthropic';
    case 'perplexity':
      return 'perplexity';
    default:
      return 'google';
  }
}

export class UsageLoggerImpl implements UsageLogger {
  constructor(
    private readonly usageStatsRepo: UsageStatsRepository,
    private readonly logger?: LoggerLike
  ) {}

  async log(params: UsageLogParams): Promise<void> {
    try {
      await this.usageStatsRepo.increment({
        provider: mapProviderString(params.provider),
        model: params.model,
        callType: mapMethodToCallType(params.method),
        success: params.success,
        inputTokens: params.usage.inputTokens,
        outputTokens: params.usage.outputTokens,
        costUsd: params.usage.costUsd,
      });
    } catch (error) {
      this.logger?.error({ error, params }, '[UsageLoggerImpl] Failed to log usage');
    }
  }
}

export function createUsageLogger(deps: {
  usageStatsRepo: UsageStatsRepository;
  logger?: LoggerLike;
}): UsageLogger {
  return new UsageLoggerImpl(deps.usageStatsRepo, deps.logger);
}
