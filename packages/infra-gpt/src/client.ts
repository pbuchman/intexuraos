import OpenAI from 'openai';
import {
  buildResearchPrompt,
  err,
  getErrorMessage,
  ok,
  type Result,
} from '@intexuraos/common-core';
import { type AuditContext, createAuditContext } from '@intexuraos/llm-audit';
import type { LLMClient } from '@intexuraos/llm-contract';
import type { GptConfig, GptError, ResearchResult } from './types.js';

export type GptClient = LLMClient;

const MAX_TOKENS = 8192;

function createRequestContext(
  method: string,
  model: string,
  prompt: string
): { requestId: string; startTime: Date; auditContext: AuditContext } {
  const requestId = crypto.randomUUID();
  const startTime = new Date();

  // eslint-disable-next-line no-console
  console.info(
    `[GPT:${method}] Request`,
    JSON.stringify({
      requestId,
      model,
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 200),
    })
  );

  const auditContext = createAuditContext({
    provider: 'openai',
    model,
    method,
    prompt,
    startedAt: startTime,
  });

  return { requestId, startTime, auditContext };
}

async function logSuccess(
  method: string,
  requestId: string,
  startTime: Date,
  response: string,
  auditContext: AuditContext,
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    reasoningTokens?: number;
    webSearchCalls?: number;
  }
): Promise<void> {
  // eslint-disable-next-line no-console
  console.info(
    `[GPT:${method}] Response`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime.getTime(),
      responseLength: response.length,
      responsePreview: response.slice(0, 200),
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      cachedTokens: usage?.cachedTokens,
      reasoningTokens: usage?.reasoningTokens,
      webSearchCalls: usage?.webSearchCalls,
    })
  );

  const auditParams: Parameters<typeof auditContext.success>[0] = { response };
  if (usage !== undefined) {
    auditParams.inputTokens = usage.inputTokens;
    auditParams.outputTokens = usage.outputTokens;
    if (usage.cachedTokens !== undefined) {
      auditParams.cachedTokens = usage.cachedTokens;
    }
    if (usage.reasoningTokens !== undefined) {
      auditParams.reasoningTokens = usage.reasoningTokens;
    }
    if (usage.webSearchCalls !== undefined) {
      auditParams.webSearchCalls = usage.webSearchCalls;
    }
  }
  await auditContext.success(auditParams);
}

async function logError(
  method: string,
  requestId: string,
  startTime: Date,
  error: unknown,
  auditContext: AuditContext
): Promise<void> {
  const errorMessage = getErrorMessage(error, String(error));

  // eslint-disable-next-line no-console
  console.error(
    `[GPT:${method}] Error`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime.getTime(),
      error: errorMessage,
    })
  );

  await auditContext.error({ error: errorMessage });
}

export function createGptClient(config: GptConfig): GptClient {
  const client = new OpenAI({ apiKey: config.apiKey });
  const { model } = config;

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GptError>> {
      const researchPrompt = buildResearchPrompt(prompt);
      const { requestId, startTime, auditContext } = createRequestContext(
        'research',
        model,
        researchPrompt
      );

      try {
        const response = await client.responses.create({
          model,
          instructions:
            'You are a senior research analyst. Search the web for current, authoritative information. Cross-reference sources and cite all findings with URLs.',
          input: researchPrompt,
          tools: [
            {
              type: 'web_search_preview',
              search_context_size: 'medium',
            },
          ],
        });

        const content = response.output_text;
        const sources = extractSourcesFromResponse(response);
        const webSearchCalls = countWebSearchCalls(response);
        const result: ResearchResult = { content, sources };
        if (response.usage !== undefined) {
          const cachedTokens = (
            response.usage as { input_tokens_details?: { cached_tokens?: number } }
          ).input_tokens_details?.cached_tokens;
          const reasoningTokens = (
            response.usage as { output_tokens_details?: { reasoning_tokens?: number } }
          ).output_tokens_details?.reasoning_tokens;
          result.usage = {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          };
          if (cachedTokens !== undefined) {
            result.usage.cachedTokens = cachedTokens;
          }
          if (reasoningTokens !== undefined) {
            result.usage.reasoningTokens = reasoningTokens;
          }
          if (webSearchCalls > 0) {
            result.usage.webSearchCalls = webSearchCalls;
          }
        }

        await logSuccess('research', requestId, startTime, content, auditContext, result.usage);
        return ok(result);
      } catch (error) {
        await logError('research', requestId, startTime, error, auditContext);
        return err(mapGptError(error));
      }
    },

    async generate(prompt: string): Promise<Result<string, GptError>> {
      const { requestId, startTime, auditContext } = createRequestContext(
        'generate',
        model,
        prompt
      );

      try {
        const response = await client.chat.completions.create({
          model,
          max_completion_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.choices[0]?.message.content ?? '';
        await logSuccess('generate', requestId, startTime, text, auditContext);
        return ok(text);
      } catch (error) {
        await logError('generate', requestId, startTime, error, auditContext);
        return err(mapGptError(error));
      }
    },
  };
}

function mapGptError(error: unknown): GptError {
  if (error instanceof OpenAI.APIError) {
    const message = error.message;

    if (error.status === 401) {
      return { code: 'INVALID_KEY', message };
    }
    if (error.status === 429) {
      return { code: 'RATE_LIMITED', message };
    }
    if (error.code === 'context_length_exceeded') {
      return { code: 'CONTEXT_LENGTH', message };
    }
    if (message.includes('timeout')) {
      return { code: 'TIMEOUT', message };
    }

    return { code: 'API_ERROR', message };
  }

  const message = getErrorMessage(error);
  return { code: 'API_ERROR', message };
}

function extractSourcesFromResponse(response: OpenAI.Responses.Response): string[] {
  const sources: string[] = [];

  for (const item of response.output) {
    if (item.type === 'web_search_call' && 'results' in item) {
      const results = item.results as { url?: string }[] | undefined;
      if (results !== undefined) {
        for (const result of results) {
          if (result.url !== undefined) {
            sources.push(result.url);
          }
        }
      }
    }
  }

  return [...new Set(sources)];
}

function countWebSearchCalls(response: OpenAI.Responses.Response): number {
  let count = 0;
  for (const item of response.output) {
    if (item.type === 'web_search_call') {
      count++;
    }
  }
  return count;
}
