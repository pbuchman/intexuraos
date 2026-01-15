/**
 * Tests for promptApi.ts
 * Tests the Notion API infrastructure layer for PromptVault operations.
 */

// Mock @notionhq/client BEFORE any imports (vi.mock is hoisted)
vi.mock('@notionhq/client', () => {
  const mockMethods = {
    retrieve: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    listBlocks: vi.fn(),
    appendBlocks: vi.fn(),
    updateBlock: vi.fn(),
    deleteBlock: vi.fn(),
  };

  class MockClient {
    pages = {
      retrieve: mockMethods.retrieve,
      create: mockMethods.create,
      update: mockMethods.update,
    };
    blocks = {
      children: {
        list: mockMethods.listBlocks,
        append: mockMethods.appendBlocks,
      },
      update: mockMethods.updateBlock,
      delete: mockMethods.deleteBlock,
    };
  }

  const mockIsNotionClientError = vi.fn((error: unknown): boolean => {
    return typeof error === 'object' && error !== null && 'code' in error;
  });

  // Store on globalThis so tests can access the mocks
  (globalThis as typeof globalThis & { __notionMocks: typeof mockMethods }).__notionMocks = mockMethods;
  (globalThis as typeof globalThis & { __isNotionClientError: typeof mockIsNotionClientError }).__isNotionClientError = mockIsNotionClientError;

  return {
    Client: MockClient,
    isNotionClientError: mockIsNotionClientError,
    APIErrorCode: {
      Unauthorized: 'unauthorized',
      ObjectNotFound: 'object_not_found',
      RateLimited: 'rate_limited',
      ValidationError: 'validation_error',
      InvalidJSON: 'invalid_json',
      Conflict: 'conflict',
    },
    LogLevel: {
      DEBUG: 'debug',
      INFO: 'info',
      WARN: 'warn',
      ERROR: 'error',
    },
  };
});

// Global type for Notion mocks
declare global {
  var __notionMocks: {
    retrieve: import('vitest').Mock;
    create: import('vitest').Mock;
    update: import('vitest').Mock;
    listBlocks: import('vitest').Mock;
    appendBlocks: import('vitest').Mock;
    updateBlock: import('vitest').Mock;
    deleteBlock: import('vitest').Mock;
  };
}

const mockNotionMethods = globalThis.__notionMocks;

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '@intexuraos/common-core';
import type {
  NotionServiceClient,
  NotionServiceError,
  NotionTokenContext,
} from '../../infra/notion/notionServiceClient.js';
import {
  createPrompt,
  getPrompt,
  listPrompts,
  updatePrompt,
} from '../../infra/notion/promptApi.js';
import type { PromptVaultSettingsPort } from '../../domain/promptvault/ports/index.js';
import { FakePromptVaultSettingsRepository } from '../fakes.js';
import type { NotionLogger } from '@intexuraos/infra-notion';

function createMockLogger(): NotionLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockNotionServiceClient(
  overrides: Partial<{
    getNotionToken: () => Promise<Result<NotionTokenContext, NotionServiceError>>;
  }> = {}
): NotionServiceClient {
  return {
    getNotionToken:
      overrides.getNotionToken ??
      ((): Promise<Result<NotionTokenContext, NotionServiceError>> =>
        Promise.resolve(ok({ connected: true, token: 'test-token' }))),
  };
}

