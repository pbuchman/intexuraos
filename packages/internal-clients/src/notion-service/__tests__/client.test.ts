import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotionServiceClient } from '../client.js';

const BASE_URL = 'http://notion-service.local';

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createNotionServiceClient', () => {
  it('returns token context on success', async () => {
    const scope = nock(BASE_URL)
      .get('/internal/notion/users/user-123/context')
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          connected: true,
          token: 'secret_notion_token',
        },
      });

    const client = createNotionServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const result = await client.getNotionToken('user-123');

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        connected: true,
        token: 'secret_notion_token',
      },
    });
  });

  it('returns page previews on success', async () => {
    nock(BASE_URL)
      .get('/internal/notion/users/user-123/pages/page-123/preview')
      .reply(200, {
        success: true,
        data: {
          title: 'Project Plan',
          url: 'https://notion.so/project-plan',
        },
      });

    const client = createNotionServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const result = await client.getPagePreview('user-123', 'page-123');

    expect(result).toEqual({
      ok: true,
      value: {
        title: 'Project Plan',
        url: 'https://notion.so/project-plan',
      },
    });
  });

  it('returns NOT_FOUND when page previews are missing', async () => {
    nock(BASE_URL)
      .get('/internal/notion/users/user-123/pages/page-456/preview')
      .reply(404, {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Page not found or not accessible',
        },
      });

    const client = createNotionServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const result = await client.getPagePreview('user-123', 'page-456');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Page not found or not accessible',
      },
    });
  });

  it('uses object-form preview error messages from non-2xx responses', async () => {
    nock(BASE_URL)
      .get('/internal/notion/users/user-123/pages/page-789/preview')
      .reply(503, {
        success: false,
        error: { code: 'DOWNSTREAM_ERROR', message: 'Downstream failure' },
      });

    const client = createNotionServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const result = await client.getPagePreview('user-123', 'page-789');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNAVAILABLE',
        message: 'Downstream failure',
      },
    });
  });

  it('falls back to Unknown error when preview failures use an object error without a string message', async () => {
    nock(BASE_URL)
      .get('/internal/notion/users/user-123/pages/page-790/preview')
      .reply(503, {
        success: false,
        error: { code: 'DOWNSTREAM_ERROR' },
      });

    const client = createNotionServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const result = await client.getPagePreview('user-123', 'page-790');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNAVAILABLE',
        message: 'Unknown error',
      },
    });
  });

  it('fails closed when token context returns success=false', async () => {
    nock(BASE_URL)
      .get('/internal/notion/users/user-123/context')
      .reply(200, {
        success: false,
        error: {
          code: 'DOWNSTREAM_ERROR',
          message: 'Notion repository unavailable',
        },
      });

    const client = createNotionServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const result = await client.getNotionToken('user-123');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'DOWNSTREAM_ERROR',
        message: 'DOWNSTREAM_ERROR: Notion repository unavailable',
      },
    });
  });

  it('fails closed when page previews return success=false', async () => {
    nock(BASE_URL)
      .get('/internal/notion/users/user-123/pages/page-999/preview')
      .reply(200, {
        success: false,
        error: {
          code: 'DOWNSTREAM_ERROR',
          message: 'Preview lookup failed',
        },
      });

    const client = createNotionServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
    });
    const result = await client.getPagePreview('user-123', 'page-999');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNAVAILABLE',
        message: 'DOWNSTREAM_ERROR: Preview lookup failed',
      },
    });
  });
});
