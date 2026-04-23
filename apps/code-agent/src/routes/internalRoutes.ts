import type { FastifyPluginCallback } from 'fastify';
import { cleanupRoutes } from './internal/cleanup-routes.js';
import { diagnosticRoutes } from './internal/diagnostic-routes.js';
import { taskAdminRoutes } from './internal/task-admin-routes.js';

/**
 * Aggregator for internal routes (INT-1433).
 *
 * Each sub-plugin owns a cohesive slice of `/internal/*` endpoints:
 * - `cleanupRoutes`    — 6 scheduler-triggered endpoints (auth via `authenticateInternalScheduler`).
 * - `taskAdminRoutes`  — dispatch-metadata fallback (auth via `validateInternalAuth`).
 * - `diagnosticRoutes` — linear-agent issue-context proxy (auth via `validateInternalAuth`).
 *
 * The exported `internalRoutes` name is preserved so `routes/index.ts` remains
 * unchanged. Security-critical auth behavior is delegated to the sub-plugins.
 */
export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.register(cleanupRoutes);
  fastify.register(taskAdminRoutes);
  fastify.register(diagnosticRoutes);
  done();
};
