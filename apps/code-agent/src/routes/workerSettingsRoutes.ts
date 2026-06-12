/**
 * Routes for per-user worker settings management.
 *
 * All routes require Auth0 JWT authentication.
 * Secrets are masked in responses (show last 3 chars only).
 *
 * The endpoints are implemented across three resource-specific sub-plugins:
 * - `settingCrudRoutes` — GET/POST/PATCH/DELETE on worker configurations
 * - `workerOpsRoutes` — per-worker operations (connectivity test, reorder)
 * - `configRoutes` — the five default-worker-type PATCH endpoints
 *
 * This module preserves the `workerSettingsRoutes` export so callers like
 * `apps/code-agent/src/routes/index.ts` do not need to change.
 */

import type { FastifyPluginCallback } from 'fastify';
import type { JwtValidator } from './codeRoutes.js';
import {
  settingCrudRoutes,
  workerOpsRoutes,
  configRoutes,
} from './worker-settings/index.js';

export interface WorkerSettingsRoutesOptions {
  jwtValidator: JwtValidator;
}

export const workerSettingsRoutes: FastifyPluginCallback<WorkerSettingsRoutesOptions> = (
  fastify,
  opts,
  done
) => {
  fastify.register(settingCrudRoutes, opts);
  fastify.register(workerOpsRoutes, opts);
  fastify.register(configRoutes, opts);
  done();
};
