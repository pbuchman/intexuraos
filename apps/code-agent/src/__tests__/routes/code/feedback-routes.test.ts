/**
 * Smoke tests for the extracted feedback-routes plugin (INT-1430).
 *
 * Detailed behavioural coverage for the feedback/message/heartbeat/
 * group-summary endpoints lives in codeRoutes.test.ts, codeRoutes.branches.test.ts
 * and groupSummaryRecompute.test.ts. This file confirms the plugin exports and
 * registers the canonical URLs after the split.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

import { feedbackRoutes } from '../../../routes/code/feedback-routes.js';

describe('feedbackRoutes plugin', () => {
  it('is exported as a Fastify plugin callback', () => {
    expect(typeof feedbackRoutes).toBe('function');
  });

  it('registers feedback, messages, heartbeat and group-summary recompute URLs', async () => {
    const app = Fastify();
    await app.register(feedbackRoutes, { jwtValidator: async () => undefined });
    await app.ready();

    expect(app.hasRoute({ method: 'POST', url: '/tasks/:taskId/feedback' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/tasks/:taskId/messages' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/internal/code/heartbeat' })).toBe(true);
    expect(app.hasRoute({ method: 'POST', url: '/internal/code/group-summary/recompute' })).toBe(
      true,
    );

    await app.close();
  });
});
