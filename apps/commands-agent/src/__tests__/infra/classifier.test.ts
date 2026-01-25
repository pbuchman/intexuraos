import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { GenerateResult } from '@intexuraos/llm-contract';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { Logger } from 'pino';

vi.mock('@intexuraos/llm-pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intexuraos/llm-pricing')>();
  return {
    ...actual,
    logUsage: vi.fn().mockResolvedValue(undefined),
  createUsageLogger: vi.fn().mockReturnValue({
    log: vi.fn().mockResolvedValue(undefined),
  }),
  };
});

const { createGeminiClassifier } = await import('../../infra/llm/classifier.js');

const mockGenerate = vi.fn();
const mockLlmClient: LlmGenerateClient = {
  generate: mockGenerate,
};

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

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

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('I need to buy groceries');

      expect(classificationResult.type).toBe('todo');
      expect(classificationResult.confidence).toBe(0.95);
      expect(classificationResult.title).toBe('Buy groceries');
    });

    it('classifies research command correctly', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('research', 0.88, 'AI trends research')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('What are the latest AI trends?');

      expect(classificationResult.type).toBe('research');
      expect(classificationResult.confidence).toBe(0.88);
    });

    it('returns note as fallback when LLM returns unknown type', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('unclassified', 0, 'Unclassified')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('random gibberish');

      // Zod validation fails for invalid enum value, returns default "note" classification
      expect(classificationResult.type).toBe('note');
      expect(classificationResult.confidence).toBe(0.3);
      expect(classificationResult.title).toBe('Unknown');
      expect(classificationResult.reasoning).toContain('Invalid response format');
    });

    it('throws on API error', async () => {
      const error = { code: 'RATE_LIMITED', message: 'API rate limit exceeded' };
      mockGenerate.mockResolvedValue(err(error));

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: API rate limit exceeded'
      );
    });

    it('throws on invalid key error', async () => {
      const error = { code: 'INVALID_KEY', message: 'Invalid API key provided' };
      mockGenerate.mockResolvedValue(err(error));

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: Invalid API key provided'
      );
    });

    it('classifies note command correctly', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('note', 0.9, 'Meeting notes')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('Meeting notes from today');

      expect(classificationResult.type).toBe('note');
      expect(classificationResult.confidence).toBe(0.9);
    });

    it('passes prompt containing the text to generate', async () => {
      mockGenerate.mockResolvedValue(ok(generateResult(jsonResponse('todo', 0.9, 'Test'))));

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      await classifier.classify('test message');

      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('test message'));
    });

    it('passes classification prompt to generate', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('calendar', 0.85, 'Team meeting')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      await classifier.classify('Team meeting tomorrow at 3pm');

      expect(mockGenerate).toHaveBeenCalledWith(expect.stringContaining('Classify the message'));
    });

    it('handles timeout error', async () => {
      const error = { code: 'TIMEOUT', message: 'Request timed out' };
      mockGenerate.mockResolvedValue(err(error));

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: Request timed out'
      );
    });

    it('handles API error', async () => {
      const error = { code: 'API_ERROR', message: 'Server error' };
      mockGenerate.mockResolvedValue(err(error));

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: Server error'
      );
    });

    it('returns note for invalid JSON response', async () => {
      mockGenerate.mockResolvedValue(ok(generateResult('This is not valid JSON')));

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.type).toBe('note');
      expect(classificationResult.confidence).toBe(0.3);
      expect(classificationResult.title).toBe('Unknown');
    });

    it('returns note for unknown type in response', async () => {
      mockGenerate.mockResolvedValue(ok(generateResult(jsonResponse('unknown_type', 0.9, 'Test'))));

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.type).toBe('note');
    });

    it('rejects confidence greater than 1', async () => {
      mockGenerate.mockResolvedValue(ok(generateResult(jsonResponse('todo', 1.5, 'Test'))));

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('test');

      // Zod validation fails for confidence > 1, returns default "note" classification
      expect(classificationResult.type).toBe('note');
      expect(classificationResult.confidence).toBe(0.3);
    });

    it('rejects negative confidence', async () => {
      mockGenerate.mockResolvedValue(ok(generateResult(jsonResponse('todo', -0.5, 'Test'))));

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('test');

      // Zod validation fails for confidence < 0, returns default "note" classification
      expect(classificationResult.type).toBe('note');
      expect(classificationResult.confidence).toBe(0.3);
    });

    it('extracts JSON from response with surrounding text', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(`Here is the classification: ${jsonResponse('todo', 0.9, 'Test')} done.`))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('test');

      expect(classificationResult.type).toBe('todo');
      expect(classificationResult.confidence).toBe(0.9);
    });

    it('returns note when JSON parses to non-object (defensive)', async () => {
      const originalParse = JSON.parse;
      JSON.parse = (): null => null;

      try {
        mockGenerate.mockResolvedValue(ok(generateResult('{"type": "todo"}')));

        const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
        const classificationResult = await classifier.classify('test');

        expect(classificationResult.type).toBe('note');
        expect(classificationResult.reasoning).toContain('Invalid response format');
      } finally {
        JSON.parse = originalParse;
      }
    });

    it('uses defaults for missing confidence, title, and reasoning', async () => {
      mockGenerate.mockResolvedValue(ok(generateResult('{"type": "todo"}')));

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('test');

      // Zod validation fails for missing required fields, returns default "note" classification
      expect(classificationResult.type).toBe('note');
      expect(classificationResult.confidence).toBe(0.3);
      expect(classificationResult.title).toBe('Unknown');
      expect(classificationResult.reasoning).toContain('Invalid response format');
    });

    it('rejects title exceeding 50 characters', async () => {
      const longTitle = 'A'.repeat(200);
      mockGenerate.mockResolvedValue(ok(generateResult(jsonResponse('todo', 0.9, longTitle))));

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('test');

      // Zod validation fails for title > 50 characters, returns default "note" classification
      expect(classificationResult.type).toBe('note');
      expect(classificationResult.confidence).toBe(0.3);
      expect(classificationResult.title).toBe('Unknown');
      expect(classificationResult.reasoning).toContain('Invalid response format');
    });

    it('accepts long reasoning without truncation', async () => {
      const longReasoning = 'B'.repeat(600);
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('todo', 0.9, 'Test', longReasoning)))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('test');

      // Zod doesn't truncate reasoning field - no max length in schema
      expect(classificationResult.reasoning).toBe(longReasoning);
    });

    it('handles non-string title in response', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult('{"type": "todo", "confidence": 0.9, "title": 123}'))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('test');

      // Zod validation fails for wrong type, returns default "note" classification
      expect(classificationResult.type).toBe('note');
      expect(classificationResult.confidence).toBe(0.3);
      expect(classificationResult.title).toBe('Unknown');
      expect(classificationResult.reasoning).toContain('Invalid response format');
    });

    it('handles non-string reasoning in response', async () => {
      mockGenerate.mockResolvedValue(
        ok(
          generateResult('{"type": "todo", "confidence": 0.9, "title": "Test", "reasoning": true}')
        )
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('test');

      // Zod validation fails for wrong type, returns default "note" classification
      expect(classificationResult.type).toBe('note');
      expect(classificationResult.confidence).toBe(0.3);
      expect(classificationResult.reasoning).toContain('Invalid response format');
    });

    it('handles non-number confidence in response', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult('{"type": "todo", "confidence": "high", "title": "Test"}'))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('test');

      // Zod validation fails for wrong type, returns default "note" classification
      expect(classificationResult.type).toBe('note');
      expect(classificationResult.confidence).toBe(0.3);
    });

  });

  describe('PWA-shared source confidence boost', () => {
    it('boosts link confidence by 0.1 for pwa-shared source', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('link', 0.85, 'Interesting article')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('https://example.com', {
        sourceType: 'pwa-shared',
      });

      expect(classificationResult.type).toBe('link');
      expect(classificationResult.confidence).toBe(0.95);
      expect(classificationResult.reasoning).toContain('confidence boosted: PWA share source');
    });

    it('caps boosted confidence at 1.0', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('link', 0.95, 'Cool link')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('https://example.com', {
        sourceType: 'pwa-shared',
      });

      expect(classificationResult.confidence).toBe(1.0);
    });

    it('does not boost confidence for non-link types with pwa-shared', async () => {
      mockGenerate.mockResolvedValue(ok(generateResult(jsonResponse('note', 0.8, 'Some note'))));

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('Just a note', {
        sourceType: 'pwa-shared',
      });

      expect(classificationResult.type).toBe('note');
      expect(classificationResult.confidence).toBe(0.8);
      expect(classificationResult.reasoning).not.toContain('boosted');
    });

    it('does not boost confidence for links with whatsapp_text source', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('link', 0.85, 'A link')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('https://example.com', {
        sourceType: 'whatsapp_text',
      });

      expect(classificationResult.type).toBe('link');
      expect(classificationResult.confidence).toBe(0.85);
      expect(classificationResult.reasoning).not.toContain('boosted');
    });

    it('does not boost confidence when no sourceType provided', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('link', 0.85, 'A link')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('https://example.com');

      expect(classificationResult.confidence).toBe(0.85);
    });
  });

  describe('URL keyword isolation', () => {
    it('classifies URL with "research" keyword as link when LLM follows prompt correctly', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('link', 0.92, 'Research World', 'URL present, keyword in URL ignored')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('https://research-world.com');

      expect(classificationResult.type).toBe('link');
      expect(classificationResult.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('classifies URL with "todo" keyword as link when LLM follows prompt correctly', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('link', 0.90, 'Todo App', 'URL present, keyword in URL ignored')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('https://todo-app.io/notes');

      expect(classificationResult.type).toBe('link');
      expect(classificationResult.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('classifies explicit "research this" intent with URL as research (STEP 2 > STEP 4)', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('research', 0.92, 'Example Research', 'Explicit research intent overrides URL')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('research this https://example.com');

      expect(classificationResult.type).toBe('research');
      expect(classificationResult.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('classifies URL with multiple keywords as link when LLM follows prompt correctly', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('link', 0.91, 'Research Todo Notes', 'URL present, keywords in URL ignored')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      const classificationResult = await classifier.classify('https://research-todo-notes.com');

      expect(classificationResult.type).toBe('link');
      expect(classificationResult.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('passes URL to LLM for classification', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('link', 0.9, 'Test Link')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      await classifier.classify('check this https://research-world.com');

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.stringContaining('https://research-world.com')
      );
    });

    it('includes URL keyword isolation instruction in prompt', async () => {
      mockGenerate.mockResolvedValue(
        ok(generateResult(jsonResponse('link', 0.9, 'Test')))
      );

      const classifier = createGeminiClassifier(mockLlmClient, mockLogger);
      await classifier.classify('https://example.com');

      expect(mockGenerate).toHaveBeenCalledWith(
        expect.stringContaining('Keywords inside URLs must be IGNORED')
      );
    });
  });
});

