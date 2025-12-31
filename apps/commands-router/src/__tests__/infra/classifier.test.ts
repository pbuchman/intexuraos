/**
 * Tests for GeminiClassifier.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateContent = vi.fn();

class MockGoogleGenAI {
  models = {
    generateContent: mockGenerateContent,
  };
}

vi.mock('@google/genai', () => ({
  GoogleGenAI: MockGoogleGenAI,
}));

const { createGeminiClassifier } = await import('../../infra/gemini/classifier.js');

describe('GeminiClassifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('classify', () => {
    it('classifies todo command correctly', async () => {
      mockGenerateContent.mockResolvedValue({
        text: '{"type": "todo", "confidence": 0.95, "title": "Buy groceries"}',
      });

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      const result = await classifier.classify('I need to buy groceries');

      expect(result.type).toBe('todo');
      expect(result.confidence).toBe(0.95);
      expect(result.title).toBe('Buy groceries');
    });

    it('classifies research command correctly', async () => {
      mockGenerateContent.mockResolvedValue({
        text: '{"type": "research", "confidence": 0.88, "title": "AI trends research"}',
      });

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      const result = await classifier.classify('What are the latest AI trends?');

      expect(result.type).toBe('research');
      expect(result.confidence).toBe(0.88);
    });

    it('handles JSON embedded in text', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Here is my classification:\n{"type": "note", "confidence": 0.9, "title": "Meeting notes"}\nDone.',
      });

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      const result = await classifier.classify('Meeting notes from today');

      expect(result.type).toBe('note');
      expect(result.confidence).toBe(0.9);
    });

    it('returns unclassified when no JSON found', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'I cannot classify this message.',
      });

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      const result = await classifier.classify('random gibberish');

      expect(result.type).toBe('unclassified');
      expect(result.confidence).toBe(0);
      expect(result.title).toBe('Unclassified command');
    });

    it('returns unclassified for invalid type', async () => {
      mockGenerateContent.mockResolvedValue({
        text: '{"type": "invalid_type", "confidence": 0.9, "title": "Test"}',
      });

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      const result = await classifier.classify('test message');

      expect(result.type).toBe('unclassified');
    });

    it('clamps confidence to valid range', async () => {
      mockGenerateContent.mockResolvedValue({
        text: '{"type": "todo", "confidence": 1.5, "title": "Test"}',
      });

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      const result = await classifier.classify('test');

      expect(result.confidence).toBe(1);
    });

    it('clamps negative confidence to 0', async () => {
      mockGenerateContent.mockResolvedValue({
        text: '{"type": "todo", "confidence": -0.5, "title": "Test"}',
      });

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      const result = await classifier.classify('test');

      expect(result.confidence).toBe(0);
    });

    it('uses default title when not provided', async () => {
      mockGenerateContent.mockResolvedValue({
        text: '{"type": "todo", "confidence": 0.9}',
      });

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      const result = await classifier.classify('test');

      expect(result.title).toBe('Untitled');
    });

    it('truncates long titles to 100 chars', async () => {
      const longTitle = 'A'.repeat(150);
      mockGenerateContent.mockResolvedValue({
        text: `{"type": "note", "confidence": 0.9, "title": "${longTitle}"}`,
      });

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      const result = await classifier.classify('test');

      expect(result.title.length).toBe(100);
    });

    it('handles null response text', async () => {
      mockGenerateContent.mockResolvedValue({
        text: null,
      });

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });
      const result = await classifier.classify('test');

      expect(result.type).toBe('unclassified');
    });

    it('throws on API error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API rate limit exceeded'));

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });

      await expect(classifier.classify('test')).rejects.toThrow(
        'Classification failed: API rate limit exceeded'
      );
    });

    it('handles non-Error exceptions', async () => {
      mockGenerateContent.mockRejectedValue('String error');

      const classifier = createGeminiClassifier({ apiKey: 'test-key' });

      await expect(classifier.classify('test')).rejects.toThrow('Classification failed:');
    });
  });
});
