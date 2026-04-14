import type { Logger } from '@intexuraos/common-core';
import type { LLMModel, ModelPricing } from '@intexuraos/llm-contract';
import { createLlmClient, type LlmGenerateClient } from '@intexuraos/llm-factory';
import { getDefaultAllowlistPricing } from '@intexuraos/infra-openrouter';
import { HttpWebhookUsageSink } from '@intexuraos/llm-pricing';

export interface ParsedValidationModel {
  provider: 'openrouter' | 'gemini';
  /** Model ID as used by createLlmClient (with or: prefix for OpenRouter) */
  modelId: string;
  /** Raw model ID without or: prefix */
  rawId: string;
}

/**
 * Static pricing for Gemini models used in validation.
 * Matches the previously-hardcoded VERIFIER_PRICING for Gemini 2.5 Flash.
 */
export const GEMINI_VALIDATION_PRICING: ModelPricing = {
  inputPricePerMillion: 0.3,
  outputPricePerMillion: 2.5,
  groundingCostPerRequest: 0,
};

const ZERO_PRICING: ModelPricing = {
  inputPricePerMillion: 0,
  outputPricePerMillion: 0,
};

/**
 * Parse the comma-separated INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS env var
 * into an ordered list of model descriptors.
 *
 * Models prefixed with `or:` are OpenRouter models; unprefixed are Gemini models.
 */
export function parseValidationModels(raw: string): ParsedValidationModel[] {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new Error('INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS must not be empty');
  }

  const entries = trimmed.split(',');
  const models: ParsedValidationModel[] = [];

  for (let i = 0; i < entries.length; i++) {
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard; loop bounds guarantee index is valid @preserve */
    const entry = entries[i]?.trim() ?? '';
    /* v8 ignore stop @preserve */
    if (entry === '') {
      throw new Error(
        `INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS contains empty entry at position ${String(i + 1)}`
      );
    }

    if (entry.startsWith('or:')) {
      models.push({
        provider: 'openrouter',
        modelId: entry,
        rawId: entry.slice(3),
      });
    } else {
      models.push({
        provider: 'gemini',
        modelId: entry,
        rawId: entry,
      });
    }
  }

  return models;
}

export interface BuildValidationClientsConfig {
  models: ParsedValidationModel[];
  openRouterApiKey: string;
  geminiApiKey: string;
  usageWebhookUrl: string;
  orchestratorSecret: string;
  internalAuthToken: string;
  logger: Logger;
}

/**
 * Build LlmGenerateClient instances for each parsed validation model,
 * in the same priority order as the input list.
 */
export function buildValidationClients(config: BuildValidationClientsConfig): LlmGenerateClient[] {
  return config.models.map((model) => {
    if (model.provider === 'openrouter') {
      if (config.openRouterApiKey === '') {
        throw new Error(
          `INTEXURAOS_OPENROUTER_APP_API_KEY is required for OpenRouter validation model: ${model.modelId}`
        );
      }

      const pricing = getDefaultAllowlistPricing(model.rawId) ?? ZERO_PRICING;

      return createLlmClient({
        apiKey: config.openRouterApiKey,
        model: model.modelId as LLMModel,
        userId: 'orchestrator-validation',
        pricing,
        logger: config.logger,
        usageSink: new HttpWebhookUsageSink({
          webhookUrl: config.usageWebhookUrl,
          webhookSecret: config.orchestratorSecret,
          internalAuthToken: config.internalAuthToken,
          service: 'orchestrator',
          component: 'validation',
          logger: config.logger,
          getCorrelationTaskId: () => null,
        }),
      });
    }

    // Gemini model
    if (config.geminiApiKey === '') {
      throw new Error(
        `INTEXURAOS_GEMINI_APP_API_KEY is required for Gemini validation model: ${model.modelId}`
      );
    }

    return createLlmClient({
      apiKey: config.geminiApiKey,
      model: model.modelId as LLMModel,
      userId: 'orchestrator-validation',
      pricing: GEMINI_VALIDATION_PRICING,
      logger: config.logger,
      usageSink: new HttpWebhookUsageSink({
        webhookUrl: config.usageWebhookUrl,
        webhookSecret: config.orchestratorSecret,
        internalAuthToken: config.internalAuthToken,
        service: 'orchestrator',
        component: 'validation',
        logger: config.logger,
        getCorrelationTaskId: () => null,
      }),
    });
  });
}
