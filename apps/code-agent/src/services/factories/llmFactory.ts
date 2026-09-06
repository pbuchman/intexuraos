/**
 * LLM factory for code-agent.
 *
 * Wires the tool-calling resolver used by the GitHub agent and the optional
 * embedding client used by execution-memory recall.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import { OpenRouterToolCallingModels, type ToolCallingClient } from '@intexuraos/llm-contract';
import { createToolCallingClient } from '@intexuraos/llm-factory';
import {
  createOpenRouterEmbeddingsClient,
  type OpenRouterEmbeddingsClient,
} from '@intexuraos/infra-openrouter';
import type { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { GitHubAgentError } from '../../domain/usecases/githubAgent.js';
import type { ServiceConfig } from '../types.js';

export interface LlmFactoryDeps {
  config: ServiceConfig;
  logger: Logger;
  userServiceClient: UserServiceClient;
  buildUsageSink: (component: string) => HttpInternalAuthUsageSink;
}

export interface LlmServices {
  resolveToolCallingClient: (userId: string) => Promise<Result<ToolCallingClient, GitHubAgentError>>;
  executionMemoryEmbeddingClient?: OpenRouterEmbeddingsClient;
}

const TOOL_CALLING_MODEL = OpenRouterToolCallingModels.Gemini36Flash;

/**
 * Create LLM-backed services.
 *
 * `resolveToolCallingClient` first tries a per-user OpenRouter key from
 * user-service, then falls back to the platform OpenRouter key, then errors.
 *
 * `executionMemoryEmbeddingClient` is returned only when the platform
 * OpenRouter key is set.
 */
export function createLlmServices(deps: LlmFactoryDeps): LlmServices {
  const { config, logger, userServiceClient, buildUsageSink } = deps;
  const githubAgentUsageSink = buildUsageSink('github-agent');

  const resolveToolCallingClient = async (userId: string): Promise<Result<ToolCallingClient, GitHubAgentError>> => {
    const keysResult = await userServiceClient.getApiKeys(userId);
    if (keysResult.ok) {
      const openRouterKey = keysResult.value.openrouter;
      if (openRouterKey !== undefined) {
        logger.debug({ userId }, 'GitHub Agent: using user OpenRouter API key');
        return ok(createToolCallingClient({
          apiKey: openRouterKey,
          model: TOOL_CALLING_MODEL,
          userId,
          logger,
          usageSink: githubAgentUsageSink,
        }));
      }
    }

    if (config.openRouterAppApiKey !== '') {
      logger.debug({ userId }, 'GitHub Agent: falling back to platform OpenRouter API key');
      return ok(createToolCallingClient({
        apiKey: config.openRouterAppApiKey,
        model: TOOL_CALLING_MODEL,
        userId,
        logger,
        usageSink: githubAgentUsageSink,
      }));
    }

    return err({ code: 'LLM_FAILED' as const, message: 'No OpenRouter API key available for tool calling' });
  };

  const executionMemoryEmbeddingClient = config.openRouterAppApiKey !== ''
    ? createOpenRouterEmbeddingsClient({
        apiKey: config.openRouterAppApiKey,
        userId: 'system',
        ownerType: 'system',
        logger,
        usageSink: buildUsageSink('execution-memory-embedding'),
      })
    : undefined;

  return {
    resolveToolCallingClient,
    ...(executionMemoryEmbeddingClient !== undefined && { executionMemoryEmbeddingClient }),
  };
}
