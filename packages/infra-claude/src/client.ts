import Anthropic from '@anthropic-ai/sdk';
import {
  ok,
  err,
  type Result,
  getErrorMessage,
  buildResearchPrompt,
} from '@intexuraos/common-core';
import { createAuditContext, type AuditContext } from '@intexuraos/infra-llm-audit';
import type { ClaudeConfig, ResearchResult, SynthesisInput, ClaudeError } from './types.js';

const DEFAULT_MODEL = 'claude-opus-4-5';
const VALIDATION_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 8192;

export interface ClaudeClient {
  research(prompt: string): Promise<Result<ResearchResult, ClaudeError>>;
  generateTitle(prompt: string): Promise<Result<string, ClaudeError>>;
  synthesize(
    originalPrompt: string,
    reports: SynthesisInput[],
    inputContexts?: { content: string }[]
  ): Promise<Result<string, ClaudeError>>;
  validateKey(): Promise<Result<boolean, ClaudeError>>;
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
    `[Claude:${method}] Request`,
    JSON.stringify({
      requestId,
      model,
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 200),
    })
  );

  // Create audit context for Firestore logging
  const auditContext = createAuditContext({
    provider: 'anthropic',
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
    `[Claude:${method}] Response`,
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
    `[Claude:${method}] Error`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime.getTime(),
      error: errorMessage,
    })
  );

  // Firestore audit logging
  await auditContext.error({ error: errorMessage });
}

export function createClaudeClient(config: ClaudeConfig): ClaudeClient {
  const client = new Anthropic({ apiKey: config.apiKey });
  const modelName = config.model ?? DEFAULT_MODEL;

  return {
    async research(prompt: string): Promise<Result<ResearchResult, ClaudeError>> {
      const researchPrompt = buildResearchPrompt(prompt);
      const { requestId, startTime, auditContext } = createRequestContext(
        'research',
        modelName,
        researchPrompt
      );

      try {
        const response = await client.messages.create({
          model: modelName,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: researchPrompt }],
          tools: [
            {
              type: 'web_search_20250305' as const,
              name: 'web_search' as const,
            },
          ],
        });

        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );

        const content = textBlocks.map((b) => b.text).join('\n\n');
        const sources = extractSourcesFromClaudeResponse(response);

        await logSuccess('research', requestId, startTime, content, auditContext);
        return ok({ content, sources });
      } catch (error) {
        await logError('research', requestId, startTime, error, auditContext);
        return err(mapClaudeError(error));
      }
    },

    async generateTitle(prompt: string): Promise<Result<string, ClaudeError>> {
      const titlePrompt = `Generate a short, descriptive title (max 10 words) for this research prompt:\n\n${prompt}`;
      const { requestId, startTime, auditContext } = createRequestContext(
        'generateTitle',
        modelName,
        titlePrompt
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

        await logSuccess('generateTitle', requestId, startTime, text, auditContext);
        return ok(text);
      } catch (error) {
        await logError('generateTitle', requestId, startTime, error, auditContext);
        return err(mapClaudeError(error));
      }
    },

    async synthesize(
      originalPrompt: string,
      reports: SynthesisInput[],
      inputContexts?: { content: string }[]
    ): Promise<Result<string, ClaudeError>> {
      const synthesisPrompt = buildSynthesisPrompt(originalPrompt, reports, inputContexts);
      const { requestId, startTime, auditContext } = createRequestContext(
        'synthesize',
        modelName,
        synthesisPrompt
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

        await logSuccess('synthesize', requestId, startTime, text, auditContext);
        return ok(text);
      } catch (error) {
        await logError('synthesize', requestId, startTime, error, auditContext);
        return err(mapClaudeError(error));
      }
    },

    async validateKey(): Promise<Result<boolean, ClaudeError>> {
      const validatePrompt = 'Say "ok"';
      const { requestId, startTime, auditContext } = createRequestContext(
        'validateKey',
        VALIDATION_MODEL,
        validatePrompt
      );

      try {
        const response = await client.messages.create({
          model: VALIDATION_MODEL,
          max_tokens: 10,
          messages: [{ role: 'user', content: validatePrompt }],
        });

        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );
        const content = textBlocks.map((b) => b.text).join('');

        await logSuccess('validateKey', requestId, startTime, content, auditContext);
        return ok(true);
      } catch (error) {
        await logError('validateKey', requestId, startTime, error, auditContext);
        return err(mapClaudeError(error));
      }
    },
  };
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

  const message = getErrorMessage(error);
  return { code: 'API_ERROR', message };
}

function extractSourcesFromClaudeResponse(response: Anthropic.Message): string[] {
  const sources: string[] = [];
  const urlPattern = /https?:\/\/[^\s"'<>)\]]+/g;

  for (const block of response.content) {
    if (block.type === 'text') {
      const matches = block.text.match(urlPattern);
      if (matches !== null) {
        sources.push(...matches);
      }
    }
    if (block.type === 'web_search_tool_result') {
      if (Array.isArray(block.content)) {
        for (const result of block.content) {
          sources.push(result.url);
        }
      }
    }
  }

  return [...new Set(sources)];
}
