import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCalendarAgentServiceClient } from '../client.js';
import type { CalendarAgentServiceConfig } from '../types.js';

const BASE_URL = 'http://calendar-agent.test';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as CalendarAgentServiceConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createCalendarAgentServiceClient', () => {
  it('returns service feedback on process success', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/calendar/process-action', {
        action: {
          id: 'action-1',
          userId: 'user-1',
          title: 'Meeting',
        },
        text: 'Meeting',
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          status: 'completed',
          message: 'Calendar event created',
          resourceUrl: 'https://calendar.google.com/event/abc',
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.processAction({
      action: {
        id: 'action-1',
        userId: 'user-1',
        title: 'Meeting',
      },
      text: 'Meeting',
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        status: 'completed',
        message: 'Calendar event created',
        resourceUrl: 'https://calendar.google.com/event/abc',
      },
    });
  });

  it('maps non-2xx JSON process errors into failed service feedback', async () => {
    nock(BASE_URL)
      .post('/internal/calendar/process-action')
      .reply(401, {
        success: false,
        error: {
          code: 'TOKEN_ERROR',
          message: 'Token expired',
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.processAction({
      action: {
        id: 'action-1',
        userId: 'user-1',
        title: 'Meeting',
      },
      text: 'Meeting',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'failed',
        message: 'Token expired',
        errorCode: 'TOKEN_ERROR',
      },
    });
  });

  it('forwards request ids and explicit timeouts for processAction', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/calendar/process-action')
      .matchHeader('x-request-id', 'req-123')
      .reply(200, {
        success: true,
        data: {
          status: 'completed',
          message: 'Calendar event created',
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.processAction(
      {
        action: {
          id: 'action-1',
          userId: 'user-1',
          title: 'Meeting',
        },
        text: 'Meeting',
      },
      { requestId: 'req-123', timeoutMs: 5000 }
    );

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        status: 'completed',
        message: 'Calendar event created',
      },
    });
  });

  it('returns preview data on preview success', async () => {
    const scope = nock(BASE_URL)
      .get('/internal/calendar/preview/action-1')
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          preview: {
            actionId: 'action-1',
            userId: 'user-1',
            status: 'ready',
            summary: 'Tomorrow at noon',
            generatedAt: '2026-01-01T12:00:00.000Z',
          },
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getPreview('action-1');

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        actionId: 'action-1',
        userId: 'user-1',
        status: 'ready',
        summary: 'Tomorrow at noon',
        generatedAt: '2026-01-01T12:00:00.000Z',
      },
    });
  });

  it('returns preview error messages on generate-preview http failures', async () => {
    nock(BASE_URL)
      .post('/internal/calendar/preview')
      .reply(404, {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Preview not found',
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.generatePreview({
      actionId: 'action-1',
      userId: 'user-1',
      text: 'Meeting',
      currentDate: '2026-01-01T12:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Preview not found');
    }
  });

  it('falls back to the HTTP status text when preview errors lack an envelope body', async () => {
    nock(BASE_URL).post('/internal/calendar/preview').reply(500, 'server exploded');

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.generatePreview({
      actionId: 'action-1',
      userId: 'user-1',
      text: 'Meeting',
      currentDate: '2026-01-01T12:00:00.000Z',
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('HTTP 500: Internal Server Error'),
    });
  });

  it('falls back to the HTTP status text when the preview error body incorrectly claims success', async () => {
    nock(BASE_URL)
      .post('/internal/calendar/preview')
      .reply(500, {
        success: true,
        data: {
          preview: null,
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.generatePreview({
      actionId: 'action-1',
      userId: 'user-1',
      text: 'Meeting',
      currentDate: '2026-01-01T12:00:00.000Z',
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('HTTP 500: Internal Server Error'),
    });
  });
});
