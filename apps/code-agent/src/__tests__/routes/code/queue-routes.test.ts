/**
 * Smoke tests for the extracted queue-routes plugin (INT-1430).
 *
 * Full behavioural coverage (queue listing, drain, retry-queue) lives in
 * codeQueue.test.ts and the drain-queue integration tests. This file only
 * confirms the plugin exports correctly and registers the canonical queue
 * URLs after the split.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

import { queueRoutes } from '../../../routes/code/queue-routes.js';

describe('queueRoutes plugin', () => {
  it('is exported as a Fastify plugin callback', () => {
    expect(typeof queueRoutes).toBe('function');
  });

  it('registers /code/queue, /code/system-status, and /internal/drain-queue', async () => {
    const app = Fastify();
    await app.register(queueRoutes, { jwtValidator: async () => undefined });
    await app.ready();

    expect(app.hasRoute({ method: 'GET', url: '/queue' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/system-status' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/internal/drain-queue' })).toBe(true);

    await app.close();
  });
});
