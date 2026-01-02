import type { FastifyInstance } from 'fastify';
import { internalRoutes } from './internalRoutes.js';
import { publicRoutes } from './publicRoutes.js';

export function registerRoutes(app: FastifyInstance): void {
  void app.register(internalRoutes);
  void app.register(publicRoutes);
}
