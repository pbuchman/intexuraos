/**
 * Fake implementations for testing.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  LlmError,
  LlmPricing,
  LlmProvider,
  LlmResearchProvider,
  LlmResearchResult,
  LlmResult,
  LlmSynthesisProvider,
  LlmUsageIncrement,
  LlmUsageStats,
  NotificationError,
  PricingRepository,
  RepositoryError,
  Research,
  ResearchRepository,
  TitleGenerator,
  UsageStatsRepository,
} from '../domain/research/index.js';
import type {
  DecryptedApiKeys,
  ResearchSettings,
  UserServiceClient,
  UserServiceError,
} from '../infra/user/index.js';
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
  private researchSettings = new Map<string, ResearchSettings>();
  private failNextGetApiKeys = false;

  async getApiKeys(userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>> {
    if (this.failNextGetApiKeys) {
      this.failNextGetApiKeys = false;
      return err({ code: 'API_ERROR', message: 'Test getApiKeys failure' });
    }
    const keys = this.apiKeys.get(userId) ?? {};
    return ok(keys);
  }

  async getResearchSettings(userId: string): Promise<Result<ResearchSettings, UserServiceError>> {
    const settings = this.researchSettings.get(userId) ?? { defaultModels: null };
    return ok(settings);
  }

  async reportLlmSuccess(_userId: string, _provider: LlmProvider): Promise<void> {
    // Best effort - do nothing in tests
  }

  // Test helpers
  setApiKeys(userId: string, keys: DecryptedApiKeys): void {
    this.apiKeys.set(userId, keys);
  }

  setResearchSettings(userId: string, settings: ResearchSettings): void {
    this.researchSettings.set(userId, settings);
  }

  setFailNextGetApiKeys(fail: boolean): void {
    this.failNextGetApiKeys = fail;
  }

  clear(): void {
    this.apiKeys.clear();
    this.researchSettings.clear();
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
export function createFakeLlmResearchProvider(response = 'Research content'): LlmResearchProvider {
  return {
    async research(_prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
      return ok({ content: response });
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
      _externalReports?: { content: string; model?: string }[]
    ): Promise<Result<string, LlmError>> {
      return ok(synthesisResult);
    },
    async generateTitle(_prompt: string): Promise<Result<string, LlmError>> {
      return ok(titleResult);
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
      _externalReports?: { content: string; model?: string }[]
    ): Promise<Result<string, LlmError>> {
      return err({ code: 'API_ERROR', message: errorMessage });
    },
    async generateTitle(_prompt: string): Promise<Result<string, LlmError>> {
      return err({ code: 'API_ERROR', message: errorMessage });
    },
  };
}

/**
 * Create a fake TitleGenerator for testing.
 */
export function createFakeTitleGenerator(title = 'Generated Title'): TitleGenerator {
  return {
    async generateTitle(_prompt: string): Promise<Result<string, LlmError>> {
      return ok(title);
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
 * Fake implementation of PricingRepository for testing.
 */
export class FakePricingRepository implements PricingRepository {
  private pricing = new Map<string, LlmPricing>();

  async findByProviderAndModel(provider: LlmProvider, model: string): Promise<LlmPricing | null> {
    const key = `${provider}_${model}`;
    return this.pricing.get(key) ?? null;
  }

  setPricing(
    provider: LlmProvider,
    model: string,
    pricing: Omit<LlmPricing, 'provider' | 'model'>
  ): void {
    const key = `${provider}_${model}`;
    this.pricing.set(key, {
      provider,
      model,
      ...pricing,
    });
  }

  clear(): void {
    this.pricing.clear();
  }
}

export class FakeUsageStatsRepository implements UsageStatsRepository {
  private stats = new Map<string, LlmUsageStats>();

  async increment(data: LlmUsageIncrement): Promise<void> {
    const key = `${data.provider}_${data.model}_total`;
    const existing = this.stats.get(key);

    if (existing !== undefined) {
      this.stats.set(key, {
        ...existing,
        calls: existing.calls + 1,
        successfulCalls: existing.successfulCalls + (data.success ? 1 : 0),
        failedCalls: existing.failedCalls + (data.success ? 0 : 1),
        inputTokens: existing.inputTokens + data.inputTokens,
        outputTokens: existing.outputTokens + data.outputTokens,
        totalTokens: existing.totalTokens + data.inputTokens + data.outputTokens,
        costUsd: existing.costUsd + data.costUsd,
        lastUpdatedAt: new Date().toISOString(),
      });
    } else {
      this.stats.set(key, {
        provider: data.provider,
        model: data.model,
        period: 'total',
        calls: 1,
        successfulCalls: data.success ? 1 : 0,
        failedCalls: data.success ? 0 : 1,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.inputTokens + data.outputTokens,
        costUsd: data.costUsd,
        lastUpdatedAt: new Date().toISOString(),
      });
    }
  }

  async getAllTotals(): Promise<LlmUsageStats[]> {
    return Array.from(this.stats.values()).filter((s) => s.period === 'total');
  }

  async getByPeriod(period: string): Promise<LlmUsageStats[]> {
    return Array.from(this.stats.values()).filter((s) => s.period === period);
  }

  getAll(): LlmUsageStats[] {
    return Array.from(this.stats.values());
  }

  clear(): void {
    this.stats.clear();
  }
}
