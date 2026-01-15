/**
 * Tests for context label generation service.
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { describe, it, expect, vi } from 'vitest';
import { generateContextLabels } from '../../../../domain/research/services/contextLabels.js';
import { LlmModels } from '@intexuraos/llm-contract';
import type { ModelPricing } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';

describe('generateContextLabels', () => {
  const mockPricing: ModelPricing = {
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
  };

  const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;

  it('returns contexts unchanged when no Google API key provided', async () => {
    const contexts = [
      { content: 'Test content 1' },
      { content: 'Test content 2', label: 'Existing label' },
    ];

    const result = await generateContextLabels(
      contexts,
      undefined,
      'user-123',
      () => {
        throw new Error('Should not be called');
      },
      mockPricing,
      mockLogger
    );

    expect(result).toEqual(contexts);
  });

  it('keeps existing labels and generates new ones for contexts without labels', async () => {
    const contexts = [
      { content: 'Article about TypeScript benefits' },
      { content: 'Research on AI', label: 'AI Research' },
      { content: 'Database optimization tips' },
    ];

    const mockGenerator = {
      generateTitle: async (): Promise<ReturnType<typeof ok<{ title: string; usage: { inputTokens: number; outputTokens: number } }>>> => ok({ title: 'Title', usage: { inputTokens: 10, outputTokens: 5 } }),
      generateContextLabel: async (content: string): Promise<ReturnType<typeof ok<{ label: string; usage: { inputTokens: number; outputTokens: number } }>>> => {
        if (content.includes('TypeScript')) {
          return ok({ label: 'TypeScript Benefits', usage: { inputTokens: 10, outputTokens: 5 } });
        }
        if (content.includes('Database')) {
          return ok({ label: 'Database Optimization', usage: { inputTokens: 10, outputTokens: 5 } });
        }
        return ok({ label: 'Generated Label', usage: { inputTokens: 10, outputTokens: 5 } });
      },
    };

    const result = await generateContextLabels(
      contexts,
      'google-api-key',
      'user-123',
      () => mockGenerator,
      mockPricing,
      mockLogger
    );

    expect(result).toEqual([
      { content: 'Article about TypeScript benefits', label: 'TypeScript Benefits' },
      { content: 'Research on AI', label: 'AI Research' },
      { content: 'Database optimization tips', label: 'Database Optimization' },
    ]);
  });

  it('handles label generation failure gracefully by omitting label', async () => {
    const contexts = [{ content: 'Test content' }];

    const mockGenerator = {
      generateTitle: async () => ok({ title: 'Title', usage: { inputTokens: 10, outputTokens: 5 } }),
      generateContextLabel: async () =>
        err({ code: 'API_ERROR' as const, message: 'API error' }),
    };

    const result = await generateContextLabels(
      contexts,
      'google-api-key',
      'user-123',
      () => mockGenerator,
      mockPricing,
      mockLogger
    );

    expect(result).toEqual([{ content: 'Test content' }]);
  });

  it('generates labels for empty string labels (treats like missing)', async () => {
    const contexts = [
      { content: 'Test content', label: '' },
      { content: 'Another content' },
    ];

    const mockGenerator = {
      generateTitle: async () => ok({ title: 'Title', usage: { inputTokens: 10, outputTokens: 5 } }),
      generateContextLabel: async () => {
        return ok({ label: 'Generated', usage: { inputTokens: 10, outputTokens: 5 } });
      },
    };

    const result = await generateContextLabels(
      contexts,
      'google-api-key',
      'user-123',
      () => mockGenerator,
      mockPricing,
      mockLogger
    );

    expect(result).toEqual([
      { content: 'Test content', label: 'Generated' },
      { content: 'Another content', label: 'Generated' },
    ]);
  });

  it('passes correct parameters to createTitleGenerator', async () => {
    const contexts = [{ content: 'Test' }];
    let capturedModel: unknown;
    let capturedApiKey: unknown;
    let capturedUserId: unknown;
    let capturedPricing: unknown;
    let capturedLogger: unknown;

    const mockGenerator = {
      generateTitle: async () => ok({ title: 'Title', usage: { inputTokens: 10, outputTokens: 5 } }),
      generateContextLabel: async () => ok({ label: 'Label', usage: { inputTokens: 10, outputTokens: 5 } }),
    };

    await generateContextLabels(
      contexts,
      'test-api-key',
      'test-user-id',
      (model, apiKey, userId, pricing, logger) => {
        capturedModel = model;
        capturedApiKey = apiKey;
        capturedUserId = userId;
        capturedPricing = pricing;
        capturedLogger = logger;
        return mockGenerator;
      },
      mockPricing,
      mockLogger
    );

    expect(capturedModel).toBe(LlmModels.Gemini25Flash);
    expect(capturedApiKey).toBe('test-api-key');
    expect(capturedUserId).toBe('test-user-id');
    expect(capturedPricing).toBe(mockPricing);
    expect(capturedLogger).toBe(mockLogger);
  });

  it('processes multiple contexts in parallel', async () => {
    const contexts = [
      { content: 'Content 1' },
      { content: 'Content 2' },
      { content: 'Content 3' },
    ];

    const callOrder: number[] = [];
    const mockGenerator = {
      generateTitle: async (): Promise<ReturnType<typeof ok<{ title: string; usage: { inputTokens: number; outputTokens: number } }>>> => ok({ title: 'Title', usage: { inputTokens: 10, outputTokens: 5 } }),
      generateContextLabel: async (content: string): Promise<ReturnType<typeof ok<{ label: string; usage: { inputTokens: number; outputTokens: number } }>>> => {
        const idx = parseInt(content.split(' ')[1] ?? '0');
        callOrder.push(idx);
        return ok({ label: `Label ${idx}`, usage: { inputTokens: 10, outputTokens: 5 } });
      },
    };

    await generateContextLabels(contexts, 'api-key', 'user', () => mockGenerator, mockPricing, mockLogger);

    expect(callOrder).toEqual([1, 2, 3]);
  });
});
