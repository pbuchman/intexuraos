import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { z } from 'zod';

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

export function getMissingFields(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    /* v8 ignore start -- upstream: extractAndParseJson guarantees object input; empty path unreachable with z.object schemas @preserve */
    return path !== '' ? path : issue.message;
    /* v8 ignore stop @preserve */
  });
}

export interface VerificationLlmResult {
  content: string;
  modelName: string;
  parsed: unknown;
}

export interface VerificationLlmFailure {
  kind: 'all-failed' | 'schema-failed';
  modelName: string;
  content: string;
  missingFields: string[];
}

export async function callVerificationLlm(params: {
  models: { client: LlmGenerateClient; modelName: string }[];
  prompt: string;
  schema: z.ZodType;
  logger: Logger;
  taskId: string;
  attempt: number;
}): Promise<
  { ok: true; value: VerificationLlmResult } | { ok: false; error: VerificationLlmFailure }
> {
  const { models, prompt, schema, logger, taskId, attempt } = params;

  let lastGeneratedContent = '';
  let succeededModelName = '';
  let parseResult: z.SafeParseReturnType<unknown, unknown> | undefined;

  for (const { client, modelName } of models) {
    const result = await client.generate(prompt, { promptType: 'completion-verification' });
    if (!result.ok) {
      logger.warn(
        {
          taskId,
          attempt,
          model: modelName,
          errorCode: result.error.code,
        },
        'Completion verifier model call failed, trying next'
      );
      continue;
    }

    const content = result.value.content; // @allow-result-access -- guarded by if (!result.ok) continue above
    lastGeneratedContent = content;
    succeededModelName = modelName;
    logger.info(
      {
        taskId,
        attempt,
        model: modelName,
        responseChars: content.length,
        response: content,
      },
      'Completion verifier response'
    );

    let rawJson: unknown;
    try {
      rawJson = extractAndParseJson(content);
    } catch (error) {
      logger.warn(
        {
          taskId,
          attempt,
          model: modelName,
          response: content,
          error: getErrorMessage(error),
        },
        'Completion verifier response parsing failed, trying next model'
      );
      continue;
    }

    const candidate = schema.safeParse(rawJson);
    if (!candidate.success) {
      const fields = getMissingFields(candidate.error);
      logger.warn(
        {
          taskId,
          attempt,
          model: modelName,
          missingFields: fields,
          zodErrors: candidate.error.issues,
        },
        'Completion verifier Zod validation failed, trying next model'
      );
      parseResult = candidate;
      continue;
    }

    parseResult = candidate;
    break;
  }

  if (parseResult?.success === true) {
    return {
      ok: true,
      value: {
        content: lastGeneratedContent,
        modelName: succeededModelName,
        parsed: parseResult.data,
      },
    };
  }

  if (parseResult !== undefined) {
    const missingFields = getMissingFields(parseResult.error);
    return {
      ok: false,
      error: {
        kind: 'schema-failed',
        modelName: succeededModelName,
        content: lastGeneratedContent,
        missingFields,
      },
    };
  }

  return {
    ok: false,
    error: {
      kind: 'all-failed',
      modelName: succeededModelName,
      content: lastGeneratedContent,
      missingFields: [],
    },
  };
}
