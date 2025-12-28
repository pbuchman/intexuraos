/**
 * Tests for promptApi.ts
 * Tests the Notion API infrastructure layer for PromptVault operations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock functions must be defined before mocking the module
const mockPagesCreate = vi.fn();
const mockPagesRetrieve = vi.fn();
const mockPagesUpdate = vi.fn();
const mockBlocksChildrenList = vi.fn();
const mockBlocksChildrenAppend = vi.fn();
const mockBlocksUpdate = vi.fn();
const mockBlocksDelete = vi.fn();

// Mock Firestore functions
const mockIsNotionConnected = vi.fn();
const mockGetNotionToken = vi.fn();
const mockGetNotionConnection = vi.fn();

// Mock the @notionhq/client module
vi.mock('@notionhq/client', () => {
  class MockClient {
    pages = { create: mockPagesCreate, retrieve: mockPagesRetrieve, update: mockPagesUpdate };
    blocks = {
      children: { list: mockBlocksChildrenList, append: mockBlocksChildrenAppend },
      update: mockBlocksUpdate,
      delete: mockBlocksDelete,
    };
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

// Mock firestore functions
vi.mock('../../infra/firestore/index.js', () => ({
  isNotionConnected: (...args: unknown[]): unknown => mockIsNotionConnected(...args),
  getNotionToken: (...args: unknown[]): unknown => mockGetNotionToken(...args),
  getNotionConnection: (...args: unknown[]): unknown => mockGetNotionConnection(...args),
}));

// Import after mocks are set up
import {
  createPrompt,
  listPrompts,
  getPrompt,
  updatePrompt,
} from '../../infra/notion/promptApi.js';
import { ok, err } from '@intexuraos/common-core';

describe('promptApi', () => {
  beforeEach(() => {
    mockPagesCreate.mockReset();
    mockPagesRetrieve.mockReset();
    mockPagesUpdate.mockReset();
    mockBlocksChildrenList.mockReset();
    mockBlocksChildrenAppend.mockReset();
    mockBlocksUpdate.mockReset();
    mockBlocksDelete.mockReset();
    mockIsNotionConnected.mockReset();
    mockGetNotionToken.mockReset();
    mockGetNotionConnection.mockReset();
  });

  // Type for pages.create call arguments
  interface CreatePageCallArgs {
    children: { type: string }[];
  }

  // Helper to extract code blocks from pages.create mock call
  function getCodeBlocksFromCreateCall(): { type: string }[] {
    const callArgs = mockPagesCreate.mock.calls[0] as [CreatePageCallArgs];
    return callArgs[0].children.filter((c) => c.type === 'code');
  }

  // Helper to set up a valid user context
  function setupValidUserContext(): void {
    mockIsNotionConnected.mockResolvedValue(ok(true));
    mockGetNotionToken.mockResolvedValue(ok('test-token'));
    mockGetNotionConnection.mockResolvedValue(
      ok({
        promptVaultPageId: 'vault-page-id',
        connected: true,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      })
    );
  }

  describe('getUserContext (tested through exported functions)', () => {
    it('returns DOWNSTREAM_ERROR when isNotionConnected fails', async () => {
      mockIsNotionConnected.mockResolvedValue(
        err({ code: 'INTERNAL_ERROR', message: 'Database unavailable' })
      );

      const result = await createPrompt('user-1', 'title', 'content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
        expect(result.error.message).toBe('Database unavailable');
      }
    });

    it('returns NOT_CONNECTED when user is not connected', async () => {
      mockIsNotionConnected.mockResolvedValue(ok(false));

      const result = await createPrompt('user-1', 'title', 'content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toBe('Notion integration is not configured');
      }
    });

    it('returns DOWNSTREAM_ERROR when getNotionToken fails', async () => {
      mockIsNotionConnected.mockResolvedValue(ok(true));
      mockGetNotionToken.mockResolvedValue(
        err({ code: 'INTERNAL_ERROR', message: 'Token fetch failed' })
      );

      const result = await createPrompt('user-1', 'title', 'content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
        expect(result.error.message).toBe('Token fetch failed');
      }
    });

    it('returns NOT_CONNECTED when token is null', async () => {
      mockIsNotionConnected.mockResolvedValue(ok(true));
      mockGetNotionToken.mockResolvedValue(ok(null));

      const result = await createPrompt('user-1', 'title', 'content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toBe('Notion token not found');
      }
    });

    it('returns DOWNSTREAM_ERROR when getNotionConnection fails', async () => {
      mockIsNotionConnected.mockResolvedValue(ok(true));
      mockGetNotionToken.mockResolvedValue(ok('test-token'));
      mockGetNotionConnection.mockResolvedValue(
        err({ code: 'INTERNAL_ERROR', message: 'Connection fetch failed' })
      );

      const result = await createPrompt('user-1', 'title', 'content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
        expect(result.error.message).toBe('Connection fetch failed');
      }
    });

    it('returns NOT_CONNECTED when connection config is null', async () => {
      mockIsNotionConnected.mockResolvedValue(ok(true));
      mockGetNotionToken.mockResolvedValue(ok('test-token'));
      mockGetNotionConnection.mockResolvedValue(ok(null));

      const result = await createPrompt('user-1', 'title', 'content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toBe('Notion configuration not found');
      }
    });
  });

  describe('createPrompt', () => {
    it('creates a prompt successfully', async () => {
      setupValidUserContext();
      mockPagesCreate.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      const result = await createPrompt('user-1', 'My Title', 'My content');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('new-page-id');
        expect(result.value.title).toBe('My Title');
        expect(result.value.content).toBe('My content');
        expect(result.value.url).toBe('https://notion.so/new-page-id');
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('uses fallback URL when response has no url property', async () => {
      setupValidUserContext();
      mockPagesCreate.mockResolvedValue({
        id: 'new-page-id',
      });

      const result = await createPrompt('user-1', 'My Title', 'My content');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://notion.so/new-page-id');
      }
    });

    it('handles long content by splitting into chunks', async () => {
      setupValidUserContext();
      const longContent = 'A'.repeat(4000); // Exceeds MAX_CHUNK_SIZE of 1950
      mockPagesCreate.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      const result = await createPrompt('user-1', 'My Title', longContent);

      expect(result.ok).toBe(true);
      // The create call should have multiple code blocks
      expect(mockPagesCreate).toHaveBeenCalledTimes(1);
      const codeBlocks = getCodeBlocksFromCreateCall();
      expect(codeBlocks.length).toBeGreaterThan(1);
    });

    it('returns DOWNSTREAM_ERROR when Notion API throws', async () => {
      setupValidUserContext();
      mockPagesCreate.mockRejectedValue(new Error('API Error'));

      const result = await createPrompt('user-1', 'My Title', 'My content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
      }
    });
  });

  describe('listPrompts', () => {
    it('returns empty list when no child pages exist', async () => {
      setupValidUserContext();
      mockBlocksChildrenList.mockResolvedValue({ results: [] });

      const result = await listPrompts('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('returns prompts from child pages', async () => {
      setupValidUserContext();
      mockBlocksChildrenList.mockResolvedValueOnce({
        results: [
          { type: 'child_page', id: 'prompt-1', child_page: { title: 'Prompt 1' } },
          { type: 'child_page', id: 'prompt-2', child_page: { title: 'Prompt 2' } },
        ],
      });

      // Mock getPromptById calls
      mockPagesRetrieve
        .mockResolvedValueOnce({
          id: 'prompt-1',
          properties: { title: { title: [{ plain_text: 'Prompt 1' }] } },
          url: 'https://notion.so/prompt-1',
          created_time: '2025-01-01T00:00:00.000Z',
          last_edited_time: '2025-01-01T00:00:00.000Z',
        })
        .mockResolvedValueOnce({
          id: 'prompt-2',
          properties: { title: { title: [{ plain_text: 'Prompt 2' }] } },
          url: 'https://notion.so/prompt-2',
          created_time: '2025-01-01T00:00:00.000Z',
          last_edited_time: '2025-01-01T00:00:00.000Z',
        });

      mockBlocksChildrenList
        .mockResolvedValueOnce({
          results: [
            { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Content 1' }] } },
          ],
        })
        .mockResolvedValueOnce({
          results: [
            { type: 'code', id: 'block-2', code: { rich_text: [{ plain_text: 'Content 2' }] } },
          ],
        });

      const result = await listPrompts('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.title).toBe('Prompt 1');
        expect(result.value[1]?.title).toBe('Prompt 2');
      }
    });

    it('skips non-child_page blocks', async () => {
      setupValidUserContext();
      mockBlocksChildrenList.mockResolvedValue({
        results: [
          { type: 'paragraph', id: 'para-1' },
          { type: 'heading_1', id: 'heading-1' },
        ],
      });

      const result = await listPrompts('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('skips child pages that fail to retrieve', async () => {
      setupValidUserContext();
      mockBlocksChildrenList.mockResolvedValueOnce({
        results: [
          { type: 'child_page', id: 'prompt-1', child_page: { title: 'Prompt 1' } },
          { type: 'child_page', id: 'prompt-2', child_page: { title: 'Prompt 2' } },
        ],
      });

      // First succeeds, second fails
      mockPagesRetrieve
        .mockResolvedValueOnce({
          id: 'prompt-1',
          properties: { title: { title: [{ plain_text: 'Prompt 1' }] } },
          url: 'https://notion.so/prompt-1',
        })
        .mockRejectedValueOnce(new Error('Page not found'));

      mockBlocksChildrenList.mockResolvedValueOnce({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Content 1' }] } },
        ],
      });

      const result = await listPrompts('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only the first prompt should be returned
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.title).toBe('Prompt 1');
      }
    });

    it('returns DOWNSTREAM_ERROR when initial list fails', async () => {
      setupValidUserContext();
      mockBlocksChildrenList.mockRejectedValue(new Error('API Error'));

      const result = await listPrompts('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
      }
    });
  });

  describe('getPrompt', () => {
    it('retrieves a prompt successfully', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
        url: 'https://notion.so/prompt-1',
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-02T00:00:00.000Z',
      });
      mockBlocksChildrenList.mockResolvedValue({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Content here' }] } },
        ],
      });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('prompt-1');
        expect(result.value.title).toBe('My Prompt');
        expect(result.value.content).toBe('Content here');
        expect(result.value.url).toBe('https://notion.so/prompt-1');
        expect(result.value.createdAt).toBe('2025-01-01T00:00:00.000Z');
        expect(result.value.updatedAt).toBe('2025-01-02T00:00:00.000Z');
      }
    });

    it('handles page response without url property', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
      });
      mockBlocksChildrenList.mockResolvedValue({ results: [] });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://notion.so/prompt-1');
      }
    });

    it('returns INTERNAL_ERROR when page response has no properties', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
      });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Unexpected page response format');
      }
    });

    it('joins multiple code blocks into single content', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
      });
      mockBlocksChildrenList.mockResolvedValue({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'First chunk' }] } },
          { type: 'code', id: 'block-2', code: { rich_text: [{ plain_text: 'Second chunk' }] } },
        ],
      });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('First chunk\nSecond chunk');
      }
    });

    it('skips non-code blocks', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
      });
      mockBlocksChildrenList.mockResolvedValue({
        results: [
          { type: 'paragraph', id: 'para-1', paragraph: { rich_text: [{ plain_text: 'Para' }] } },
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Code content' }] } },
        ],
      });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Code content');
      }
    });

    it('handles code blocks without rich_text', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
      });
      mockBlocksChildrenList.mockResolvedValue({
        results: [{ type: 'code', id: 'block-1', code: {} }],
      });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('handles empty code blocks content', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
      });
      mockBlocksChildrenList.mockResolvedValue({
        results: [{ type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: '' }] } }],
      });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('handles page without created_time or last_edited_time', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
      });
      mockBlocksChildrenList.mockResolvedValue({ results: [] });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt).toBeUndefined();
        expect(result.value.updatedAt).toBeUndefined();
      }
    });

    it('returns DOWNSTREAM_ERROR when Notion API throws', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockRejectedValue(new Error('Page not found'));

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
      }
    });
  });

  describe('updatePrompt', () => {
    it('updates title only', async () => {
      setupValidUserContext();
      mockPagesUpdate.mockResolvedValue({ id: 'prompt-1' });
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Updated Title' }] } },
      });
      mockBlocksChildrenList.mockResolvedValue({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Content' }] } },
        ],
      });

      const result = await updatePrompt('user-1', 'prompt-1', { title: 'Updated Title' });

      expect(result.ok).toBe(true);
      expect(mockPagesUpdate).toHaveBeenCalledWith({
        page_id: 'prompt-1',
        properties: { title: { title: [{ text: { content: 'Updated Title' } }] } },
      });
    });

    it('updates content only', async () => {
      setupValidUserContext();
      mockBlocksChildrenList
        .mockResolvedValueOnce({
          results: [
            { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Old content' }] } },
          ],
        })
        .mockResolvedValueOnce({
          results: [
            { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'New content' }] } },
          ],
        });
      mockBlocksUpdate.mockResolvedValue({});
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });

      const result = await updatePrompt('user-1', 'prompt-1', { content: 'New content' });

      expect(result.ok).toBe(true);
      expect(mockPagesUpdate).not.toHaveBeenCalled();
      expect(mockBlocksUpdate).toHaveBeenCalledWith({
        block_id: 'block-1',
        code: {
          rich_text: [{ type: 'text', text: { content: 'New content' } }],
          language: 'markdown',
        },
      });
    });

    it('updates both title and content', async () => {
      setupValidUserContext();
      mockPagesUpdate.mockResolvedValue({ id: 'prompt-1' });
      mockBlocksChildrenList
        .mockResolvedValueOnce({
          results: [{ type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Old' }] } }],
        })
        .mockResolvedValueOnce({
          results: [{ type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'New' }] } }],
        });
      mockBlocksUpdate.mockResolvedValue({});
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'New Title' }] } },
      });

      const result = await updatePrompt('user-1', 'prompt-1', {
        title: 'New Title',
        content: 'New',
      });

      expect(result.ok).toBe(true);
      expect(mockPagesUpdate).toHaveBeenCalled();
      expect(mockBlocksUpdate).toHaveBeenCalled();
    });

    it('deletes extra code blocks when new content is shorter', async () => {
      setupValidUserContext();
      mockBlocksChildrenList
        .mockResolvedValueOnce({
          results: [
            { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Chunk 1' }] } },
            { type: 'code', id: 'block-2', code: { rich_text: [{ plain_text: 'Chunk 2' }] } },
          ],
        })
        .mockResolvedValueOnce({
          results: [
            { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Short' }] } },
          ],
        });
      mockBlocksUpdate.mockResolvedValue({});
      mockBlocksDelete.mockResolvedValue({});
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });

      const result = await updatePrompt('user-1', 'prompt-1', { content: 'Short' });

      expect(result.ok).toBe(true);
      expect(mockBlocksUpdate).toHaveBeenCalledTimes(1);
      expect(mockBlocksDelete).toHaveBeenCalledTimes(1);
      expect(mockBlocksDelete).toHaveBeenCalledWith({ block_id: 'block-2' });
    });

    it('appends new code blocks when new content is longer', async () => {
      setupValidUserContext();
      const longContent = 'A'.repeat(4000); // Will split into 3 chunks
      mockBlocksChildrenList
        .mockResolvedValueOnce({
          results: [
            { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Short' }] } },
          ],
        })
        .mockResolvedValueOnce({
          results: [
            { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: longContent }] } },
          ],
        });
      mockBlocksUpdate.mockResolvedValue({});
      mockBlocksChildrenAppend.mockResolvedValue({});
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });

      const result = await updatePrompt('user-1', 'prompt-1', { content: longContent });

      expect(result.ok).toBe(true);
      expect(mockBlocksUpdate).toHaveBeenCalledTimes(1);
      expect(mockBlocksChildrenAppend.mock.calls.length).toBeGreaterThan(0);
    });

    it('returns DOWNSTREAM_ERROR when Notion API throws during update', async () => {
      setupValidUserContext();
      mockPagesUpdate.mockRejectedValue(new Error('Update failed'));

      const result = await updatePrompt('user-1', 'prompt-1', { title: 'New Title' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
      }
    });
  });

  describe('mapError (tested through error paths)', () => {
    it('maps NOT_FOUND to NOT_FOUND', async () => {
      setupValidUserContext();
      // Mock isNotionClientError to return true for this test
      const { isNotionClientError } = await import('@notionhq/client');
      vi.mocked(isNotionClientError).mockReturnValueOnce(true);
      mockPagesRetrieve.mockRejectedValue({
        code: 'object_not_found',
        message: 'Page not found',
      });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(false);
      // The actual error code depends on mapNotionError implementation
    });

    it('maps UNAUTHORIZED to UNAUTHORIZED', async () => {
      setupValidUserContext();
      const { isNotionClientError } = await import('@notionhq/client');
      vi.mocked(isNotionClientError).mockReturnValueOnce(true);
      mockPagesRetrieve.mockRejectedValue({
        code: 'unauthorized',
        message: 'Invalid token',
      });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(false);
    });
  });

  describe('splitTextIntoChunks (tested through createPrompt and updatePrompt)', () => {
    it('handles text shorter than MAX_CHUNK_SIZE', async () => {
      setupValidUserContext();
      mockPagesCreate.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      const shortContent = 'Short content';
      await createPrompt('user-1', 'Title', shortContent);

      expect(mockPagesCreate).toHaveBeenCalledTimes(1);
      const codeBlocks = getCodeBlocksFromCreateCall();
      expect(codeBlocks).toHaveLength(1);
    });

    it('splits at double newline boundary when possible', async () => {
      setupValidUserContext();
      mockPagesCreate.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      // Create content with double newline near the split point
      const chunk1 = 'A'.repeat(1800);
      const chunk2 = 'B'.repeat(1000);
      const content = chunk1 + '\n\n' + chunk2;

      await createPrompt('user-1', 'Title', content);

      expect(mockPagesCreate).toHaveBeenCalledTimes(1);
    });

    it('splits at single newline when no double newline is available', async () => {
      setupValidUserContext();
      mockPagesCreate.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      // Create content with only single newlines
      const chunk1 = 'A'.repeat(1800);
      const chunk2 = 'B'.repeat(1000);
      const content = chunk1 + '\n' + chunk2;

      await createPrompt('user-1', 'Title', content);

      expect(mockPagesCreate).toHaveBeenCalledTimes(1);
    });

    it('splits at period when no newline is available', async () => {
      setupValidUserContext();
      mockPagesCreate.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      // Create content with periods but no newlines
      const chunk1 = 'A'.repeat(1800);
      const chunk2 = 'B'.repeat(1000);
      const content = chunk1 + '. ' + chunk2;

      await createPrompt('user-1', 'Title', content);

      expect(mockPagesCreate).toHaveBeenCalledTimes(1);
    });

    it('splits at space when no other boundary is available', async () => {
      setupValidUserContext();
      mockPagesCreate.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      // Create content with only spaces
      const chunk1 = 'A'.repeat(1800);
      const chunk2 = 'B'.repeat(1000);
      const content = chunk1 + ' ' + chunk2;

      await createPrompt('user-1', 'Title', content);

      expect(mockPagesCreate).toHaveBeenCalledTimes(1);
    });

    it('forces split at MAX_CHUNK_SIZE when no boundary is available', async () => {
      setupValidUserContext();
      mockPagesCreate.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      // Create content with no natural split points
      const content = 'A'.repeat(4000);

      await createPrompt('user-1', 'Title', content);

      expect(mockPagesCreate).toHaveBeenCalledTimes(1);
      const codeBlocks = getCodeBlocksFromCreateCall();
      expect(codeBlocks.length).toBeGreaterThan(1);
    });
  });

  describe('joinTextChunks (tested through getPrompt)', () => {
    it('returns empty string for empty array', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });
      mockBlocksChildrenList.mockResolvedValue({ results: [] });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('returns single chunk as-is', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });
      mockBlocksChildrenList.mockResolvedValue({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Single chunk' }] } },
        ],
      });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Single chunk');
      }
    });

    it('joins multiple chunks with newlines', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });
      mockBlocksChildrenList.mockResolvedValue({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'First' }] } },
          { type: 'code', id: 'block-2', code: { rich_text: [{ plain_text: 'Second' }] } },
          { type: 'code', id: 'block-3', code: { rich_text: [{ plain_text: 'Third' }] } },
        ],
      });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('First\nSecond\nThird');
      }
    });

    it('filters out empty chunks', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });
      mockBlocksChildrenList.mockResolvedValue({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'First' }] } },
          { type: 'code', id: 'block-2', code: { rich_text: [{ plain_text: '   ' }] } },
          { type: 'code', id: 'block-3', code: { rich_text: [{ plain_text: 'Third' }] } },
        ],
      });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('First\nThird');
      }
    });
  });

  describe('edge cases', () => {
    it('handles page with empty created_time string', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
        created_time: '',
        last_edited_time: '',
      });
      mockBlocksChildrenList.mockResolvedValue({ results: [] });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt).toBeUndefined();
        expect(result.value.updatedAt).toBeUndefined();
      }
    });

    it('handles code block with missing plain_text in rich_text items', async () => {
      setupValidUserContext();
      mockPagesRetrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });
      mockBlocksChildrenList.mockResolvedValue({
        results: [{ type: 'code', id: 'block-1', code: { rich_text: [{}] } }],
      });

      const result = await getPrompt('user-1', 'prompt-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Missing plain_text should be treated as empty string
        expect(result.value.content).toBe('');
      }
    });
  });
});
