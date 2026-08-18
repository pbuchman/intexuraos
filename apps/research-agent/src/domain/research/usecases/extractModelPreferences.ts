/**
 * Extract model preferences from user's original message using LLM.
 *
 * This use case analyzes the user's research request to determine which
 * LLM models they want to use for research and synthesis.
 */

import type { Logger } from '@intexuraos/common-core';
import {
  createOpenRouterModelId,
  DEFAULT_PLATFORM_LLM_MODEL,
  type ResearchModel,
} from '@intexuraos/llm-contract';
import { OPENROUTER_ALLOWED_MODELS } from '@intexuraos/infra-openrouter';
import {
  modelExtractionPrompt,
  parseModelExtractionResponse,
  MODEL_KEYWORDS,
  SYNTHESIS_MODELS,
  DEFAULT_SYNTHESIS_MODEL,
  type AvailableModelInfo,
} from '@intexuraos/llm-prompts';
import type { ApiKeyStore, TextGenerationClient } from '../ports/index.js';

/**
 * Result of model preference extraction.
 */
export interface ExtractModelPreferencesResult {
  selectedModels: ResearchModel[];
  synthesisModel: ResearchModel | undefined; // @allow-undefined-type -- explicitly returned as undefined in multiple fallback paths
}

/**
 * Dependencies for extractModelPreferences.
 */
export interface ExtractModelPreferencesDeps {
  llmClient: TextGenerationClient;
  availableKeys: ApiKeyStore;
  logger: Logger;
}

export const MAX_RESEARCH_MODELS = 6;

/**
 * Display names for models.
 */
const MODEL_DISPLAY_NAMES = new Map<string, string>(
  OPENROUTER_ALLOWED_MODELS.map((model) => [createOpenRouterModelId(model.id), model.name])
);

/**
 * Get model display name, generating one for OpenRouter models.
 */
export function getModelDisplayName(model: ResearchModel): string {
  const staticModel = model as string;
  const configuredName = MODEL_DISPLAY_NAMES.get(staticModel);
  if (configuredName !== undefined) {
    return configuredName;
  }
  // OpenRouter model - extract name from ID (e.g., 'anthropic/claude-sonnet-4.6' -> 'Claude Sonnet 4.6')
  const parts = staticModel.split('/');
  const namePart = parts[1]?.replace(/-/g, ' ') ?? staticModel;
  return namePart.charAt(0).toUpperCase() + namePart.slice(1);
}

/**
 * Get model keywords, using default for OpenRouter models.
 */
export function getModelKeywords(model: ResearchModel): string[] {
  const staticModel = model as string;
  if (staticModel in MODEL_KEYWORDS) {
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires ?? but `in` check guarantees key exists @preserve */
    return MODEL_KEYWORDS[staticModel as ResearchModel] ?? ['openrouter'];
    /* v8 ignore stop @preserve */
  }
  const rawId = staticModel.startsWith('or:') ? staticModel.slice(3) : staticModel;
  const [author = '', slug = ''] = rawId.split('/', 2);
  return [
    'openrouter',
    author,
    ...slug.split(/[-.:]/u).filter((part) => part !== ''),
  ].filter((keyword, index, keywords) => keyword !== '' && keywords.indexOf(keyword) === index);
}

/**
 * Build the list of models available to the user based on their API keys.
 */
function buildAvailableModels(keys: ApiKeyStore): AvailableModelInfo[] {
  if (keys.openrouter === undefined || keys.openrouter === '') {
    return [];
  }

  return OPENROUTER_ALLOWED_MODELS.map((modelInfo) => {
    const model = createOpenRouterModelId(modelInfo.id);
    return {
      id: model,
      provider: modelInfo.provider,
      displayName: modelInfo.name,
      keywords: getModelKeywords(model),
      isProviderDefault: model === DEFAULT_PLATFORM_LLM_MODEL,
    };
  });
}

