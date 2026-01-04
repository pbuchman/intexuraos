import type { LlmProvider } from '../models/Research.js';
import type { LlmCallType } from '../models/LlmUsageStats.js';
import type { UsageStatsRepository } from '../ports/usageStatsRepository.js';
import type { PricingRepository } from '../ports/pricingRepository.js';
import { calculateAccurateCost } from '../utils/costCalculator.js';

export interface TrackLlmCallParams {
  provider: LlmProvider;
  model: string;
  callType: LlmCallType;
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  providerCost?: number;
}

export interface LlmUsageTracker {
  track(params: TrackLlmCallParams): void;
}

interface LoggerLike {
  error(obj: object, msg: string): void;
}

export function createLlmUsageTracker(deps: {
  usageStatsRepo: UsageStatsRepository;
  pricingRepo: PricingRepository;
  logger?: LoggerLike;
}): LlmUsageTracker {
  const { usageStatsRepo, pricingRepo, logger } = deps;

  return {
    track(params: TrackLlmCallParams): void {
      void (async (): Promise<void> => {
        try {
          const pricing = await pricingRepo.findByProviderAndModel(params.provider, params.model);

          const costUsd =
            pricing !== null
              ? calculateAccurateCost(
                  {
                    inputTokens: params.inputTokens,
                    outputTokens: params.outputTokens,
                    ...(params.providerCost !== undefined && { providerCost: params.providerCost }),
                  },
                  pricing
                )
              : 0;

          await usageStatsRepo.increment({
            provider: params.provider,
            model: params.model,
            callType: params.callType,
            success: params.success,
            inputTokens: params.inputTokens,
            outputTokens: params.outputTokens,
            costUsd,
          });
        } catch (error) {
          logger?.error({ error, params }, '[LlmUsageTracker] Failed to track usage');
        }
      })();
    },
  };
}
