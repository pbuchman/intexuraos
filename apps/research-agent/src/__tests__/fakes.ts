/**
 * Fake implementations for testing.
 */

import {
  err,
  ok,
  type Result,
} from '@intexuraos/common-core';
import {
  type InferResearchContextOptions,
  type InferSynthesisContextParams,
  type ResearchContext,
  type SynthesisContext,
} from '@intexuraos/llm-common';
import type {
  LabelGenerateResult,
  LlmError,
  LlmProvider,
  LlmResearchProvider,
  LlmResearchResult,
  LlmResult,
  LlmSynthesisProvider,
  LlmSynthesisResult,
  NotificationError,
  RepositoryError,
  Research,
  ResearchRepository,
  TitleGenerateResult,
  TitleGenerator,
} from '../domain/research/index.js';
import type {
  ContextInferenceProvider,
  ResearchContextResult,
  SynthesisContextResult,
} from '../domain/research/ports/contextInference.js';
import type {
  InputValidationProvider,
  ValidationResult,
  ImprovementResult,
} from '../infra/llm/InputValidationAdapter.js';
import type { DecryptedApiKeys, UserServiceClient, UserServiceError } from '../infra/user/index.js';
import type { ResearchEventPublisher, ResearchProcessEvent } from '../infra/pubsub/index.js';
import type { NotificationSender } from '../domain/research/index.js';

/**
 * In-memory fake implementation of ResearchRepository.
 */
export class FakeResearchRepository implements ResearchRepository {
  private researches = new Map<string, Research>();
  private failNextSave = false;
  private failNextFind = false;
  private failNextDelete = false;
  private failNextUpdate = false;
  private failNextUpdateLlmResult = false;
  private failNextClearShareInfo = false;

  async save(research: Research): Promise<Result<Research, RepositoryError>> {
    if (this.failNextSave) {
      this.failNextSave = false;
      return err({ code: 'FIRESTORE_ERROR', message: 'Test save failure' });
    }
    this.researches.set(research.id, research);
    return ok(research);
  }

  async findById(id: string): Promise<Result<Research | null, RepositoryError>> {
    if (this.failNextFind) {
      this.failNextFind = false;
      return err({ code: 'FIRESTORE_ERROR', message: 'Test find failure' });
    }
    const research = this.researches.get(id) ?? null;
    return ok(research);
  }

  async findByUserId(
    userId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<Result<{ items: Research[]; nextCursor?: string }, RepositoryError>> {
    if (this.failNextFind) {
      this.failNextFind = false;
      return err({ code: 'FIRESTORE_ERROR', message: 'Test find failure' });
    }

    const limit = options?.limit ?? 50;
    const items = Array.from(this.researches.values())
      .filter((r) => r.userId === userId)
      .slice(0, limit);

    return ok({ items });
  }

  async update(id: string, updates: Partial<Research>): Promise<Result<Research, RepositoryError>> {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      return err({ code: 'FIRESTORE_ERROR', message: 'Test update failure' });
    }
    const existing = this.researches.get(id);
    if (existing === undefined) {
      return err({ code: 'NOT_FOUND', message: 'Research not found' });
    }
    const updated = { ...existing, ...updates };
    this.researches.set(id, updated);
    return ok(updated);
  }

  async updateLlmResult(
    researchId: string,
    model: string,
    result: Partial<LlmResult>
  ): Promise<Result<void, RepositoryError>> {
    if (this.failNextUpdateLlmResult) {
      this.failNextUpdateLlmResult = false;
      throw new Error('Unexpected repository error during updateLlmResult');
    }
    const existing = this.researches.get(researchId);
    if (existing === undefined) {
      return err({ code: 'NOT_FOUND', message: 'Research not found' });
    }
    const llmIndex = existing.llmResults.findIndex((r) => r.model === model);
    if (llmIndex >= 0) {
      const llmResult = existing.llmResults[llmIndex];
      if (llmResult !== undefined) {
        existing.llmResults[llmIndex] = { ...llmResult, ...result };
      }
    }
    this.researches.set(researchId, existing);
    return ok(undefined);
  }

