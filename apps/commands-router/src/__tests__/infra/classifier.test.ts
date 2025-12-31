/**
 * Tests for GeminiClassifier.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { GeminiError, ClassificationResult } from '@intexuraos/infra-gemini';

const mockClassify = vi.fn();

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: () => ({
    classify: mockClassify,
  }),
}));

const { createGeminiClassifier } = await import('../../infra/gemini/classifier.js');

describe('GeminiClassifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('classify', () => {
    it('classifies todo command correctly', async () => {
      const result: ClassificationResult<string> = {
        type: 'todo',
        confidence: 0.95,
        title: 'Buy groceries',
      };
      mockClassify.mockResolvedValue(ok(result));

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      const classificationResult = await classifier.classify('I need to buy groceries');

      expect(classificationResult.type).toBe('todo');
      expect(classificationResult.confidence).toBe(0.95);
      expect(classificationResult.title).toBe('Buy groceries');
    });

    it('classifies research command correctly', async () => {
      const result: ClassificationResult<string> = {
        type: 'research',
        confidence: 0.88,
        title: 'AI trends research',
      };
      mockClassify.mockResolvedValue(ok(result));

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      const classificationResult = await classifier.classify('What are the latest AI trends?');

      expect(classificationResult.type).toBe('research');
      expect(classificationResult.confidence).toBe(0.88);
    });

    it('returns unclassified when classify returns unclassified type', async () => {
      const result: ClassificationResult<string> = {
        type: 'unclassified',
        confidence: 0,
        title: 'Unclassified',
      };
      mockClassify.mockResolvedValue(ok(result));

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
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
      mockClassify.mockResolvedValue(err(error));

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: API rate limit exceeded'
      );
    });

    it('throws on invalid key error', async () => {
      const error: GeminiError = {
        code: 'INVALID_KEY',
        message: 'Invalid API key provided',
      };
      mockClassify.mockResolvedValue(err(error));

      const classifier = createGeminiClassifier({ apiKey: 'bad-key' });

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: Invalid API key provided'
      );
    });

    it('classifies note command correctly', async () => {
      const result: ClassificationResult<string> = {
        type: 'note',
        confidence: 0.9,
        title: 'Meeting notes',
      };
      mockClassify.mockResolvedValue(ok(result));

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      const classificationResult = await classifier.classify('Meeting notes from today');

      expect(classificationResult.type).toBe('note');
      expect(classificationResult.confidence).toBe(0.9);
    });

    it('passes correct options to classify', async () => {
      const result: ClassificationResult<string> = {
        type: 'todo',
        confidence: 0.9,
        title: 'Test',
      };
      mockClassify.mockResolvedValue(ok(result));

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      await classifier.classify('test message');

      expect(mockClassify).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'test message',
          defaultType: 'unclassified',
        })
      );
    });

    it('passes all valid types to classify', async () => {
      const result: ClassificationResult<string> = {
        type: 'calendar',
        confidence: 0.85,
        title: 'Team meeting',
      };
      mockClassify.mockResolvedValue(ok(result));

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      await classifier.classify('Team meeting tomorrow at 3pm');

      expect(mockClassify).toHaveBeenCalledWith(
        expect.objectContaining({
          validTypes: expect.arrayContaining([
            'todo',
            'research',
            'note',
            'link',
            'calendar',
            'reminder',
            'unclassified',
          ]),
        })
      );
    });

    it('handles timeout error', async () => {
      const error: GeminiError = {
        code: 'TIMEOUT',
        message: 'Request timed out',
      };
      mockClassify.mockResolvedValue(err(error));

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: Request timed out'
      );
    });

    it('handles API error', async () => {
      const error: GeminiError = {
        code: 'API_ERROR',
        message: 'Server error',
      };
      mockClassify.mockResolvedValue(err(error));

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: Server error'
      );
    });

    it('handles parse error', async () => {
      const error: GeminiError = {
        code: 'PARSE_ERROR',
        message: 'Failed to parse response',
      };
      mockClassify.mockResolvedValue(err(error));

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: Failed to parse response'
      );
    });
  });
});
