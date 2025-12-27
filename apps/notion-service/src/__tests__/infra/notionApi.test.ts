/**
 * Tests for Notion API utilities.
 * Mocks createNotionClient from @intexuraos/common.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Create mock functions
const mockUsersMe = vi.fn();
const mockPagesRetrieve = vi.fn();
const mockBlocksChildrenList = vi.fn();

// Mock the common package's createNotionClient
vi.mock('@intexuraos/common', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    createNotionClient: vi.fn(() => ({
      users: { me: mockUsersMe },
      pages: { retrieve: mockPagesRetrieve },
      blocks: { children: { list: mockBlocksChildrenList } },
    })),
  };
});

import { validateNotionToken, getPageWithPreview } from '../../infra/notion/notionApi.js';

describe('notionApi', () => {
  beforeEach(() => {
    mockUsersMe.mockReset();
    mockPagesRetrieve.mockReset();
    mockBlocksChildrenList.mockReset();
  });

  describe('validateNotionToken', () => {
    it('returns true when token is valid', async () => {
      mockUsersMe.mockResolvedValue({ object: 'user', id: 'user-123' });

      const result = await validateNotionToken('valid-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns error when API call fails', async () => {
      mockUsersMe.mockRejectedValue(new Error('Network error'));

      const result = await validateNotionToken('invalid-token');

      // Generic errors map to INTERNAL_ERROR, which is not UNAUTHORIZED
      // so validateNotionToken returns error (not ok(false))
      expect(result.ok).toBe(false);
    });
  });

  describe('getPageWithPreview', () => {
    it('returns page with title and blocks', async () => {
      mockPagesRetrieve.mockResolvedValue({
        id: 'page-123',
        url: 'https://notion.so/page-123',
        properties: {
          title: {
            title: [{ plain_text: 'My Page Title' }],
          },
        },
      });

      mockBlocksChildrenList.mockResolvedValue({
        results: [
          {
            type: 'paragraph',
            paragraph: {
              rich_text: [{ plain_text: 'First paragraph content' }],
            },
          },
          {
            type: 'heading_1',
            heading_1: {
              rich_text: [{ plain_text: 'A heading' }],
            },
          },
        ],
      });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('page-123');
        expect(result.value.title).toBe('My Page Title');
        expect(result.value.url).toBe('https://notion.so/page-123');
        expect(result.value.blocks).toHaveLength(2);
        expect(result.value.blocks[0]?.type).toBe('paragraph');
        expect(result.value.blocks[0]?.content).toBe('First paragraph content');
      }
    });

    it('handles page with no title property', async () => {
      mockPagesRetrieve.mockResolvedValue({
        id: 'page-123',
        url: 'https://notion.so/page-123',
        properties: {},
      });

      mockBlocksChildrenList.mockResolvedValue({ results: [] });

      const result = await getPageWithPreview('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe('Untitled');
      }
    });

    it('returns error when API fails', async () => {
      mockPagesRetrieve.mockRejectedValue(new Error('Page not found'));

      const result = await getPageWithPreview('token', 'nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Page not found');
      }
    });
  });
});
