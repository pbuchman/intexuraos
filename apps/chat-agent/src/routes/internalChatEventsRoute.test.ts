import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import { setupFakeServices, resetFakeServices } from '../__tests__/fakes.fixture.js';
import type { FastifyInstance } from 'fastify';

const INTERNAL_AUTH_TOKEN = 'test-internal-token';
const ROUTE = '/internal/chat/events';

function validPayload(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    userId: 'user-123',
    source: 'github-webhook-agent',
    eventId: `evt-${crypto.randomUUID()}`,
    threadKey: 'pr-42',
    kind: 'status',
    message: 'Processing your webhook event...',
    ...overrides,
  };
}

describe('POST /internal/chat/events', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    setupFakeServices();
    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetFakeServices();
    delete process.env['NODE_ENV'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  describe('authentication', () => {
    it('rejects request without auth header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: ROUTE,
        payload: validPayload(),
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects request with wrong auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { 'x-internal-auth': 'wrong-token' },
        payload: validPayload(),
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('idempotency', () => {
    it('returns delivered:true on first submission', async () => {
      const response = await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validPayload({ eventId: 'evt-unique-1' }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { delivered: boolean; duplicate: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.delivered).toBe(true);
      expect(body.data.duplicate).toBe(false);
    });

    it('returns duplicate:true on second submission with same eventId', async () => {
      const payload = validPayload({ eventId: 'evt-dedup-test' });

      await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload,
      });

      const response = await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { delivered: boolean; duplicate: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.delivered).toBe(false);
      expect(body.data.duplicate).toBe(true);
    });
  });

  describe('payload validation', () => {
    it('rejects missing threadKey', async () => {
      const payload = validPayload();
      delete payload['threadKey'];

      const response = await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing userId', async () => {
      const payload = validPayload();
      delete payload['userId'];

      const response = await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing eventId', async () => {
      const payload = validPayload();
      delete payload['eventId'];

      const response = await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing message', async () => {
      const payload = validPayload();
      delete payload['message'];

      const response = await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing source', async () => {
      const payload = validPayload();
      delete payload['source'];

      const response = await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing kind', async () => {
      const payload = validPayload();
      delete payload['kind'];

      const response = await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it('accepts valid complete payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: ROUTE,
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validPayload(),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);
    });
  });
});
