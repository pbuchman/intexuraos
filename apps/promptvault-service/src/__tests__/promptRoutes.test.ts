/**
 * Tests for prompt CRUD routes:
 * - GET /prompt-vault/main-page
 * - GET /prompt-vault/prompts
 * - POST /prompt-vault/prompts
 * - GET /prompt-vault/prompts/:prompt_id
 * - PATCH /prompt-vault/prompts/:prompt_id
 */
import {
  describe,
  it,
  expect,
  setupTestContext,
  createToken,
  type TestContext,
} from './testUtils.js';

/**
 * Helper to set up a Notion connection directly through the repository.
 * This replaces the need to call /notion/connect which is in notion-service.
 */
async function setupConnection(
  ctx: TestContext,
  userId: string,
  pageId = 'vault-page-id'
): Promise<void> {
  await ctx.connectionRepository.saveConnection(userId, pageId, 'secret-token');
  // Also set up the page in the mock Notion API
  ctx.notionApi.setPage(
    pageId,
    pageId === 'vault-page-id' ? 'Prompt Vault' : 'Test Page',
    'Block 1\n\nBlock 2\n\nBlock 3\n\nBlock 4'
  );
}

describe('Prompt Routes', () => {
  const ctx = setupTestContext();

  describe('GET /prompt-vault/main-page', () => {
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

      // Set up connection with null token to simulate token not found scenario
      ctx.connectionRepository.setConnection('user-no-token', null, 'vault-page-id', true);

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
      expect(body.error.message).toBe('Notion token not found.');
    });

    it('fails with DOWNSTREAM_ERROR when getToken fails', async () => {
      const token = await createToken({ sub: 'user-token-error' });

      // Set up connection
      await setupConnection(ctx, 'user-token-error');

      // Inject error for getToken
      ctx.connectionRepository.setGetTokenError({
        code: 'INTERNAL_ERROR',
        message: 'Database error',
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
      expect(body.error.message).toBe('Database error');
    });

    it('fails with DOWNSTREAM_ERROR when getConnection fails', async () => {
      const token = await createToken({ sub: 'user-conn-error' });

      // Set up connection
      await setupConnection(ctx, 'user-conn-error');

      // Inject error for getConnection
      ctx.connectionRepository.setGetConnectionError({
        code: 'INTERNAL_ERROR',
        message: 'Connection lookup failed',
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
      expect(body.error.message).toBe('Connection lookup failed');
    });

    it('fails with DOWNSTREAM_ERROR when Notion API fails', async () => {
      const token = await createToken({ sub: 'user-notion-error' });

      // Set up connection
      await setupConnection(ctx, 'user-notion-error');

      // Inject error for getPageWithPreview
      ctx.notionApi.setGetPageWithPreviewError({
        code: 'API_ERROR',
        message: 'Notion API rate limited',
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
      expect(body.error.message).toBe('Notion API rate limited');
    });

    it('fails with DOWNSTREAM_ERROR when isConnected fails', async () => {
      const token = await createToken({ sub: 'user-is-connected-error' });

      // Inject error for isConnected
      ctx.connectionRepository.setIsConnectedError({
        code: 'INTERNAL_ERROR',
        message: 'Database unavailable',
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
      expect(body.error.message).toBe('Database unavailable');
    });

    it('fails with MISCONFIGURED when config not found', async () => {
      const token = await createToken({ sub: 'user-config-not-found' });

      // Set up connection
      await setupConnection(ctx, 'user-config-not-found');

      // Force getConnection to return null (simulates data inconsistency)
      ctx.connectionRepository.setForceGetConnectionNull(true);

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
      expect(body.error.message).toBe('Notion configuration not found.');
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

      // Set up some child prompt pages
      ctx.notionApi.setPage('prompt-1', 'First Prompt', 'Content of first prompt');
      ctx.notionApi.setPage('prompt-2', 'Second Prompt', 'Content of second prompt');
      ctx.notionApi.addChildPage('vault-page', 'prompt-1');
      ctx.notionApi.addChildPage('vault-page', 'prompt-2');

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
      expect(body.data.prompts[1]?.title).toBe('Second Prompt');
    });

    it('fails with MISCONFIGURED when getToken fails', async () => {
      const token = await createToken({ sub: 'user-list-token-error' });

      // Set up connection first
      await setupConnection(ctx, 'user-list-token-error');

      // Inject error for getToken
      ctx.connectionRepository.setGetTokenError({
        code: 'INTERNAL_ERROR',
        message: 'Token retrieval failed',
      });

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
  });

  describe('POST /prompt-vault/prompts (createPrompt)', () => {
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
      expect(body.data.prompt.id).toBeDefined();
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

    it('fails with MISCONFIGURED when getToken fails during create', async () => {
      const token = await createToken({ sub: 'user-create-token-error' });

      // Set up connection first
      await setupConnection(ctx, 'user-create-token-error');

      // Inject error for getToken
      ctx.connectionRepository.setGetTokenError({
        code: 'INTERNAL_ERROR',
        message: 'Token retrieval failed',
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

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });
  });

  describe('GET /prompt-vault/prompts/:prompt_id (getPrompt)', () => {
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

      // Set up an existing prompt page
      ctx.notionApi.setPage('existing-prompt-id', 'My Prompt', 'This is the prompt content');

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

    it('returns NOT_FOUND for non-existent prompt', async () => {
      const token = await createToken({ sub: 'user-update-nonexistent' });

      // Set up connection directly through repository
      await setupConnection(ctx, 'user-update-nonexistent', 'page-id');

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

      // Set up an existing prompt page
      ctx.notionApi.setPage('update-prompt-id', 'Original Title', 'Original content');

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

      // Set up an existing prompt page
      ctx.notionApi.setPage('update-title-id', 'Original Title', 'Original content');

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

      // Set up an existing prompt page
      ctx.notionApi.setPage('update-prompt-only-id', 'Original Title', 'Original content');

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
