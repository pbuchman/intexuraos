import { IntexuraOSError, type Logger } from '@intexuraos/common-core';
import type { LLMModel } from '@intexuraos/llm-contract';
import { createLlmClient, type LlmGenerateClient } from '@intexuraos/llm-factory';
import { HttpWebhookUsageSink } from '@intexuraos/llm-pricing';

export interface ParsedValidationModel {
  provider: 'openrouter';
  /** Model ID as used by createLlmClient (with or: prefix for OpenRouter) */
  modelId: string;
  /** Raw model ID without or: prefix */
  rawId: string;
}

/**
 * Parse the comma-separated INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS env var
 * into an ordered list of model descriptors.
 *
 * Every validation model must be routed through OpenRouter.
 */
export function parseValidationModels(raw: string): ParsedValidationModel[] {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new IntexuraOSError(
      'MISCONFIGURED',
      'INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS must not be empty'
    );
  }

  const entries = trimmed.split(',');
  const models: ParsedValidationModel[] = [];

  for (let i = 0; i < entries.length; i++) {
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard; loop bounds guarantee index is valid @preserve */
    const entry = entries[i]?.trim() ?? '';
    /* v8 ignore stop @preserve */
    if (entry === '') {
      throw new IntexuraOSError(
        'MISCONFIGURED',
        `INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS contains empty entry at position ${String(i + 1)}`
      );
    }

    if (!entry.startsWith('or:')) {
      throw new IntexuraOSError(
        'MISCONFIGURED',
        `INTEXURAOS_ORCHESTRATOR_VALIDATION_MODELS must use an or: OpenRouter model ID at position ${String(i + 1)}`
      );
    }

    models.push({
      provider: 'openrouter',
      modelId: entry,
      rawId: entry.slice(3),
    });
  }

  return models;
}

export interface BuildValidationClientsConfig {
  models: ParsedValidationModel[];
  openRouterApiKey: string;
  usageWebhookUrl: string;
  orchestratorSecret: string;
  internalAuthToken: string;
  logger: Logger;
  /** Returns the task ID for the currently-active request, for usage correlation. */
  getCorrelationTaskId: () => string | null;
}

export interface ValidationClientEntry {
  client: LlmGenerateClient;
  /** OpenRouter model ID used for logging/reporting. */
  modelName: string;
}

/**
 * Build LlmGenerateClient instances for each parsed validation model,
 * in the same priority order as the input list.
 */
export function buildValidationClients(
  config: BuildValidationClientsConfig
): ValidationClientEntry[] {
  return config.models.map((model) => {
    if (config.openRouterApiKey === '') {
      throw new IntexuraOSError(
        'MISCONFIGURED',
        `INTEXURAOS_OPENROUTER_APP_API_KEY is required for OpenRouter validation model: ${model.modelId}`
      );
    }

    return {
      modelName: model.modelId,
      client: createLlmClient({
        apiKey: config.openRouterApiKey,
        model: model.modelId as LLMModel,
        userId: 'orchestrator-validation',
        logger: config.logger,
        usageSink: new HttpWebhookUsageSink({
          webhookUrl: config.usageWebhookUrl,
          webhookSecret: config.orchestratorSecret,
          internalAuthToken: config.internalAuthToken,
          service: 'orchestrator',
          component: 'validation',
          logger: config.logger,
          getCorrelationTaskId: config.getCorrelationTaskId,
        }),
      }),
    };
  });
}
