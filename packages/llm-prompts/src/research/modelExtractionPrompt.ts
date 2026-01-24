/**
 * Prompt for extracting LLM model preferences from user messages.
 *
 * Used by research-agent to determine which models to use for research
 * and synthesis based on the user's original message.
 */

import { LlmModels, type ResearchModel } from '@intexuraos/llm-contract';
import type { Logger } from 'pino';
import { withLlmParseErrorLogging } from '@intexuraos/llm-utils';

/**
 * Model information for building the extraction prompt.
 */
export interface AvailableModelInfo {
  id: ResearchModel;
  provider: string;
  displayName: string;
  keywords: string[];
  isProviderDefault: boolean;
}

/**
 * Dependencies for building the model extraction prompt.
 */
export interface ModelExtractionPromptDeps {
  /** The user's original message */
  userMessage: string;
  /** Models available to the user (those they have API keys for) */
  availableModels: AvailableModelInfo[];
  /** Model IDs that support synthesis */
  synthesisModels: ResearchModel[];
  /** Default synthesis model if not specified */
  defaultSynthesisModel: ResearchModel;
}

/**
 * Expected response format from the LLM.
 */
export interface ModelExtractionResponse {
  /** Model IDs selected for research */
  selectedModels: ResearchModel[];
  /** Model ID for synthesis (or null if not specified) */
  synthesisModel: ResearchModel | null;
}

/**
 * Build the prompt for extracting model preferences from a user message.
 */
export function buildModelExtractionPrompt(deps: ModelExtractionPromptDeps): string {
  const { userMessage, availableModels, synthesisModels, defaultSynthesisModel } = deps;

  // Group models by provider
  const modelsByProvider = new Map<string, AvailableModelInfo[]>();
  for (const model of availableModels) {
    const existing = modelsByProvider.get(model.provider) ?? [];
    existing.push(model);
    modelsByProvider.set(model.provider, existing);
  }

  // Build available models description
  const modelsDescription = availableModels
    .map((m) => {
      const defaultNote = m.isProviderDefault ? ' (provider default)' : '';
      return `- ${m.id}: ${m.displayName} (${m.provider})${defaultNote}\n  Keywords: ${m.keywords.join(', ')}`;
    })
    .join('\n');

  // Build provider defaults description
  const providerDefaults = Array.from(modelsByProvider.entries())
    .map(([provider, models]) => {
      const defaultModel = models.find((m) => m.isProviderDefault);
      if (defaultModel !== undefined) {
        return `- ${provider}: ${defaultModel.id}`;
      }
      return null;
    })
    .filter((s): s is string => s !== null)
    .join('\n');

  return `You are a model selection assistant. Your task is to extract LLM model preferences from a user's research request.

## Available Models
These are the models available to this user (they have API keys for these):

${modelsDescription}

## Constraints
1. **One model per provider**: You cannot select multiple models from the same provider (e.g., cannot select both gemini-2.5-pro AND gemini-2.5-flash)
2. **Synthesis models**: Only these models can be used for synthesis: ${synthesisModels.join(', ')}
3. **Invalid synthesis**: If user requests a model for synthesis that doesn't support it, use ${defaultSynthesisModel} instead

## Provider Defaults
When user mentions a provider without specifying a model, use these defaults:
${providerDefaults}

## User Message
"${userMessage}"

## Your Task
Extract which models the user wants for:
1. **Research**: Which models to use for the research phase
2. **Synthesis**: Which model to use for combining research results (optional)

## Special Cases
- "all models" / "all LLMs": Select one model from each available provider
- "all except X": Select one model from each provider except the mentioned one
- No model mentioned: Return empty selectedModels (user will pick later)
- Provider name only (e.g., "use google"): Use the provider's default model

## Response Format
Respond with ONLY valid JSON in this exact format:
{
  "selectedModels": ["model-id-1", "model-id-2"],
  "synthesisModel": "model-id" or null
}

Do not include any text before or after the JSON.`;
}

/**
 * Parse the LLM response into typed model extraction result.
 * Returns null if parsing fails.
 */
