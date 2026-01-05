/**
 * Context inference adapter using Gemini Flash for fast context extraction.
 * Usage logging is handled by the client (packages/infra-gemini).
 */

import { createGeminiClient, type GeminiClient } from '@intexuraos/infra-gemini';
import {
  buildInferResearchContextPrompt,
  buildInferSynthesisContextPrompt,
  getErrorMessage,
  isResearchContext,
  isSynthesisContext,
  type InferResearchContextOptions,
  type InferSynthesisContextParams,
  type ResearchContext,
  type Result,
  type SynthesisContext,
} from '@intexuraos/common-core';
import type { LlmError } from '../../domain/research/ports/llmProvider.js';
import type { ContextInferenceProvider } from '../../domain/research/ports/contextInference.js';
import type { Logger } from '@intexuraos/common-core';

export class ContextInferenceAdapter implements ContextInferenceProvider {
  private readonly client: GeminiClient;
  private readonly logger: Logger | undefined;

  constructor(apiKey: string, model: string, userId: string, logger?: Logger) {
    this.client = createGeminiClient({ apiKey, model, userId });
    this.logger = logger;
  }

  async inferResearchContext(
    userQuery: string,
    opts?: InferResearchContextOptions
  ): Promise<Result<ResearchContext, LlmError>> {
    const prompt = buildInferResearchContextPrompt(userQuery, opts);
    const result = await this.client.generate(prompt);

    if (!result.ok) {
      return { ok: false, error: mapToLlmError(result.error) };
    }

    const parsed = parseJson<ResearchContext>(result.value.content, isResearchContext);
    if (!parsed.ok) {
      this.logger?.warn({ error: parsed.error }, 'Failed to parse research context');
      return { ok: false, error: { code: 'API_ERROR', message: parsed.error } };
    }

    return { ok: true, value: parsed.value };
  }

  async inferSynthesisContext(
    params: InferSynthesisContextParams
  ): Promise<Result<SynthesisContext, LlmError>> {
    const prompt = buildInferSynthesisContextPrompt(params);
    const result = await this.client.generate(prompt);

    if (!result.ok) {
      return { ok: false, error: mapToLlmError(result.error) };
    }

    const parsed = parseJson<SynthesisContext>(result.value.content, isSynthesisContext);
    if (!parsed.ok) {
      this.logger?.warn({ error: parsed.error }, 'Failed to parse synthesis context');
      return { ok: false, error: { code: 'API_ERROR', message: parsed.error } };
    }

    return { ok: true, value: parsed.value };
  }
}

function mapToLlmError(error: { code: string; message: string }): LlmError {
  const validCodes = ['API_ERROR', 'TIMEOUT', 'INVALID_KEY', 'RATE_LIMITED'] as const;
  const code = validCodes.includes(error.code as (typeof validCodes)[number])
    ? (error.code as LlmError['code'])
    : 'API_ERROR';

  return { code, message: error.message };
}

function parseJson<T>(
  raw: string,
  guard: (v: unknown) => v is T
): { ok: true; value: T } | { ok: false; error: string } {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${getErrorMessage(e)}` };
  }

  if (!guard(parsed)) {
    return { ok: false, error: 'Response does not match expected schema' };
  }

  return { ok: true, value: parsed };
}