  async delete(id: string): Promise<Result<void, RepositoryError>> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      return err({ code: 'FIRESTORE_ERROR', message: 'Test delete failure' });
    }
    this.researches.delete(id);
    return ok(undefined);
  }

  async clearShareInfo(id: string): Promise<Result<Research, RepositoryError>> {
    if (this.failNextClearShareInfo) {
      this.failNextClearShareInfo = false;
      return err({ code: 'FIRESTORE_ERROR', message: 'Unknown error clearing share info' });
    }
    const existing = this.researches.get(id);
    if (existing === undefined) {
      return err({ code: 'NOT_FOUND', message: 'Research not found' });
    }
    const { shareInfo: _, ...rest } = existing;
    const updated = rest as Research;
    this.researches.set(id, updated);
    return ok(updated);
  }

  // Test helpers
  setFailNextSave(fail: boolean): void {
    this.failNextSave = fail;
  }

  setFailNextFind(fail: boolean): void {
    this.failNextFind = fail;
  }

  setFailNextDelete(fail: boolean): void {
    this.failNextDelete = fail;
  }

  setFailNextUpdate(fail: boolean): void {
    this.failNextUpdate = fail;
  }

  setFailNextUpdateLlmResult(fail: boolean): void {
    this.failNextUpdateLlmResult = fail;
  }

  setFailNextClearShareInfo(fail: boolean): void {
    this.failNextClearShareInfo = fail;
  }

  addResearch(research: Research): void {
    this.researches.set(research.id, research);
  }

  getAll(): Research[] {
    return Array.from(this.researches.values());
  }

  clear(): void {
    this.researches.clear();
  }
}

/**
 * Fake implementation of UserServiceClient for testing.
 */
export class FakeUserServiceClient implements UserServiceClient {
  private apiKeys = new Map<string, DecryptedApiKeys>();
  private failNextGetApiKeys = false;
  private failNextReportLlmSuccess = false;

  async getApiKeys(userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>> {
    if (this.failNextGetApiKeys) {
      this.failNextGetApiKeys = false;
      return err({ code: 'API_ERROR', message: 'Test getApiKeys failure' });
    }
    const keys = this.apiKeys.get(userId) ?? {};
    return ok(keys);
  }

  async reportLlmSuccess(_userId: string, _provider: LlmProvider): Promise<void> {
    if (this.failNextReportLlmSuccess) {
      this.failNextReportLlmSuccess = false;
      throw new Error('Test reportLlmSuccess failure');
    }
  }

  // Test helpers
  setApiKeys(userId: string, keys: DecryptedApiKeys): void {
    this.apiKeys.set(userId, keys);
  }

  setFailNextGetApiKeys(fail: boolean): void {
    this.failNextGetApiKeys = fail;
  }

  setFailNextReportLlmSuccess(fail: boolean): void {
    this.failNextReportLlmSuccess = fail;
  }

  clear(): void {
    this.apiKeys.clear();
  }
}

/**
 * Fake implementation of ResearchEventPublisher for testing.
 */
export class FakeResearchEventPublisher implements ResearchEventPublisher {
  private publishedEvents: ResearchProcessEvent[] = [];
  private failNextPublish = false;

  async publishProcessResearch(
    event: ResearchProcessEvent
  ): Promise<Result<void, { code: 'PUBLISH_FAILED'; message: string }>> {
    if (this.failNextPublish) {
      this.failNextPublish = false;
      return err({ code: 'PUBLISH_FAILED', message: 'Test publish failure' });
    }
    this.publishedEvents.push(event);
    return ok(undefined);
  }

  getPublishedEvents(): ResearchProcessEvent[] {
    return [...this.publishedEvents];
  }

  setFailNextPublish(fail: boolean): void {
    this.failNextPublish = fail;
  }

  clear(): void {
    this.publishedEvents = [];
  }
}

/**
 * Fake implementation of NotificationSender for testing.
 */
export class FakeNotificationSender implements NotificationSender {
  private sentNotifications: {
    userId: string;
    researchId: string;
    title: string;
    shareUrl: string;
  }[] = [];
  private sentFailures: {
    userId: string;
    researchId: string;
    model: string;
    error: string;
  }[] = [];

  async sendResearchComplete(
    userId: string,
    researchId: string,
    title: string,
    shareUrl: string
  ): Promise<Result<void, NotificationError>> {
    this.sentNotifications.push({ userId, researchId, title, shareUrl });
    return ok(undefined);
  }

  async sendLlmFailure(
    userId: string,
    researchId: string,
    model: string,
    error: string
  ): Promise<Result<void, NotificationError>> {
    this.sentFailures.push({ userId, researchId, model, error });
    return ok(undefined);
  }

  getSentNotifications(): {
    userId: string;
    researchId: string;
    title: string;
    shareUrl: string;
  }[] {
    return [...this.sentNotifications];
  }

