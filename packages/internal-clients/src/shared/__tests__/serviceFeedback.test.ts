import nock from 'nock';
import { afterEach, describe, expect, it } from 'vitest';
import { postServiceFeedback } from '../serviceFeedback.js';

const BASE_URL = 'https://service-feedback.example.com';

afterEach(() => {
  nock.cleanAll();
});

describe('postServiceFeedback', () => {
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
