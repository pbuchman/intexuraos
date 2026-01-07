import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { GeminiError } from '@intexuraos/infra-gemini';
import type { GenerateResult } from '@intexuraos/llm-contract';
import { LlmModels } from '@intexuraos/llm-contract';
import { extractSelectedModels } from '../../infra/gemini/classifier.js';

const mockGenerate = vi.fn();

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: (): { generate: typeof mockGenerate } => ({
    generate: mockGenerate,
  }),
}));

vi.mock('@intexuraos/llm-pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intexuraos/llm-pricing')>();
  return {
    ...actual,
    logUsage: vi.fn().mockResolvedValue(undefined),
  };
});

const { createGeminiClassifier } = await import('../../infra/gemini/classifier.js');
const { TEST_PRICING } = await import('@intexuraos/llm-pricing');

const testPricing = TEST_PRICING;

const mockUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.001 };

function generateResult(content: string): GenerateResult {
  return { content, usage: mockUsage };
}

function jsonResponse(type: string, confidence: number, title: string, reasoning?: string): string {
  return JSON.stringify({ type, confidence, title, reasoning: reasoning ?? 'Test reasoning' });
}

describe('GeminiClassifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('classify', () => {
    it('classifies todo command correctly', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('todo', 0.95, 'Buy groceries')))
      );

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('I need to buy groceries');

      expect(classificationResult.type).toBe('todo');
      expect(classificationResult.confidence).toBe(0.95);
      expect(classificationResult.title).toBe('Buy groceries');
    });

    it('classifies research command correctly', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('research', 0.88, 'AI trends research')))
      );

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('What are the latest AI trends?');

      expect(classificationResult.type).toBe('research');
      expect(classificationResult.confidence).toBe(0.88);
    });

    it('returns unclassified when classify returns unclassified type', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('unclassified', 0, 'Unclassified')))
      );

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('random gibberish');

      expect(classificationResult.type).toBe('unclassified');
      expect(classificationResult.confidence).toBe(0);
      expect(classificationResult.title).toBe('Unclassified');
    });

    it('throws on API error', async () => {
      const error: GeminiError = {
        code: 'RATE_LIMITED',
        message: 'API rate limit exceeded',
      };
      mockGenerate.mockResolvedValue(err(error));

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: API rate limit exceeded'
      );
    });

    it('throws on invalid key error', async () => {
      const error: GeminiError = {
        code: 'INVALID_KEY',
        message: 'Invalid API key provided',
      };
      mockGenerate.mockResolvedValue(err(error));

      const classifier = createGeminiClassifier({
        apiKey: 'bad-key',
        userId: 'test-user',
        pricing: testPricing,
      });

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: Invalid API key provided'
      );
    });

    it('classifies note command correctly', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('note', 0.9, 'Meeting notes')))
      );

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('Meeting notes from today');

      expect(classificationResult.type).toBe('note');
      expect(classificationResult.confidence).toBe(0.9);
    });

    it('passes prompt containing the text to generate', async () => {
      mockGenerate.mockResolvedValue(ok(generateResult(jsonResponse('todo', 0.9, 'Test'))));

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      await classifier.classify('test message');

      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('test message'));
    });

    it('passes classification prompt to generate', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('calendar', 0.85, 'Team meeting')))
      );

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      await classifier.classify('Team meeting tomorrow at 3pm');

      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('command classifier'));
    });

    it('handles timeout error', async () => {
      const error: GeminiError = {
        code: 'TIMEOUT',
        message: 'Request timed out',
      };
      mockGenerate.mockResolvedValue(err(error));

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: Request timed out'
      );
    });

    it('handles API error', async () => {
      const error: GeminiError = {
        code: 'API_ERROR',
        message: 'Server error',
      };
      mockGenerate.mockResolvedValue(err(error));

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: Server error'
      );
    });

    it('returns unclassified for invalid JSON response', async () => {
      mockGenerate.mockResolvedValue(ok(generateResult('This is not valid JSON')));

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.type).toBe('unclassified');
      expect(classificationResult.confidence).toBe(0.5);
      expect(classificationResult.title).toBe('Unknown');
    });

    it('returns unclassified for unknown type in response', async () => {
      mockGenerate.mockResolvedValue(ok(generateResult(jsonResponse('unknown_type', 0.9, 'Test'))));

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.type).toBe('unclassified');
    });

    it('clamps confidence to valid range', async () => {
      mockGenerate.mockResolvedValue(ok(generateResult(jsonResponse('todo', 1.5, 'Test'))));

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.confidence).toBe(1);
    });

    it('clamps negative confidence to zero', async () => {
      mockGenerate.mockResolvedValue(ok(generateResult(jsonResponse('todo', -0.5, 'Test'))));

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.confidence).toBe(0);
    });

    it('extracts JSON from response with surrounding text', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(`Here is the classification: ${jsonResponse('todo', 0.9, 'Test')} done.`))
      );

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.type).toBe('todo');
      expect(classificationResult.confidence).toBe(0.9);
    });

    it('returns unclassified when JSON parses to non-object (defensive)', async () => {
      const originalParse = JSON.parse;
      JSON.parse = (): null => null;

      try {
        mockGenerate.mockResolvedValue(ok(generateResult('{"type": "todo"}')));

        const classifier = createGeminiClassifier({
          apiKey: 'test-key',
          userId: 'test-user',
          pricing: testPricing,
        });
        const classificationResult = await classifier.classify('test');

        expect(classificationResult.type).toBe('unclassified');
        expect(classificationResult.reasoning).toBe('Invalid response format');
      } finally {
        JSON.parse = originalParse;
      }
    });

    it('uses defaults for missing confidence, title, and reasoning', async () => {
      mockGenerate.mockResolvedValue(ok(generateResult('{"type": "todo"}')));

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.type).toBe('todo');
      expect(classificationResult.confidence).toBe(0.5);
      expect(classificationResult.title).toBe('Unknown');
      expect(classificationResult.reasoning).toBe('No reasoning provided');
    });

    it('truncates long title to 100 characters', async () => {
      const longTitle = 'A'.repeat(200);
      mockGenerate.mockResolvedValue(ok(generateResult(jsonResponse('todo', 0.9, longTitle))));

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.title).toBe('A'.repeat(100));
    });

    it('truncates long reasoning to 500 characters', async () => {
      const longReasoning = 'B'.repeat(600);
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('todo', 0.9, 'Test', longReasoning)))
      );

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.reasoning).toBe('B'.repeat(500));
    });

    it('handles non-string title in response', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult('{"type": "todo", "confidence": 0.9, "title": 123}'))
      );

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.title).toBe('Unknown');
    });

    it('handles non-string reasoning in response', async () => {
      mockGenerate.mockResolvedValue(
        ok(
          generateResult('{"type": "todo", "confidence": 0.9, "title": "Test", "reasoning": true}')
        )
      );

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.reasoning).toBe('No reasoning provided');
    });

    it('handles non-number confidence in response', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult('{"type": "todo", "confidence": "high", "title": "Test"}'))
      );

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.confidence).toBe(0.5);
    });

    it('extracts selectedModels from text', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('research', 0.9, 'Research topic')))
      );

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('Research this using only gemini');

      expect(classificationResult.selectedModels).toEqual([LlmModels.Gemini25Flash]);
    });

    it('returns undefined selectedModels when no model specified', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('research', 0.9, 'Research topic')))
      );

      const classifier = createGeminiClassifier({
        apiKey: 'test-key',
        userId: 'test-user',
        pricing: testPricing,
      });
      const classificationResult = await classifier.classify('Research this topic');

      expect(classificationResult.selectedModels).toBeUndefined();
    });
  });
});