  getSentFailures(): {
    userId: string;
    researchId: string;
    model: string;
    error: string;
  }[] {
    return [...this.sentFailures];
  }

  clear(): void {
    this.sentNotifications = [];
    this.sentFailures = [];
  }
}

/**
 * Create a fake LlmResearchProvider for testing.
 */
export function createFakeLlmResearchProvider(
  response = 'Research content',
  options?: { sources?: string[]; usage?: { inputTokens: number; outputTokens: number; costUsd: number } }
): LlmResearchProvider {
  return {
    async research(_prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
      const result: LlmResearchResult = { content: response };
      if (options?.sources !== undefined) {
        result.sources = options.sources;
      }
      if (options?.usage !== undefined) {
        result.usage = options.usage;
      }
      return ok(result);
    },
  };
}

/**
 * Create a fake LlmResearchProvider that always fails for testing error paths.
 */
export function createFailingLlmResearchProvider(
  errorMessage = 'Test research failure'
): LlmResearchProvider {
  return {
    async research(_prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
      return err({ code: 'API_ERROR', message: errorMessage });
    },
  };
}

/**
 * Create fake LLM providers for all providers.
 */
export function createFakeLlmProviders(): Record<LlmProvider, LlmResearchProvider> {
  return {
    google: createFakeLlmResearchProvider('Google research result'),
    openai: createFakeLlmResearchProvider('OpenAI research result'),
    anthropic: createFakeLlmResearchProvider('Anthropic research result'),
    perplexity: createFakeLlmResearchProvider('Perplexity research result'),
    zai: createFakeLlmResearchProvider('Zai research result'),
  };
}

/**
 * Create a fake LlmSynthesisProvider for testing.
 */
export function createFakeSynthesizer(
  synthesisResult = 'Synthesized content',
  titleResult = 'Generated Title'
): LlmSynthesisProvider {
  return {
    async synthesize(
      _originalPrompt: string,
      _reports: { model: string; content: string }[],
      _additionalSources?: { content: string; label?: string }[],
      _synthesisContext?: SynthesisContext
    ): Promise<Result<LlmSynthesisResult, LlmError>> {
      return ok({ content: synthesisResult });
    },
    async generateTitle(_prompt: string): Promise<Result<TitleGenerateResult, LlmError>> {
      return ok({ title: titleResult, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } });
    },
  };
}

/**
 * Create a fake LlmSynthesisProvider that always fails for testing error paths.
 */
export function createFailingSynthesizer(
  errorMessage = 'Test synthesis failure'
): LlmSynthesisProvider {
  return {
    async synthesize(
      _originalPrompt: string,
      _reports: { model: string; content: string }[],
      _additionalSources?: { content: string; label?: string }[],
      _synthesisContext?: SynthesisContext
    ): Promise<Result<LlmSynthesisResult, LlmError>> {
      return err({ code: 'API_ERROR', message: errorMessage });
    },
    async generateTitle(_prompt: string): Promise<Result<TitleGenerateResult, LlmError>> {
      return err({ code: 'API_ERROR', message: errorMessage });
    },
  };
}

/**
 * Create a fake TitleGenerator for testing.
 */
export function createFakeTitleGenerator(
  title = 'Generated Title',
  contextLabel = 'Generated Label'
): TitleGenerator {
  return {
    async generateTitle(_prompt: string): Promise<Result<TitleGenerateResult, LlmError>> {
      return ok({ title, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } });
    },
    async generateContextLabel(_content: string): Promise<Result<LabelGenerateResult, LlmError>> {
      return ok({ label: contextLabel, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } });
    },
  };
}

/**
 * Fake implementation of LlmCallPublisher for testing.
 */
export class FakeLlmCallPublisher {
  private publishedEvents: {
    type: 'llm.call';
    researchId: string;
    userId: string;
    model: string;
    prompt: string;
  }[] = [];
  private failNextPublish = false;

  async publishLlmCall(event: {
    type: 'llm.call';
    researchId: string;
    userId: string;
    model: string;
    prompt: string;
  }): Promise<Result<void, { code: 'PUBLISH_FAILED'; message: string }>> {
    if (this.failNextPublish) {
      this.failNextPublish = false;
      return err({ code: 'PUBLISH_FAILED', message: 'Test publish failure' });
    }
    this.publishedEvents.push(event);
    return ok(undefined);
  }

