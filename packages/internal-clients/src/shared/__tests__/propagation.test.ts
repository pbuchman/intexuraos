import { describe, expect, it } from 'vitest';
import { runWithRequestContext } from '@intexuraos/common-core';
import { runWithRequestId } from '@intexuraos/common-http';
import { resolvePropagationHeaders } from '../propagation.js';

describe('resolvePropagationHeaders', () => {
  it('creates a fresh header object when no headers are supplied', async () => {
    const headers = await runWithRequestContext(
      { requestId: 'req-1', correlationId: 'corr-1' },
      async () => resolvePropagationHeaders()
    );

    expect(headers).toEqual({
      'x-request-id': 'req-1',
      'x-correlation-id': 'corr-1',
    });
  });

  it('falls back to the common-http request id when no request context exists', async () => {
    const headers = await runWithRequestId('http-request-id', async () =>
      resolvePropagationHeaders()
    );

    expect(headers).toEqual({
      'x-request-id': 'http-request-id',
    });
  });

  it('prefers an explicit request id override', async () => {
    const headers = await runWithRequestContext(
      { requestId: 'ctx-request-id', correlationId: 'ctx-correlation-id' },
      async () =>
        resolvePropagationHeaders({
          requestId: 'override-request-id',
        })
    );

    expect(headers).toEqual({
      'x-request-id': 'override-request-id',
      'x-correlation-id': 'ctx-correlation-id',
    });
  });

  it('does not emit an empty request id header', () => {
    expect(resolvePropagationHeaders({ requestId: '' })).toEqual({});
  });
});
