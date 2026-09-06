import {
  getOpenRouterRawId,
  isOpenRouterModel,
} from '@intexuraos/llm-contract';
import { isAllowedModel } from '@intexuraos/infra-openrouter';
import { SYNTHESIS_MODELS } from '@intexuraos/llm-prompts';

export function isRetryableStoredResearchModel(model: string): boolean {
  return isOpenRouterModel(model) && isAllowedModel(getOpenRouterRawId(model));
}

export function isExecutableSynthesisModel(model: string): boolean {
  return (
    isRetryableStoredResearchModel(model) &&
    SYNTHESIS_MODELS.some((synthesisModel) => synthesisModel === model)
  );
}

export function getUnsupportedHistoricalModels(models: readonly string[]): string[] {
  return models.filter((model) => !isRetryableStoredResearchModel(model));
}

export function getUnsupportedRetryMessage(models: readonly string[]): string {
  return `Cannot retry research because these historical models are no longer supported: ${models.join(', ')}`;
}

export function getUnsupportedSynthesisMessage(model: string): string {
  return `Cannot run synthesis because the historical synthesis model is no longer supported: ${model}`;
}
