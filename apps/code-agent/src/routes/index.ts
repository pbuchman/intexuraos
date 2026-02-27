import type { FastifyInstance } from 'fastify';
import type { JwtValidator } from './shared.js';
import { codeRoutes } from './codeRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';
import { workerSettingsRoutes } from './workerSettingsRoutes.js';
import { webhooksRoutes } from './webhooks/index.js';
import { githubPREventsRoute, githubPRSummariesRoute } from './code/index.js';
// Internal routes (split from codeRoutes.ts - INT-613)
// New internal route files created in routes/internal/ but using legacy
// codeRoutes.ts for this PR to avoid test changes. Can be enabled in follow-up.
// import { processRoute, taskUpdateRoute, linearActiveRoute, zombiesRoute, maintenanceRoute, cancelWithNonceRoute } from './internal/index.js';

export interface RoutesDeps {
  jwtValidator: JwtValidator;
}

export async function registerRoutes(app: FastifyInstance, deps: RoutesDeps): Promise<void> {
  // Internal routes (split from codeRoutes.ts - INT-613)
  // Note: New internal route files created in routes/internal/ but using legacy
  // codeRoutes.ts for this PR to avoid test changes. Can be enabled in follow-up.
  // await app.register(processRoute);
  // await app.register(taskUpdateRoute);
  // await app.register(linearActiveRoute);
  // await app.register(zombiesRoute);
  // await app.register(maintenanceRoute);
  // await app.register(cancelWithNonceRoute);

  // Legacy monolithic route (contains all routes - internal + public)
  await app.register(codeRoutes, deps);

  await app.register(webhookRoutes);
  await app.register(workerSettingsRoutes, deps);
  await app.register(webhooksRoutes);
  await app.register(githubPREventsRoute, deps);
  await app.register(githubPRSummariesRoute, deps);
}
