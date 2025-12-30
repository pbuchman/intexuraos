import Anthropic from '@anthropic-ai/sdk';
import { ok, err, type Result } from '@intexuraos/common-core';
import type { ClaudeConfig, ResearchResult, SynthesisInput, ClaudeError } from './types.js';

const DEFAULT_MODEL = 'claude-opus-4-5';
const VALIDATION_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 8192;

export interface ClaudeClient {
  research(prompt: string): Promise<Result<ResearchResult, ClaudeError>>;
  generateTitle(prompt: string): Promise<Result<string, ClaudeError>>;
  synthesize(
    originalPrompt: string,
    reports: SynthesisInput[]
  ): Promise<Result<string, ClaudeError>>;
  validateKey(): Promise<Result<boolean, ClaudeError>>;
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
    `[Claude:${method}] Request`,
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
    `[Claude:${method}] Response`,
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
    `[Claude:${method}] Error`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    })
  );
}

export function createClaudeClient(config: ClaudeConfig): ClaudeClient {
  const client = new Anthropic({ apiKey: config.apiKey });
  const modelName = config.model ?? DEFAULT_MODEL;

  return {
    async research(prompt: string): Promise<Result<ResearchResult, ClaudeError>> {
      const { requestId, startTime } = logRequest(
        'research',
        modelName,
        prompt.length,
        prompt.slice(0, 200)
      );

      try {
        const response = await client.messages.create({
          model: modelName,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        });

        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );

        const content = textBlocks.map((b) => b.text).join('\n\n');

        logResponse('research', requestId, startTime, content.length, content.slice(0, 200));
        return ok({ content });
      } catch (error) {
        logError('research', requestId, startTime, error);
        return err(mapClaudeError(error));
      }
    },

    async generateTitle(prompt: string): Promise<Result<string, ClaudeError>> {
      const titlePrompt = `Generate a short, descriptive title (max 10 words) for this research prompt:\n\n${prompt}`;
      const { requestId, startTime } = logRequest(
        'generateTitle',
        modelName,
        titlePrompt.length,
        prompt.slice(0, 100)
      );

      try {
        const response = await client.messages.create({
          model: modelName,
          max_tokens: 100,
          messages: [{ role: 'user', content: titlePrompt }],
        });

        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );
        const text = textBlocks
          .map((b) => b.text)
          .join('')
          .trim();

        logResponse('generateTitle', requestId, startTime, text.length, text);
        return ok(text);
      } catch (error) {
        logError('generateTitle', requestId, startTime, error);
        return err(mapClaudeError(error));
      }
    },

    async synthesize(
      originalPrompt: string,
      reports: SynthesisInput[]
    ): Promise<Result<string, ClaudeError>> {
      const synthesisPrompt = buildSynthesisPrompt(originalPrompt, reports);
      const { requestId, startTime } = logRequest(
        'synthesize',
        modelName,
        synthesisPrompt.length,
        originalPrompt.slice(0, 100)
      );

      try {
        const response = await client.messages.create({
          model: modelName,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: synthesisPrompt }],
        });

        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );
        const text = textBlocks.map((b) => b.text).join('\n\n');

        logResponse('synthesize', requestId, startTime, text.length, text.slice(0, 200));
        return ok(text);
      } catch (error) {
        logError('synthesize', requestId, startTime, error);
        return err(mapClaudeError(error));
      }
    },

    async validateKey(): Promise<Result<boolean, ClaudeError>> {
      const { requestId, startTime } = logRequest('validateKey', VALIDATION_MODEL, 9, 'Say "ok"');

      try {
        const response = await client.messages.create({
          model: VALIDATION_MODEL,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say "ok"' }],
        });

        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );
        const content = textBlocks.map((b) => b.text).join('');

        logResponse('validateKey', requestId, startTime, content.length, content);
        return ok(true);
      } catch (error) {
        logError('validateKey', requestId, startTime, error);
        return err(mapClaudeError(error));
      }
    },
  };
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

function mapClaudeError(error: unknown): ClaudeError {
  if (error instanceof Anthropic.APIError) {
    const message = error.message;

    if (error.status === 401) {
      return { code: 'INVALID_KEY', message };
    }
    if (error.status === 429) {
      return { code: 'RATE_LIMITED', message };
    }
    if (error.status === 529) {
      return { code: 'OVERLOADED', message };
    }
    if (message.includes('timeout')) {
      return { code: 'TIMEOUT', message };
    }

    return { code: 'API_ERROR', message };
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return { code: 'API_ERROR', message };
}
