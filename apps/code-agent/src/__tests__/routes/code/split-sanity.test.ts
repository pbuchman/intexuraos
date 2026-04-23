/**
 * Split sanity tests for INT-1430.
 *
 * Behavioural coverage for the split routes lives in the pre-existing large
 * integration suites (`codeRoutes.test.ts`, `codeRoutes.branches.test.ts`,
 * `codeSubmit.test.ts`, `askAgentStart.test.ts`, `askAgentActive.test.ts`,
 * `codeQueue.test.ts`, `codeTasks.test.ts`, `codeCancel.test.ts`, etc.).
 *
 * This file only verifies the structural invariants introduced by the split:
 *   - each new resource plugin is exported as a Fastify plugin function
 *   - the thin `codeRoutes` plugin re-exports back-compat symbols
 *   - registering the thin plugin still wires up the expected public +
 *     internal endpoints (the URL surface has not changed)
 *
 * If any of these fail, it means the file split broke the external contract
 * even if the big integration suites pass in isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { codeRoutes, timestampToIso, taskToApiResponse, inFlightRequests } from '../../../routes/codeRoutes.js';
import { taskRoutes } from '../../../routes/code/task-routes.js';
import { queueRoutes } from '../../../routes/code/queue-routes.js';
import { askAgentRoutes } from '../../../routes/code/ask-agent-routes.js';
import { feedbackRoutes } from '../../../routes/code/feedback-routes.js';
import { linearRoutes } from '../../../routes/code/linear-routes.js';
import { resetServices } from '../../../services.js';

function buildMinimalApp(): FastifyInstance {
  // A Fastify instance without the shared intexura decorators is enough for
  // enumeration purposes: we only observe the routes Fastify registers via
  // the `onRoute` hook and never dispatch a request, so the reply helpers
  // `reply.ok/fail` don't need to exist on this instance.
  return Fastify();
}

describe('routes/code split (INT-1430) sanity', () => {
  beforeEach(() => {
    resetServices();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-exports back-compat symbols from codeRoutes.ts', () => {
    expect(typeof timestampToIso).toBe('function');
    expect(typeof taskToApiResponse).toBe('function');
    expect(inFlightRequests).toBeInstanceOf(Map);
  });

  it('each resource plugin is a callable Fastify plugin function', () => {
    for (const plugin of [taskRoutes, queueRoutes, askAgentRoutes, feedbackRoutes, linearRoutes]) {
      expect(typeof plugin).toBe('function');
      // FastifyPluginCallback has 3 parameters (fastify, opts, done)
      expect(plugin.length).toBe(3);
    }
  });

  it('codeRoutes registers the union of all resource URLs unchanged', async () => {
    const app = buildMinimalApp();
    const jwtValidator = async (): Promise<void> => {
      /* no-op; we never dispatch */
    };

    // Collect `METHOD url` pairs via the onRoute hook — this is Fastify's
    // stable public hook for enumerating registered routes without caring
    // about the internal trie print format.
    const registered = new Set<string>();
    app.addHook('onRoute', (route) => {
      const method = Array.isArray(route.method) ? route.method.join('|') : route.method;
      // Fastify auto-adds HEAD handlers for every GET — skip them since
      // we only want to assert the explicitly-declared routes.
      if (method === 'HEAD') return;
      registered.add(`${method} ${route.url}`);
    });

    await app.register(codeRoutes, { jwtValidator });

    const EXPECTED = new Set<string>([
      // task-routes
      'POST /internal/code/process',
      'POST /internal/code/submit',
      'PATCH /internal/code-tasks/:taskId',
      'GET /internal/code-tasks/zombies',
      'POST /code/submit',
      'GET /code/tasks',
      'GET /code/tasks/:taskId',
      'DELETE /code/tasks/:taskId',
      'POST /code/tasks/:taskId/archive',
      'POST /code/tasks/:taskId/implement',
      'POST /code/cancel',
      'POST /code/retry',
      'GET /code/workers/status',
      'POST /code/workers/refresh-status',
      'POST /internal/code/detect-zombies',
      'POST /internal/code/cancel-with-nonce',
      'POST /internal/code/submit-phase2',
      'POST /internal/tasks/cleanup-logs',
      // queue-routes
      'GET /code/queue',
      'POST /internal/drain-queue',
      // ask-agent-routes
      'POST /code/ask-agent/start',
      'GET /code/ask-agent/active',
      // feedback-routes
      'POST /internal/code/group-summary/recompute',
      'POST /internal/code/heartbeat',
      'POST /code/tasks/:taskId/feedback',
      'POST /code/tasks/:taskId/messages',
      // linear-routes
      'GET /internal/code-tasks/linear/:linearIssueId/active',
    ]);

    for (const expected of EXPECTED) {
      expect(registered, `missing: ${expected}`).toContain(expected);
    }
    // No unexpected routes slipped in — the thin plugin must be additive only.
    for (const actual of registered) {
      expect(EXPECTED, `unexpected: ${actual}`).toContain(actual);
    }
    expect(registered.size).toBe(EXPECTED.size);
  });

  it('timestampToIso handles every input branch', () => {
    expect(timestampToIso(undefined)).toBeUndefined();
    expect(timestampToIso('2024-01-01T00:00:00Z')).toBe('2024-01-01T00:00:00Z');
    const ts = { toDate: (): Date => new Date('2024-01-15T10:30:00Z') };
    expect(timestampToIso(ts)).toBe('2024-01-15T10:30:00.000Z');
    const badTs = { toDate: 'not a function' as unknown } as unknown as {
      toDate: () => Date;
    };
    expect(timestampToIso(badTs)).toBeUndefined();
  });
});
