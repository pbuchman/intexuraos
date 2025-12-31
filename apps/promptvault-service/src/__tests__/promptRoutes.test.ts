/**
 * Tests for prompt CRUD routes:
 * - GET /prompt-vault/main-page
 * - GET /prompt-vault/prompts
 * - POST /prompt-vault/prompts
 * - GET /prompt-vault/prompts/:prompt_id
 * - PATCH /prompt-vault/prompts/:prompt_id
 */
import {
  beforeEach,
  createToken,
  describe,
  expect,
  it,
  setupTestContext,
  type TestContext,
} from './testUtils.js';
import { vi } from 'vitest';
import { ok } from '@intexuraos/common-core';
import { FakeNotionServiceClient } from './fakes.js';

// Mock Notion Client - must be defined at top level
const mockNotionMethods = {
  retrieve: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  listBlocks: vi.fn(),
  appendBlocks: vi.fn(),
  updateBlock: vi.fn(),
  deleteBlock: vi.fn(),
};

vi.mock('@notionhq/client', () => {
  // Define class inside factory to avoid hoisting issues
  class MockClient {
    pages = {
      retrieve: mockNotionMethods.retrieve,
      create: mockNotionMethods.create,
      update: mockNotionMethods.update,
    };
    blocks = {
      children: {
        list: mockNotionMethods.listBlocks,
        append: mockNotionMethods.appendBlocks,
      },
      update: mockNotionMethods.updateBlock,
      delete: mockNotionMethods.deleteBlock,
    };
  }

  // Mock for isNotionClientError - check if error has 'code' property
  const mockIsNotionClientError = vi.fn((error: unknown): boolean => {
    return typeof error === 'object' && error !== null && 'code' in error;
  });

  return {
    Client: MockClient,
    isNotionClientError: mockIsNotionClientError,
    APIErrorCode: {
      Unauthorized: 'unauthorized',
      ObjectNotFound: 'object_not_found',
    },
    LogLevel: {
      DEBUG: 'debug',
    },
  };
});

// Mock promptVaultSettingsRepository
const mockGetPromptVaultPageId = vi.fn();
vi.mock('../infra/firestore/promptVaultSettingsRepository.js', () => ({
  getPromptVaultPageId: (...args: unknown[]): unknown => mockGetPromptVaultPageId(...args),
  savePromptVaultPageId: vi.fn(),
}));

/**
 * Helper to set up a Notion connection directly through fakes.
 * Sets up token via FakeNotionServiceClient and pageId via mocked promptVaultSettingsRepository.
 */
async function setupConnection(
  ctx: TestContext,
  userId: string,
  pageId = 'vault-page-id'
): Promise<void> {
  // Set up token context in FakeNotionServiceClient
  const fakeClient = ctx.notionServiceClient as FakeNotionServiceClient;
  fakeClient.setTokenContext(userId, { connected: true, token: 'secret-token' });

  // Mock promptVaultPageId response
  mockGetPromptVaultPageId.mockImplementation(async (uid: string) => {
    if (uid === userId) {
      return ok(pageId);
    }
    return ok(null);
  });

  // Set up Notion API mocks for the page
  const pageTitle = pageId === 'vault-page-id' ? 'Prompt Vault' : 'Test Page';
  mockNotionMethods.retrieve.mockImplementation(async (args: { page_id: string }) => {
    if (args.page_id === pageId) {
      return {
        id: pageId,
        properties: {
          title: {
            title: [{ plain_text: pageTitle }],
          },
        },
        url: `https://notion.so/${pageId}`,
        created_time: '2025-01-01T00:00:00.000Z',
        last_edited_time: '2025-01-01T00:00:00.000Z',
      };
    }
    throw new Error('Page not found');
  });

  mockNotionMethods.listBlocks.mockImplementation(async (args: { block_id: string }) => {
    if (args.block_id === pageId) {
      return {
        results: [
          {
            type: 'paragraph',
            id: 'block-1',
            paragraph: { rich_text: [{ plain_text: 'Block 1' }] },
          },
          {
            type: 'paragraph',
            id: 'block-2',
            paragraph: { rich_text: [{ plain_text: 'Block 2' }] },
          },
          {
            type: 'paragraph',
            id: 'block-3',
            paragraph: { rich_text: [{ plain_text: 'Block 3' }] },
          },
          {
            type: 'paragraph',
            id: 'block-4',
            paragraph: { rich_text: [{ plain_text: 'Block 4' }] },
          },
        ],
      };
    }
    return { results: [] };
  });
}

