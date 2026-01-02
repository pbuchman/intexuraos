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
import type { GeminiConfig, GeminiError, ResearchResult, SynthesisInput } from './types.js';
import { GEMINI_DEFAULTS } from './types.js';

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
  const defaultModel = config.defaultModel ?? GEMINI_DEFAULTS.defaultModel;
  const validationModel = config.validationModel ?? GEMINI_DEFAULTS.validationModel;
  const researchModel = config.researchModel ?? GEMINI_DEFAULTS.researchModel;

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GeminiError>> {
      const researchPrompt = buildResearchPrompt(prompt);
      const { requestId, startTime, auditContext } = createRequestContext(
        'research',
        researchModel,
        researchPrompt
      );

      try {
        const response = await ai.models.generateContent({
          model: researchModel,
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
        defaultModel,
        prompt
      );

      try {
        const response = await ai.models.generateContent({
          model: defaultModel,
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

    async synthesize(
      originalPrompt: string,
      reports: SynthesisInput[],
      externalReports?: { content: string; model?: string }[]
    ): Promise<Result<string, GeminiError>> {
      const synthesisPrompt = buildSynthesisPrompt(originalPrompt, reports, externalReports);
      const { requestId, startTime, auditContext } = createRequestContext(
        'synthesize',
        defaultModel,
        synthesisPrompt
      );

      try {
        const response = await ai.models.generateContent({
          model: defaultModel,
          contents: synthesisPrompt,
        });

        const text = response.text ?? '';

        await logSuccess('synthesize', requestId, startTime, text, auditContext);
        return ok(text);
      } catch (error) {
        await logError('synthesize', requestId, startTime, error, auditContext);
        return err(mapGeminiError(error));
      }
    },

    async validateKey(): Promise<Result<boolean, GeminiError>> {
      const validatePrompt = `Introduce yourself as Gemini and welcome the user to their intelligent workspace. Say you're here to intelligently improve their experience. Keep it to 2-3 sentences. Start with "Hi! I'm Gemini."`;
      const { requestId, startTime, auditContext } = createRequestContext(
        'validateKey',
        validationModel,
        validatePrompt
      );

      try {
        const response = await ai.models.generateContent({
          model: validationModel,
          contents: validatePrompt,
        });

        const text = response.text ?? '';

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

function buildSynthesisPrompt(
  originalPrompt: string,
  reports: SynthesisInput[],
  externalReports?: { content: string; model?: string }[]
): string {
  const formattedReports = reports.map((r) => `### ${r.model}\n\n${r.content}`).join('\n\n---\n\n');

  let externalReportsSection = '';
  if (externalReports !== undefined && externalReports.length > 0) {
    const formattedExternal = externalReports
      .map((report, idx) => {
        const source = report.model ?? 'unknown source';
        return `### External Report ${String(idx + 1)} (${source})\n\n${report.content}`;
      })
      .join('\n\n---\n\n');
    externalReportsSection = `## External LLM Reports

The following reports were obtained from external LLM sources not available through system APIs:

${formattedExternal}

---

`;
  }

  const hasExternal = externalReports !== undefined && externalReports.length > 0;
  const conflictGuidelines = hasExternal
    ? `
## Conflict Resolution Guidelines

When information conflicts between system reports and external reports:
1. Note the discrepancy explicitly
2. Present both perspectives with attribution
3. If dates are available, prefer more recent information
4. Never silently discard conflicting data
`
    : '';

  return `You are a research analyst. Below are research reports from multiple AI models responding to the same prompt. Synthesize them into a comprehensive, well-organized report.

## Original Research Prompt

${originalPrompt}

${externalReportsSection}## System Reports

${formattedReports}
${conflictGuidelines}
## Your Task

Create a unified synthesis that:
1. Combines the best insights from all reports${hasExternal ? ' (both system and external)' : ''}
2. Notes any conflicting information with clear attribution
3. Provides a balanced conclusion
4. Lists key sources from across all reports

Write in clear, professional prose.`;
}
