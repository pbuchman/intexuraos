import { describe, expect, it, vi } from 'vitest';

import {
  MATRIX_CORPUS_PRODUCTION_CONTROL_ORIGIN,
  createProductionControlAuthorizationHeaderProvider,
} from '../matrixCorpus/productionControlTransport.js';

describe('production Matrix corpus control authorization', () => {
  it('reuses one Google identity client and returns only its bearer header', async () => {
    const getRequestHeaders = vi
      .fn()
      .mockResolvedValue(new Headers({ authorization: 'Bearer production-id-token' }));
    const createIdentityClient = vi.fn().mockResolvedValue({ getRequestHeaders });
    const provider = createProductionControlAuthorizationHeaderProvider({
      createIdentityClient,
    });

    await expect(provider()).resolves.toBe('Bearer production-id-token');
    await expect(provider()).resolves.toBe('Bearer production-id-token');
    expect(MATRIX_CORPUS_PRODUCTION_CONTROL_ORIGIN).toBe('https://intexuraos.cloud');
    expect(createIdentityClient).toHaveBeenCalledTimes(1);
    expect(getRequestHeaders).toHaveBeenCalledWith('https://intexuraos.cloud');
  });

  it('fails closed without reflecting malformed identity headers', async () => {
    const provider = createProductionControlAuthorizationHeaderProvider({
      createIdentityClient: vi.fn().mockResolvedValue({
        getRequestHeaders: vi.fn().mockResolvedValue({ authorization: 'private malformed value' }),
      }),
    });

    await expect(provider()).rejects.toThrow('production_control_authorization_unavailable');
  });
});