/**
 * Validate that selected models follow constraints:
 * Models must be in the available list, are deduplicated by full ID, and capped at six.
 */
export function validateSelectedModels(
  models: ResearchModel[],
  availableModels: AvailableModelInfo[]
): ResearchModel[] {
  const availableIds = new Set(availableModels.map((m) => m.id));
  const seenModels = new Set<string>();
  const valid: ResearchModel[] = [];

  for (const model of models) {
    if (!availableIds.has(model) || seenModels.has(model)) {
      continue;
    }

    seenModels.add(model);
    valid.push(model);
    if (valid.length === MAX_RESEARCH_MODELS) {
      break;
    }
  }

  return valid;
}

/**
 * Validate synthesis model.
 * Must be in SYNTHESIS_MODELS list and user must have API key for it.
 */
export function validateSynthesisModel(
  model: ResearchModel | null,
  availableModels: AvailableModelInfo[]
): ResearchModel | undefined {
  if (model === null) {
    return undefined;
  }

  const availableIds = new Set(availableModels.map((m) => m.id));

  // Check if model supports synthesis
  if (!SYNTHESIS_MODELS.includes(model)) {
    return undefined;
  }

  // Check if user has API key for this model
  if (!availableIds.has(model)) {
    return undefined;
  }

  return model;
}

/**
 * Extract model preferences from user's original message.
 *
 * Uses an LLM to analyze the message and extract which models the user wants.
 * Returns empty arrays if extraction fails - the user will pick manually in the UI.
 */
export async function extractModelPreferences(
  originalMessage: string,
  deps: ExtractModelPreferencesDeps
): Promise<ExtractModelPreferencesResult> {
  const { llmClient, availableKeys, logger } = deps;

  // Build available models from user's API keys
  const availableModels = buildAvailableModels(availableKeys);

  if (availableModels.length === 0) {
    logger.info({}, 'No API keys configured, skipping model extraction');
    return { selectedModels: [], synthesisModel: undefined };
  }

  // Build the extraction prompt
  const prompt = modelExtractionPrompt.build({
    userMessage: originalMessage,
    availableModels,
    synthesisModels: SYNTHESIS_MODELS,
    defaultSynthesisModel: DEFAULT_SYNTHESIS_MODEL,
  });

  try {
    logger.info({ messageLength: originalMessage.length }, 'Extracting model preferences from message');

    const result = await llmClient.generate(prompt, { promptType: 'research-model-preference-extraction' });

    if (!result.ok) {
      logger.warn(
        { errorCode: result.error.code, errorMessage: result.error.message },
        'LLM call failed during model extraction'
      );
      return { selectedModels: [], synthesisModel: undefined };
    }

    // Parse the response
    const validModelIds = availableModels.map((m) => m.id);
    const parsed = parseModelExtractionResponse(result.value.content, validModelIds); // @allow-result-access -- guarded by if (!result.ok) early return above

    if (parsed === null) {
      logger.warn({ response: result.value.content.substring(0, 200) }, 'Failed to parse model extraction response'); // @allow-result-access -- guarded by if (!result.ok) early return above
      return { selectedModels: [], synthesisModel: undefined };
    }

    // Validate selected models (unique IDs, allowlisted, maximum six)
    const validatedModels = validateSelectedModels(parsed.selectedModels, availableModels);

    // Validate synthesis model
    const validatedSynthesis = validateSynthesisModel(parsed.synthesisModel, availableModels);

    logger.info(
      {
        requestedModels: parsed.selectedModels,
        validatedModels,
        requestedSynthesis: parsed.synthesisModel,
        validatedSynthesis,
      },
      'Model preferences extracted'
    );

    return {
      selectedModels: validatedModels,
      synthesisModel: validatedSynthesis,
    };
  } catch (error) {
    logger.error({ error }, 'Exception during model extraction');
    return { selectedModels: [], synthesisModel: undefined };
  }
}
