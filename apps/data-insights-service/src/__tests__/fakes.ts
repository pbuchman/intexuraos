/**
 * Fake repositories for data-insights-service testing.
 *
 * These fakes implement domain port interfaces with in-memory storage.
 */
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  AnalyticsEvent,
  AnalyticsEventRepository,
  AggregatedInsights,
  AggregatedInsightsRepository,
  CreateAnalyticsEventRequest,
} from '../domain/insights/index.js';

/**
 * Fake AnalyticsEvent repository for testing.
 */
export class FakeAnalyticsEventRepository implements AnalyticsEventRepository {
  private events = new Map<string, AnalyticsEvent>();
  private idCounter = 1;
  private shouldFailCreate = false;
  private shouldFailGet = false;
  private shouldFailCount = false;

  setFailNextCreate(fail: boolean): void {
    this.shouldFailCreate = fail;
  }

  setFailNextGet(fail: boolean): void {
    this.shouldFailGet = fail;
  }

  setFailNextCount(fail: boolean): void {
    this.shouldFailCount = fail;
  }

  create(request: CreateAnalyticsEventRequest): Promise<Result<AnalyticsEvent, string>> {
    if (this.shouldFailCreate) {
      this.shouldFailCreate = false;
      return Promise.resolve(err('Simulated create failure'));
    }

    const id = `event-${String(this.idCounter++)}`;
    const now = new Date();
    const event: AnalyticsEvent = {
      id,
      userId: request.userId,
      sourceService: request.sourceService,
      eventType: request.eventType,
      payload: request.payload,
      timestamp: request.timestamp ?? now,
      createdAt: now,
    };

    this.events.set(id, event);
    return Promise.resolve(ok(event));
  }

  getByUserIdAndTimeRange(
    userId: string,
    startDate: Date,
    endDate: Date,
    limit = 100
  ): Promise<Result<AnalyticsEvent[], string>> {
    if (this.shouldFailGet) {
      this.shouldFailGet = false;
      return Promise.resolve(err('Simulated get failure'));
    }

    const events = Array.from(this.events.values())
      .filter(
        (e) =>
          e.userId === userId &&
          e.timestamp >= startDate &&
          e.timestamp <= endDate
      )
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);

    return Promise.resolve(ok(events));
  }

  countByUserIdAndService(
    userId: string,
    serviceNames: string[]
  ): Promise<Result<Record<string, number>, string>> {
    if (this.shouldFailCount) {
      this.shouldFailCount = false;
      return Promise.resolve(err('Simulated count failure'));
    }

    const counts: Record<string, number> = {};
    for (const serviceName of serviceNames) {
      counts[serviceName] = Array.from(this.events.values()).filter(
        (e) => e.userId === userId && e.sourceService === serviceName
      ).length;
    }

    return Promise.resolve(ok(counts));
  }

  clear(): void {
    this.events.clear();
    this.idCounter = 1;
  }

  getAll(): AnalyticsEvent[] {
    return Array.from(this.events.values());
  }

  addEvent(event: AnalyticsEvent): void {
    this.events.set(event.id, event);
  }
}

/**
 * Fake AggregatedInsights repository for testing.
 */
export class FakeAggregatedInsightsRepository implements AggregatedInsightsRepository {
  private insights = new Map<string, AggregatedInsights>();
  private shouldFailGet = false;
  private shouldFailUpsert = false;

  setFailNextGet(fail: boolean): void {
    this.shouldFailGet = fail;
  }

  setFailNextUpsert(fail: boolean): void {
    this.shouldFailUpsert = fail;
  }

  getByUserId(userId: string): Promise<Result<AggregatedInsights | null, string>> {
    if (this.shouldFailGet) {
      this.shouldFailGet = false;
      return Promise.resolve(err('Simulated get failure'));
    }

    const insights = this.insights.get(userId);
    return Promise.resolve(ok(insights ?? null));
  }

  upsert(insights: AggregatedInsights): Promise<Result<void, string>> {
    if (this.shouldFailUpsert) {
      this.shouldFailUpsert = false;
      return Promise.resolve(err('Simulated upsert failure'));
    }

    this.insights.set(insights.userId, insights);
    return Promise.resolve(ok(undefined));
  }

  clear(): void {
    this.insights.clear();
  }

  getAll(): AggregatedInsights[] {
    return Array.from(this.insights.values());
  }

  setInsights(insights: AggregatedInsights): void {
    this.insights.set(insights.userId, insights);
  }
}
