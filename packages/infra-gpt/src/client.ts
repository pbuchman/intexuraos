import OpenAI from 'openai';
import {
  buildResearchPrompt,
  err,
  getErrorMessage,
  ok,
  type Result,
} from '@intexuraos/common-core';
import { type AuditContext, createAuditContext } from '@intexuraos/infra-llm-audit';
import type { GptConfig, GptError, ResearchResult, SynthesisInput } from './types.js';

const DEFAULT_MODEL = 'gpt-4.1';
const VALIDATION_MODEL = 'gpt-4.1-mini';
const MAX_TOKENS = 8192;

export interface GptClient {
  research(prompt: string): Promise<Result<ResearchResult, GptError>>;
  generateTitle(prompt: string): Promise<Result<string, GptError>>;
  synthesize(
    originalPrompt: string,
    reports: SynthesisInput[],
    externalReports?: { content: string; model?: string }[]
  ): Promise<Result<string, GptError>>;
  validateKey(): Promise<Result<boolean, GptError>>;
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
    `[GPT:${method}] Request`,
    JSON.stringify({
      requestId,
      model,
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 200),
    })
  );

  // Create audit context for Firestore logging
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
  auditContext: AuditContext
): Promise<void> {
  // Console logging
  // eslint-disable-next-line no-console
  console.info(
    `[GPT:${method}] Response`,
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
    `[GPT:${method}] Error`,
    JSON.stringify({
      requestId,
      durationMs: Date.now() - startTime.getTime(),
      error: errorMessage,
    })
  );

  // Firestore audit logging
  await auditContext.error({ error: errorMessage });
}

export function createGptClient(config: GptConfig): GptClient {
  const client = new OpenAI({ apiKey: config.apiKey });
  const modelName = config.model ?? DEFAULT_MODEL;

  return {
    async research(prompt: string): Promise<Result<ResearchResult, GptError>> {
      const researchPrompt = buildResearchPrompt(prompt);
      const { requestId, startTime, auditContext } = createRequestContext(
        'research',
        modelName,
        researchPrompt
      );

      try {
        const response = await client.responses.create({
          model: modelName,
          instructions:
            'You are a senior research analyst. Search the web for current, authoritative information. Cross-reference sources and cite all findings with URLs.',
          input: researchPrompt,
          tools: [
            {
              type: 'web_search_preview',
              search_context_size: 'high',
            },
          ],
        });

        const content = response.output_text;

        const sources = extractSourcesFromResponse(response);

        await logSuccess('research', requestId, startTime, content, auditContext);
        return ok({ content, sources });
      } catch (error) {
        await logError('research', requestId, startTime, error, auditContext);
        return err(mapGptError(error));
      }
    },

    async generateTitle(prompt: string): Promise<Result<string, GptError>> {
      const titlePrompt = `Generate a short, descriptive title (max 10 words) for this research prompt:\n\n${prompt}`;
      const { requestId, startTime, auditContext } = createRequestContext(
        'generateTitle',
        modelName,
        titlePrompt
      );

      try {
        const response = await client.chat.completions.create({
          model: modelName,
          max_tokens: 100,
          messages: [{ role: 'user', content: titlePrompt }],
        });

        const text = (response.choices[0]?.message.content ?? '').trim();
        await logSuccess('generateTitle', requestId, startTime, text, auditContext);
        return ok(text);
      } catch (error) {
        await logError('generateTitle', requestId, startTime, error, auditContext);
        return err(mapGptError(error));
      }
    },

    async synthesize(
      originalPrompt: string,
      reports: SynthesisInput[],
      externalReports?: { content: string; model?: string }[]
    ): Promise<Result<string, GptError>> {
      const synthesisPrompt = buildSynthesisPrompt(originalPrompt, reports, externalReports);
      const { requestId, startTime, auditContext } = createRequestContext(
        'synthesize',
        modelName,
        synthesisPrompt
      );

      try {
        const response = await client.chat.completions.create({
          model: modelName,
          max_tokens: MAX_TOKENS,
          messages: [
            {
              role: 'system',
              content:
                'You are a research analyst synthesizing multiple reports into one comprehensive document.',
            },
            {
              role: 'user',
              content: synthesisPrompt,
            },
          ],
        });

        const text = response.choices[0]?.message.content ?? '';
        await logSuccess('synthesize', requestId, startTime, text, auditContext);
        return ok(text);
      } catch (error) {
        await logError('synthesize', requestId, startTime, error, auditContext);
        return err(mapGptError(error));
      }
    },

    async validateKey(): Promise<Result<boolean, GptError>> {
      const validatePrompt = `Introduce yourself as GPT and welcome the user to their intelligent workspace. Say you're here to intelligently improve their experience. Keep it to 2-3 sentences. Start with "Hi! I'm GPT."`;
      const { requestId, startTime, auditContext } = createRequestContext(
        'validateKey',
        VALIDATION_MODEL,
        validatePrompt
      );

      try {
        const response = await client.chat.completions.create({
          model: VALIDATION_MODEL,
          max_tokens: 100,
          messages: [{ role: 'user', content: validatePrompt }],
        });

        const content = response.choices[0]?.message.content ?? '';
        await logSuccess('validateKey', requestId, startTime, content, auditContext);
        return ok(true);
      } catch (error) {
        await logError('validateKey', requestId, startTime, error, auditContext);
        return err(mapGptError(error));
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

  return `Below are research reports from multiple AI models responding to the same prompt. Synthesize them into a comprehensive, well-organized report.

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
