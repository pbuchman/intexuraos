import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import {
  buildResearchPrompt,
  err,
  getErrorMessage,
  ok,
  type Result,
} from '@intexuraos/common-core';
import { type AuditContext, createAuditContext } from '@intexuraos/llm-audit';
import type {
  LLMClient,
  NormalizedUsage,
  ImageGenerateOptions,
  ImageGenerationResult,
  GenerateResult,
} from '@intexuraos/llm-contract';
import { logUsage, type CallType } from '@intexuraos/llm-pricing';
import type { GptConfig, GptError, ResearchResult } from './types.js';

export type GptClient = LLMClient;

const MAX_TOKENS = 8192;
const IMAGE_MODEL = 'dall-e-3';
const DEFAULT_IMAGE_COST = 0.04;
const WEB_SEARCH_COST_PER_CALL = 0.025;

const GPT_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-5.2': { input: 0.4, output: 2.0 },
  o1: { input: 15.0, output: 60.0 },
  'o1-mini': { input: 1.1, output: 4.4 },
  'o3-mini': { input: 1.1, output: 4.4 },
};

function createRequestContext(
  method: string,
  model: string,
  prompt: string
): { requestId: string; startTime: Date; auditContext: AuditContext } {
  const requestId = randomUUID();
  const startTime = new Date();
  const auditContext = createAuditContext({
    provider: 'openai',
    model,
    method,
    prompt,
    startedAt: startTime,
  });
  return { requestId, startTime, auditContext };
}

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  webSearchCalls: number,
  cachedTokens: number
): number {
  const pricing = GPT_PRICING[model] ?? { input: 2.5, output: 10.0 };
  const effectiveInputTokens = inputTokens - cachedTokens * 0.5;
  const inputCost = (effectiveInputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const webSearchCost = webSearchCalls * WEB_SEARCH_COST_PER_CALL;
  return Math.round((inputCost + outputCost + webSearchCost) * 1_000_000) / 1_000_000;
}

function normalizeUsage(
  model: string,
  usage: OpenAI.Responses.ResponseUsage | OpenAI.CompletionUsage | undefined,
  webSearchCalls: number
): NormalizedUsage {
  if (usage === undefined) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    };
  }

  const inputTokens = 'input_tokens' in usage ? usage.input_tokens : usage.prompt_tokens;
  const outputTokens = 'output_tokens' in usage ? usage.output_tokens : usage.completion_tokens;

  const cachedTokens =
    'input_tokens_details' in usage
      ? ((usage as { input_tokens_details?: { cached_tokens?: number } }).input_tokens_details
          ?.cached_tokens ?? 0)
      : 0;

  const reasoningTokens =
    'output_tokens_details' in usage
      ? (usage as { output_tokens_details?: { reasoning_tokens?: number } }).output_tokens_details
          ?.reasoning_tokens
      : undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: calculateCost(model, inputTokens, outputTokens, webSearchCalls, cachedTokens),
    ...(cachedTokens > 0 && { cacheTokens: cachedTokens }),
    ...(reasoningTokens !== undefined && reasoningTokens > 0 && { reasoningTokens }),
    ...(webSearchCalls > 0 && { webSearchCalls }),
  };
}

export function createGptClient(config: GptConfig): GptClient {
  const client = new OpenAI({ apiKey: config.apiKey });
  const { model, userId } = config;

  function trackUsage(
    callType: CallType,
    usage: NormalizedUsage,
    success: boolean,
    errorMessage?: string
  ): void {
    void logUsage({
      userId,
      provider: 'openai',
      model,
      callType,
      usage,
      success,
      ...(errorMessage !== undefined && { errorMessage }),
    });
  }

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GptError>> {
      const researchPrompt = buildResearchPrompt(prompt);
      const { auditContext } = createRequestContext('research', model, researchPrompt);

      try {
        const response = await client.responses.create({
          model,
          instructions:
            'You are a senior research analyst. Search the web for current, authoritative information. Cross-reference sources and cite all findings with URLs.',
          input: researchPrompt,
          tools: [{ type: 'web_search_preview', search_context_size: 'medium' }],
        });

        const content = response.output_text;
        const sources = extractSourcesFromResponse(response);
        const webSearchCalls = countWebSearchCalls(response);
        const usage = normalizeUsage(model, response.usage, webSearchCalls);

        const successParams: Parameters<typeof auditContext.success>[0] = {
          response: content,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        };
        if (usage.webSearchCalls !== undefined) {
          successParams.webSearchCalls = usage.webSearchCalls;
        }
        await auditContext.success(successParams);
        trackUsage('research', usage, true);

        return ok({ content, sources, usage });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        await auditContext.error({ error: errorMsg });
        const emptyUsage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        trackUsage('research', emptyUsage, false, errorMsg);
        return err(mapGptError(error));
      }
    },

    async generate(prompt: string): Promise<Result<GenerateResult, GptError>> {
      const { auditContext } = createRequestContext('generate', model, prompt);

      try {
        const response = await client.chat.completions.create({
          model,
          max_completion_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.choices[0]?.message.content ?? '';
        const usage = normalizeUsage(model, response.usage, 0);

        await auditContext.success({
          response: text,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
        trackUsage('generate', usage, true);

        return ok({ content: text, usage });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        await auditContext.error({ error: errorMsg });
        const emptyUsage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        trackUsage('generate', emptyUsage, false, errorMsg);
        return err(mapGptError(error));
      }
    },

    async generateImage(
      prompt: string,
      options?: ImageGenerateOptions
    ): Promise<Result<ImageGenerationResult, GptError>> {
      const { auditContext } = createRequestContext('generateImage', IMAGE_MODEL, prompt);

      try {
        const response = await client.images.generate({
          model: IMAGE_MODEL,
          prompt,
          n: 1,
          size: options?.size ?? '1024x1024',
          response_format: 'b64_json',
        });

        const b64Data = response.data?.[0]?.b64_json;
        if (b64Data === undefined) {
          const errorMsg = 'No image data in response';
          await auditContext.error({ error: errorMsg });
          return err({ code: 'API_ERROR', message: errorMsg });
        }

        const imageBuffer = Buffer.from(b64Data, 'base64');
        const usage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: DEFAULT_IMAGE_COST,
        };

        await auditContext.success({
          response: '[image-generated]',
          imageCostUsd: DEFAULT_IMAGE_COST,
        });
        trackUsage('image_generation', usage, true);

        return ok({ imageData: imageBuffer, model: IMAGE_MODEL, usage });
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        await auditContext.error({ error: errorMsg });
        const emptyUsage: NormalizedUsage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        trackUsage('image_generation', emptyUsage, false, errorMsg);
        return err(mapGptError(error));
      }
    },
  };
}

function mapGptError(error: unknown): GptError {
  if (error instanceof OpenAI.APIError) {
    const message = error.message;
    if (error.status === 401) return { code: 'INVALID_KEY', message };
    if (error.status === 429) return { code: 'RATE_LIMITED', message };
    if (error.code === 'context_length_exceeded') return { code: 'CONTEXT_LENGTH', message };
    if (message.includes('timeout')) return { code: 'TIMEOUT', message };
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
