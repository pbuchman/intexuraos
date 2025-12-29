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

export function createGeminiClient(config: GeminiConfig): GeminiClient {
  const genAI = new GoogleGenerativeAI(config.apiKey);

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GeminiError>> {
      try {
        const model = genAI.getGenerativeModel({
          model: config.model ?? DEFAULT_MODEL,
        });

        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        return ok({ content: text });
      } catch (error) {
        return err(mapGeminiError(error));
      }
    },

    async generateTitle(prompt: string): Promise<Result<string, GeminiError>> {
      try {
        const model = genAI.getGenerativeModel({
          model: config.model ?? DEFAULT_MODEL,
        });

        const result = await model.generateContent(
          `Generate a short, descriptive title (max 10 words) for this research prompt:\n\n${prompt}`
        );

        return ok(result.response.text().trim());
      } catch (error) {
        return err(mapGeminiError(error));
      }
    },

    async synthesize(
      originalPrompt: string,
      reports: SynthesisInput[]
    ): Promise<Result<string, GeminiError>> {
      try {
        const model = genAI.getGenerativeModel({
          model: config.model ?? DEFAULT_MODEL,
        });

        const synthesisPrompt = buildSynthesisPrompt(originalPrompt, reports);
        const result = await model.generateContent(synthesisPrompt);

        return ok(result.response.text());
      } catch (error) {
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
