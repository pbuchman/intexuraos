import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fishingAssistantRoutes } from '../routes/index.js';
import { intexuraFastifyPlugin, logIncomingRequest } from '@intexuraos/common-http';

vi.mock('@intexuraos/common-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intexuraos/common-http')>();

  return {
    ...actual,
    logIncomingRequest: vi.fn(),
  };
});

describe('fishing assistant routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.mocked(logIncomingRequest).mockClear();
    app = Fastify({ logger: false });
    await app.register(intexuraFastifyPlugin);
    await app.register(fishingAssistantRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /fishing-assistant/status', () => {
    it('logs the incoming status request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/status',
      });

      expect(response.statusCode).toBe(200);
      expect(logIncomingRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          url: '/status',
        }),
        { message: 'Received Fishing Assistant status request' }
      );
    });
  });
});
