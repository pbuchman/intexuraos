import { type GenerateContentResponse, GoogleGenAI } from '@google/genai';
import {
  buildResearchPrompt,
  err,
  getErrorMessage,
  ok,
  type Result,
} from '@intexuraos/common-core';
import { type AuditContext, createAuditContext } from '@intexuraos/llm-audit';
import type { LLMClient } from '@intexuraos/llm-contract';
import type { GeminiConfig, GeminiError, ResearchResult } from './types.js';

export type GeminiClient = LLMClient;

function createRequestContext(
  method: string,
  model: string,
  prompt: string
): { requestId: string; startTime: Date; auditContext: AuditContext } {
  const requestId = crypto.randomUUID();
  const startTime = new Date();

  // eslint-disable-next-line no-console
  console.info(
    `[Gemini:${method}] Request`,
    JSON.stringify({
      requestId,
      model,
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 200),
    })
  );

  const auditContext = createAuditContext({
    provider: 'google',
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
  usage?: { inputTokens: number; outputTokens: number }
): Promise<void> {
  // eslint-disable-next-line no-console
  console.info(
    `[Gemini:${method}] Response`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime.getTime(),
      responseLength: response.length,
      responsePreview: response.slice(0, 200),
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    })
  );

  const auditParams: Parameters<typeof auditContext.success>[0] = { response };
  if (usage !== undefined) {
    auditParams.inputTokens = usage.inputTokens;
    auditParams.outputTokens = usage.outputTokens;
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
    `[Gemini:${method}] Error`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime.getTime(),
      error: errorMessage,
    })
  );

  await auditContext.error({ error: errorMessage });
}

export function createGeminiClient(config: GeminiConfig): GeminiClient {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const { model } = config;

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GeminiError>> {
      const researchPrompt = buildResearchPrompt(prompt);
      const { requestId, startTime, auditContext } = createRequestContext(
        'research',
        model,
        researchPrompt
      );

      try {
        const response = await ai.models.generateContent({
          model,
          contents: researchPrompt,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        const text = response.text ?? '';
        const sources = extractSourcesFromResponse(response);
        const result: ResearchResult = { content: text, sources };
        const usageMetadata = response.usageMetadata;
        if (usageMetadata !== undefined) {
          result.usage = {
            inputTokens: usageMetadata.promptTokenCount ?? 0,
            outputTokens: usageMetadata.candidatesTokenCount ?? 0,
          };
        }

        await logSuccess('research', requestId, startTime, text, auditContext, result.usage);
        return ok(result);
      } catch (error) {
        await logError('research', requestId, startTime, error, auditContext);
        return err(mapGeminiError(error));
      }
    },

    async generate(prompt: string): Promise<Result<string, GeminiError>> {
      const { requestId, startTime, auditContext } = createRequestContext(
        'generate',
        model,
        prompt
      );

      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
        });

        const text = response.text ?? '';

        await logSuccess('generate', requestId, startTime, text, auditContext);
        return ok(text);
      } catch (error) {
        await logError('generate', requestId, startTime, error, auditContext);
        return err(mapGeminiError(error));
      }
    },
  };
}

function mapGeminiError(error: unknown): GeminiError {
  const message = getErrorMessage(error);

  if (message.includes('API_KEY')) {
    return { code: 'INVALID_KEY', message };
  }
  if (message.includes('429') || message.includes('quota')) {
    return { code: 'RATE_LIMITED', message };
  }
  if (message.includes('timeout')) {
    return { code: 'TIMEOUT', message };
  }

  return { code: 'API_ERROR', message };
}

function extractSourcesFromResponse(response: GenerateContentResponse): string[] {
  const sources: string[] = [];
  const candidate = response.candidates?.[0];

  if (candidate?.groundingMetadata !== undefined) {
    const groundingChunks = candidate.groundingMetadata.groundingChunks;
    if (Array.isArray(groundingChunks)) {
      for (const chunk of groundingChunks) {
        if (chunk.web?.uri !== undefined) {
          sources.push(chunk.web.uri);
        }
      }
    }
  }

  return [...new Set(sources)];
}
