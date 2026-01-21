/**
 * Extract model preferences from user's original message using LLM.
 *
 * This use case analyzes the user's research request to determine which
 * LLM models they want to use for research and synthesis.
 */

import type { Logger } from '@intexuraos/common-core';
import { getProviderForModel, type ResearchModel, LlmModels } from '@intexuraos/llm-contract';
import {
  buildModelExtractionPrompt,
  parseModelExtractionResponse,
  MODEL_KEYWORDS,
  PROVIDER_DEFAULT_MODELS,
  SYNTHESIS_MODELS,
  DEFAULT_SYNTHESIS_MODEL,
  type AvailableModelInfo,
} from '@intexuraos/llm-common';
import type { ApiKeyStore, TextGenerationClient } from '../ports/index.js';

/**
 * Result of model preference extraction.
 */
export interface ExtractModelPreferencesResult {
  selectedModels: ResearchModel[];
  synthesisModel: ResearchModel | undefined;
}

/**
 * Dependencies for extractModelPreferences.
 */
export interface ExtractModelPreferencesDeps {
  llmClient: TextGenerationClient;
  availableKeys: ApiKeyStore;
  logger: Logger;
}

/**
 * Research models available for selection (excludes image and non-research models).
 */
const RESEARCH_MODELS: ResearchModel[] = [
  LlmModels.Gemini25Pro,
  LlmModels.Gemini25Flash,
  LlmModels.ClaudeOpus45,
  LlmModels.ClaudeSonnet45,
  LlmModels.O4MiniDeepResearch,
  LlmModels.GPT52,
  LlmModels.Sonar,
  LlmModels.SonarPro,
  LlmModels.SonarDeepResearch,
  LlmModels.Glm47,
];

/**
 * Display names for models.
 */
const MODEL_DISPLAY_NAMES: Record<ResearchModel, string> = {
  [LlmModels.Gemini25Pro]: 'Gemini 2.5 Pro',
  [LlmModels.Gemini25Flash]: 'Gemini 2.5 Flash',
  [LlmModels.ClaudeOpus45]: 'Claude Opus 4.5',
  [LlmModels.ClaudeSonnet45]: 'Claude Sonnet 4.5',
  [LlmModels.O4MiniDeepResearch]: 'O4 Mini Deep Research',
  [LlmModels.GPT52]: 'GPT 5.2',
  [LlmModels.Sonar]: 'Sonar',
  [LlmModels.SonarPro]: 'Sonar Pro',
  [LlmModels.SonarDeepResearch]: 'Sonar Deep Research',
  [LlmModels.Glm47]: 'GLM 4.7',
};

/**
 * Get API key field name for a provider.
 */
function providerToKeyField(provider: string): keyof ApiKeyStore {
  switch (provider) {
    case 'google':
      return 'google';
    case 'openai':
      return 'openai';
    case 'anthropic':
      return 'anthropic';
    case 'perplexity':
      return 'perplexity';
    case 'zai':
      return 'zai';
    default:
      return 'google';
  }
}

/**
 * Build the list of models available to the user based on their API keys.
 */
function buildAvailableModels(keys: ApiKeyStore): AvailableModelInfo[] {
  const available: AvailableModelInfo[] = [];

  for (const model of RESEARCH_MODELS) {
    const provider = getProviderForModel(model);
    const keyField = providerToKeyField(provider);
    const hasKey = keys[keyField] !== undefined && keys[keyField] !== '';

    if (hasKey) {
      const isProviderDefault = PROVIDER_DEFAULT_MODELS[provider] === model;
      available.push({
        id: model,
        provider,
        displayName: MODEL_DISPLAY_NAMES[model],
        keywords: MODEL_KEYWORDS[model],
        isProviderDefault,
      });
    }
  }

  return available;
}

/**
 * Validate that selected models follow constraints:
 * 1. Only one model per provider
 * 2. Models must be in the available list
 */
function validateSelectedModels(
  models: ResearchModel[],
  availableModels: AvailableModelInfo[]
): ResearchModel[] {
  const availableIds = new Set(availableModels.map((m) => m.id));
  const seenProviders = new Set<string>();
  const valid: ResearchModel[] = [];

  for (const model of models) {
    if (!availableIds.has(model)) {
      continue;
    }

    const provider = getProviderForModel(model);
    if (seenProviders.has(provider)) {
      continue;
    }

    seenProviders.add(provider);
    valid.push(model);
  }

  return valid;
}

/**
 * Validate synthesis model.
 * Must be in SYNTHESIS_MODELS list and user must have API key for it.
 */
function validateSynthesisModel(
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
  const prompt = buildModelExtractionPrompt({
    userMessage: originalMessage,
    availableModels,
    synthesisModels: SYNTHESIS_MODELS,
    defaultSynthesisModel: DEFAULT_SYNTHESIS_MODEL,
  });

  try {
    logger.info({ messageLength: originalMessage.length }, 'Extracting model preferences from message');

    const result = await llmClient.generate(prompt);

    if (!result.ok) {
      logger.warn(
        { errorCode: result.error.code, errorMessage: result.error.message },
        'LLM call failed during model extraction'
      );
      return { selectedModels: [], synthesisModel: undefined };
    }

    // Parse the response
    const validModelIds = availableModels.map((m) => m.id);
    const parsed = parseModelExtractionResponse(result.value.content, validModelIds);

    if (parsed === null) {
      logger.warn({ response: result.value.content.substring(0, 200) }, 'Failed to parse model extraction response');
      return { selectedModels: [], synthesisModel: undefined };
    }

    // Validate selected models (one per provider, must be available)
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
