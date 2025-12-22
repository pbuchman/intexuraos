/**
 * Tests for text chunking utilities.
 */
import { describe, it, expect } from 'vitest';
import {
  splitTextIntoChunks,
  joinTextChunks,
  exceedsNotionLimit,
  getRequiredChunkCount,
  NOTION_TEXT_BLOCK_LIMIT,
} from '../textChunker.js';

describe('textChunker', () => {
  describe('splitTextIntoChunks', () => {
    it('returns single chunk for empty string', () => {
      expect(splitTextIntoChunks('')).toEqual(['']);
    });

    it('returns single chunk for short text', () => {
      const text = 'Hello, world!';
      expect(splitTextIntoChunks(text)).toEqual([text]);
    });

    it('returns single chunk for text at exactly the limit', () => {
      const text = 'a'.repeat(1950);
      const chunks = splitTextIntoChunks(text);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('splits long text into multiple chunks', () => {
      const text = 'a'.repeat(4000);
      const chunks = splitTextIntoChunks(text);
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(1950);
      });
    });

    it('prefers splitting at paragraph boundaries', () => {
      const paragraph1 = 'First paragraph content here. '.repeat(80);
      const paragraph2 = 'Second paragraph content. '.repeat(80);
      const text = paragraph1 + '\n\n' + paragraph2;

      const chunks = splitTextIntoChunks(text);

      expect(chunks.length).toBeGreaterThan(1);
      const firstChunk = chunks[0] ?? '';
      expect(firstChunk).toContain('First paragraph');
      const hasSecondParagraphInLaterChunk = chunks
        .slice(1)
        .some((chunk) => chunk.includes('Second paragraph'));
      expect(hasSecondParagraphInLaterChunk).toBe(true);
    });

    it('prefers splitting at sentence boundaries when no paragraph break', () => {
      const text = 'This is sentence one. This is sentence two. '.repeat(60);
      const chunks = splitTextIntoChunks(text);

      expect(chunks.length).toBeGreaterThan(1);
      const chunksEndingWithSentence = chunks.filter((chunk) => {
        const trimmed = chunk.trim();
        return trimmed.endsWith('.') || trimmed.endsWith('. ');
      });
      expect(chunksEndingWithSentence.length).toBeGreaterThanOrEqual(chunks.length - 1);
    });

    it('splits at word boundaries as fallback', () => {
      const text = 'word '.repeat(500);
      const chunks = splitTextIntoChunks(text);

      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(1950);
        expect(chunk.trim().endsWith('word')).toBe(true);
      });
    });

    it('handles text with only newlines', () => {
      const text = 'Line 1\nLine 2\nLine 3\n'.repeat(200);
      const chunks = splitTextIntoChunks(text);

      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(1950);
      });
    });

    it('handles very long single word (hard cut)', () => {
      const longWord = 'a'.repeat(2500);
      const chunks = splitTextIntoChunks(longWord);

      expect(chunks.length).toBe(2);
      const chunk0 = chunks[0] ?? '';
      const chunk1 = chunks[1] ?? '';
      expect(chunk0.length).toBeLessThanOrEqual(1950);
      expect(chunk1.length).toBeLessThanOrEqual(1950);
      expect(chunk0 + chunk1).toBe(longWord);
    });

    it('respects custom max chunk size', () => {
      const text = 'Hello world! '.repeat(100);
      const chunks = splitTextIntoChunks(text, 100);

      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('joinTextChunks', () => {
    it('returns empty string for empty array', () => {
      expect(joinTextChunks([])).toBe('');
    });

    it('returns single chunk unchanged', () => {
      expect(joinTextChunks(['Hello'])).toBe('Hello');
    });

    it('joins multiple chunks with newline', () => {
      const result = joinTextChunks(['Chunk 1', 'Chunk 2', 'Chunk 3']);
      expect(result).toBe('Chunk 1\nChunk 2\nChunk 3');
    });

    it('trims whitespace from chunks', () => {
      const result = joinTextChunks(['  Chunk 1  ', '  Chunk 2  ']);
      expect(result).toBe('Chunk 1\nChunk 2');
    });

    it('filters out empty chunks', () => {
      const result = joinTextChunks(['Chunk 1', '', '  ', 'Chunk 2']);
      expect(result).toBe('Chunk 1\nChunk 2');
    });
  });

  describe('exceedsNotionLimit', () => {
    it('returns false for short text', () => {
      expect(exceedsNotionLimit('Hello')).toBe(false);
    });

    it('returns false for text at exactly the limit', () => {
      expect(exceedsNotionLimit('a'.repeat(NOTION_TEXT_BLOCK_LIMIT))).toBe(false);
    });

    it('returns true for text exceeding the limit', () => {
      expect(exceedsNotionLimit('a'.repeat(NOTION_TEXT_BLOCK_LIMIT + 1))).toBe(true);
    });
  });

  describe('getRequiredChunkCount', () => {
    it('returns 1 for short text', () => {
      expect(getRequiredChunkCount('Hello')).toBe(1);
    });

    it('returns 1 for empty text', () => {
      expect(getRequiredChunkCount('')).toBe(1);
    });

    it('returns correct count for long text', () => {
      const text = 'a'.repeat(4000);
      const count = getRequiredChunkCount(text);
      expect(count).toBeGreaterThan(1);
      expect(count).toBeLessThanOrEqual(3);
    });
  });

  describe('round-trip: split then join', () => {
    it('preserves content for short text', () => {
      const original = 'Hello, world!';
      const chunks = splitTextIntoChunks(original);
      const rejoined = joinTextChunks(chunks);
      expect(rejoined).toBe(original);
    });

    it('preserves content for long text (allowing whitespace normalization)', () => {
      const original = 'This is a test. '.repeat(200);
      const chunks = splitTextIntoChunks(original);
      const rejoined = joinTextChunks(chunks);

      expect(rejoined.replace(/\s+/g, ' ').trim()).toBe(original.replace(/\s+/g, ' ').trim());
    });
  });
});

