/**
 * Smoke tests for the extracted ask-agent-routes plugin (INT-1430).
 *
 * Full behavioural coverage (start + active conflict cases) lives in
 * askAgentStart.test.ts and askAgentActive.test.ts. This file pins down the
 * plugin export and that both ask-agent URLs are registered after the split.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

import { askAgentRoutes } from '../../../routes/code/ask-agent-routes.js';

describe('askAgentRoutes plugin', () => {
  it('is exported as a Fastify plugin callback', () => {
    expect(typeof askAgentRoutes).toBe('function');
  });

  it('registers both /code/ask-agent/start and /code/ask-agent/active', async () => {
    const app = Fastify();
    await app.register(askAgentRoutes, { jwtValidator: async () => undefined });
    await app.ready();

    expect(app.hasRoute({ method: 'POST', url: '/ask-agent/start' })).toBe(true);
    expect(app.hasRoute({ method: 'GET', url: '/ask-agent/active' })).toBe(true);

    await app.close();
  });
});
