import Anthropic from '@anthropic-ai/sdk';
import {
  buildResearchPrompt,
  err,
  getErrorMessage,
  ok,
  type Result,
} from '@intexuraos/common-core';
import { type AuditContext, createAuditContext } from '@intexuraos/llm-audit';
import type { LLMClient } from '@intexuraos/llm-contract';
import type { ClaudeConfig, ClaudeError, ResearchResult, SynthesisInput } from './types.js';
import { CLAUDE_DEFAULTS } from './types.js';

export type ClaudeClient = LLMClient;

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
    `[Claude:${method}] Request`,
    JSON.stringify({
      requestId,
      model,
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 200),
    })
  );

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

  // eslint-disable-next-line no-console
  console.error(
    `[Claude:${method}] Error`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime.getTime(),
      error: errorMessage,
    })
  );

  await auditContext.error({ error: errorMessage });
}

export function createClaudeClient(config: ClaudeConfig): ClaudeClient {
  const client = new Anthropic({ apiKey: config.apiKey });
  const defaultModel = config.defaultModel ?? CLAUDE_DEFAULTS.defaultModel;
  const validationModel = config.validationModel ?? CLAUDE_DEFAULTS.validationModel;
  const researchModel = config.researchModel ?? CLAUDE_DEFAULTS.researchModel;

  return {
    async research(prompt: string): Promise<Result<ResearchResult, ClaudeError>> {
      const researchPrompt = buildResearchPrompt(prompt);
      const { requestId, startTime, auditContext } = createRequestContext(
        'research',
        researchModel,
        researchPrompt
      );

      try {
        const response = await client.messages.create({
          model: researchModel,
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

    async generate(prompt: string): Promise<Result<string, ClaudeError>> {
      const { requestId, startTime, auditContext } = createRequestContext(
        'generate',
        defaultModel,
        prompt
      );

      try {
        const response = await client.messages.create({
          model: defaultModel,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        });

        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === 'text'
        );
        const text = textBlocks.map((b) => b.text).join('\n\n');

        await logSuccess('generate', requestId, startTime, text, auditContext);
        return ok(text);
      } catch (error) {
        await logError('generate', requestId, startTime, error, auditContext);
        return err(mapClaudeError(error));
      }
    },

    async synthesize(
      originalPrompt: string,
      reports: SynthesisInput[],
      externalReports?: { content: string; model?: string }[]
    ): Promise<Result<string, ClaudeError>> {
      const synthesisPrompt = buildSynthesisPrompt(originalPrompt, reports, externalReports);
      const { requestId, startTime, auditContext } = createRequestContext(
        'synthesize',
        defaultModel,
        synthesisPrompt
      );

      try {
        const response = await client.messages.create({
          model: defaultModel,
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
      const validatePrompt = `Introduce yourself as Claude and welcome the user to their intelligent workspace. Say you're here to intelligently improve their experience. Keep it to 2-3 sentences. Start with "Hi! I'm Claude."`;
      const { requestId, startTime, auditContext } = createRequestContext(
        'validateKey',
        validationModel,
        validatePrompt
      );

      try {
        const response = await client.messages.create({
          model: validationModel,
          max_tokens: 100,
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
