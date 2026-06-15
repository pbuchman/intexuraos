/**
 * Smoke tests for the extracted task-routes plugin (INT-1430).
 *
 * Full per-endpoint behaviour is covered by the existing integration tests
 * (codeSubmit.test.ts, codeTasks.test.ts, codeCancel.test.ts, etc.). This
 * file only pins down that the plugin module exports the expected callback,
 * registers the canonical task URLs on the Fastify instance, and preserves
 * the task CRUD URL surface after the split.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

import { taskRoutes } from '../../../routes/code/task-routes.js';

const EXPECTED_ROUTES: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string }[] = [
  { method: 'POST', url: '/internal/code/process' },
  { method: 'POST', url: '/internal/code/submit' },
  { method: 'PATCH', url: '/internal/code-tasks/:taskId' },
  { method: 'GET', url: '/internal/code-tasks/zombies' },
  { method: 'POST', url: '/internal/code/detect-zombies' },
  { method: 'POST', url: '/internal/code/cancel-with-nonce' },
  { method: 'POST', url: '/internal/code/submit-phase2' },
  { method: 'POST', url: '/submit' },
  { method: 'GET', url: '/tasks' },
  { method: 'GET', url: '/tasks/:taskId' },
  { method: 'DELETE', url: '/tasks/:taskId' },
  { method: 'POST', url: '/tasks/:taskId/archive' },
  { method: 'POST', url: '/tasks/:taskId/implement' },
  { method: 'POST', url: '/cancel' },
  { method: 'POST', url: '/retry' },
  { method: 'GET', url: '/workers/status' },
  { method: 'POST', url: '/workers/refresh-status' },
];

describe('taskRoutes plugin', () => {
  it('is exported as a Fastify plugin callback', () => {
    expect(typeof taskRoutes).toBe('function');
  });

  it('registers every canonical task URL on the Fastify instance', async () => {
    const app = Fastify();
    await app.register(taskRoutes, { jwtValidator: async () => undefined });
    await app.ready();

    for (const { method, url } of EXPECTED_ROUTES) {
      expect(app.hasRoute({ method, url })).toBe(true);
    }

    await app.close();
  });
});
