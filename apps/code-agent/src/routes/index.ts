import type { FastifyInstance } from 'fastify';
import { codeRoutes } from './codeRoutes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(codeRoutes);
}