describe('Prompt Routes', () => {
  const ctx = setupTestContext();

  beforeEach(() => {
    mockGetPromptVaultPageId.mockReset();
    // Reset all Notion Client mocks
    mockNotionMethods.retrieve.mockReset();
    mockNotionMethods.create.mockReset();
    mockNotionMethods.update.mockReset();
    mockNotionMethods.listBlocks.mockReset();
    mockNotionMethods.appendBlocks.mockReset();
    mockNotionMethods.updateBlock.mockReset();
    mockNotionMethods.deleteBlock.mockReset();
  });

  describe('GET /prompt-vault/main-page', () => {
    it('fails with UNAUTHORIZED when Authorization header is missing', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/main-page',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-main' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/main-page',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('returns page preview when connected', async () => {
      const token = await createToken({ sub: 'user-preview' });

      // Set up connection directly through repository
      await setupConnection(ctx, 'user-preview');

      // Then get main page
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/main-page',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          page: { id: string; title: string; url: string };
          preview: { blocks: unknown[] };
        };
        diagnostics: { requestId: string; durationMs: number };
      };
      expect(body.success).toBe(true);
      expect(body.data.page.id).toBe('vault-page-id');
      expect(body.data.page.title).toBe('Prompt Vault');
      expect(body.data.preview.blocks).toHaveLength(4);
      expect(body.diagnostics.requestId).toBeDefined();
      expect(body.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('fails with MISCONFIGURED when token not found', async () => {
      const token = await createToken({ sub: 'user-no-token' });

      // Set up token context with null token
      const fakeClient = ctx.notionServiceClient as FakeNotionServiceClient;
      fakeClient.setTokenContext('user-no-token', { connected: true, token: null });
      mockGetPromptVaultPageId.mockResolvedValueOnce(ok('vault-page-id'));

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/main-page',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('fails with DOWNSTREAM_ERROR when getNotionToken fails', async () => {
      const token = await createToken({ sub: 'user-token-error' });

      // Inject error for getNotionToken
      const fakeClient = ctx.notionServiceClient as FakeNotionServiceClient;
      fakeClient.setGetNotionTokenError({
        code: 'DOWNSTREAM_ERROR',
        message: 'notion-service returned 500: Internal Server Error',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/main-page',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('fails with DOWNSTREAM_ERROR when getPromptVaultPageId fails', async () => {
      const token = await createToken({ sub: 'user-pageid-error' });

      // Set up token
      const fakeClient = ctx.notionServiceClient as FakeNotionServiceClient;
      fakeClient.setTokenContext('user-pageid-error', { connected: true, token: 'secret-token' });

      // Inject error for getPromptVaultPageId
      mockGetPromptVaultPageId.mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get prompt vault page ID: Database error',
        },
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/main-page',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('fails with DOWNSTREAM_ERROR when Notion API fails', async () => {
      const token = await createToken({ sub: 'user-notion-error' });

      // Set up connection
      await setupConnection(ctx, 'user-notion-error');

      // Override retrieve mock to throw rate limit error
      mockNotionMethods.retrieve.mockRejectedValueOnce({
        code: 'rate_limited',
        message: 'Rate limited by Notion API',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/main-page',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('fails with UNAUTHORIZED when notionServiceClient returns UNAUTHORIZED', async () => {
      const token = await createToken({ sub: 'user-unauthorized' });

      // Inject UNAUTHORIZED error
      const fakeClient = ctx.notionServiceClient as FakeNotionServiceClient;
      fakeClient.setGetNotionTokenError({
        code: 'UNAUTHORIZED',
        message: 'Internal auth failed when calling notion-service',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/main-page',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('fails with MISCONFIGURED when promptVaultPageId not found', async () => {
      const token = await createToken({ sub: 'user-pageid-not-found' });

      // Set up token
      const fakeClient = ctx.notionServiceClient as FakeNotionServiceClient;
      fakeClient.setTokenContext('user-pageid-not-found', {
        connected: true,
        token: 'secret-token',
      });

      // Mock promptVaultPageId as null
      mockGetPromptVaultPageId.mockResolvedValueOnce(ok(null));

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/main-page',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
      expect(body.error.message).toBe('PromptVault page ID not configured');
    });
  });

  describe('GET /prompt-vault/prompts (listPrompts)', () => {
    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-list-prompts' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/prompts',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('returns empty list when connected but no prompts exist', async () => {
      const token = await createToken({ sub: 'user-empty-list' });

      // Set up connection directly through repository
      await setupConnection(ctx, 'user-empty-list', 'page-id');

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/prompts',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { prompts: unknown[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.prompts).toHaveLength(0);
    });

    it('returns list of prompts when they exist', async () => {
      const token = await createToken({ sub: 'user-list-with-prompts' });

      // Set up connection directly through repository
      await setupConnection(ctx, 'user-list-with-prompts', 'vault-page');

      // Mock listBlocks to return child_page blocks
      mockNotionMethods.listBlocks.mockResolvedValueOnce({
        results: [
          {
            type: 'child_page',
            id: 'prompt-1',
            child_page: { title: 'First Prompt' },
          },
          {
            type: 'child_page',
            id: 'prompt-2',
            child_page: { title: 'Second Prompt' },
          },
        ],
      });

      // Mock retrieve for each prompt page
      mockNotionMethods.retrieve
        .mockResolvedValueOnce({
          id: 'prompt-1',
          properties: { title: { title: [{ plain_text: 'First Prompt' }] } },
          url: 'https://notion.so/prompt-1',
        })
        .mockResolvedValueOnce({
          id: 'prompt-2',
          properties: { title: { title: [{ plain_text: 'Second Prompt' }] } },
          url: 'https://notion.so/prompt-2',
        });

      // Mock listBlocks for prompt content (must be 'code' blocks)
      mockNotionMethods.listBlocks
        .mockResolvedValueOnce({
          results: [
            {
              type: 'code',
              id: 'b1',
              code: { rich_text: [{ plain_text: 'Content of first prompt' }] },
            },
          ],
        })
        .mockResolvedValueOnce({
          results: [
            {
              type: 'code',
              id: 'b2',
              code: { rich_text: [{ plain_text: 'Content of second prompt' }] },
            },
          ],
        });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/prompts',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          prompts: {
            id: string;
            title: string;
            prompt: string;
            url: string;
          }[];
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.prompts).toHaveLength(2);
      expect(body.data.prompts[0]?.title).toBe('First Prompt');
      expect(body.data.prompts[0]?.prompt).toBe('Content of first prompt');
      expect(body.data.prompts[1]?.title).toBe('Second Prompt');
      expect(body.data.prompts[1]?.prompt).toBe('Content of second prompt');
    });

    it('fails with DOWNSTREAM_ERROR when getNotionToken fails', async () => {
      const token = await createToken({ sub: 'user-list-token-error' });

      // Inject error for getNotionToken
      const fakeClient = ctx.notionServiceClient as FakeNotionServiceClient;
      fakeClient.setGetNotionTokenError({
        code: 'DOWNSTREAM_ERROR',
        message: 'notion-service returned 503: Service Unavailable',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/prompts',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });
  });

  describe('POST /prompt-vault/prompts (createPrompt)', () => {
    it('fails with UNAUTHORIZED when Authorization header is missing', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/prompt-vault/prompts',
        payload: {
          title: 'Test Prompt',
          prompt: 'Test prompt content',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-create-prompt' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/prompt-vault/prompts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Test Prompt',
          prompt: 'Test prompt content',
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('creates prompt successfully', async () => {
      const token = await createToken({ sub: 'user-create-prompt-success' });

      // Set up connection directly through repository
      await setupConnection(ctx, 'user-create-prompt-success', 'page-id');

      // Mock create to return a new page (children are included in create call)
      const createdPageId = 'new-prompt-123';
      mockNotionMethods.create.mockResolvedValueOnce({
        id: createdPageId,
        properties: { title: { title: [{ plain_text: 'My New Prompt' }] } },
        url: `https://notion.so/${createdPageId}`,
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/prompt-vault/prompts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'My New Prompt',
          prompt: 'This is my prompt content',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          prompt: { id: string; title: string; prompt: string };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.prompt.id).toBe(createdPageId);
      expect(body.data.prompt.title).toBe('My New Prompt');
      expect(body.data.prompt.prompt).toBe('This is my prompt content');
    });

    it('rejects requests with missing title', async () => {
      const token = await createToken({ sub: 'user-missing-title' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/prompt-vault/prompts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects requests with missing prompt', async () => {
      const token = await createToken({ sub: 'user-missing-prompt' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/prompt-vault/prompts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Test Title',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects title exceeding max length (200 chars)', async () => {
      const token = await createToken({ sub: 'user-long-title' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/prompt-vault/prompts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'x'.repeat(201),
          prompt: 'Test prompt',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects requests with extra properties (strict mode)', async () => {
      const token = await createToken({ sub: 'user-extra-props' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/prompt-vault/prompts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Valid Title',
          prompt: 'Valid prompt',
          extraField: 'should not be allowed',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects prompt exceeding max length (100,000 chars)', async () => {
      const token = await createToken({ sub: 'user-long-prompt' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/prompt-vault/prompts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Valid Title',
          prompt: 'x'.repeat(100001),
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('fails with DOWNSTREAM_ERROR when getNotionToken fails during create', async () => {
      const token = await createToken({ sub: 'user-create-token-error' });

      // Inject error for getNotionToken
      const fakeClient = ctx.notionServiceClient as FakeNotionServiceClient;
      fakeClient.setGetNotionTokenError({
        code: 'DOWNSTREAM_ERROR',
        message: 'notion-service connection timeout',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/prompt-vault/prompts',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Test Prompt',
          prompt: 'Test content',
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });
  });

  describe('GET /prompt-vault/prompts/:prompt_id (getPrompt)', () => {
    it('fails with UNAUTHORIZED when Authorization header is missing', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/prompts/some-prompt-id',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-get-prompt' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/prompts/some-prompt-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('returns NOT_FOUND for non-existent prompt', async () => {
      const token = await createToken({ sub: 'user-get-nonexistent' });

      // Set up connection directly through repository
      await setupConnection(ctx, 'user-get-nonexistent', 'page-id');

      // Mock retrieve to throw object_not_found error
      const notFoundError = {
        code: 'object_not_found',
        message: 'Could not find page with ID: nonexistent-id',
      };
      mockNotionMethods.retrieve.mockRejectedValueOnce(notFoundError);

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/prompts/nonexistent-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns prompt successfully when it exists', async () => {
      const token = await createToken({ sub: 'user-get-success' });

      // Set up connection directly through repository
      await setupConnection(ctx, 'user-get-success', 'page-id');

      // Mock retrieve to return the prompt page
      mockNotionMethods.retrieve.mockResolvedValueOnce({
        id: 'existing-prompt-id',
        properties: { title: { title: [{ plain_text: 'My Prompt' }] } },
        url: 'https://notion.so/existing-prompt-id',
      });

      // Mock listBlocks to return the prompt content (must be 'code' blocks)
      mockNotionMethods.listBlocks.mockResolvedValueOnce({
        results: [
          {
            type: 'code',
            id: 'block-1',
            code: { rich_text: [{ plain_text: 'This is the prompt content' }] },
          },
        ],
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/prompt-vault/prompts/existing-prompt-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          prompt: {
            id: string;
            title: string;
            prompt: string;
            url: string;
          };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.prompt.id).toBe('existing-prompt-id');
      expect(body.data.prompt.title).toBe('My Prompt');
      expect(body.data.prompt.prompt).toBe('This is the prompt content');
      expect(body.data.prompt.url).toBe('https://notion.so/existing-prompt-id');
    });
  });

  describe('PATCH /prompt-vault/prompts/:prompt_id (updatePrompt)', () => {
    it('fails with UNAUTHORIZED when Authorization header is missing', async () => {
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/prompt-vault/prompts/some-prompt-id',
        payload: {
          title: 'Updated Title',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-update-prompt' });

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/prompt-vault/prompts/some-prompt-id',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Updated Title',
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('rejects empty update (no title or prompt)', async () => {
      const token = await createToken({ sub: 'user-empty-update' });

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/prompt-vault/prompts/some-id',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('rejects title exceeding max length in update', async () => {
      const token = await createToken({ sub: 'user-long-update-title' });

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/prompt-vault/prompts/some-id',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'x'.repeat(201),
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns NOT_FOUND for non-existent prompt', async () => {
      const token = await createToken({ sub: 'user-update-nonexistent' });

      // Set up connection directly through repository
      await setupConnection(ctx, 'user-update-nonexistent', 'page-id');

      // Mock retrieve to throw object_not_found error
      const notFoundError = {
        code: 'object_not_found',
        message: 'Could not find page with ID: nonexistent-id',
      };
      mockNotionMethods.retrieve.mockRejectedValueOnce(notFoundError);

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/prompt-vault/prompts/nonexistent-id',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'New Title',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('updates prompt successfully when it exists', async () => {
      const token = await createToken({ sub: 'user-update-success' });

      // Set up connection directly through repository
      await setupConnection(ctx, 'user-update-success', 'page-id');

      // Mock update for title
      mockNotionMethods.update.mockResolvedValueOnce({
        id: 'update-prompt-id',
        properties: { title: { title: [{ plain_text: 'Updated Title' }] } },
      });

      // Mock listBlocks for content update - first call gets existing blocks
      mockNotionMethods.listBlocks.mockResolvedValueOnce({
        results: [
          {
            type: 'code',
            id: 'block-1',
            code: { rich_text: [{ plain_text: 'Original content' }] },
          },
        ],
      });

      // Mock updateBlock for updating the content block
      mockNotionMethods.updateBlock.mockResolvedValueOnce({
        id: 'block-1',
        type: 'code',
        code: { rich_text: [{ plain_text: 'Updated content' }] },
      });

      // Mock retrieve for final getPromptById - returns updated title
      mockNotionMethods.retrieve.mockResolvedValueOnce({
        id: 'update-prompt-id',
        properties: { title: { title: [{ plain_text: 'Updated Title' }] } },
        url: 'https://notion.so/update-prompt-id',
      });

      // Mock listBlocks for final getPromptById - returns updated content
      mockNotionMethods.listBlocks.mockResolvedValueOnce({
        results: [
          {
            type: 'code',
            id: 'block-1',
            code: { rich_text: [{ plain_text: 'Updated content' }] },
          },
        ],
      });

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/prompt-vault/prompts/update-prompt-id',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'Updated Title',
          prompt: 'Updated content',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          prompt: {
            id: string;
            title: string;
            prompt: string;
            url: string;
          };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.prompt.id).toBe('update-prompt-id');
      expect(body.data.prompt.title).toBe('Updated Title');
      expect(body.data.prompt.prompt).toBe('Updated content');
      expect(body.data.prompt.url).toBe('https://notion.so/update-prompt-id');
    });

    it('updates only title when prompt not provided', async () => {
      const token = await createToken({ sub: 'user-update-title-only' });

      // Set up connection directly through repository
      await setupConnection(ctx, 'user-update-title-only', 'page-id');

      // Mock update for title only
      mockNotionMethods.update.mockResolvedValueOnce({
        id: 'update-title-id',
        properties: { title: { title: [{ plain_text: 'New Title Only' }] } },
      });

      // Mock retrieve for final getPromptById - returns updated title
      mockNotionMethods.retrieve.mockResolvedValueOnce({
        id: 'update-title-id',
        properties: { title: { title: [{ plain_text: 'New Title Only' }] } },
        url: 'https://notion.so/update-title-id',
      });

      // Mock listBlocks for final getPromptById - returns unchanged content
      mockNotionMethods.listBlocks.mockResolvedValueOnce({
        results: [
          {
            type: 'code',
            id: 'block-1',
            code: { rich_text: [{ plain_text: 'Original content' }] },
          },
        ],
      });

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/prompt-vault/prompts/update-title-id',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: 'New Title Only',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          prompt: {
            id: string;
            title: string;
            prompt: string;
          };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.prompt.title).toBe('New Title Only');
      expect(body.data.prompt.prompt).toBe('Original content');
    });

    it('updates only prompt when title not provided', async () => {
      const token = await createToken({ sub: 'user-update-prompt-only' });

      // Set up connection directly through repository
      await setupConnection(ctx, 'user-update-prompt-only', 'page-id');

      // Mock retrieve to return the existing page (called twice)
      mockNotionMethods.retrieve
        .mockResolvedValueOnce({
          id: 'update-prompt-only-id',
          properties: { title: { title: [{ plain_text: 'Original Title' }] } },
          url: 'https://notion.so/update-prompt-only-id',
        })
        .mockResolvedValueOnce({
          id: 'update-prompt-only-id',
          properties: { title: { title: [{ plain_text: 'Original Title' }] } },
          url: 'https://notion.so/update-prompt-only-id',
        });

      // Mock listBlocks to return original content, then updated content (must be 'code' blocks)
      mockNotionMethods.listBlocks
        .mockResolvedValueOnce({
          results: [
            {
              type: 'code',
              id: 'block-1',
              code: { rich_text: [{ plain_text: 'Original content' }] },
            },
          ],
        })
        .mockResolvedValueOnce({
          results: [
            {
              type: 'code',
              id: 'block-1',
              code: { rich_text: [{ plain_text: 'New content only' }] },
            },
          ],
        });

      // Mock deleteBlock and appendBlocks for content update
      mockNotionMethods.deleteBlock.mockResolvedValueOnce({});
      mockNotionMethods.appendBlocks.mockResolvedValueOnce({ results: [] });

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/prompt-vault/prompts/update-prompt-only-id',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          prompt: 'New content only',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          prompt: {
            id: string;
            title: string;
            prompt: string;
          };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.prompt.title).toBe('Original Title');
      expect(body.data.prompt.prompt).toBe('New content only');
    });
  });
});
