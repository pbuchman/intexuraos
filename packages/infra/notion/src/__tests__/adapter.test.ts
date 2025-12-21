import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotionApiAdapter } from '../adapter.js';

// Track which errors should be treated as Notion client errors
const notionClientErrors = new WeakSet<Error>();

// Create mock error class
class MockNotionClientError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    notionClientErrors.add(this);
  }
}

// Mock @notionhq/client
vi.mock('@notionhq/client', () => {
  return {
    Client: vi.fn(),
    isNotionClientError: (error: unknown): boolean => {
      return error instanceof Error && notionClientErrors.has(error);
    },
    APIErrorCode: {
      Unauthorized: 'unauthorized',
      ObjectNotFound: 'object_not_found',
      RateLimited: 'rate_limited',
      ValidationError: 'validation_error',
      InvalidJSON: 'invalid_json',
    },
  };
});

// Import after mock
import { Client, APIErrorCode } from '@notionhq/client';

// Helper to create mock Notion client error
function createNotionError(code: string, message: string): Error {
  return new MockNotionClientError(code, message);
}

describe('NotionApiAdapter', () => {
  let adapter: NotionApiAdapter;
  let mockClient: {
    users: { me: ReturnType<typeof vi.fn> };
    pages: {
      retrieve: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    blocks: { children: { list: ReturnType<typeof vi.fn> } };
  };

  beforeEach(() => {
    mockClient = {
      users: { me: vi.fn() },
      pages: {
        retrieve: vi.fn(),
        create: vi.fn(),
      },
      blocks: { children: { list: vi.fn() } },
    };

    vi.mocked(Client).mockImplementation(
      () => mockClient as unknown as InstanceType<typeof Client>
    );
    adapter = new NotionApiAdapter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('validateToken', () => {
    it('returns ok(true) when token is valid', async () => {
      mockClient.users.me.mockResolvedValue({ id: 'user-123', type: 'person' });

      const result = await adapter.validateToken('valid-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('returns ok(false) when token is unauthorized', async () => {
      mockClient.users.me.mockRejectedValue(
        createNotionError(APIErrorCode.Unauthorized, 'Invalid token')
      );

      const result = await adapter.validateToken('invalid-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('returns error for other API errors', async () => {
      mockClient.users.me.mockRejectedValue(
        createNotionError(APIErrorCode.RateLimited, 'Too many requests')
      );

      const result = await adapter.validateToken('some-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('RATE_LIMITED');
      }
    });

    it('returns INTERNAL_ERROR for non-Notion errors', async () => {
      mockClient.users.me.mockRejectedValue(new Error('Network error'));

      const result = await adapter.validateToken('some-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Network error');
      }
    });
  });

  describe('getPageWithPreview', () => {
    const pageId = 'page-123';
    const token = 'valid-token';

    it('returns page and blocks on success', async () => {
      mockClient.pages.retrieve.mockResolvedValue({
        id: pageId,
        url: 'https://notion.so/page-123',
        properties: {
          title: {
            title: [{ plain_text: 'Test Page' }],
          },
        },
      });

      mockClient.blocks.children.list.mockResolvedValue({
        results: [
          {
            type: 'paragraph',
            paragraph: {
              rich_text: [{ plain_text: 'Hello world' }],
            },
          },
        ],
      });

      const result = await adapter.getPageWithPreview(token, pageId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.page.id).toBe(pageId);
        expect(result.value.page.title).toBe('Test Page');
        expect(result.value.blocks).toHaveLength(1);
        expect(result.value.blocks[0]?.content).toBe('Hello world');
      }
    });

    it('extracts title from various property names', async () => {
      // Test with 'Name' property instead of 'title'
      mockClient.pages.retrieve.mockResolvedValue({
        id: pageId,
        url: 'https://notion.so/page-123',
        properties: {
          Name: {
            title: [{ plain_text: 'Named Page' }],
          },
        },
      });

      mockClient.blocks.children.list.mockResolvedValue({ results: [] });

      const result = await adapter.getPageWithPreview(token, pageId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.page.title).toBe('Named Page');
      }
    });

    it('returns Untitled when no title property found', async () => {
      mockClient.pages.retrieve.mockResolvedValue({
        id: pageId,
        url: 'https://notion.so/page-123',
        properties: {},
      });

      mockClient.blocks.children.list.mockResolvedValue({ results: [] });

      const result = await adapter.getPageWithPreview(token, pageId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.page.title).toBe('Untitled');
      }
    });

    it('returns error when page has unexpected format', async () => {
      // Database response doesn't have 'properties'
      mockClient.pages.retrieve.mockResolvedValue({
        id: pageId,
        object: 'database',
      });

      const result = await adapter.getPageWithPreview(token, pageId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Unexpected page response format');
      }
    });

    it('returns NOT_FOUND error when page not found', async () => {
      mockClient.pages.retrieve.mockRejectedValue(
        createNotionError(APIErrorCode.ObjectNotFound, 'Page not found')
      );

      const result = await adapter.getPageWithPreview(token, pageId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('constructs URL when not provided in response', async () => {
      mockClient.pages.retrieve.mockResolvedValue({
        id: pageId,
        // No 'url' property
        properties: {},
      });

      mockClient.blocks.children.list.mockResolvedValue({ results: [] });

      const result = await adapter.getPageWithPreview(token, pageId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.page.url).toBe(`https://notion.so/${pageId}`);
      }
    });

    it('filters out blocks without type property', async () => {
      mockClient.pages.retrieve.mockResolvedValue({
        id: pageId,
        url: 'https://notion.so/page-123',
        properties: {},
      });

      mockClient.blocks.children.list.mockResolvedValue({
        results: [
          {
            type: 'paragraph',
            paragraph: { rich_text: [{ plain_text: 'Valid' }] },
          },
          // Invalid block without type
          { id: 'invalid' },
        ],
      });

      const result = await adapter.getPageWithPreview(token, pageId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.blocks).toHaveLength(1);
      }
    });
  });

  describe('createPromptVaultNote', () => {
    const token = 'valid-token';
    const parentPageId = 'parent-123';
    const title = 'New Note';
    const prompt = 'Note prompt content';
    const userId = 'user-123';

    it('creates page successfully with correct block structure', async () => {
      mockClient.pages.create.mockResolvedValue({
        id: 'new-page-123',
        url: 'https://notion.so/new-page-123',
      });

      const result = await adapter.createPromptVaultNote({
        token,
        parentPageId,
        title,
        prompt,
        userId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('new-page-123');
        expect(result.value.url).toBe('https://notion.so/new-page-123');
        expect(result.value.title).toBe(title);
      }

      // Verify the block structure passed to Notion
      expect(mockClient.pages.create).toHaveBeenCalledWith({
        parent: { page_id: parentPageId },
        properties: {
          title: {
            title: [{ text: { content: title } }],
          },
        },
        children: [
          {
            object: 'block',
            type: 'heading_2',
            heading_2: {
              rich_text: [{ type: 'text', text: { content: 'Prompt' } }],
            },
          },
          {
            object: 'block',
            type: 'code',
            code: {
              rich_text: [{ type: 'text', text: { content: prompt } }],
              language: 'markdown',
            },
          },
          {
            object: 'block',
            type: 'heading_2',
            heading_2: {
              rich_text: [{ type: 'text', text: { content: 'Meta' } }],
            },
          },
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ type: 'text', text: { content: 'Source: GPT PromptVault' } }],
            },
          },
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ type: 'text', text: { content: `UserId: ${userId}` } }],
            },
          },
        ],
      });
    });

    it('constructs URL when not provided', async () => {
      mockClient.pages.create.mockResolvedValue({
        id: 'new-page-456',
        // No 'url' property
      });

      const result = await adapter.createPromptVaultNote({
        token,
        parentPageId,
        title,
        prompt,
        userId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://notion.so/new-page-456');
      }
    });

    it('returns VALIDATION_ERROR for invalid input', async () => {
      mockClient.pages.create.mockRejectedValue(
        createNotionError(APIErrorCode.ValidationError, 'Invalid parent')
      );

      const result = await adapter.createPromptVaultNote({
        token,
        parentPageId: 'invalid-parent',
        title,
        prompt,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('returns VALIDATION_ERROR for invalid JSON', async () => {
      mockClient.pages.create.mockRejectedValue(
        createNotionError(APIErrorCode.InvalidJSON, 'Invalid JSON')
      );

      const result = await adapter.createPromptVaultNote({
        token,
        parentPageId,
        title,
        prompt,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('returns NOT_FOUND when parent page does not exist', async () => {
      mockClient.pages.create.mockRejectedValue(
        createNotionError(APIErrorCode.ObjectNotFound, 'Parent not found')
      );

      const result = await adapter.createPromptVaultNote({
        token,
        parentPageId: 'missing-parent',
        title,
        prompt,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns UNAUTHORIZED when token is invalid', async () => {
      mockClient.pages.create.mockRejectedValue(
        createNotionError(APIErrorCode.Unauthorized, 'Invalid token')
      );

      const result = await adapter.createPromptVaultNote({
        token,
        parentPageId,
        title,
        prompt,
        userId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('stores prompt verbatim without modification', async () => {
      mockClient.pages.create.mockResolvedValue({
        id: 'new-page-verbatim',
        url: 'https://notion.so/new-page-verbatim',
      });

      const verbatimPrompt = '  \n\n  Prompt with whitespace  \n\n  ';

      await adapter.createPromptVaultNote({
        token,
        parentPageId,
        title,
        prompt: verbatimPrompt,
        userId,
      });

      // Verify the exact prompt was passed
      const callArgs = mockClient.pages.create.mock.calls[0]?.[0] as {
        children: {
          type: string;
          code?: { rich_text: { text: { content: string } }[] };
        }[];
      };
      const codeBlock = callArgs.children.find((c) => c.type === 'code');
      expect(codeBlock?.code?.rich_text[0]?.text.content).toBe(verbatimPrompt);
    });
  });

  describe('error mapping', () => {
    it('maps unknown error codes to INTERNAL_ERROR', async () => {
      mockClient.users.me.mockRejectedValue(createNotionError('unknown_code', 'Unknown error'));

      const result = await adapter.validateToken('some-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('handles non-Error thrown values', async () => {
      mockClient.users.me.mockRejectedValue('string error');

      const result = await adapter.validateToken('some-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Unknown Notion API error');
      }
    });
  });

  describe('listChildPages', () => {
    it('returns list of child pages', async () => {
      mockClient.blocks.children.list.mockResolvedValue({
        results: [
          {
            id: 'page-1',
            type: 'child_page',
            child_page: { title: 'Page 1' },
          },
          {
            id: 'page-2',
            type: 'child_page',
            child_page: { title: 'Page 2' },
          },
        ],
      });

      const result = await adapter.listChildPages('token', 'parent-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.title).toBe('Page 1');
        expect(result.value[1]?.title).toBe('Page 2');
      }
    });

    it('returns empty list when no children', async () => {
      mockClient.blocks.children.list.mockResolvedValue({
        results: [],
      });

      const result = await adapter.listChildPages('token', 'parent-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('filters out non-child_page blocks', async () => {
      mockClient.blocks.children.list.mockResolvedValue({
        results: [
          { id: 'para-1', type: 'paragraph', paragraph: {} },
          {
            id: 'page-1',
            type: 'child_page',
            child_page: { title: 'Page 1' },
          },
          { id: 'heading-1', type: 'heading_1', heading_1: {} },
        ],
      });

      const result = await adapter.listChildPages('token', 'parent-id');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.title).toBe('Page 1');
      }
    });

    it('handles API errors', async () => {
      mockClient.blocks.children.list.mockRejectedValue(
        createNotionError(APIErrorCode.Unauthorized, 'Unauthorized')
      );

      const result = await adapter.listChildPages('token', 'parent-id');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });
  });

  describe('getPromptPage', () => {
    it('returns page with prompt content', async () => {
      mockClient.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        properties: {
          title: {
            type: 'title',
            title: [{ plain_text: 'My Prompt' }],
          },
        },
        url: 'https://notion.so/page-123',
        created_time: '2024-01-01T00:00:00.000Z',
        last_edited_time: '2024-01-02T00:00:00.000Z',
      });

      mockClient.blocks.children.list.mockResolvedValue({
        results: [
          {
            type: 'code',
            code: {
              rich_text: [{ plain_text: 'This is the prompt content' }],
            },
          },
        ],
      });

      const result = await adapter.getPromptPage('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.page.title).toBe('My Prompt');
        expect(result.value.promptContent).toBe('This is the prompt content');
        expect(result.value.createdAt).toBe('2024-01-01T00:00:00.000Z');
        expect(result.value.updatedAt).toBe('2024-01-02T00:00:00.000Z');
      }
    });

    it('returns empty promptContent when no code block', async () => {
      mockClient.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        properties: {
          title: {
            type: 'title',
            title: [{ plain_text: 'No Code' }],
          },
        },
        url: 'https://notion.so/page-123',
      });

      mockClient.blocks.children.list.mockResolvedValue({
        results: [{ type: 'paragraph', paragraph: {} }],
      });

      const result = await adapter.getPromptPage('token', 'page-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.promptContent).toBe('');
      }
    });

    it('returns NOT_FOUND error when page not found', async () => {
      mockClient.pages.retrieve.mockRejectedValue(
        createNotionError(APIErrorCode.ObjectNotFound, 'Page not found')
      );

      const result = await adapter.getPromptPage('token', 'nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns INTERNAL_ERROR when page has unexpected format', async () => {
      mockClient.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        // Missing properties
      });

      const result = await adapter.getPromptPage('token', 'page-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('updatePromptPage', () => {
    beforeEach(() => {
      // Add blocks.update mock
      (mockClient.blocks as unknown as { update: ReturnType<typeof vi.fn> }).update = vi.fn();
      (mockClient.pages as unknown as { update: ReturnType<typeof vi.fn> }).update = vi.fn();
    });

    it('updates title successfully', async () => {
      (
        mockClient.pages as unknown as { update: ReturnType<typeof vi.fn> }
      ).update.mockResolvedValue({});
      mockClient.blocks.children.list.mockResolvedValue({ results: [] });
      mockClient.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        properties: {
          title: {
            type: 'title',
            title: [{ plain_text: 'New Title' }],
          },
        },
        url: 'https://notion.so/page-123',
        last_edited_time: '2024-01-02T00:00:00.000Z',
      });

      const result = await adapter.updatePromptPage('token', 'page-123', {
        title: 'New Title',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.page.title).toBe('New Title');
      }
    });

    it('updates prompt content successfully', async () => {
      mockClient.blocks.children.list.mockResolvedValueOnce({
        results: [
          {
            id: 'code-block-id',
            type: 'code',
            code: { rich_text: [{ plain_text: 'Old content' }] },
          },
        ],
      });
      (
        mockClient.blocks as unknown as { update: ReturnType<typeof vi.fn> }
      ).update.mockResolvedValue({});
      mockClient.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        properties: {
          title: { type: 'title', title: [{ plain_text: 'Title' }] },
        },
        url: 'https://notion.so/page-123',
        last_edited_time: '2024-01-02T00:00:00.000Z',
      });
      mockClient.blocks.children.list.mockResolvedValueOnce({
        results: [
          {
            type: 'code',
            code: { rich_text: [{ plain_text: 'New content' }] },
          },
        ],
      });

      const result = await adapter.updatePromptPage('token', 'page-123', {
        promptContent: 'New content',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.promptContent).toBe('New content');
      }
    });

    it('returns NOT_FOUND when page not found', async () => {
      mockClient.pages.retrieve.mockRejectedValue(
        createNotionError(APIErrorCode.ObjectNotFound, 'Page not found')
      );

      const result = await adapter.updatePromptPage('token', 'nonexistent', {
        title: 'New Title',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('returns INTERNAL_ERROR when page has unexpected format', async () => {
      (
        mockClient.pages as unknown as { update: ReturnType<typeof vi.fn> }
      ).update.mockResolvedValue({});
      mockClient.blocks.children.list.mockResolvedValue({ results: [] });
      mockClient.pages.retrieve.mockResolvedValue({
        id: 'page-123',
        // Missing properties
      });

      const result = await adapter.updatePromptPage('token', 'page-123', {
        title: 'New Title',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });
});
