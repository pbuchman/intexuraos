import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock functions must be defined before mocking the module
const mockUsersMe = vi.fn();
const mockPagesRetrieve = vi.fn();
const mockBlocksChildrenList = vi.fn();

// Mock the entire @notionhq/client module with factory pattern
vi.mock('@notionhq/client', () => {
  class MockClient {
    users = { me: mockUsersMe };
    pages = { retrieve: mockPagesRetrieve };
    blocks = { children: { list: mockBlocksChildrenList } };
  }

  return {
    Client: MockClient,
    isNotionClientError: vi.fn().mockReturnValue(false),
    APIErrorCode: {
      Unauthorized: 'unauthorized',
      ObjectNotFound: 'object_not_found',
      RateLimited: 'rate_limited',
      ValidationError: 'validation_error',
      InvalidJSON: 'invalid_json',
    },
    LogLevel: {
      DEBUG: 'debug',
    },
  };
});

// Import after mock is set up
import {
  mapNotionError,
  createNotionClient,
  validateNotionToken,
  getPageWithPreview,
  type NotionLogger,
} from '../notion.js';

describe('notion utilities', () => {
  beforeEach(() => {
    mockUsersMe.mockReset();
    mockPagesRetrieve.mockReset();
    mockBlocksChildrenList.mockReset();
  });

  describe('mapNotionError', () => {
    it('maps unknown error to INTERNAL_ERROR', () => {
      const result = mapNotionError(new Error('Something went wrong'));
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Something went wrong');
    });
    it('maps non-Error objects to INTERNAL_ERROR', () => {
      const result = mapNotionError('string error');
      expect(result.code).toBe('INTERNAL_ERROR');
      expect(result.message).toBe('Unknown Notion API error');
    });
    it('maps null to INTERNAL_ERROR', () => {
      const result = mapNotionError(null);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
    it('maps undefined to INTERNAL_ERROR', () => {
      const result = mapNotionError(undefined);
      expect(result.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('createNotionClient', () => {
    it('creates a Notion client without logger', () => {
      const client = createNotionClient('test-token');
      expect(client).toBeDefined();
    });
    it('creates a Notion client with logger', () => {
      const logger: NotionLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const client = createNotionClient('test-token', logger);
      expect(client).toBeDefined();
    });
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
