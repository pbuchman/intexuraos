/**
 * Routes for data-insights-agent.
 */
import type { FastifyPluginAsync } from 'fastify';
import { dataSourceRoutes } from './dataSourceRoutes.js';
import { compositeFeedRoutes } from './compositeFeedRoutes.js';
import { internalRoutes } from './internalRoutes.js';

/**
 * Register all routes.
 */
export const dataInsightsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(dataSourceRoutes);
  await app.register(compositeFeedRoutes);
  await app.register(internalRoutes);
};
