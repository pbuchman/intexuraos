/**
 * Tests for prompt CRUD routes:
 * - GET /v1/tools/notion/promptvault/main-page
 * - GET /v1/tools/notion/promptvault/prompts
 * - POST /v1/tools/notion/promptvault/prompts
 * - GET /v1/tools/notion/promptvault/prompts/:promptId
 * - PATCH /v1/tools/notion/promptvault/prompts/:promptId
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
 * This replaces the need to call /v1/integrations/notion/connect which was moved to notion-service.
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

  describe('GET /v1/tools/notion/promptvault/main-page', () => {
    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-main' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/v1/tools/notion/promptvault/main-page',
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
        url: '/v1/tools/notion/promptvault/main-page',
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
  });

  describe('GET /v1/tools/notion/promptvault/prompts (listPrompts)', () => {
    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-list-prompts' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/v1/tools/notion/promptvault/prompts',
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
        url: '/v1/tools/notion/promptvault/prompts',
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
  });

  describe('POST /v1/tools/notion/promptvault/prompts (createPrompt)', () => {
    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-create-prompt' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/v1/tools/notion/promptvault/prompts',
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
        url: '/v1/tools/notion/promptvault/prompts',
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
        url: '/v1/tools/notion/promptvault/prompts',
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
        url: '/v1/tools/notion/promptvault/prompts',
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
        url: '/v1/tools/notion/promptvault/prompts',
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
  });

  describe('GET /v1/tools/notion/promptvault/prompts/:promptId (getPrompt)', () => {
    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-get-prompt' });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/v1/tools/notion/promptvault/prompts/some-prompt-id',
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
        url: '/v1/tools/notion/promptvault/prompts/nonexistent-id',
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
  });

  describe('PATCH /v1/tools/notion/promptvault/prompts/:promptId (updatePrompt)', () => {
    it('fails with MISCONFIGURED when not connected', async () => {
      const token = await createToken({ sub: 'user-update-prompt' });

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/v1/tools/notion/promptvault/prompts/some-prompt-id',
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
        url: '/v1/tools/notion/promptvault/prompts/some-id',
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
        url: '/v1/tools/notion/promptvault/prompts/nonexistent-id',
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
  });
});