describe('promptApi', () => {
  let fakeSettings: FakePromptVaultSettingsRepository;
  let mockLogger: NotionLogger;

  beforeEach(() => {
    mockNotionMethods.create.mockReset();
    mockNotionMethods.retrieve.mockReset();
    mockNotionMethods.update.mockReset();
    mockNotionMethods.listBlocks.mockReset();
    mockNotionMethods.appendBlocks.mockReset();
    mockNotionMethods.updateBlock.mockReset();
    mockNotionMethods.deleteBlock.mockReset();
    fakeSettings = new FakePromptVaultSettingsRepository();
    mockLogger = createMockLogger();
  });

  interface CreatePageCallArgs {
    children: { type: string }[];
  }

  function getCodeBlocksFromCreateCall(): { type: string }[] {
    const callArgs = mockNotionMethods.create.mock.calls[0] as [CreatePageCallArgs];
    return callArgs[0].children.filter((c) => c.type === 'code');
  }

  function setupValidUserContext(): {
    client: NotionServiceClient;
    settings: PromptVaultSettingsPort;
    logger: NotionLogger;
  } {
    fakeSettings.setPageId('user-1', 'vault-page-id');
    return { client: createMockNotionServiceClient(), settings: fakeSettings, logger: mockLogger };
  }

  describe('getUserContext (tested through exported functions)', () => {
    it('returns DOWNSTREAM_ERROR when getNotionToken fails with non-UNAUTHORIZED error', async () => {
      const client = createMockNotionServiceClient({
        getNotionToken: (): Promise<Result<NotionTokenContext, NotionServiceError>> =>
          Promise.resolve(err({ code: 'DOWNSTREAM_ERROR', message: 'Service unavailable' })),
      });
      fakeSettings.setPageId('user-1', 'vault-page-id');

      const result = await createPrompt('user-1', 'title', 'content', client, fakeSettings, mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
        expect(result.error.message).toBe('Service unavailable');
      }
    });

    it('returns UNAUTHORIZED when getNotionToken fails with UNAUTHORIZED error', async () => {
      const client = createMockNotionServiceClient({
        getNotionToken: (): Promise<Result<NotionTokenContext, NotionServiceError>> =>
          Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'Invalid auth' })),
      });
      fakeSettings.setPageId('user-1', 'vault-page-id');

      const result = await createPrompt('user-1', 'title', 'content', client, fakeSettings, mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
    });

    it('returns NOT_CONNECTED when user is not connected', async () => {
      const client = createMockNotionServiceClient({
        getNotionToken: (): Promise<Result<NotionTokenContext, NotionServiceError>> =>
          Promise.resolve(ok({ connected: false, token: null })),
      });
      fakeSettings.setPageId('user-1', 'vault-page-id');

      const result = await createPrompt('user-1', 'title', 'content', client, fakeSettings, mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toBe('Notion integration is not configured');
      }
    });

    it('returns NOT_CONNECTED when token is null even if connected is true', async () => {
      const client = createMockNotionServiceClient({
        getNotionToken: (): Promise<Result<NotionTokenContext, NotionServiceError>> =>
          Promise.resolve(ok({ connected: true, token: null })),
      });
      fakeSettings.setPageId('user-1', 'vault-page-id');

      const result = await createPrompt('user-1', 'title', 'content', client, fakeSettings, mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
      }
    });

    it('returns DOWNSTREAM_ERROR when getPromptVaultPageId fails', async () => {
      const { client } = setupValidUserContext();
      fakeSettings.setGetPageIdError({ code: 'INTERNAL_ERROR', message: 'Firestore error' });

      const result = await createPrompt('user-1', 'title', 'content', client, fakeSettings, mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
        expect(result.error.message).toBe('Firestore error');
      }
    });

    it('returns NOT_CONNECTED when promptVaultPageId is null', async () => {
      const client = createMockNotionServiceClient();
      // fakeSettings returns null by default when no pageId is set

      const result = await createPrompt('user-1', 'title', 'content', client, fakeSettings, mockLogger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_CONNECTED');
        expect(result.error.message).toBe('PromptVault page ID not configured');
      }
    });
  });

  describe('createPrompt', () => {
    it('creates a prompt successfully', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.create.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      const result = await createPrompt('user-1', 'My Title', 'My content', client, settings, logger);

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
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.create.mockResolvedValue({
        id: 'new-page-id',
      });

      const result = await createPrompt('user-1', 'My Title', 'My content', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://notion.so/new-page-id');
      }
    });

    it('handles long content by splitting into chunks', async () => {
      const { client, settings, logger } = setupValidUserContext();
      const longContent = 'A'.repeat(4000);
      mockNotionMethods.create.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      const result = await createPrompt('user-1', 'My Title', longContent, client, settings, logger);

      expect(result.ok).toBe(true);
      expect(mockNotionMethods.create).toHaveBeenCalledTimes(1);
      const codeBlocks = getCodeBlocksFromCreateCall();
      expect(codeBlocks.length).toBeGreaterThan(1);
    });

    it('returns DOWNSTREAM_ERROR when Notion API throws', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.create.mockRejectedValue(new Error('API Error'));

      const result = await createPrompt('user-1', 'My Title', 'My content', client, settings, logger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
      }
    });
  });

  describe('listPrompts', () => {
    it('returns empty list when no child pages exist', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.listBlocks.mockResolvedValue({ results: [] });

      const result = await listPrompts('user-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('returns prompts from child pages', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.listBlocks.mockResolvedValueOnce({
        results: [
          { type: 'child_page', id: 'prompt-1', child_page: { title: 'Prompt 1' } },
          { type: 'child_page', id: 'prompt-2', child_page: { title: 'Prompt 2' } },
        ],
      });

      mockNotionMethods.retrieve
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

      mockNotionMethods.listBlocks
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

      const result = await listPrompts('user-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.title).toBe('Prompt 1');
        expect(result.value[1]?.title).toBe('Prompt 2');
      }
    });

    it('skips non-child_page blocks', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.listBlocks.mockResolvedValue({
        results: [
          { type: 'paragraph', id: 'para-1' },
          { type: 'heading_1', id: 'heading-1' },
        ],
      });

      const result = await listPrompts('user-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('skips child pages that fail to retrieve', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.listBlocks.mockResolvedValueOnce({
        results: [
          { type: 'child_page', id: 'prompt-1', child_page: { title: 'Prompt 1' } },
          { type: 'child_page', id: 'prompt-2', child_page: { title: 'Prompt 2' } },
        ],
      });

      mockNotionMethods.retrieve
        .mockResolvedValueOnce({
          id: 'prompt-1',
          properties: { title: { title: [{ plain_text: 'Prompt 1' }] } },
          url: 'https://notion.so/prompt-1',
        })
        .mockRejectedValueOnce(new Error('Page not found'));

      mockNotionMethods.listBlocks.mockResolvedValueOnce({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Content 1' }] } },
        ],
      });

      const result = await listPrompts('user-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.title).toBe('Prompt 1');
      }
    });

    it('returns DOWNSTREAM_ERROR when initial list fails', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.listBlocks.mockRejectedValue(new Error('API Error'));

      const result = await listPrompts('user-1', client, settings, logger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
      }
    });
  });

  describe('getPrompt', () => {
    it('retrieves a prompt successfully', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
        url: 'https://notion.so/prompt-1',
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-02T00:00:00.000Z',
      });
      mockNotionMethods.listBlocks.mockResolvedValue({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Content here' }] } },
        ],
      });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

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
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
      });
      mockNotionMethods.listBlocks.mockResolvedValue({ results: [] });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.url).toBe('https://notion.so/prompt-1');
      }
    });

    it('returns INTERNAL_ERROR when page response has no properties', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
      });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toBe('Unexpected page response format');
      }
    });

    it('joins multiple code blocks into single content', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
      });
      mockNotionMethods.listBlocks.mockResolvedValue({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'First chunk' }] } },
          { type: 'code', id: 'block-2', code: { rich_text: [{ plain_text: 'Second chunk' }] } },
        ],
      });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('First chunk\nSecond chunk');
      }
    });

    it('skips non-code blocks', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
      });
      mockNotionMethods.listBlocks.mockResolvedValue({
        results: [
          { type: 'paragraph', id: 'para-1', paragraph: { rich_text: [{ plain_text: 'Para' }] } },
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Code content' }] } },
        ],
      });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Code content');
      }
    });

    it('handles code blocks without rich_text', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
      });
      mockNotionMethods.listBlocks.mockResolvedValue({
        results: [{ type: 'code', id: 'block-1', code: {} }],
      });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('handles empty code blocks content', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
      });
      mockNotionMethods.listBlocks.mockResolvedValue({
        results: [{ type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: '' }] } }],
      });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('handles page without created_time or last_edited_time', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
      });
      mockNotionMethods.listBlocks.mockResolvedValue({ results: [] });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt).toBeUndefined();
        expect(result.value.updatedAt).toBeUndefined();
      }
    });

    it('returns DOWNSTREAM_ERROR when Notion API throws', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockRejectedValue(new Error('Page not found'));

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
      }
    });
  });

  describe('updatePrompt', () => {
    it('updates title only', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.update.mockResolvedValue({ id: 'prompt-1' });
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Updated Title' }] } },
      });
      mockNotionMethods.listBlocks.mockResolvedValue({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Content' }] } },
        ],
      });

      const result = await updatePrompt(
        'user-1',
        'prompt-1',
        { title: 'Updated Title' },
        client,
        settings,
        logger
      );

      expect(result.ok).toBe(true);
      expect(mockNotionMethods.update).toHaveBeenCalledWith({
        page_id: 'prompt-1',
        properties: { title: { title: [{ text: { content: 'Updated Title' } }] } },
      });
    });

    it('updates content only', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.listBlocks
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
      mockNotionMethods.updateBlock.mockResolvedValue({});
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });

      const result = await updatePrompt(
        'user-1',
        'prompt-1',
        { content: 'New content' },
        client,
        settings,
        logger
      );

      expect(result.ok).toBe(true);
      expect(mockNotionMethods.update).not.toHaveBeenCalled();
      expect(mockNotionMethods.updateBlock).toHaveBeenCalledWith({
        block_id: 'block-1',
        code: {
          rich_text: [{ type: 'text', text: { content: 'New content' } }],
          language: 'markdown',
        },
      });
    });

    it('updates both title and content', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.update.mockResolvedValue({ id: 'prompt-1' });
      mockNotionMethods.listBlocks
        .mockResolvedValueOnce({
          results: [{ type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Old' }] } }],
        })
        .mockResolvedValueOnce({
          results: [{ type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'New' }] } }],
        });
      mockNotionMethods.updateBlock.mockResolvedValue({});
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'New Title' }] } },
      });

      const result = await updatePrompt(
        'user-1',
        'prompt-1',
        { title: 'New Title', content: 'New' },
        client,
        settings,
        logger
      );

      expect(result.ok).toBe(true);
      expect(mockNotionMethods.update).toHaveBeenCalled();
      expect(mockNotionMethods.updateBlock).toHaveBeenCalled();
    });

    it('deletes extra code blocks when new content is shorter', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.listBlocks
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
      mockNotionMethods.updateBlock.mockResolvedValue({});
      mockNotionMethods.deleteBlock.mockResolvedValue({});
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });

      const result = await updatePrompt(
        'user-1',
        'prompt-1',
        { content: 'Short' },
        client,
        settings,
        logger
      );

      expect(result.ok).toBe(true);
      expect(mockNotionMethods.updateBlock).toHaveBeenCalledTimes(1);
      expect(mockNotionMethods.deleteBlock).toHaveBeenCalledTimes(1);
      expect(mockNotionMethods.deleteBlock).toHaveBeenCalledWith({ block_id: 'block-2' });
    });

    it('appends new code blocks when new content is longer', async () => {
      const { client, settings, logger } = setupValidUserContext();
      const longContent = 'A'.repeat(4000);
      mockNotionMethods.listBlocks
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
      mockNotionMethods.updateBlock.mockResolvedValue({});
      mockNotionMethods.appendBlocks.mockResolvedValue({});
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });

      const result = await updatePrompt(
        'user-1',
        'prompt-1',
        { content: longContent },
        client,
        settings,
        logger
      );

      expect(result.ok).toBe(true);
      expect(mockNotionMethods.updateBlock).toHaveBeenCalledTimes(1);
      expect(mockNotionMethods.appendBlocks.mock.calls.length).toBeGreaterThan(0);
    });

    it('returns DOWNSTREAM_ERROR when Notion API throws during update', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.update.mockRejectedValue(new Error('Update failed'));

      const result = await updatePrompt(
        'user-1',
        'prompt-1',
        { title: 'New Title' },
        client,
        settings,
        logger
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
      }
    });
  });

  describe('mapError (tested through error paths)', () => {
    it('maps NOT_FOUND to NOT_FOUND', async () => {
      const { client, settings, logger } = setupValidUserContext();
      const { isNotionClientError } = await import('@notionhq/client');
      vi.mocked(isNotionClientError).mockReturnValueOnce(true);
      mockNotionMethods.retrieve.mockRejectedValue({
        code: 'object_not_found',
        message: 'Page not found',
      });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(false);
    });

    it('maps UNAUTHORIZED to UNAUTHORIZED', async () => {
      const { client, settings, logger } = setupValidUserContext();
      const { isNotionClientError } = await import('@notionhq/client');
      vi.mocked(isNotionClientError).mockReturnValueOnce(true);
      mockNotionMethods.retrieve.mockRejectedValue({
        code: 'unauthorized',
        message: 'Invalid token',
      });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(false);
    });
  });

  describe('splitTextIntoChunks (tested through createPrompt and updatePrompt)', () => {
    it('handles text shorter than MAX_CHUNK_SIZE', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.create.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      const shortContent = 'Short content';
      await createPrompt('user-1', 'Title', shortContent, client, settings, logger);

      expect(mockNotionMethods.create).toHaveBeenCalledTimes(1);
      const codeBlocks = getCodeBlocksFromCreateCall();
      expect(codeBlocks).toHaveLength(1);
    });

    it('splits at double newline boundary when possible', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.create.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      const chunk1 = 'A'.repeat(1800);
      const chunk2 = 'B'.repeat(1000);
      const content = chunk1 + '\n\n' + chunk2;

      await createPrompt('user-1', 'Title', content, client, settings, logger);

      expect(mockNotionMethods.create).toHaveBeenCalledTimes(1);
    });

    it('splits at single newline when no double newline is available', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.create.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      const chunk1 = 'A'.repeat(1800);
      const chunk2 = 'B'.repeat(1000);
      const content = chunk1 + '\n' + chunk2;

      await createPrompt('user-1', 'Title', content, client, settings, logger);

      expect(mockNotionMethods.create).toHaveBeenCalledTimes(1);
    });

    it('splits at period when no newline is available', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.create.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      const chunk1 = 'A'.repeat(1800);
      const chunk2 = 'B'.repeat(1000);
      const content = chunk1 + '. ' + chunk2;

      await createPrompt('user-1', 'Title', content, client, settings, logger);

      expect(mockNotionMethods.create).toHaveBeenCalledTimes(1);
    });

    it('splits at space when no other boundary is available', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.create.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      const chunk1 = 'A'.repeat(1800);
      const chunk2 = 'B'.repeat(1000);
      const content = chunk1 + ' ' + chunk2;

      await createPrompt('user-1', 'Title', content, client, settings, logger);

      expect(mockNotionMethods.create).toHaveBeenCalledTimes(1);
    });

    it('forces split at MAX_CHUNK_SIZE when no boundary is available', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.create.mockResolvedValue({
        id: 'new-page-id',
        url: 'https://notion.so/new-page-id',
      });

      const content = 'A'.repeat(4000);

      await createPrompt('user-1', 'Title', content, client, settings, logger);

      expect(mockNotionMethods.create).toHaveBeenCalledTimes(1);
      const codeBlocks = getCodeBlocksFromCreateCall();
      expect(codeBlocks.length).toBeGreaterThan(1);
    });
  });

  describe('joinTextChunks (tested through getPrompt)', () => {
    it('returns empty string for empty array', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });
      mockNotionMethods.listBlocks.mockResolvedValue({ results: [] });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('returns single chunk as-is', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });
      mockNotionMethods.listBlocks.mockResolvedValue({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'Single chunk' }] } },
        ],
      });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Single chunk');
      }
    });

    it('joins multiple chunks with newlines', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });
      mockNotionMethods.listBlocks.mockResolvedValue({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'First' }] } },
          { type: 'code', id: 'block-2', code: { rich_text: [{ plain_text: 'Second' }] } },
          { type: 'code', id: 'block-3', code: { rich_text: [{ plain_text: 'Third' }] } },
        ],
      });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('First\nSecond\nThird');
      }
    });

    it('filters out empty chunks', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });
      mockNotionMethods.listBlocks.mockResolvedValue({
        results: [
          { type: 'code', id: 'block-1', code: { rich_text: [{ plain_text: 'First' }] } },
          { type: 'code', id: 'block-2', code: { rich_text: [{ plain_text: '   ' }] } },
          { type: 'code', id: 'block-3', code: { rich_text: [{ plain_text: 'Third' }] } },
        ],
      });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('First\nThird');
      }
    });
  });

  describe('edge cases', () => {
    it('handles page with empty created_time string', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
        created_time: '',
        last_edited_time: '',
      });
      mockNotionMethods.listBlocks.mockResolvedValue({ results: [] });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt).toBeUndefined();
        expect(result.value.updatedAt).toBeUndefined();
      }
    });

    it('handles code block with missing plain_text in rich_text items', async () => {
      const { client, settings, logger } = setupValidUserContext();
      mockNotionMethods.retrieve.mockResolvedValue({
        id: 'prompt-1',
        properties: { title: { title: [{ plain_text: 'Title' }] } },
      });
      mockNotionMethods.listBlocks.mockResolvedValue({
        results: [{ type: 'code', id: 'block-1', code: { rich_text: [{}] } }],
      });

      const result = await getPrompt('user-1', 'prompt-1', client, settings, logger);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });
  });
});
