/**
 * Routes for data-insights-service.
 */
import type { FastifyPluginAsync } from 'fastify';
import { dataSourceRoutes } from './dataSourceRoutes.js';

/**
 * Register all routes.
 */
export const dataInsightsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(dataSourceRoutes);
};
