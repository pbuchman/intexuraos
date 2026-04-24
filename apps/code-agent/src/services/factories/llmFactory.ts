/**
 * LLM factory for code-agent.
 *
 * Wires the tool-calling resolver used by the GitHub agent and the optional
 * embedding client used by execution-memory recall.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from 'pino';
import OpenAI from 'openai';
import type { CreateEmbeddingResponse } from 'openai/resources';
import { LlmModels, type ToolCallingClient } from '@intexuraos/llm-contract';
import { createToolCallingClient } from '@intexuraos/llm-factory';
import { EmbeddingClient } from '@intexuraos/infra-gpt';
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
  executionMemoryEmbeddingClient?: EmbeddingClient;
}

const TOOL_CALLING_MODEL = LlmModels.Gemini25Flash;

/**
 * Create LLM-backed services.
 *
 * `resolveToolCallingClient` first tries a per-user Google key from user-service,
 * then falls back to the platform `geminiAppApiKey`, then errors.
 *
 * `executionMemoryEmbeddingClient` is returned only when `openaiAppApiKey` is set.
 */
export function createLlmServices(deps: LlmFactoryDeps): LlmServices {
  const { config, logger, userServiceClient, buildUsageSink } = deps;
  const githubAgentUsageSink = buildUsageSink('github-agent');

  const resolveToolCallingClient = async (userId: string): Promise<Result<ToolCallingClient, GitHubAgentError>> => {
    const keysResult = await userServiceClient.getApiKeys(userId);
    if (keysResult.ok) {
      const googleKey = keysResult.value.google;
      if (googleKey !== undefined) {
        logger.debug({ userId }, 'GitHub Agent: using user Google API key');
        return ok(createToolCallingClient({
          apiKey: googleKey,
          model: TOOL_CALLING_MODEL,
          userId,
          logger,
          usageSink: githubAgentUsageSink,
        }));
      }
    }

    if (config.geminiAppApiKey !== '') {
      logger.debug({ userId }, 'GitHub Agent: falling back to platform Gemini API key');
      return ok(createToolCallingClient({
        apiKey: config.geminiAppApiKey,
        model: TOOL_CALLING_MODEL,
        userId,
        logger,
        usageSink: githubAgentUsageSink,
      }));
    }

    return err({ code: 'LLM_FAILED' as const, message: 'No Google API key available for tool calling' });
  };

  const executionMemoryOpenAI = config.openaiAppApiKey !== ''
    ? new OpenAI({ apiKey: config.openaiAppApiKey })
    : undefined;
  const executionMemoryEmbeddingClient = executionMemoryOpenAI !== undefined
    ? new EmbeddingClient({
        embedFn: (text: string, model: string): Promise<CreateEmbeddingResponse> =>
          executionMemoryOpenAI.embeddings.create({ model, input: text }),
      })
    : undefined;

  return {
    resolveToolCallingClient,
    ...(executionMemoryEmbeddingClient !== undefined && { executionMemoryEmbeddingClient }),
  };
}
