import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../../server.js';
import { setServices, resetServices } from '../../services.js';
import { createMockServices } from '../helpers/mockServices.js';

describe('GET /health', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    setServices(createMockServices());
    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  it('returns ok status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'code-agent',
    });
  });
});
