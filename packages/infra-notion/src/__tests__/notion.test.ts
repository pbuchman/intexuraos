/**
 * Tests for Notion client utilities.
 *
 * Note: Tests for validateNotionToken, getPageWithPreview, and createNotionClient
 * require mocking the Notion Client constructor which is complex. These functions
 * are covered by integration tests in the apps that use them.
 *
 * This file tests the pure utility functions that don't require network calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIErrorCode, isNotionClientError } from '@notionhq/client';
import { mapNotionError, extractPageTitle } from '../notion.js';

// Only mock isNotionClientError, not the whole module
vi.mock('@notionhq/client', async () => {
  const actual = await vi.importActual<typeof import('@notionhq/client')>('@notionhq/client');
  return {
    ...actual,
    isNotionClientError: vi.fn(),
  };
});

describe('Notion utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mapNotionError', () => {
    beforeEach(() => {
      vi.mocked(isNotionClientError).mockReturnValue(false);
    });

    it('maps Unauthorized error', () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      const error = { code: APIErrorCode.Unauthorized, message: 'Invalid token' };

      const result = mapNotionError(error);

      expect(result.code).toBe('UNAUTHORIZED');
      expect(result.message).toBe('Invalid token');
    });

    it('maps ObjectNotFound error', () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      const error = { code: APIErrorCode.ObjectNotFound, message: 'Page not found' };

      const result = mapNotionError(error);

      expect(result.code).toBe('NOT_FOUND');
    });

    it('maps RateLimited error', () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      const error = { code: APIErrorCode.RateLimited, message: 'Too many requests' };

      const result = mapNotionError(error);

      expect(result.code).toBe('RATE_LIMITED');
    });

    it('maps ValidationError error', () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      const error = { code: APIErrorCode.ValidationError, message: 'Invalid input' };

      const result = mapNotionError(error);

      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('maps InvalidJSON error', () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      const error = { code: APIErrorCode.InvalidJSON, message: 'Malformed JSON' };

      const result = mapNotionError(error);

      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('maps other Notion errors to INTERNAL_ERROR', () => {
      vi.mocked(isNotionClientError).mockReturnValue(true);
      const error = { code: APIErrorCode.InternalServerError, message: 'Server error' };

      const result = mapNotionError(error);

      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Server error');
    });

    it('maps non-Notion Error to INTERNAL_ERROR', () => {
      vi.mocked(isNotionClientError).mockReturnValue(false);
      const error = new Error('Network failure');

      const result = mapNotionError(error);

      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Network failure');
    });

    it('maps non-Error object to INTERNAL_ERROR with fallback message', () => {
      vi.mocked(isNotionClientError).mockReturnValue(false);

      const result = mapNotionError({ some: 'object' });

      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Unknown Notion API error');
    });

    it('maps null/undefined to INTERNAL_ERROR', () => {
      vi.mocked(isNotionClientError).mockReturnValue(false);

      expect(mapNotionError(null).code).toBe('INTERNAL_ERROR');
      expect(mapNotionError(undefined).code).toBe('INTERNAL_ERROR');
    });
  });

  describe('extractPageTitle', () => {
    it('extracts title from title property', () => {
      const properties = {
        title: {
          title: [{ plain_text: 'My Page Title' }],
        },
      };

      expect(extractPageTitle(properties)).toBe('My Page Title');
    });

    it('extracts title from Title property (capitalized)', () => {
      const properties = {
        Title: {
          title: [{ plain_text: 'Capitalized Title' }],
        },
      };

      expect(extractPageTitle(properties)).toBe('Capitalized Title');
    });

    it('extracts title from Name property', () => {
      const properties = {
        Name: {
          title: [{ plain_text: 'Name Property' }],
        },
      };

      expect(extractPageTitle(properties)).toBe('Name Property');
    });

    it('extracts title from name property (lowercase)', () => {
      const properties = {
        name: {
          title: [{ plain_text: 'Lowercase Name' }],
        },
      };

      expect(extractPageTitle(properties)).toBe('Lowercase Name');
    });

    it('concatenates multiple title segments', () => {
      const properties = {
        title: {
          title: [{ plain_text: 'Part 1 ' }, { plain_text: 'Part 2' }],
        },
      };

      expect(extractPageTitle(properties)).toBe('Part 1 Part 2');
    });

    it('handles missing plain_text in segments', () => {
      const properties = {
        title: {
          title: [{ plain_text: 'Text' }, { other: 'data' }],
        },
      };

      expect(extractPageTitle(properties)).toBe('Text');
    });

    it('returns Untitled when no title property exists', () => {
      const properties = {
        other: 'value',
      };

      expect(extractPageTitle(properties)).toBe('Untitled');
    });

    it('returns Untitled when title property has wrong format', () => {
      const properties = {
        title: 'string value',
      };

      expect(extractPageTitle(properties)).toBe('Untitled');
    });

    it('returns empty string when title array is empty', () => {
      const properties = {
        title: {
          title: [],
        },
      };

      expect(extractPageTitle(properties)).toBe('');
    });

    it('handles null title property', () => {
      const properties = {
        title: null,
      };

      expect(extractPageTitle(properties)).toBe('Untitled');
    });
  });
});
