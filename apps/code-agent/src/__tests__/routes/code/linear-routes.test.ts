/**
 * Smoke tests for the extracted linear-routes plugin (INT-1430).
 *
 * Detailed behavioural coverage for the active-linear-task lookup lives in
 * codeRoutes.test.ts via `app.inject()`. This file confirms the plugin exports
 * and registers the canonical URL after the split.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

import { linearRoutes } from '../../../routes/code/linear-routes.js';

describe('linearRoutes plugin', () => {
  it('is exported as a Fastify plugin callback', () => {
    expect(typeof linearRoutes).toBe('function');
  });

  it('registers /internal/code-tasks/linear/:linearIssueId/active', async () => {
    const app = Fastify();
    await app.register(linearRoutes, { jwtValidator: async () => undefined });
    await app.ready();

    expect(
      app.hasRoute({ method: 'GET', url: '/internal/code-tasks/linear/:linearIssueId/active' }),
    ).toBe(true);

    await app.close();
  });
});
