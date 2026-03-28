import { getOpenRouterRawId, isOpenRouterModel, isValidModel } from '@intexuraos/llm-contract';
import { isAllowedModel } from '@intexuraos/infra-openrouter';

export function isRetryableStoredResearchModel(model: string): boolean {
  if (isOpenRouterModel(model)) {
    return isAllowedModel(getOpenRouterRawId(model));
  }

  return isValidModel(model);
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