  getPublishedEvents(): {
    type: 'llm.call';
    researchId: string;
    userId: string;
    model: string;
    prompt: string;
  }[] {
    return [...this.publishedEvents];
  }

  setFailNextPublish(fail: boolean): void {
    this.failNextPublish = fail;
  }

  clear(): void {
    this.publishedEvents = [];
  }
}

/**
 * Create a fake ContextInferenceProvider for testing.
 */
export function createFakeContextInferrer(): ContextInferenceProvider {
  const defaultResearchContext: ResearchContext = {
    language: 'en',
    domain: 'general',
    mode: 'standard',
    intent_summary: 'General research query',
    defaults_applied: [],
    assumptions: [],
    answer_style: ['practical'],
    time_scope: {
      as_of_date: new Date().toISOString().split('T')[0] ?? '',
      prefers_recent_years: 2,
      is_time_sensitive: false,
    },
    locale_scope: {
      country_or_region: 'United States',
      jurisdiction: 'United States',
      currency: 'USD',
    },
    research_plan: {
      key_questions: ['What are the main aspects?'],
      search_queries: ['general query'],
      preferred_source_types: ['official', 'academic'],
      avoid_source_types: ['random_blogs'],
    },
    output_format: {
      wants_table: false,
      wants_steps: false,
      wants_pros_cons: false,
      wants_budget_numbers: false,
    },
    safety: {
      high_stakes: false,
      required_disclaimers: [],
    },
    red_flags: [],
  };

  const defaultSynthesisContext: SynthesisContext = {
    language: 'en',
    domain: 'general',
    mode: 'standard',
    synthesis_goals: ['merge', 'summarize'],
    missing_sections: [],
    detected_conflicts: [],
    source_preference: {
      prefer_official_over_aggregators: true,
      prefer_recent_when_time_sensitive: true,
    },
    defaults_applied: [],
    assumptions: [],
    output_format: {
      wants_table: false,
      wants_actionable_summary: true,
    },
    safety: {
      high_stakes: false,
      required_disclaimers: [],
    },
    red_flags: [],
  };

  return {
    async inferResearchContext(
      _userQuery: string,
      _opts?: InferResearchContextOptions
    ): Promise<Result<ResearchContextResult, LlmError>> {
      return ok({
        context: defaultResearchContext,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      });
    },
    async inferSynthesisContext(
      _params: InferSynthesisContextParams
    ): Promise<Result<SynthesisContextResult, LlmError>> {
      return ok({
        context: defaultSynthesisContext,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      });
    },
  };
}

/**
 * Create a fake ContextInferenceProvider that always fails for testing error paths.
 */
export function createFailingContextInferrer(
  errorMessage = 'Test context inference failure'
): ContextInferenceProvider {
  return {
    async inferResearchContext(
      _userQuery: string,
      _opts?: InferResearchContextOptions
    ): Promise<Result<ResearchContextResult, LlmError>> {
      return err({ code: 'API_ERROR', message: errorMessage });
    },
    async inferSynthesisContext(
      _params: InferSynthesisContextParams
    ): Promise<Result<SynthesisContextResult, LlmError>> {
      return err({ code: 'API_ERROR', message: errorMessage });
    },
  };
}

/**
 * Create a fake ContextInferenceProvider that fails but includes usage data
 * (simulating LLM call success but parsing failure).
 */
export function createFailingContextInferrerWithUsage(
  errorMessage = 'Test parsing failure',
  usage = { inputTokens: 1000, outputTokens: 500, costUsd: 0.005 }
): ContextInferenceProvider {
  return {
    async inferResearchContext(
      _userQuery: string,
      _opts?: InferResearchContextOptions
    ): Promise<Result<ResearchContextResult, LlmError>> {
      return err({ code: 'API_ERROR', message: errorMessage, usage });
    },
    async inferSynthesisContext(
      _params: InferSynthesisContextParams
    ): Promise<Result<SynthesisContextResult, LlmError>> {
      return err({ code: 'API_ERROR', message: errorMessage, usage });
    },
  };
}

/**
 * Create a fake InputValidationProvider for testing.
 */
export function createFakeInputValidator(): InputValidationProvider {
  return {
    async validateInput(_prompt: string): Promise<Result<ValidationResult, LlmError>> {
      return ok({
        quality: 2,
        reason: 'Test quality validation',
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      });
    },
    async improveInput(prompt: string): Promise<Result<ImprovementResult, LlmError>> {
      return ok({
        improvedPrompt: `Improved: ${prompt}`,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      });
    },
  };
}
