import {
  createOpenRouterModelId,
  DEFAULT_PLATFORM_LLM_MODEL,
  getOpenRouterRawId,
  isOpenRouterModel,
} from '@intexuraos/llm-contract';
import type { SupportedModel } from '@/services/researchAgentApi.types';

export const RESEARCH_SYNTHESIS_MODELS: readonly SupportedModel[] = [
  DEFAULT_PLATFORM_LLM_MODEL,
  createOpenRouterModelId('openai/gpt-5.4'),
];

export function isStoredResearchModelAvailable(
  model: string,
  availableModelIds: readonly string[],
): model is SupportedModel {
  return isOpenRouterModel(model) && availableModelIds.includes(getOpenRouterRawId(model));
}

export function isStoredResearchSynthesisModelExecutable(
  model: string,
  availableModelIds: readonly string[],
): model is SupportedModel {
  return (
    isStoredResearchModelAvailable(model, availableModelIds) &&
    RESEARCH_SYNTHESIS_MODELS.some((synthesisModel) => synthesisModel === model)
  );
}
