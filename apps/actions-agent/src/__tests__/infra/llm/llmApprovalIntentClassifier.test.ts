/**
 * Tests for LLM-based approval intent classifier.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLlmApprovalIntentClassifier } from '../../../infra/llm/llmApprovalIntentClassifier.js';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { ok, err } from '@intexuraos/common-core';

describe('LlmApprovalIntentClassifier', () => {
  let mockLlmClient: LlmGenerateClient;
  let mockLogger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as ReturnType<typeof vi.fn>;

    mockLlmClient = {
      generate: vi.fn(),
    } as unknown as LlmGenerateClient;
  });

  it('returns unclear for empty text', async () => {
    const classifier = createLlmApprovalIntentClassifier({
      llmClient: mockLlmClient,
      logger: mockLogger as never,
    });

    const result = await classifier.classify('   ');

    expect(result).toEqual({
      intent: 'unclear',
      confidence: 1.0,
      reasoning: 'Empty or whitespace-only text',
    });
    expect(mockLlmClient.generate).not.toHaveBeenCalled();
  });

  it('returns unclear when LLM call fails', async () => {
    vi.mocked(mockLlmClient.generate).mockResolvedValue(
      err({ code: 'API_ERROR', message: 'API error' })
    );

    const classifier = createLlmApprovalIntentClassifier({
      llmClient: mockLlmClient,
      logger: mockLogger as never,
    });

    const result = await classifier.classify('yes');

    expect(result).toEqual({
      intent: 'unclear',
      confidence: 0.0,
      reasoning: 'LLM error: API error',
    });
  });

  it('returns unclear when LLM response cannot be parsed', async () => {
    vi.mocked(mockLlmClient.generate).mockResolvedValue(
      ok({
        content: 'invalid response that cannot be parsed',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          costUsd: 0.0001,
        },
      })
    );

    const classifier = createLlmApprovalIntentClassifier({
      llmClient: mockLlmClient,
      logger: mockLogger as never,
    });

    const result = await classifier.classify('maybe');

    expect(result.intent).toBe('unclear');
    expect(result.confidence).toBe(0.0);
    expect(result.reasoning).toBe('Failed to parse LLM response');
  });

  it('classifies approval intent successfully', async () => {
    vi.mocked(mockLlmClient.generate).mockResolvedValue(
      ok({
        content: JSON.stringify({
          intent: 'approve',
          confidence: 0.95,
          reasoning: 'User said yes',
        }),
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          costUsd: 0.0001,
        },
      })
    );

    const classifier = createLlmApprovalIntentClassifier({
      llmClient: mockLlmClient,
      logger: mockLogger as never,
    });

    const result = await classifier.classify('Yes, please do it');

    expect(result).toEqual({
      intent: 'approve',
      confidence: 0.95,
      reasoning: 'User said yes',
    });
  });

  it('classifies rejection intent successfully', async () => {
    vi.mocked(mockLlmClient.generate).mockResolvedValue(
      ok({
        content: JSON.stringify({
          intent: 'reject',
          confidence: 0.88,
          reasoning: 'User said no',
        }),
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          costUsd: 0.0001,
        },
      })
    );

    const classifier = createLlmApprovalIntentClassifier({
      llmClient: mockLlmClient,
      logger: mockLogger as never,
    });

    const result = await classifier.classify('No thanks');

    expect(result).toEqual({
      intent: 'reject',
      confidence: 0.88,
      reasoning: 'User said no',
    });
  });

  it('classifies unclear intent successfully', async () => {
    vi.mocked(mockLlmClient.generate).mockResolvedValue(
      ok({
        content: JSON.stringify({
          intent: 'unclear',
          confidence: 0.5,
          reasoning: 'Ambiguous response',
        }),
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          costUsd: 0.0001,
        },
      })
    );

    const classifier = createLlmApprovalIntentClassifier({
      llmClient: mockLlmClient,
      logger: mockLogger as never,
    });

    const result = await classifier.classify('I need to think about it');

    expect(result).toEqual({
      intent: 'unclear',
      confidence: 0.5,
      reasoning: 'Ambiguous response',
    });
  });
});
