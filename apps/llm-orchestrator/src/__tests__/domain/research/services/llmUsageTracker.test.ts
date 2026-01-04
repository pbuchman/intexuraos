/**
 * Tests for LlmUsageTracker service.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLlmUsageTracker } from '../../../../domain/research/services/llmUsageTracker.js';
import type {
  LlmPricing,
  LlmProvider,
  LlmUsageIncrement,
  PricingRepository,
  UsageStatsRepository,
} from '../../../../domain/research/index.js';

class FakePricingRepo implements PricingRepository {
  private pricing: LlmPricing | null = null;
  private shouldThrow = false;

  async findByProviderAndModel(_provider: LlmProvider, _model: string): Promise<LlmPricing | null> {
    if (this.shouldThrow) {
      throw new Error('Pricing fetch failed');
    }
    return this.pricing;
  }

  setPricing(pricing: LlmPricing | null): void {
    this.pricing = pricing;
  }

  setThrow(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }
}

class FakeUsageStatsRepo implements UsageStatsRepository {
  private increments: LlmUsageIncrement[] = [];
  private shouldThrow = false;

  async increment(data: LlmUsageIncrement): Promise<void> {
    if (this.shouldThrow) {
      throw new Error('Increment failed');
    }
    this.increments.push(data);
  }

  async getAllTotals(): Promise<never[]> {
    return [];
  }

  async getByPeriod(_period: string): Promise<never[]> {
    return [];
  }

  getIncrements(): LlmUsageIncrement[] {
    return [...this.increments];
  }

  setThrow(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }

  clear(): void {
    this.increments = [];
  }
}

describe('LlmUsageTracker', () => {
  let pricingRepo: FakePricingRepo;
  let usageStatsRepo: FakeUsageStatsRepo;

  beforeEach(() => {
    pricingRepo = new FakePricingRepo();
    usageStatsRepo = new FakeUsageStatsRepo();
  });

  it('tracks usage with pricing', async () => {
    pricingRepo.setPricing({
      provider: 'google',
      model: 'gemini-2.5-pro',
      inputPricePerMillion: 1.25,
      outputPricePerMillion: 5.0,
      updatedAt: '2024-01-01T00:00:00Z',
    });

    const tracker = createLlmUsageTracker({
      usageStatsRepo,
      pricingRepo,
    });

    tracker.track({
      provider: 'google',
      model: 'gemini-2.5-pro',
      callType: 'research',
      success: true,
      inputTokens: 1000,
      outputTokens: 500,
    });

    await vi.waitFor(() => {
      expect(usageStatsRepo.getIncrements()).toHaveLength(1);
    });

    const increment = usageStatsRepo.getIncrements()[0];
    expect(increment).toMatchObject({
      provider: 'google',
      model: 'gemini-2.5-pro',
      callType: 'research',
      success: true,
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(increment?.costUsd).toBeGreaterThan(0);
  });

  it('tracks usage without pricing (cost is 0)', async () => {
    pricingRepo.setPricing(null);

    const tracker = createLlmUsageTracker({
      usageStatsRepo,
      pricingRepo,
    });

    tracker.track({
      provider: 'anthropic',
      model: 'claude-opus-4-5-20251101',
      callType: 'synthesis',
      success: true,
      inputTokens: 500,
      outputTokens: 1000,
    });

    await vi.waitFor(() => {
      expect(usageStatsRepo.getIncrements()).toHaveLength(1);
    });

    const increment = usageStatsRepo.getIncrements()[0];
    expect(increment?.costUsd).toBe(0);
  });

  it('logs error on failure when logger provided', async () => {
    usageStatsRepo.setThrow(true);
    const mockLogger = {
      error: vi.fn(),
    };

    const tracker = createLlmUsageTracker({
      usageStatsRepo,
      pricingRepo,
      logger: mockLogger,
    });

    tracker.track({
      provider: 'openai',
      model: 'gpt-4o',
      callType: 'title',
      success: true,
      inputTokens: 100,
      outputTokens: 50,
    });

    await vi.waitFor(() => {
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        '[LlmUsageTracker] Failed to track usage'
      );
    });
  });

  it('silently fails on error when no logger provided', async () => {
    usageStatsRepo.setThrow(true);

    const tracker = createLlmUsageTracker({
      usageStatsRepo,
      pricingRepo,
    });

    tracker.track({
      provider: 'perplexity',
      model: 'sonar-pro',
      callType: 'research',
      success: false,
      inputTokens: 0,
      outputTokens: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(usageStatsRepo.getIncrements()).toHaveLength(0);
  });
});
