import nock from 'nock';
import { afterEach, describe, expect, it } from 'vitest';
import { postServiceFeedback } from '../serviceFeedback.js';

const BASE_URL = 'https://service-feedback.example.com';

afterEach(() => {
  nock.cleanAll();
});

describe('postServiceFeedback', () => {
  it('returns service feedback from a success envelope', async () => {
    nock(BASE_URL)
      .post('/internal/test')
      .reply(200, {
        success: true,
        data: {
          status: 'completed',
          message: 'done',
          resourceUrl: 'https://example.com/resource',
          errorCode: 'NONE',
        },
      });

    const result = await postServiceFeedback(
      {
        baseUrl: BASE_URL,
        internalAuthToken: 'secret',
        logger: { warn: () => undefined },
      },
      {
        path: '/internal/test',
        body: { ok: true },
        invalidJsonMessage: 'invalid json',
        invalidEnvelopeMessage: 'invalid envelope',
        networkErrorPrefix: 'network error',
        getDefaultHttpErrorMessage: (response) => `HTTP ${String(response.status)}`,
      }
    );

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'completed',
        message: 'done',
        resourceUrl: 'https://example.com/resource',
        errorCode: 'NONE',
      },
    });
  });

  it('returns a network error when the request cannot be sent', async () => {
    nock(BASE_URL).post('/internal/test').replyWithError('socket closed');

    const result = await postServiceFeedback(
      {
        baseUrl: BASE_URL,
        internalAuthToken: 'secret',
        logger: { warn: () => undefined },
      },
      {
        path: '/internal/test',
        body: { ok: true },
        invalidJsonMessage: 'invalid json',
        invalidEnvelopeMessage: 'invalid envelope',
        networkErrorPrefix: 'network error',
        getDefaultHttpErrorMessage: (response) => `HTTP ${String(response.status)}`,
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('network error:');
    }
  });

  it('returns the invalid envelope message when a success response lacks data', async () => {
    nock(BASE_URL).post('/internal/test').reply(200, {
      success: true,
    });

    const result = await postServiceFeedback(
      {
        baseUrl: BASE_URL,
        internalAuthToken: 'secret',
        logger: { warn: () => undefined },
      },
      {
        path: '/internal/test',
        body: { ok: true },
        invalidJsonMessage: 'invalid json',
        invalidEnvelopeMessage: 'invalid envelope',
        networkErrorPrefix: 'network error',
        getDefaultHttpErrorMessage: (response) => `HTTP ${String(response.status)}`,
      }
    );

    expect(result).toEqual({
      ok: false,
      error: new Error('invalid envelope'),
    });
  });

  it('returns a timeout error with the configured timeout', async () => {
    nock(BASE_URL)
      .post('/internal/test')
      .delay(50)
      .reply(200, {
        success: true,
        data: {
          status: 'completed',
          message: 'done',
        },
      });

    const result = await postServiceFeedback(
      {
        baseUrl: BASE_URL,
        internalAuthToken: 'secret',
        logger: { warn: () => undefined },
        defaultTimeoutMs: 1,
      },
      {
        path: '/internal/test',
        body: { ok: true },
        invalidJsonMessage: 'invalid json',
        invalidEnvelopeMessage: 'invalid envelope',
        networkErrorPrefix: 'network error',
        getDefaultHttpErrorMessage: (response) => `HTTP ${String(response.status)}`,
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('network error: Request exceeded 1ms');
    }
  });

  it('falls back to the default HTTP error message when error details are not an object', async () => {
    nock(BASE_URL).post('/internal/test').reply(500, {
      success: false,
      error: 'not-an-object',
    });

    const result = await postServiceFeedback(
      {
        baseUrl: BASE_URL,
        internalAuthToken: 'secret',
        logger: { warn: () => undefined },
      },
      {
        path: '/internal/test',
        body: { ok: true },
        invalidJsonMessage: 'invalid json',
        invalidEnvelopeMessage: 'invalid envelope',
        networkErrorPrefix: 'network error',
        getDefaultHttpErrorMessage: (response) => `HTTP ${String(response.status)}`,
      }
    );

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'failed',
        message: 'HTTP 500',
      },
    });
  });
});
