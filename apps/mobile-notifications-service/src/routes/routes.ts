/**
 * Routes for mobile-notifications-service.
 */
import type { FastifyPluginAsync } from 'fastify';
import { connectRoutes } from './connectRoutes.js';
import { statusRoutes } from './statusRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';
import { notificationRoutes } from './notificationRoutes.js';
import { filterRoutes } from './filterRoutes.js';

/**
 * Register all routes.
 */
export const mobileNotificationsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(connectRoutes);
  await app.register(statusRoutes);
  await app.register(webhookRoutes);
  await app.register(notificationRoutes);
  await app.register(filterRoutes);
};
