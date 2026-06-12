/**
 * Route tests for POST /guest-session.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { setupFakeServices, resetFakeServices } from './fakes.fixture.js';

describe('POST /guest-session', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    setupFakeServices();
    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetFakeServices();
    delete process.env['NODE_ENV'];
  });

  it('returns a token and expiresAt', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/guest-session',
      headers: { 'x-forwarded-for': '198.51.100.10' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.sessionToken).toBe('string');
    expect(typeof body.data.expiresAt).toBe('number');
    expect(body.data.expiresAt).toBeGreaterThan(Date.now());
  });

  it('issues different tokens on subsequent calls when sub differs', async () => {
    const services = setupFakeServices();
    services.fakeGuestSessionSigner.setNextSub('sub-1');
    app = await buildServer();
    const r1 = await app.inject({
      method: 'POST',
      url: '/guest-session',
      headers: { 'x-forwarded-for': '198.51.100.11' },
    });
    expect(r1.statusCode).toBe(200);
    const t1 = r1.json().data.sessionToken;

    services.fakeGuestSessionSigner.setNextSub('sub-2');
    const r2 = await app.inject({
      method: 'POST',
      url: '/guest-session',
      headers: { 'x-forwarded-for': '198.51.100.12' },
    });
    expect(r2.statusCode).toBe(200);
    const t2 = r2.json().data.sessionToken;
    expect(t1).not.toBe(t2);
  });
});
