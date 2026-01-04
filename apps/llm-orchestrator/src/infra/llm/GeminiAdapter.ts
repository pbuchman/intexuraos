/**
 * Gemini adapter implementing LlmResearchProvider and LlmSynthesisProvider.
 */

import { createGeminiClient, type GeminiClient } from '@intexuraos/infra-gemini';
import { buildSynthesisPrompt, type Result, type SynthesisContext } from '@intexuraos/common-core';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
  LlmSynthesisProvider,
} from '../../domain/research/index.js';
import type { LlmUsageTracker } from '../../domain/research/services/index.js';

export class GeminiAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: GeminiClient;
  private readonly model: string;
  private readonly tracker: LlmUsageTracker | undefined;

  constructor(apiKey: string, model: string, tracker?: LlmUsageTracker) {
    this.client = createGeminiClient({ apiKey, model });
    this.model = model;
    this.tracker = tracker;
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    const result = await this.client.research(prompt);

    if (!result.ok) {
      this.tracker?.track({
        provider: 'google',
        model: this.model,
        callType: 'research',
        success: false,
        inputTokens: 0,
        outputTokens: 0,
      });
      return {
        ok: false,
        error: mapToLlmError(result.error),
      };
    }

    this.tracker?.track({
      provider: 'google',
      model: this.model,
      callType: 'research',
      success: true,
      inputTokens: result.value.usage?.inputTokens ?? 0,
      outputTokens: result.value.usage?.outputTokens ?? 0,
    });

    return result;
  }

  async synthesize(
    originalPrompt: string,
    reports: { model: string; content: string }[],
    additionalSources?: { content: string; label?: string }[],
    synthesisContext?: SynthesisContext
  ): Promise<Result<string, LlmError>> {
    const synthesisPrompt =
      synthesisContext !== undefined
        ? buildSynthesisPrompt(originalPrompt, reports, synthesisContext, additionalSources)
        : buildSynthesisPrompt(originalPrompt, reports, additionalSources);
    const result = await this.client.generate(synthesisPrompt);

    if (!result.ok) {
      this.tracker?.track({
        provider: 'google',
        model: this.model,
        callType: 'synthesis',
        success: false,
        inputTokens: 0,
        outputTokens: 0,
      });
      return {
        ok: false,
        error: mapToLlmError(result.error),
      };
    }

    this.tracker?.track({
      provider: 'google',
      model: this.model,
      callType: 'synthesis',
      success: true,
      inputTokens: 0,
      outputTokens: 0,
    });

    return result;
  }

  async generateTitle(prompt: string): Promise<Result<string, LlmError>> {
    const titlePrompt = `Generate a short, concise title for this research prompt.

CRITICAL REQUIREMENTS:
- Title must be 5-8 words maximum
- Title must be in the SAME LANGUAGE as the prompt (Polish prompt → Polish title, English prompt → English title)
- Return ONLY the title - no explanations, no options, no word counts
- Do NOT start with "Here are options" or similar phrases

GOOD EXAMPLES:
- "Gran Canaria w Drugiej Połowie Stycznia" (for Polish prompt about Gran Canaria)
- "Machine Learning in Healthcare Applications" (for English prompt)
- "Paris Budget Travel Guide" (for English prompt)

BAD EXAMPLES (DO NOT DO THIS):
- "Here are a few options: 1. Gran Canaria January Trip: Worth it? (9 words)"
- "Title: Planning Your Gran Canaria Vacation in January"
- "Gran Canaria January Tourist Guide: What to See, Do, Stay. (10 words)"

Research prompt:
${prompt}

Generate title:`;
    const result = await this.client.generate(titlePrompt);

    if (!result.ok) {
      this.tracker?.track({
        provider: 'google',
        model: this.model,
        callType: 'title',
        success: false,
        inputTokens: 0,
        outputTokens: 0,
      });
      return {
        ok: false,
        error: mapToLlmError(result.error),
      };
    }

    this.tracker?.track({
      provider: 'google',
      model: this.model,
      callType: 'title',
      success: true,
      inputTokens: 0,
      outputTokens: 0,
    });

    return { ok: true, value: result.value.trim() };
  }

  async generateContextLabel(content: string): Promise<Result<string, LlmError>> {
    const contentPreview = content.length > 2000 ? content.slice(0, 2000) + '...' : content;

    const labelPrompt = `Generate a very short label (3-6 words) summarizing the following content.

CRITICAL REQUIREMENTS:
- Label must be 3-6 words maximum
- Label must be in the SAME LANGUAGE as the content
- Return ONLY the label - no explanations, no quotes
- Describe WHAT the content is about, not its format

GOOD EXAMPLES:
- "Gran Canaria trip itinerary"
- "Wymagania techniczne projektu"
- "Customer feedback survey results"
- "Analiza konkurencji rynkowej"

BAD EXAMPLES:
- "Document about travel plans for vacation" (too long)
- "Here is a label: Trip Planning" (includes extra text)
- "A PDF file" (describes format, not content)

Content:
${contentPreview}

Generate label:`;

    const result = await this.client.generate(labelPrompt);

    if (!result.ok) {
      this.tracker?.track({
        provider: 'google',
        model: this.model,
        callType: 'context_label',
        success: false,
        inputTokens: 0,
        outputTokens: 0,
      });
      return {
        ok: false,
        error: mapToLlmError(result.error),
      };
    }

    this.tracker?.track({
      provider: 'google',
      model: this.model,
      callType: 'context_label',
      success: true,
      inputTokens: 0,
      outputTokens: 0,
    });

    return { ok: true, value: result.value.trim() };
  }
}

function mapToLlmError(error: { code: string; message: string }): LlmError {
  const validCodes = ['API_ERROR', 'TIMEOUT', 'INVALID_KEY', 'RATE_LIMITED'] as const;
  const code = validCodes.includes(error.code as (typeof validCodes)[number])
    ? (error.code as LlmError['code'])
    : 'API_ERROR';

  return { code, message: error.message };
}
