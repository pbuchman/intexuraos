import { GoogleGenerativeAI } from '@google/generative-ai';
import { ok, err, type Result } from '@intexuraos/common-core';
import type { GeminiConfig, ResearchResult, SynthesisInput, GeminiError } from './types.js';

const DEFAULT_MODEL = 'gemini-2.0-flash-exp';

export interface GeminiClient {
  research(prompt: string): Promise<Result<ResearchResult, GeminiError>>;
  generateTitle(prompt: string): Promise<Result<string, GeminiError>>;
  synthesize(
    originalPrompt: string,
    reports: SynthesisInput[]
  ): Promise<Result<string, GeminiError>>;
}

function logRequest(
  method: string,
  model: string,
  promptLength: number,
  promptPreview: string
): { requestId: string; startTime: number } {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  // eslint-disable-next-line no-console
  console.info(
    `[Gemini:${method}] Request`,
    JSON.stringify({ requestId, model, promptLength, promptPreview })
  );
  return { requestId, startTime };
}

function logResponse(
  method: string,
  requestId: string,
  startTime: number,
  responseLength: number,
  responsePreview: string
): void {
  // eslint-disable-next-line no-console
  console.info(
    `[Gemini:${method}] Response`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime,
      responseLength,
      responsePreview,
    })
  );
}

function logError(method: string, requestId: string, startTime: number, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    `[Gemini:${method}] Error`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    })
  );
}

export function createGeminiClient(config: GeminiConfig): GeminiClient {
  const genAI = new GoogleGenerativeAI(config.apiKey);
  const modelName = config.model ?? DEFAULT_MODEL;

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GeminiError>> {
      const { requestId, startTime } = logRequest(
        'research',
        modelName,
        prompt.length,
        prompt.slice(0, 200)
      );

      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        logResponse('research', requestId, startTime, text.length, text.slice(0, 200));
        return ok({ content: text });
      } catch (error) {
        logError('research', requestId, startTime, error);
        return err(mapGeminiError(error));
      }
    },

    async generateTitle(prompt: string): Promise<Result<string, GeminiError>> {
      const titlePrompt = `Generate a short, descriptive title (max 10 words) for this research prompt:\n\n${prompt}`;
      const { requestId, startTime } = logRequest(
        'generateTitle',
        modelName,
        titlePrompt.length,
        prompt.slice(0, 100)
      );

      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(titlePrompt);
        const text = result.response.text().trim();

        logResponse('generateTitle', requestId, startTime, text.length, text);
        return ok(text);
      } catch (error) {
        logError('generateTitle', requestId, startTime, error);
        return err(mapGeminiError(error));
      }
    },

    async synthesize(
      originalPrompt: string,
      reports: SynthesisInput[]
    ): Promise<Result<string, GeminiError>> {
      const synthesisPrompt = buildSynthesisPrompt(originalPrompt, reports);
      const { requestId, startTime } = logRequest(
        'synthesize',
        modelName,
        synthesisPrompt.length,
        originalPrompt.slice(0, 100)
      );

      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(synthesisPrompt);
        const text = result.response.text();

        logResponse('synthesize', requestId, startTime, text.length, text.slice(0, 200));
        return ok(text);
      } catch (error) {
        logError('synthesize', requestId, startTime, error);
        return err(mapGeminiError(error));
      }
    },
  };
}

function mapGeminiError(error: unknown): GeminiError {
  const message = error instanceof Error ? error.message : 'Unknown error';

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

function buildSynthesisPrompt(originalPrompt: string, reports: SynthesisInput[]): string {
  const formattedReports = reports.map((r) => `### ${r.model}\n\n${r.content}`).join('\n\n---\n\n');

  return `You are a research analyst. Below are research reports from multiple AI models responding to the same prompt. Synthesize them into a comprehensive, well-organized report.

## Original Research Prompt

${originalPrompt}

## Individual Reports

${formattedReports}

## Your Task

Create a unified synthesis that:
1. Combines the best insights from all reports
2. Notes any conflicting information
3. Provides a balanced conclusion
4. Lists key sources from across all reports

Write in clear, professional prose.`;
}
