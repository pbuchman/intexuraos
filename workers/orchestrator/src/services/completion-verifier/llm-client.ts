import type { Logger } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';

export async function generateResumeSummaryWithFallback(params: {
  primaryClient: LlmGenerateClient;
  primaryModelName: string;
  fallbacks: readonly { client: LlmGenerateClient; modelName: string }[];
  prompt: string;
  taskId: string;
  logger: Logger;
}): Promise<Awaited<ReturnType<LlmGenerateClient['generate']>> & { modelName: string }> {
  const { primaryClient, primaryModelName, fallbacks, prompt, taskId, logger } = params;

  const result = await primaryClient.generate(prompt, {
    promptType: 'resume-summary-extraction',
  });
  if (result.ok) {
    return { ...result, modelName: primaryModelName };
  }

  logger.warn(
    {
      taskId,
      primaryModel: primaryModelName,
      errorCode: result.error.code,
      fallbackCount: fallbacks.length,
    },
    'Primary validation model failed, trying fallbacks'
  );

  for (const fallback of fallbacks) {
    const fallbackResult = await fallback.client.generate(prompt, {
      promptType: 'resume-summary-extraction',
    });
    if (fallbackResult.ok) {
      logger.info({ taskId, model: fallback.modelName }, 'Fallback validation model succeeded');
      return { ...fallbackResult, modelName: fallback.modelName };
    }
    logger.warn(
      { taskId, errorCode: fallbackResult.error.code },
      'Fallback validation model also failed'
    );
  }

  // All failed — return the original primary error
  return { ...result, modelName: primaryModelName };
}

export function extractAndParseJson(content: string): unknown {
  const trimmed = content.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return JSON.parse(trimmed) as unknown;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
  }

  throw new Error('LLM verifier response is not valid JSON');
}
