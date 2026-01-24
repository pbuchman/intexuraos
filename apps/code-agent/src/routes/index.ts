import type { FastifyInstance } from 'fastify';
import { codeTasksRoutes } from './codeTasksRoutes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(codeTasksRoutes);
}