describe('extractSelectedModels', () => {
  describe('all models patterns', () => {
    it('returns default models for "use all LLMs"', () => {
      expect(extractSelectedModels('use all LLMs for this research')).toEqual([
        LlmModels.Gemini25Pro,
        LlmModels.ClaudeOpus45,
        LlmModels.GPT52,
        LlmModels.SonarPro,
      ]);
    });

    it('returns default models for "use all models"', () => {
      expect(extractSelectedModels('use all models')).toEqual([
        LlmModels.Gemini25Pro,
        LlmModels.ClaudeOpus45,
        LlmModels.GPT52,
        LlmModels.SonarPro,
      ]);
    });

    it('returns default models for Polish "użyj wszystkich"', () => {
      expect(extractSelectedModels('użyj wszystkich modeli')).toEqual([
        LlmModels.Gemini25Pro,
        LlmModels.ClaudeOpus45,
        LlmModels.GPT52,
        LlmModels.SonarPro,
      ]);
    });

    it('returns default models for Polish "wszystkie modele"', () => {
      expect(extractSelectedModels('chcę wszystkie modele')).toEqual([
        LlmModels.Gemini25Pro,
        LlmModels.ClaudeOpus45,
        LlmModels.GPT52,
        LlmModels.SonarPro,
      ]);
    });
  });

  describe('specific model keywords', () => {
    it('extracts gemini-2.5-flash for "gemini"', () => {
      expect(extractSelectedModels('use gemini for this')).toEqual([LlmModels.Gemini25Flash]);
    });

    it('extracts gpt-5.2 for "gpt"', () => {
      expect(extractSelectedModels('ask gpt about this')).toEqual([LlmModels.GPT52]);
    });

    it('extracts gpt-5.2 for "chatgpt"', () => {
      expect(extractSelectedModels('ask chatgpt about this')).toEqual([LlmModels.GPT52]);
    });

    it('extracts claude-sonnet model for "claude"', () => {
      expect(extractSelectedModels('use claude for research')).toEqual([LlmModels.ClaudeSonnet45]);
    });

    it('extracts multiple models', () => {
      const result = extractSelectedModels('use gpt and claude for this');
      expect(result).toContain(LlmModels.GPT52);
      expect(result).toContain(LlmModels.ClaudeSonnet45);
    });

    it('extracts multiple models when mentioned', () => {
      const result = extractSelectedModels('compare gemini, gpt and claude');
      expect(result).toContain(LlmModels.Gemini25Flash);
      expect(result).toContain(LlmModels.GPT52);
      expect(result).toContain(LlmModels.ClaudeSonnet45);
    });
  });

  describe('no match', () => {
    it('returns undefined when no model mentioned', () => {
      expect(extractSelectedModels('research this topic')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(extractSelectedModels('')).toBeUndefined();
    });
  });
});
