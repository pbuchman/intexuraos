import { describe, expect, it } from 'vitest';
import { runWithRequestContext } from '@intexuraos/common-core';
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
});
