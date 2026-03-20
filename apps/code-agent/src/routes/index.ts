import type { FastifyInstance } from 'fastify';
import type { JwtValidator } from './codeRoutes.js';
import { codeRoutes } from './codeRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';
import { workerSettingsRoutes } from './workerSettingsRoutes.js';
import { webhooksRoutes } from './webhooks/index.js';
import { githubEventLogRoute, githubPREventsRoute, githubPRSummariesRoute } from './code/index.js';
import { internalRoutes } from './internalRoutes.js';

export interface RoutesDeps {
  jwtValidator: JwtValidator;
}

export async function registerRoutes(app: FastifyInstance, deps: RoutesDeps): Promise<void> {
  await app.register(codeRoutes, deps);
  await app.register(webhookRoutes);
  await app.register(workerSettingsRoutes, deps);
  await app.register(webhooksRoutes);
  await app.register(githubPREventsRoute, deps);
  await app.register(githubPRSummariesRoute, deps);
  await app.register(githubEventLogRoute, deps);
  await app.register(internalRoutes);
}
