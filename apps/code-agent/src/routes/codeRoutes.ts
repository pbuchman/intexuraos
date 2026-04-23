/**
 * codeRoutes — thin Fastify plugin that composes resource-specific sub-plugins.
 *
 * Refactored in INT-1430 from a 4,786-line monolith into a resource-split
 * structure. All route logic now lives in `./code/*-routes.ts`, schemas in
 * `./code/schemas.ts`, and response-formatting helpers in
 * `./code/responseFormatters.ts`.
 *
 * This file intentionally remains the public plugin entrypoint — its export
 * is registered by `apps/code-agent/src/index.ts` (via `routes/index.ts`)
 * and MUST NOT be moved or renamed without updating both.
 *
 * Re-exports `timestampToIso`, `taskToApiResponse`, and `inFlightRequests` so
 * that existing external importers continue to resolve the same symbols they
 * did before the split (notably `./code/issueGroupRoutes.ts` and test
 * helpers that dynamic-import from this module).
 */
import type { FastifyPluginCallback } from 'fastify';

import { taskRoutes } from './code/task-routes.js';
import { queueRoutes } from './code/queue-routes.js';
import { askAgentRoutes } from './code/ask-agent-routes.js';
import { feedbackRoutes } from './code/feedback-routes.js';
import { linearRoutes } from './code/linear-routes.js';
import type { CodeRoutesOptions } from './code/types.js';

export type { CodeRoutesOptions, JwtValidator } from './code/types.js';
export {
  timestampToIso,
  taskToApiResponse,
  inFlightRequests,
} from './code/responseFormatters.js';

export const codeRoutes: FastifyPluginCallback<CodeRoutesOptions> = (fastify, opts, done) => {
  fastify.register(taskRoutes, opts);
  fastify.register(queueRoutes, opts);
  fastify.register(askAgentRoutes, opts);
  fastify.register(feedbackRoutes, opts);
  fastify.register(linearRoutes, opts);
  done();
};
