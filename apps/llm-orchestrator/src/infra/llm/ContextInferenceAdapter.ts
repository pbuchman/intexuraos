/**
 * Context inference adapter using Gemini Flash for fast context extraction.
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
import type { LlmUsageTracker } from '../../domain/research/services/index.js';

export class ContextInferenceAdapter implements ContextInferenceProvider {
  private readonly client: GeminiClient;
  private readonly model: string;
  private readonly logger: Logger | undefined;
  private readonly tracker: LlmUsageTracker | undefined;

  constructor(apiKey: string, model: string, logger?: Logger, tracker?: LlmUsageTracker) {
    this.client = createGeminiClient({ apiKey, model });
    this.model = model;
    this.logger = logger;
    this.tracker = tracker;
  }

  async inferResearchContext(
    userQuery: string,
    opts?: InferResearchContextOptions
  ): Promise<Result<ResearchContext, LlmError>> {
    const prompt = buildInferResearchContextPrompt(userQuery, opts);
    const result = await this.client.generate(prompt);

    if (!result.ok) {
      this.tracker?.track({
        provider: 'google',
        model: this.model,
        callType: 'context_inference',
        success: false,
        inputTokens: 0,
        outputTokens: 0,
      });
      return {
        ok: false,
        error: mapToLlmError(result.error),
      };
    }

    const parsed = parseJson<ResearchContext>(result.value, isResearchContext);
    if (!parsed.ok) {
      this.logger?.warn({ error: parsed.error }, 'Failed to parse research context');
      this.tracker?.track({
        provider: 'google',
        model: this.model,
        callType: 'context_inference',
        success: false,
        inputTokens: 0,
        outputTokens: 0,
      });
      return {
        ok: false,
        error: { code: 'API_ERROR', message: parsed.error },
      };
    }

    this.tracker?.track({
      provider: 'google',
      model: this.model,
      callType: 'context_inference',
      success: true,
      inputTokens: 0,
      outputTokens: 0,
    });

    return { ok: true, value: parsed.value };
  }

  async inferSynthesisContext(
    params: InferSynthesisContextParams
  ): Promise<Result<SynthesisContext, LlmError>> {
    const prompt = buildInferSynthesisContextPrompt(params);
    const result = await this.client.generate(prompt);

    if (!result.ok) {
      this.tracker?.track({
        provider: 'google',
        model: this.model,
        callType: 'context_inference',
        success: false,
        inputTokens: 0,
        outputTokens: 0,
      });
      return {
        ok: false,
        error: mapToLlmError(result.error),
      };
    }

    const parsed = parseJson<SynthesisContext>(result.value, isSynthesisContext);
    if (!parsed.ok) {
      this.logger?.warn({ error: parsed.error }, 'Failed to parse synthesis context');
      this.tracker?.track({
        provider: 'google',
        model: this.model,
        callType: 'context_inference',
        success: false,
        inputTokens: 0,
        outputTokens: 0,
      });
      return {
        ok: false,
        error: { code: 'API_ERROR', message: parsed.error },
      };
    }

    this.tracker?.track({
      provider: 'google',
      model: this.model,
      callType: 'context_inference',
      success: true,
      inputTokens: 0,
      outputTokens: 0,
    });

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
