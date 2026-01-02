/**
 * Routes for data-insights-service.
 */
import type { FastifyPluginAsync } from 'fastify';
import { internalRoutes } from './internalRoutes.js';
import { insightsRoutes } from './insightsRoutes.js';

/**
 * Register all routes.
 */
export const dataInsightsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(internalRoutes);
  await app.register(insightsRoutes);
};
