import { GoogleGenerativeAI, type GenerateContentResult } from '@google/generative-ai';
import {
  ok,
  err,
  type Result,
  getErrorMessage,
  buildResearchPrompt,
} from '@intexuraos/common-core';
import { createAuditContext, type AuditContext } from '@intexuraos/infra-llm-audit';
import type { GeminiConfig, ResearchResult, SynthesisInput, GeminiError } from './types.js';

const DEFAULT_MODEL = 'gemini-3-pro-preview';
const VALIDATION_MODEL = 'gemini-2.0-flash-lite';

export interface GeminiClient {
  research(prompt: string): Promise<Result<ResearchResult, GeminiError>>;
  generateTitle(prompt: string): Promise<Result<string, GeminiError>>;
  synthesize(
    originalPrompt: string,
    reports: SynthesisInput[],
    inputContexts?: { content: string }[]
  ): Promise<Result<string, GeminiError>>;
  validateKey(): Promise<Result<boolean, GeminiError>>;
}

function createRequestContext(
  method: string,
  model: string,
  prompt: string
): { requestId: string; startTime: Date; auditContext: AuditContext } {
  const requestId = crypto.randomUUID();
  const startTime = new Date();

  // Console logging
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

  // Create audit context for Firestore logging
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
  auditContext: AuditContext
): Promise<void> {
  // Console logging
  // eslint-disable-next-line no-console
  console.info(
    `[Gemini:${method}] Response`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime.getTime(),
      responseLength: response.length,
      responsePreview: response.slice(0, 200),
    })
  );

  // Firestore audit logging
  await auditContext.success({ response });
}

async function logError(
  method: string,
  requestId: string,
  startTime: Date,
  error: unknown,
  auditContext: AuditContext
): Promise<void> {
  const errorMessage = getErrorMessage(error, String(error));

  // Console logging
  // eslint-disable-next-line no-console
  console.error(
    `[Gemini:${method}] Error`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime.getTime(),
      error: errorMessage,
    })
  );

  // Firestore audit logging
  await auditContext.error({ error: errorMessage });
}

export function createGeminiClient(config: GeminiConfig): GeminiClient {
  const genAI = new GoogleGenerativeAI(config.apiKey);
  const modelName = config.model ?? DEFAULT_MODEL;

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GeminiError>> {
      const researchPrompt = buildResearchPrompt(prompt);
      const { requestId, startTime, auditContext } = createRequestContext(
        'research',
        modelName,
        researchPrompt
      );

      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          tools: [{ googleSearchRetrieval: {} }],
        });
        const result = await model.generateContent(researchPrompt);
        const response = result.response;
        const text = response.text();
        const sources = extractSourcesFromGeminiResponse(result);

        await logSuccess('research', requestId, startTime, text, auditContext);
        return ok({ content: text, sources });
      } catch (error) {
        await logError('research', requestId, startTime, error, auditContext);
        return err(mapGeminiError(error));
      }
    },

    async generateTitle(prompt: string): Promise<Result<string, GeminiError>> {
      const titlePrompt = `Generate a short, descriptive title (max 10 words) for this research prompt:\n\n${prompt}`;
      const { requestId, startTime, auditContext } = createRequestContext(
        'generateTitle',
        modelName,
        titlePrompt
      );

      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(titlePrompt);
        const text = result.response.text().trim();

        await logSuccess('generateTitle', requestId, startTime, text, auditContext);
        return ok(text);
      } catch (error) {
        await logError('generateTitle', requestId, startTime, error, auditContext);
        return err(mapGeminiError(error));
      }
    },

    async synthesize(
      originalPrompt: string,
      reports: SynthesisInput[],
      inputContexts?: { content: string }[]
    ): Promise<Result<string, GeminiError>> {
      const synthesisPrompt = buildSynthesisPrompt(originalPrompt, reports, inputContexts);
      const { requestId, startTime, auditContext } = createRequestContext(
        'synthesize',
        modelName,
        synthesisPrompt
      );

      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(synthesisPrompt);
        const text = result.response.text();

        await logSuccess('synthesize', requestId, startTime, text, auditContext);
        return ok(text);
      } catch (error) {
        await logError('synthesize', requestId, startTime, error, auditContext);
        return err(mapGeminiError(error));
      }
    },

    async validateKey(): Promise<Result<boolean, GeminiError>> {
      const validatePrompt = 'Say "ok"';
      const { requestId, startTime, auditContext } = createRequestContext(
        'validateKey',
        VALIDATION_MODEL,
        validatePrompt
      );

      try {
        const model = genAI.getGenerativeModel({ model: VALIDATION_MODEL });
        const result = await model.generateContent(validatePrompt);
        const text = result.response.text();

        await logSuccess('validateKey', requestId, startTime, text, auditContext);
        return ok(true);
      } catch (error) {
        await logError('validateKey', requestId, startTime, error, auditContext);
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

function extractSourcesFromGeminiResponse(result: GenerateContentResult): string[] {
  const sources: string[] = [];
  const candidate = result.response.candidates?.[0];

  if (candidate?.groundingMetadata !== undefined) {
    const groundingChunks = candidate.groundingMetadata.groundingChuncks;
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

function buildSynthesisPrompt(
  originalPrompt: string,
  reports: SynthesisInput[],
  inputContexts?: { content: string }[]
): string {
  const formattedReports = reports.map((r) => `### ${r.model}\n\n${r.content}`).join('\n\n---\n\n');

  let inputContextsSection = '';
  if (inputContexts !== undefined && inputContexts.length > 0) {
    const formattedContexts = inputContexts
      .map((ctx, idx) => `### User Context ${String(idx + 1)}\n\n${ctx.content}`)
      .join('\n\n---\n\n');
    inputContextsSection = `## User-Provided Context

The user has provided the following reference materials to consider in the synthesis:

${formattedContexts}

---

`;
  }

  return `You are a research analyst. Below are research reports from multiple AI models responding to the same prompt. Synthesize them into a comprehensive, well-organized report.

## Original Research Prompt

${originalPrompt}

${inputContextsSection}## Individual Reports

${formattedReports}

## Your Task

Create a unified synthesis that:
1. Combines the best insights from all reports${inputContexts !== undefined && inputContexts.length > 0 ? ' and user-provided context' : ''}
2. Notes any conflicting information
3. Provides a balanced conclusion
4. Lists key sources from across all reports

Write in clear, professional prose.`;
}