export function parseModelExtractionResponse(
  response: string,
  validModels: ResearchModel[]
): ModelExtractionResponse | null {
  try {
    // Try to extract JSON from response (may have surrounding text)
    const jsonMatch = /\{[\s\S]*\}/.exec(response);
    if (jsonMatch === null) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as unknown;

    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;

    // Validate selectedModels
    if (!Array.isArray(obj['selectedModels'])) {
      return null;
    }

    const selectedModels = obj['selectedModels'].filter(
      (m): m is ResearchModel => typeof m === 'string' && validModels.includes(m as ResearchModel)
    );

    // Validate synthesisModel
    let synthesisModel: ResearchModel | null = null;
    if (typeof obj['synthesisModel'] === 'string') {
      if (validModels.includes(obj['synthesisModel'] as ResearchModel)) {
        synthesisModel = obj['synthesisModel'] as ResearchModel;
      }
    }

    return { selectedModels, synthesisModel };
  } catch (_error) {
    // Silently return null for lenient parsing
    // TODO: Add logging version for production debugging
    return null;
  }
}

/**
 * Parse model extraction response with error logging.
 *
 * This version logs parsing failures for debugging and monitoring.
 * Use this in production to track LLM response quality issues.
 *
 * @param response - Raw LLM response string
 * @param validModels - Array of valid model names to filter against
 * @param logger - Pino logger instance for error logging
 * @returns Parsed model extraction response
 * @throws {Error} When parsing fails (error is logged before throwing)
 */
export function parseModelExtractionResponseWithLogging(
  response: string,
  validModels: ResearchModel[],
  logger: Logger
): ModelExtractionResponse {
  const wrapped = withLlmParseErrorLogging<string, ModelExtractionResponse>({
    logger,
    operation: 'parseModelExtractionResponse',
    expectedSchema: '{"selectedModels":["model1",...],"synthesisModel":"model"}',
    parser: (resp: string): ModelExtractionResponse => {
      const result = parseModelExtractionResponse(resp, validModels);
      if (result === null) {
        throw new Error(
          'Failed to parse model extraction: response does not match expected schema'
        );
      }
      return result;
    },
  });
  return wrapped(response);
}

/**
 * Model keywords for common ways users refer to models.
 * Maps to provider default or specific models.
 */
export const MODEL_KEYWORDS: Record<ResearchModel, string[]> = {
  [LlmModels.Gemini25Pro]: ['gemini pro', 'gemini-pro', 'pro'],
  [LlmModels.Gemini25Flash]: ['gemini flash', 'gemini-flash', 'gemini', 'google'],
  [LlmModels.ClaudeOpus45]: ['claude opus', 'opus'],
  [LlmModels.ClaudeSonnet45]: ['claude sonnet', 'sonnet', 'claude', 'anthropic'],
  [LlmModels.O4MiniDeepResearch]: ['o4', 'o4-mini', 'deep research'],
  [LlmModels.GPT52]: ['gpt', 'gpt-5', 'openai', 'chatgpt'],
  [LlmModels.Sonar]: ['sonar basic'],
  [LlmModels.SonarPro]: ['sonar', 'sonar pro', 'pplx', 'perplexity'],
  [LlmModels.SonarDeepResearch]: ['sonar deep', 'perplexity deep', 'deep sonar'],
  [LlmModels.Glm47]: ['glm', 'glm-4', 'glm-4.7', 'zai'],
  [LlmModels.Glm47Flash]: ['glm flash', 'glm-flash', 'glm-4.7-flash'],
};

/**
 * Provider default models.
 * Used when user says "use google" without specifying a model.
 */
export const PROVIDER_DEFAULT_MODELS: Record<string, ResearchModel> = {
  google: LlmModels.Gemini25Pro,
  anthropic: LlmModels.ClaudeSonnet45,
  openai: LlmModels.GPT52,
  perplexity: LlmModels.SonarPro,
  zai: LlmModels.Glm47,
};

/**
 * Models that support synthesis.
 */
export const SYNTHESIS_MODELS: ResearchModel[] = [LlmModels.Gemini25Pro, LlmModels.GPT52];

/**
 * Default synthesis model when not specified or invalid.
 */
export const DEFAULT_SYNTHESIS_MODEL: ResearchModel = LlmModels.Gemini25Pro;
